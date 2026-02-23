"""
Virtual Serial Port Test - ASL Glove Simulator

This script simulates continuous sensor data from the ASL glove
by sending data through a virtual serial port (COM3).

Requirements:
    pip install pyserial

Usage:
    1. Make sure VSPE has COM3 <-> COM4 pair created
    2. Run this script (it will connect to COM3)
    3. Desktop app should connect to COM4
    4. Type a letter (A, B, C, ...) + Enter to switch. Keeps current letter until you change.
"""

import serial
import time
import random
import math
import threading

# Serial port configuration
PORT = 'COM3'  # Change to COM4 if needed
BAUD_RATE = 115200
SAMPLE_RATE = 0.02  # 50Hz (20ms between samples)

# Sensor calibration - MUST match SimulatorControl.tsx (thermistor glove)
# Thermistor: straight = higher, bent = lower (opposite of flex sensors)
# Updated for normalized model compatibility
BASELINES = [2700, 1650, 1850, 2110, 2125]  # straight (higher values)
MAXBENDS = [2200, 1300, 1480, 1640, 1720]   # fully bent (lower values)

def denormalize(normalized_values, baselines, maxbends):
    """Convert normalized 0-1 to raw sensor values (thermistor range)"""
    return [
        int(baselines[i] + normalized_values[i] * (maxbends[i] - baselines[i]))
        for i in range(5)
    ]

# ASL letter patterns (normalized 0-1) - ASL-correct shapes for display
# B: index must be straight (0.05) like middle/ring/pinky
ASL_PATTERNS_NORMALIZED = {
    'A': [0.00, 1.00, 0.90, 1.00, 1.00],
    'B': [0.74, 0.05, 0.06, 0.10, 0.13],
    'C': [0.00, 1.00, 0.85, 0.98, 0.86],
    'D': [0.09, 0.05, 0.85, 1.00, 0.79],   # index straight, others bent
    'E': [0.88, 1.00, 0.97, 1.00, 0.97],
    'F': [0.04, 0.52, 0.11, 0.26, 0.28],
    'I': [0.83, 0.99, 0.85, 0.98, 0.20],
    'K': [0.04, 0.53, 0.21, 0.87, 0.50],
    'O': [0.02, 0.91, 0.81, 0.98, 0.78],
    'S': [0.57, 0.92, 0.87, 1.00, 0.96],
    'T': [0.07, 0.88, 0.88, 1.00, 1.00],
    'V': [0.55, 0.31, 0.19, 0.94, 0.81],
    'W': [0.72, 0.09, 0.03, 0.15, 0.90],
    'X': [0.48, 0.33, 0.77, 0.92, 0.91],
    'Y': [0.01, 0.98, 0.91, 0.95, 0.03],
}

# Convert to raw sensor values
ASL_PATTERNS = {
    letter: denormalize(pattern, BASELINES, MAXBENDS)
    for letter, pattern in ASL_PATTERNS_NORMALIZED.items()
}

def add_noise(values, noise_level=8):
    """Add realistic sensor noise to values (thermistor range ~1300-2700)"""
    return [
        max(1000, min(3000, int(v + random.uniform(-noise_level, noise_level))))
        for v in values
    ]

def interpolate(start, end, factor):
    """Linear interpolation between two patterns"""
    return [
        int(start[i] + (end[i] - start[i]) * factor)
        for i in range(5)
    ]

def smooth_transition(pattern1, pattern2, steps=20):
    """Generate smooth transition between two patterns"""
    for i in range(steps):
        factor = i / steps
        # Use easing function for smoother movement
        eased_factor = 0.5 - 0.5 * math.cos(factor * math.pi)
        yield interpolate(pattern1, pattern2, eased_factor)

def main():
    print(f"Connecting to {PORT} at {BAUD_RATE} baud...")
    
    try:
        ser = serial.Serial(PORT, BAUD_RATE, timeout=1)
        print(f"✓ Connected to {PORT}")
        print("Sending continuous sensor data...")
        print("\nControls: Type a letter (A,B,C,D,E,F,I,K,O,S,T,V,W,X,Y) + Enter to switch.")
        print("          Keeps current letter until you change. Ctrl+C to stop.\n")
        
        # Shared: current letter (user controls via keyboard)
        current_letter = ['A']  # use list so closure can mutate
        valid_letters = sorted(ASL_PATTERNS.keys())
        
        def input_thread():
            while True:
                try:
                    inp = input("Letter> ").strip().upper()
                    if not inp:
                        continue
                    letter = inp[0]
                    if letter in ASL_PATTERNS:
                        current_letter[0] = letter
                        print(f"  → Switched to {letter}")
                    else:
                        print(f"  Valid: {', '.join(valid_letters)}")
                except EOFError:
                    break
                except Exception:
                    break
        
        t = threading.Thread(target=input_thread, daemon=True)
        t.start()
        
        sample_count = 0
        prev_letter = current_letter[0]
        
        while True:
            letter = current_letter[0]
            pattern = ASL_PATTERNS[letter]
            
            # Smooth transition when letter changed
            if letter != prev_letter:
                prev_pattern = ASL_PATTERNS[prev_letter]
                for interpolated in smooth_transition(prev_pattern, pattern, steps=25):
                    values = add_noise(interpolated)
                    ser.write((','.join(map(str, values)) + '\n').encode('utf-8'))
                    sample_count += 1
                    time.sleep(SAMPLE_RATE)
                prev_letter = letter
            
            # Send current letter continuously (keep holding)
            for _ in range(50):  # 1 second bursts, allows responsive letter change
                values = add_noise(pattern)
                ser.write((','.join(map(str, values)) + '\n').encode('utf-8'))
                sample_count += 1
                time.sleep(SAMPLE_RATE)
    
    except serial.SerialException as e:
        print(f"✗ Serial port error: {e}")
        print("\nTroubleshooting:")
        print("1. Make sure VSPE has COM3 <-> COM4 pair created and active")
        print("2. Close any other programs using COM3")
        print("3. Try changing PORT to 'COM4' in the script")
        return
    
    except KeyboardInterrupt:
        print("\n\n✓ Stopping serial simulator...")
        ser.close()
        print("Disconnected. Goodbye!")
    
    except Exception as e:
        print(f"✗ Unexpected error: {e}")
        if 'ser' in locals():
            ser.close()

if __name__ == "__main__":
    main()

