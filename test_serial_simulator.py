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
# Values extracted from actual professor training data (mean per letter).
# ch0=thumb, ch1=index, ch2=middle, ch3=ring, ch4=pinky
ASL_PATTERNS_NORMALIZED = {
    'A': [0.0040, 0.8067, 0.9911, 0.9987, 0.9976],
    'B': [0.9379, 0.0000, 0.0001, 0.0045, 0.1919],
    'C': [0.0256, 0.3829, 0.7685, 0.6533, 0.8023],
    'D': [0.7846, 0.0032, 0.7969, 0.8894, 0.8866],
    'E': [0.8581, 0.6188, 0.9779, 0.9826, 0.9116],
    'F': [0.8187, 0.5793, 0.0053, 0.0013, 0.0111],
    'G': [0.2084, 0.0000, 0.8620, 0.9432, 0.9218],
    'H': [0.9752, 0.0000, 0.2935, 0.8228, 0.5178],
    'I': [0.7892, 0.2775, 0.7126, 0.6707, 0.0083],
    'K': [0.0059, 0.0015, 0.0746, 0.7792, 0.5689],
    'L': [0.0000, 0.0000, 0.8554, 0.9833, 0.9902],
    'O': [0.0961, 0.2506, 0.8400, 0.7338, 0.5442],
    'P': [0.0000, 0.0000, 0.2932, 0.8840, 0.6322],
    'Q': [0.3055, 0.0000, 0.8943, 0.9169, 0.7865],
    'R': [0.8669, 0.0000, 0.2560, 0.7749, 0.8513],
    'S': [0.6921, 0.5537, 0.9941, 0.9902, 0.8541],
    'T': [0.0000, 0.4662, 0.8822, 0.7773, 0.8903],
    'V': [0.8134, 0.0000, 0.0225, 0.8406, 0.7180],
    'W': [0.9761, 0.0000, 0.0008, 0.0318, 0.4394],
    'X': [0.8555, 0.3450, 0.9520, 0.9814, 0.8685],
    'Y': [0.0781, 0.9664, 0.9122, 0.8085, 0.0271],
}
ASL_PATTERNS = {l: denormalize(p, BASELINES, MAXBENDS) for l, p in ASL_PATTERNS_NORMALIZED.items()}

# ── IMU quaternion orientations per letter ────────────────────────────────────
# Approximate hand orientations — unit quaternions (w, x, y, z) as a BNO055 would output.
# These drive BOTH the 3D desktop visualizer AND the 21-letter prediction model (IMU features).
# Letters G/H/P/Q/R require specific orientations to distinguish them from flex-identical twins.
IMU_QUATERNIONS = {
    # ── Flex-only letters: identity quaternion (IMU not used for these at inference) ──
    'A': ( 1.0000,  0.0000,  0.0000,  0.0000),
    'C': ( 1.0000,  0.0000,  0.0000,  0.0000),
    'E': ( 1.0000,  0.0000,  0.0000,  0.0000),
    'F': ( 1.0000,  0.0000,  0.0000,  0.0000),
    'I': ( 1.0000,  0.0000,  0.0000,  0.0000),
    'O': ( 1.0000,  0.0000,  0.0000,  0.0000),
    'S': ( 1.0000,  0.0000,  0.0000,  0.0000),
    'T': ( 1.0000,  0.0000,  0.0000,  0.0000),
    'V': ( 1.0000,  0.0000,  0.0000,  0.0000),
    'X': ( 1.0000,  0.0000,  0.0000,  0.0000),
    'Y': ( 1.0000,  0.0000,  0.0000,  0.0000),

    # ── IMU-required letters: mean quaternion from actual training recordings ──
    'B': ( 0.4358,  0.4781, -0.4257,  0.6244),
    'D': ( 0.4779,  0.5061, -0.5340,  0.4739),
    'G': ( 0.4780, -0.5103, -0.5969,  0.3904),
    'H': ( 0.5331, -0.5069, -0.5106,  0.4286),
    'K': ( 0.4861,  0.3582, -0.7495,  0.2595),
    'L': ( 0.3667,  0.5497, -0.3950,  0.6321),
    'P': ( 0.5500, -0.6344, -0.1630,  0.1022),
    'Q': (-0.1754, -0.6205, -0.2305,  0.6396),
    'R': (-0.3909, -0.5847, -0.3984,  0.5790),
    'W': ( 0.5432,  0.3863, -0.5543,  0.4864),
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

