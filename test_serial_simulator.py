"""
Virtual Serial Port Test - ASL Glove Simulator  (v6 — negated-Ohm format, matches real glove)

Simulates the full 23-value glove + armband output using the SAME format as the
esp32-new firmware:
  F0..F4   : positive Ohm values  (330*(3.3/V-1))  — increases when finger bends
  qw,qx,qy,qz: wrist BNO055 quaternion
  lx,ly,lz : linear acceleration [m/s²]
  gx,gy,gz : angular velocity    [deg/s]
  q1w..q1z : upper-arm armband quaternion
  q2w..q2z : forearm armband quaternion

Format per line:  "F0,F1,F2,F3,F4,qw,qx,qy,qz,lx,ly,lz,gx,gy,gz,q1w,q1x,q1y,q1z,q2w,q2x,q2y,q2z\n"

The desktop app uses DEFAULT_BASELINES for all positive-Ohm data
(both real glove and this simulator output the same positive format).

Requirements:
    pip install pyserial

Usage:
    1. Create a virtual COM pair in VSPE (e.g. COM3 <-> COM4)
    2. Run this script — it writes to COM3
    3. Desktop app connects to COM4
    4. Commands (type + Enter):
         Letters  : A B C D E F G H I K L O P Q R S T V W X Y
         Poses    : up   flat   down   left   right   tilt
         Arms     : arm_neutral  arm_raised  arm_side
         Reset    : reset  (back to the letter's own default IMU)
         Ctrl+C   : stop

   Pose reference (default letter state = palm faces camera, fingers pointing up/forward):
     flat  – palm faces FLOOR, fingers toward camera   [default]
     up    – fingers toward CEILING (+Y)
     tilt  – fingers 45° between ceiling and camera
     down  – fingers toward FLOOR (−Y)
     left  – fingers toward LEFT wall (−X)
     right – fingers toward RIGHT wall (+X)

Flex sensor calibration (positive-Ohm format, matches DEFAULT_BASELINES in App.tsx):
  BASELINES = straight (lower Ohm) : [1200,  8000, 10000,  8000,  6000]
  MAXBENDS  = fully bent (higher Ohm): [1800, 35000, 30000, 35000, 12000]
"""

import serial
import time
import random
import math
import threading

# ── Serial config ──────────────────────────────────────────────────────────────
PORT        = 'COM3'   # write side of the VSPE pair
BAUD_RATE   = 115200
SAMPLE_RATE = 0.02     # 50 Hz

# ── Flex sensor calibration (positive Ohm format — matches DEFAULT_BASELINES in App.tsx) ──
#   Index: thumb=0, index=1, middle=2, ring=3, pinky=4
#   Formula: 330 * (3.3/V - 1)  — straight = low Ohm, bent = high Ohm
BASELINES = [  850, 1370, 1480, 1040, 1760]   # straight (lower Ohm)
MAXBENDS  = [ 1050, 1950, 2050, 1450, 2200]   # fully bent (higher Ohm)

def denormalize(normalized):
    """Map 0-1 normalised pattern to negated-Ohm integer values."""
    return [
        int(BASELINES[i] + normalized[i] * (MAXBENDS[i] - BASELINES[i]))
        for i in range(5)
    ]

# ── ASL finger patterns (0 = straight, 1 = fully bent) ────────────────────────
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
ASL_PATTERNS = {l: denormalize(p) for l, p in ASL_PATTERNS_NORMALIZED.items()}

# ── Wrist IMU quaternions per letter (BNO055 absolute orientation) ─────────────
IMU_QUATERNIONS = {
    # Flex-only letters: identity quaternion (IMU not used during inference)
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
    # IMU-required letters — mean quaternion from actual training recordings
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

# ── Hand orientation presets (override letter's default wrist IMU) ─────────────
ORIENTATION_PRESETS = {
    'flat':  ( 1.0000,  0.0000,  0.0000,  0.0000),   # palm down, fingers toward camera
    'up':    ( 0.7071,  0.0000,  0.7071,  0.0000),   # fingers toward ceiling   (BNO Y negated in app)
    'tilt':  ( 0.9239,  0.0000, -0.3827,  0.0000),   # fingers 45° between ceiling and camera
    'down':  ( 0.7071,  0.0000, -0.7071,  0.0000),   # fingers toward floor     (BNO Y negated in app)
    'left':  ( 0.5000,  0.5000, -0.5000, -0.5000),   # fingers toward left wall
    'right': ( 0.5000, -0.5000, -0.5000,  0.5000),   # fingers toward right wall
    'reset': None,   # sentinel: revert to letter's own default IMU
}

# ── Armband quaternion presets (upper-arm q1, forearm q2) ─────────────────────
# Neutral: arm bent at ~90°, elbow down, forearm roughly horizontal (signing pose)
ARM_PRESETS = {
    #                   q1 (upper arm)                q2 (forearm)
    'arm_neutral': (
        ( 0.9239,  0.0000,  0.3827,  0.0000),   # upper arm ~45° forward/down
        ( 0.7071,  0.0000,  0.0000,  0.7071),   # forearm horizontal, palm inward
    ),
    'arm_raised': (
        ( 1.0000,  0.0000,  0.0000,  0.0000),   # upper arm straight up
        ( 0.7071,  0.7071,  0.0000,  0.0000),   # forearm horizontal
    ),
    'arm_side': (
        ( 0.7071,  0.0000,  0.0000, -0.7071),   # upper arm out to the side
        ( 0.7071,  0.0000,  0.7071,  0.0000),   # forearm up
    ),
}
DEFAULT_ARM = ARM_PRESETS['arm_neutral']

# ── Noise helpers ──────────────────────────────────────────────────────────────
def add_flex_noise(values, noise=50):
    """Add realistic noise to positive-Ohm values (higher = more bent)."""
    return [max(0, min(99999, int(v + random.uniform(-noise, noise)))) for v in values]

def add_imu_noise(quat, noise=0.003):
    """Add tiny noise to a quaternion and renormalise."""
    w, x, y, z = [v + random.uniform(-noise, noise) for v in quat]
    mag = math.sqrt(w*w + x*x + y*y + z*z)
    return w/mag, x/mag, y/mag, z/mag

def rand_motion(lscale=0.05, gscale=0.3):
    """Generate plausible resting linear-accel and gyro noise."""
    lx = random.gauss(0.0, lscale)
    ly = random.gauss(0.0, lscale)
    lz = random.gauss(0.0, lscale)
    gx = random.gauss(0.0, gscale)
    gy = random.gauss(0.0, gscale)
    gz = random.gauss(0.0, gscale)
    return lx, ly, lz, gx, gy, gz

def fmt_line(flex, imu, motion, q1, q2):
    """Build the 23-value CSV line the desktop expects."""
    flex_s   = ','.join(str(v) for v in flex)
    imu_s    = ','.join(f'{v:.4f}' for v in imu)
    motion_s = ','.join(f'{v:.4f}' for v in motion)
    q1_s     = ','.join(f'{v:.4f}' for v in q1)
    q2_s     = ','.join(f'{v:.4f}' for v in q2)
    return f'{flex_s},{imu_s},{motion_s},{q1_s},{q2_s}\n'

# ── Transition helpers ─────────────────────────────────────────────────────────
def interpolate_flex(a, b, t):
    return [int(a[i] + (b[i] - a[i]) * t) for i in range(5)]

def slerp(q1, q2, t):
    dot = sum(a*b for a, b in zip(q1, q2))
    if dot < 0:
        q2  = tuple(-v for v in q2)
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

def smooth_transition(flex1, flex2, imu1, imu2, arm1, arm2, steps=25):
    q1_from, q2_from = arm1
    q1_to,   q2_to   = arm2
    for i in range(steps):
        t = 0.5 - 0.5 * math.cos(i / steps * math.pi)   # cosine ease-in/out
        yield (
            interpolate_flex(flex1, flex2, t),
            slerp(imu1, imu2, t),
            slerp(q1_from, q1_to, t),
            slerp(q2_from, q2_to, t),
        )

# ── Main ───────────────────────────────────────────────────────────────────────
def main():
    print(f"Connecting to {PORT} at {BAUD_RATE} baud ...")
    try:
        ser = serial.Serial(PORT, BAUD_RATE, timeout=1)
        print(f"Connected.  Streaming 23-column ASL glove data at 50 Hz")
        print()
        print("── Letter commands ──────────────────────────────────────────────")
        print(f"  {', '.join(sorted(ASL_PATTERNS.keys()))}")
        print()
        print("── Orientation commands (wrist pose, keeps current letter) ──────")
        print("  flat   – palm faces FLOOR, fingers toward camera  [default]")
        print("  up     – fingers toward CEILING (+Y)")
        print("  tilt   – fingers 45° between ceiling and camera")
        print("  down   – fingers toward FLOOR (−Y)")
        print("  left   – fingers toward LEFT wall (−X)")
        print("  right  – fingers toward RIGHT wall (+X)")
        print("  reset  – restore this letter's own default IMU orientation")
        print()
        print("── Arm commands (armband pose) ───────────────────────────────────")
        print("  arm_neutral – elbow bent, signing at chest level  [default]")
        print("  arm_raised  – arm raised straight up")
        print("  arm_side    – arm extended out to the side")
        print()
        print("  Ctrl+C to stop.")
        print()

        current_letter = ['A']
        imu_override   = [None]     # None → use letter's own quaternion
        arm_override   = [None]     # None → use DEFAULT_ARM

        valid_letters = sorted(ASL_PATTERNS.keys())

        def input_thread():
            while True:
                try:
                    inp = input("> ").strip().lower()
                    if not inp:
                        continue
                    if inp in ORIENTATION_PRESETS:
                        preset = ORIENTATION_PRESETS[inp]
                        imu_override[0] = preset   # None for 'reset'
                        label = "reset → letter default" if preset is None else inp
                        print(f"  Wrist orientation → {label}")
                    elif inp in ARM_PRESETS:
                        arm_override[0] = ARM_PRESETS[inp]
                        print(f"  Arm pose → {inp}")
                    else:
                        letter = inp[0].upper()
                        if letter in ASL_PATTERNS:
                            current_letter[0] = letter
                            imu_override[0] = None   # always restore letter's own training quaternion
                            print(f"  Letter → {letter}  (wrist reset to training orientation)")
                        else:
                            print(f"  Unknown command.")
                            print(f"  Letters : {', '.join(valid_letters)}")
                            print(f"  Poses   : {', '.join(k for k in ORIENTATION_PRESETS if k != 'reset')}, reset")
                            print(f"  Arms    : {', '.join(ARM_PRESETS)}")
                except (EOFError, Exception):
                    break

        threading.Thread(target=input_thread, daemon=True).start()

        prev_letter = current_letter[0]
        prev_imu    = IMU_QUATERNIONS[prev_letter]
        prev_arm    = DEFAULT_ARM

        while True:
            letter   = current_letter[0]
            override = imu_override[0]
            arm      = arm_override[0] if arm_override[0] is not None else DEFAULT_ARM
            target_imu = override if override is not None else IMU_QUATERNIONS[letter]

            if letter != prev_letter or target_imu != prev_imu or arm != prev_arm:
                for flex, imu, q1, q2 in smooth_transition(
                    ASL_PATTERNS[prev_letter], ASL_PATTERNS[letter],
                    prev_imu, target_imu,
                    prev_arm, arm,
                    steps=25,
                ):
                    line = fmt_line(
                        add_flex_noise(flex),
                        add_imu_noise(imu),
                        rand_motion(),
                        add_imu_noise(q1),
                        add_imu_noise(q2),
                    )
                    ser.write(line.encode())
                    time.sleep(SAMPLE_RATE)
                prev_letter = letter
                prev_imu    = target_imu
                prev_arm    = arm

            # Hold current state (~1-second burst, responsive to input)
            flex       = ASL_PATTERNS[letter]
            imu        = target_imu
            q1_cur, q2_cur = arm
            for _ in range(50):
                override   = imu_override[0]
                arm        = arm_override[0] if arm_override[0] is not None else DEFAULT_ARM
                target_imu = override if override is not None else IMU_QUATERNIONS[letter]
                if target_imu != prev_imu or arm != prev_arm or current_letter[0] != letter:
                    break
                line = fmt_line(
                    add_flex_noise(flex),
                    add_imu_noise(imu),
                    rand_motion(),
                    add_imu_noise(q1_cur),
                    add_imu_noise(q2_cur),
                )
                ser.write(line.encode())
                time.sleep(SAMPLE_RATE)

    except serial.SerialException as e:
        print(f"\nSerial port error: {e}")
        print("  1. Make sure VSPE has a COM3 <-> COM4 virtual pair active")
        print("  2. Close any other program that may be using COM3")
        print("  3. Change PORT at the top of this script if needed")

    except KeyboardInterrupt:
        print("\nStopping …")
        if 'ser' in locals():
            ser.close()
        print("Disconnected.")

    except Exception as e:
        print(f"\nUnexpected error: {e}")
        if 'ser' in locals():
            ser.close()


if __name__ == "__main__":
    main()
