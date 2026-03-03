"""
Virtual Serial Port Test - ASL Glove Simulator

Simulates the full 9-value glove output:
  5 thermistor values + 4 BNO055 quaternion values (w, x, y, z)

Format per line:  "ch0,ch1,ch2,ch3,ch4,w,x,y,z\n"
  - 5 integers  : raw thermistor ADC readings
  - 4 floats    : unit quaternion from BNO055 IMU

The desktop app (Rust/Tauri) parses both:
  - 5-value lines  → flex sensor only (legacy)
  - 9-value lines  → flex + IMU (visualised separately, IMU NOT sent to model)

Requirements:
    pip install pyserial

Usage:
    1. Make sure VSPE has COM3 <-> COM4 pair created
    2. Run this script (it will connect to COM3)
    3. Desktop app should connect to COM4
    4. Commands (type + Enter):
         Letters  : A B C D E F G H I K L O P Q R S T V W X Y
         Poses    : up   flat   down   left   right   tilt
         Reset    : reset  (back to the letter's own default IMU)
         Ctrl+C   : stop

   Pose reference (default letter state = palm faces floor, fingers toward camera):
     flat  – palm faces FLOOR, fingers toward camera  [same as all letters by default]
     up    – fingers toward CEILING (+Y)
     tilt  – fingers 45° between ceiling and camera
     down  – fingers toward FLOOR (-Y)
     left  – fingers toward LEFT wall (-X)
     right – fingers toward RIGHT wall (+X)
"""

import serial
import time
import random
import math
import threading

# ── Serial config ─────────────────────────────────────────────────────────────
PORT      = 'COM3'   # change to COM4 if needed
BAUD_RATE = 115200
SAMPLE_RATE = 0.02   # 50 Hz

# ── Thermistor calibration ────────────────────────────────────────────────────
BASELINES = [2700, 1650, 1850, 2110, 2125]  # straight  (higher ADC)
MAXBENDS  = [2200, 1300, 1480, 1640, 1720]  # fully bent (lower ADC)

def denormalize(normalized, baselines, maxbends):
    return [int(baselines[i] + normalized[i] * (maxbends[i] - baselines[i])) for i in range(5)]

# ── ASL finger patterns (0=straight, 1=bent) ─────────────────────────────────
ASL_PATTERNS_NORMALIZED = {
    'A': [0.00, 1.00, 0.90, 1.00, 1.00],
    'B': [0.74, 0.05, 0.06, 0.10, 0.13],
    'C': [0.00, 1.00, 0.85, 0.98, 0.86],
    'D': [0.09, 0.05, 0.85, 1.00, 0.79],
    'E': [0.88, 1.00, 0.97, 1.00, 0.97],
    'F': [0.04, 0.52, 0.11, 0.26, 0.28],
    'G': [0.10, 0.10, 0.90, 0.95, 0.90],   # index+thumb out sideways, others bent
    'H': [0.70, 0.10, 0.10, 0.95, 0.90],   # index+middle out sideways, others bent
    'I': [0.83, 0.99, 0.85, 0.98, 0.20],
    'K': [0.04, 0.53, 0.21, 0.87, 0.50],
    'L': [0.05, 0.05, 0.90, 0.95, 0.90],   # thumb up + index forward, L-shape
    'O': [0.02, 0.91, 0.81, 0.98, 0.78],
    'P': [0.04, 0.53, 0.21, 0.87, 0.50],   # same flex as K, differs by IMU (pitched down)
    'Q': [0.10, 0.10, 0.90, 0.95, 0.90],   # same flex as G, differs by IMU (pitched down)
    'R': [0.55, 0.28, 0.22, 0.94, 0.81],   # index+middle crossed — similar to V, differs by IMU (fingers DOWN)
    'S': [0.57, 0.92, 0.87, 1.00, 0.96],
    'T': [0.07, 0.88, 0.88, 1.00, 1.00],
    'V': [0.55, 0.31, 0.19, 0.94, 0.81],
    'W': [0.72, 0.09, 0.03, 0.15, 0.90],
    'X': [0.48, 0.33, 0.77, 0.92, 0.91],
    'Y': [0.01, 0.98, 0.91, 0.95, 0.03],
}
ASL_PATTERNS = {l: denormalize(p, BASELINES, MAXBENDS) for l, p in ASL_PATTERNS_NORMALIZED.items()}

# ── IMU quaternion orientations per letter ────────────────────────────────────
# Approximate hand orientations — unit quaternions (w, x, y, z) as a BNO055 would output.
# These drive BOTH the 3D desktop visualizer AND the 21-letter prediction model (IMU features).
# Letters G/H/P/Q/R require specific orientations to distinguish them from flex-identical twins.
IMU_QUATERNIONS = {
    # ── Flex-only letters: near-identity (any orientation works at inference) ──
    'A': ( 0.9990,  0.0000,  0.0400,  0.0200),   # palm forward
    'B': ( 0.9980,  0.0600,  0.0000,  0.0000),   # palm forward, fingers up
    'C': ( 0.9950,  0.0000,  0.0980,  0.0200),   # palm forward, cupped
    'E': ( 0.9985,  0.0000,  0.0400,  0.0400),   # palm forward, all curled
    'F': ( 0.9975,  0.0500,  0.0600,  0.0200),   # palm forward
    'I': ( 0.9975,  0.0600, -0.0300,  0.0300),   # palm forward, pinky up
    'O': ( 0.9950,  0.0000,  0.0980,  0.0500),   # palm forward, O shape
    'S': ( 0.9985,  0.0200,  0.0400,  0.0400),   # palm forward, fist
    'T': ( 0.9970, -0.0710,  0.0000,  0.0100),   # palm sideways
    'V': ( 0.9980,  0.0000,  0.0500,  0.0300),   # palm forward, fingers UP
    'W': ( 0.9975,  0.0000,  0.0600,  0.0500),   # palm forward
    'X': ( 0.9970,  0.0710,  0.0300,  0.0000),   # palm sideways, hook
    'Y': ( 0.9980,  0.0000, -0.0500,  0.0300),   # palm forward

    # ── IMU-required letters: specific orientations the model was trained on ──
    # Quaternions derived to produce the correct visual in the Three.js desktop visualizer
    # (same pipeline: qRelViz axis-remap → multiply by Q_TARGET = 90° around X)
    'D': ( 0.9970,  0.0000,  0.0710,  0.0300),   # near-flat: index UP, distinguishes from G
    'K': ( 0.9960,  0.0000,  0.0870,  0.0300),   # near-flat: K shape UP, distinguishes from P
    'G': ( 0.5000, -0.5000, -0.5000,  0.5000),   # = 'right' preset: fingers point SIDEWAYS (+X)
    'H': ( 0.5000, -0.5000, -0.5000,  0.5000),   # same as G: index+middle point SIDEWAYS (+X)
    'L': ( 0.9800,  0.0000,  0.2000,  0.0000),   # near-flat with slight tilt: L-shape
    'P': ( 0.9239,  0.0000,  0.3827,  0.0000),   # 45° below flat: fingers point down-toward-camera (like K but tilted down)
    'Q': ( 0.8926, -0.3134, -0.0735,  0.3134),   # diagonal: between G(sideways) and P(tilted-down)
    'R': ( 0.8191,  0.0000,  0.5735,  0.0000),   # 70° below flat: fingers steeply down-toward-camera (distinguishes from V=flat)
}

# ── IMU orientation presets (overrides letter's default IMU) ──────────────────
# The visualizer remaps BNO axes before applying Q_TARGET (90° around X):
#   qRelViz = { w:qRel.w, x:qRel.y, y:qRel.z, z:qRel.x }
#   Then: qFinal = qRelViz * Q_TARGET
#
# Consequence: BNO Y rotation → Viz X rotation → tilts fingers up/down.
#              BNO X rotation → Viz Z rotation → rolls palm left/right (does NOT tilt fingers).
#
# Default/identity BNO state (all letters near identity):
#   fingers point toward camera (+Z in Three.js), palm faces floor (-Y)
#   = hand lying flat on a desk, fingers pointing toward the viewer
#
# Derived by solving qFinal = desired_world_rotation * Q_TARGET⁻¹ then
# reversing the axis remap to recover the required BNO quaternion:
#
#   flat/default → identity → fingers toward camera, palm down   (same as letters A–Y default)
#   up           → -90° BNO Y → qFinal=identity → fingers toward +Y (ceiling)
#   tilt         → +22.5° BNO Y → fingers 45° downward from ceiling
#   down         → +90° BNO Y  → qFinal=180°X  → fingers toward -Y (floor)
#   left         → +90° around combined axes → fingers toward -X (left wall)
#   right        → -90° around combined axes → fingers toward +X (right wall)
ORIENTATION_PRESETS = {
    # fingers toward camera, palm down — this is the same as the default letter state
    'flat':   (1.0000,  0.0000,  0.0000,  0.0000),
    # -90° BNO Y  →  qFinal = identity  →  fingers toward ceiling (+Y)
    'up':     (0.7071,  0.0000, -0.7071,  0.0000),
    # +22.5° BNO Y  →  fingers 45° between ceiling and camera
    'tilt':   (0.9239,  0.0000,  0.3827,  0.0000),
    # +90° BNO Y  →  qFinal = 180° X  →  fingers toward floor (-Y)
    'down':   (0.7071,  0.0000,  0.7071,  0.0000),
    # +90° BNO Z  →  qFinal = 90° Z  →  fingers toward left wall (-X)
    'left':   (0.5000,  0.5000, -0.5000, -0.5000),
    # -90° BNO Z  →  qFinal = -90° Z  →  fingers toward right wall (+X)
    'right':  (0.5000, -0.5000, -0.5000,  0.5000),
    'reset':  None,   # sentinel: revert to the letter's own default IMU
}

# ── Noise helpers ─────────────────────────────────────────────────────────────
def add_flex_noise(values, noise=8):
    return [max(1000, min(3000, int(v + random.uniform(-noise, noise)))) for v in values]

def add_imu_noise(quat, noise=0.003):
    """Add tiny noise to quaternion and re-normalise."""
    w, x, y, z = [v + random.uniform(-noise, noise) for v in quat]
    mag = math.sqrt(w*w + x*x + y*y + z*z)
    return w/mag, x/mag, y/mag, z/mag

def fmt_line(flex, imu):
    """Build the 9-value CSV line the desktop expects."""
    flex_str = ','.join(map(str, flex))
    imu_str  = ','.join(f'{v:.4f}' for v in imu)
    return f'{flex_str},{imu_str}\n'

# ── Transition helpers ────────────────────────────────────────────────────────
def interpolate(a, b, t):
    return [int(a[i] + (b[i] - a[i]) * t) for i in range(len(a))]

def slerp(q1, q2, t):
    """Spherical linear interpolation between two quaternions."""
    dot = sum(a*b for a, b in zip(q1, q2))
    # Ensure shortest path
    if dot < 0:
        q2 = tuple(-v for v in q2)
        dot = -dot
    dot = min(1.0, dot)
    if dot > 0.9995:
        result = tuple(q1[i] + t * (q2[i] - q1[i]) for i in range(4))
    else:
        theta_0 = math.acos(dot)
        theta   = theta_0 * t
        sin_t   = math.sin(theta)
        sin_0   = math.sin(theta_0)
        s1 = math.cos(theta) - dot * sin_t / sin_0
        s2 = sin_t / sin_0
        result = tuple(s1 * q1[i] + s2 * q2[i] for i in range(4))
    mag = math.sqrt(sum(v*v for v in result))
    return tuple(v/mag for v in result)

def smooth_transition(flex1, flex2, imu1, imu2, steps=25):
    for i in range(steps):
        t = 0.5 - 0.5 * math.cos(i / steps * math.pi)  # cosine ease
        yield interpolate(flex1, flex2, t), slerp(imu1, imu2, t)

# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    print(f"Connecting to {PORT} at {BAUD_RATE} baud...")
    try:
        ser = serial.Serial(PORT, BAUD_RATE, timeout=1)
        print(f"Connected to {PORT}")
        print("Sending flex + IMU quaternion data at 50 Hz")
        print("Format: ch0,ch1,ch2,ch3,ch4,w,x,y,z")
        print()
        print("── Letter commands ──────────────────────────────────────────")
        print(f"  {', '.join(sorted(ASL_PATTERNS.keys()))}")
        print()
        print("── Orientation commands (change hand angle, keep current letter) ──")
        print("  flat   – palm faces FLOOR, fingers toward camera  [default letter state]")
        print("  up     – fingers toward CEILING (+Y)")
        print("  tilt   – fingers 45° between ceiling and camera")
        print("  down   – fingers toward the FLOOR (-Y)")
        print("  left   – fingers toward the LEFT wall (-X)")
        print("  right  – fingers toward the RIGHT wall (+X)")
        print("  reset  – revert to this letter's own default IMU orientation")
        print()
        print("  Ctrl+C to stop.")
        print()

        # Shared state — use lists so the input thread can mutate them
        current_letter  = ['A']
        imu_override    = [None]   # None = use letter's default IMU

        valid_letters   = sorted(ASL_PATTERNS.keys())
        valid_poses     = sorted(ORIENTATION_PRESETS.keys())

        def input_thread():
            while True:
                try:
                    inp = input("> ").strip().lower()
                    if not inp:
                        continue

                    # Check orientation preset first (multi-char keywords)
                    if inp in ORIENTATION_PRESETS:
                        preset = ORIENTATION_PRESETS[inp]
                        imu_override[0] = preset   # None for 'reset'
                        if preset is None:
                            print(f"  IMU reset → using {current_letter[0]}'s default orientation")
                        else:
                            print(f"  Orientation → {inp}")
                        continue

                    # Otherwise treat as a letter command
                    letter = inp[0].upper()
                    if letter in ASL_PATTERNS:
                        current_letter[0] = letter
                        print(f"  Letter → {letter}  (IMU override: {'ON' if imu_override[0] else 'off'})")
                    else:
                        print(f"  Unknown command. Letters: {', '.join(valid_letters)}")
                        print(f"  Poses: {', '.join(valid_poses)}")
                except (EOFError, Exception):
                    break

        threading.Thread(target=input_thread, daemon=True).start()

        prev_letter      = current_letter[0]
        prev_imu         = IMU_QUATERNIONS[prev_letter]

        while True:
            letter   = current_letter[0]
            override = imu_override[0]
            target_imu = override if override is not None else IMU_QUATERNIONS[letter]

            if letter != prev_letter or target_imu != prev_imu:
                # Smooth transition in flex (if letter changed) and IMU
                for flex, imu in smooth_transition(
                    ASL_PATTERNS[prev_letter], ASL_PATTERNS[letter],
                    prev_imu, target_imu,
                    steps=25,
                ):
                    ser.write(fmt_line(add_flex_noise(flex), add_imu_noise(imu)).encode())
                    time.sleep(SAMPLE_RATE)
                prev_letter = letter
                prev_imu    = target_imu

            # Hold current state for 1-second burst (responsive to input changes)
            flex = ASL_PATTERNS[letter]
            imu  = target_imu
            for _ in range(50):
                # Re-read override in case it changed during this burst
                override   = imu_override[0]
                target_imu = override if override is not None else IMU_QUATERNIONS[letter]
                if target_imu != prev_imu:
                    break   # exit burst early, outer loop will smooth-transition
                ser.write(fmt_line(add_flex_noise(flex), add_imu_noise(imu)).encode())
                time.sleep(SAMPLE_RATE)

    except serial.SerialException as e:
        print(f"Serial port error: {e}")
        print("  1. Make sure VSPE has COM3 <-> COM4 pair active")
        print("  2. Close any other program using COM3")
        print("  3. Try changing PORT to 'COM4'")

    except KeyboardInterrupt:
        print("\nStopping...")
        if 'ser' in locals():
            ser.close()
        print("Disconnected.")

    except Exception as e:
        print(f"Unexpected error: {e}")
        if 'ser' in locals():
            ser.close()

if __name__ == "__main__":
    main()

