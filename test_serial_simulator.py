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
    4. Watch the real-time hand movements!
"""

import serial
import time
import random
import math

# Serial port configuration
PORT = 'COM3'  # Change to COM4 if needed
BAUD_RATE = 115200
SAMPLE_RATE = 0.02  # 50Hz (20ms between samples)

# Sensor calibration (from SimulatorControl.tsx)
BASELINES = [440, 612, 618, 548, 528]  # thumb, index, middle, ring, pinky (straight)
MAXBENDS = [650, 900, 900, 850, 800]   # fully bent

def denormalize(normalized_values, baselines, maxbends):
    """Convert normalized values (0-1) to raw sensor values"""
    return [
        int(baselines[i] + normalized_values[i] * (maxbends[i] - baselines[i]))
        for i in range(5)
    ]

# ASL letter patterns (normalized 0-1, matching SimulatorControl.tsx exactly)
ASL_PATTERNS_NORMALIZED = {
    'A': [0.02, 0.68, 0.78, 0.65, 0.68],
    'B': [0.42, 0.13, 0.24, 0.26, 0.32],
    'C': [0.31, 0.56, 0.70, 0.59, 0.59],
    'D': [0.40, 0.04, 0.74, 0.64, 0.66],
    'E': [0.53, 0.61, 0.81, 0.64, 0.64],
    'F': [0.44, 0.43, 0.13, 0.22, 0.33],
    'I': [0.47, 0.68, 0.74, 0.66, 0.22],
    'K': [0.13, 0.00, 0.35, 0.65, 0.68],
    'O': [0.50, 0.50, 0.58, 0.58, 0.54],
    'S': [0.55, 0.67, 0.74, 0.68, 0.69],
    'T': [0.33, 0.20, 0.67, 0.63, 0.68],
    'V': [0.26, 0.03, 0.02, 0.95, 0.95],
    'W': [0.23, 0.12, 0.11, 0.22, 0.73],
    'X': [0.38, 0.47, 0.71, 0.65, 0.71],
    'Y': [0.00, 0.58, 0.71, 0.65, 0.24],
}

# Convert to raw sensor values
ASL_PATTERNS = {
    letter: denormalize(pattern, BASELINES, MAXBENDS)
    for letter, pattern in ASL_PATTERNS_NORMALIZED.items()
}

def add_noise(values, noise_level=8):
    """Add realistic sensor noise to values"""
    return [
        max(0, min(1023, int(v + random.uniform(-noise_level, noise_level))))
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
        print("Press Ctrl+C to stop\n")
        
        # Letter sequence to cycle through
        letters = ['A', 'B', 'C', 'D', 'E', 'V', 'W', 'Y', 'I']
        current_letter_idx = 0
        
        # Hold each letter for a bit, then smoothly transition
        samples_per_letter = 250  # ~4 seconds at 50Hz
        transition_steps = 25     # ~0.5 seconds transition
        
        sample_count = 0
        
        while True:
            current_letter = letters[current_letter_idx]
            next_letter = letters[(current_letter_idx + 1) % len(letters)]
            
            current_pattern = ASL_PATTERNS[current_letter]
            next_pattern = ASL_PATTERNS[next_letter]
            
            # Hold current letter
            for _ in range(samples_per_letter - transition_steps):
                values = add_noise(current_pattern)
                line = ','.join(map(str, values)) + '\n'
                ser.write(line.encode('utf-8'))
                
                sample_count += 1
                if sample_count % 50 == 0:  # Print every second
                    print(f"[{sample_count:5d}] Sending {current_letter}: {','.join(map(str, values))}")
                
                time.sleep(SAMPLE_RATE)
            
            # Smooth transition to next letter
            print(f"        → Transitioning from {current_letter} to {next_letter}...")
            for interpolated in smooth_transition(current_pattern, next_pattern, transition_steps):
                values = add_noise(interpolated)
                line = ','.join(map(str, values)) + '\n'
                ser.write(line.encode('utf-8'))
                
                sample_count += 1
                time.sleep(SAMPLE_RATE)
            
            current_letter_idx = (current_letter_idx + 1) % len(letters)
    
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

