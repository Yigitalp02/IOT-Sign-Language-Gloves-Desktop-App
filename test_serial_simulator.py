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
    4. Type a letter (A-Y) + Enter to switch. Ctrl+C to stop.
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
# Approximate hand orientations — palm facing forward, slight rotations per sign.
# Values are unit quaternions (w, x, y, z). Real BNO055 output would look like this.
# These are display-only: they are NOT used by the prediction model.
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
    'D': ( 0.9970,  0.0000,  0.0710,  0.0300),   # palm forward, index UP (distinguishes from G)
    'K': ( 0.9960,  0.0000,  0.0870,  0.0300),   # palm forward, K shape UP (distinguishes from P)
    'G': ( 0.7071,  0.0000,  0.7071,  0.0000),   # wrist rotated ~90° — index points LEFT
    'H': ( 0.7071,  0.0000,  0.7071,  0.0300),   # wrist rotated ~90° — index+middle point LEFT
    'L': ( 0.9800,  0.0000,  0.2000,  0.0000),   # palm forward, slight pitch — L-shape up
    'P': ( 0.9239,  0.3827,  0.0000,  0.0000),   # pitched DOWN ~45° (like K but floor-ward)
    'Q': ( 0.6533,  0.2706,  0.6533,  0.2706),   # rotated sideways + pitched DOWN (like G but floor-ward)
    'R': ( 0.2588,  0.9659,  0.0000,  0.0000),   # ~150° pitch — fingers pointing DOWNWARD (distinguishes from V)
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
        print("\nControls: Type a letter (A,B,C,D,E,F,I,K,O,S,T,V,W,X,Y) + Enter")
        print("          Ctrl+C to stop.\n")

        current_letter = ['A']
        valid_letters  = sorted(ASL_PATTERNS.keys())

        def input_thread():
            while True:
                try:
                    inp = input("Letter> ").strip().upper()
                    if not inp:
                        continue
                    letter = inp[0]
                    if letter in ASL_PATTERNS:
                        current_letter[0] = letter
                        print(f"  Switched to {letter}")
                    else:
                        print(f"  Valid: {', '.join(valid_letters)}")
                except (EOFError, Exception):
                    break

        threading.Thread(target=input_thread, daemon=True).start()

        prev_letter = current_letter[0]

        while True:
            letter = current_letter[0]

            if letter != prev_letter:
                # Smooth transition in both flex and IMU
                for flex, imu in smooth_transition(
                    ASL_PATTERNS[prev_letter], ASL_PATTERNS[letter],
                    IMU_QUATERNIONS[prev_letter], IMU_QUATERNIONS[letter],
                    steps=25,
                ):
                    ser.write(fmt_line(add_flex_noise(flex), add_imu_noise(imu)).encode())
                    time.sleep(SAMPLE_RATE)
                prev_letter = letter

            # Hold current letter for 1-second burst (responsive to input changes)
            flex = ASL_PATTERNS[letter]
            imu  = IMU_QUATERNIONS[letter]
            for _ in range(50):
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

