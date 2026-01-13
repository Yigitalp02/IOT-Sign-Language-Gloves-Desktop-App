# 🎬 Professor Demo Guide

**Demo Date:** Tomorrow  
**Features to Demonstrate:**
1. ✅ Text-to-Speech (Turkish & English)
2. ✅ Learning UI (Language switcher, Theme)
3. ✅ Hardware Connection Simulation
4. ✅ Real-time Data Capture

---

## 📋 Pre-Demo Checklist

### 1. Install Virtual Serial Port Software (Windows)

You need to create a **virtual serial port pair** so the simulator can send data to one port, and the desktop app can read from the other.

**Option A: com0com (Free, Recommended)**
1. Download: https://sourceforge.net/projects/com0com/
2. Install with default settings
3. Creates COM3 ↔ COM4 pair (or similar)

**Option B: Virtual Serial Port Driver (Trial)**
1. Download: https://www.eltima.com/products/vspdxp/
2. Creates paired ports easily

### 2. Verify Setup

```bash
# Check if pyserial is installed
pip list | findstr pyserial

# If not installed:
pip install pyserial
```

### 3. Test Desktop App

```bash
# Navigate to desktop app folder
cd C:\Users\Yigit\Desktop\iot-sign-language-desktop

# Start desktop app
pnpm tauri:dev
# OR
npm run tauri:dev
```

---

## 🎭 Demo Script (Step-by-Step)

### **Part 1: Text-to-Speech Demo** (2 minutes)

1. **Launch the desktop app**
   ```bash
   cd C:\Users\Yigit\Desktop\iot-sign-language-desktop
   pnpm tauri:dev
   ```

2. **Show the UI:**
   - Point out the clean, modern interface
   - Highlight the language switcher (English/Turkish)
   - Highlight the theme switcher (Light/Dark/System)

3. **Demo Text-to-Speech:**
   ```
   Professor, let me show you the text-to-speech feature...
   
   [Type in textarea]: "Hello professor, this is a sign language recognition demo."
   [Click]: "🔊 Speak (English)"
   
   [Change language to Turkish]
   [Type in textarea]: "Merhaba hocam, bu bir işaret dili tanıma demosu."
   [Click]: "🔊 Speak (Turkish)"
   ```

4. **Explain:**
   > "The app uses the Web Speech API to convert text to speech in multiple languages. 
   > This is useful for sign language learners who want to hear pronunciations."

---

### **Part 2: Hardware Connection Simulation** (3 minutes)

#### **Terminal 1: Start the Glove Simulator**

```bash
cd iot-sign-glove

# Simulate gesture "A" from user 1, looping continuously
python scripts/glove_simulator.py --port COM3 --gesture A --loop --speed 1.0
```

**Expected Output:**
```
============================================================
🎮 IoT Glove Simulator
============================================================
Port: COM3
Baud Rate: 115200
Samples: 250
Speed: 1.0x
Loop: Yes
============================================================

✓ Connected to COM3

▶️  Starting data transmission...
   (Press Ctrl+C to stop)

📡 Iteration 1 - Sending 250 samples...
   Progress: 50/250 (20.0%)
   Progress: 100/250 (40.0%)
   ...
```

#### **Desktop App: Connect to Virtual Port**

1. **In the Connection Manager section:**
   - Click the **"↻ Scan"** button
   - Select **COM4** (the paired port) from dropdown
   - Click **"Connect"**

2. **Show Real-Time Data:**
   - Point to the **green indicator** (Connected)
   - Show the **5 sensor channels (CH0-CH4)** updating in real-time
   - Explain: "These are the flex sensor resistance values from the 5 fingers"

3. **Explain the Simulation:**
   ```
   Professor, since we don't have the physical glove right now, 
   I'm simulating it by reading data from your dataset and sending 
   it over a virtual serial port. The app receives it exactly as 
   it would from real hardware via Bluetooth.
   
   COM3 (simulator) ←→ COM4 (desktop app)
   ```

---

### **Part 3: Data Capture Demo** (3 minutes)

1. **Calibration:**
   ```
   Now let me show you the calibration process...
   
   [Click]: "Baseline (straight)"
   [Wait 2 seconds - show the countdown/calibration in progress]
   [Alert pops up]: "✓ baseline calibrated: [500, 520, 510, 505, 515]"
   
   [Click]: "Max Bend (fist)"
   [Wait 2 seconds]
   [Alert pops up]: "✓ maxbend calibrated: [850, 870, 860, 855, 865]"
   ```

2. **Recording a Gesture:**
   ```
   [Set User ID]: "DEMO01"
   [Set Session ID]: "S1"
   [Select Gesture]: "A"
   
   [Click]: "⏺ Start Recording"
   [Watch sample counter increase: 0 → 50 → 100 → 150...]
   [After ~3 seconds, click]: "⏹ Stop Recording"
   
   [Alert pops up]: "✓ Saved 250 samples for gesture "A""
   ```

3. **Explain Data Storage:**
   ```
   Professor, the app saves the data in CSV format with:
   - Raw sensor values (ch0_raw to ch4_raw)
   - Normalized values (0-1 range)
   - Calibration data (baseline and maxbend)
   - Timestamps, user ID, session ID, gesture label
   
   This format is compatible with our ML pipeline.
   ```

4. **Show Saved File:**
   - Files are saved in: `C:\Users\Yigit\AppData\Roaming\iot-sign-language-desktop\recordings\`
   - Open one CSV file in Notepad/Excel to show the format

---

### **Part 4: "Learning UI" Explanation** (1 minute)

```
Professor, regarding the "learning UI" you mentioned...

[Demonstrate]:
1. Language Switcher (English ↔ Turkish)
   - "This helps Turkish users learn sign language in their native language"

2. Theme Switcher (Light ↔ Dark ↔ System)
   - "Users can choose comfortable visual settings"

3. Gesture Selection Dropdown
   - "Users select which gesture they want to practice and record"
   - [Show]: A, B, C, D, E, F, G, H, REST options

4. Real-time Feedback
   - "Users see live sensor values, so they can learn proper finger positioning"
```

---

## 🔧 Troubleshooting

### Problem: "No ports found" or "Port COM4 not available"

**Solution:**
1. Check virtual serial port software is running
2. Try different COM port numbers (COM5, COM6, etc.)
3. Update simulator and desktop app to use same port pair

```bash
# List available ports
python -c "import serial.tools.list_ports; [print(p.device) for p in serial.tools.list_ports.comports()]"
```

### Problem: Simulator says "Port already in use"

**Solution:**
```bash
# Close the simulator (Ctrl+C)
# Disconnect in desktop app
# Restart simulator
```

### Problem: Desktop app not receiving data

**Solution:**
1. Check that simulator is running and connected
2. Make sure desktop app is connected to the **paired port** (COM4 if simulator uses COM3)
3. Check baud rate matches (115200)
4. Restart both simulator and desktop app

---

## 📊 Key Talking Points for Your Professor

### 1. **System Architecture**
```
IoT Glove (ESP32) 
    ↓ [Bluetooth/Serial]
Desktop App (Tauri + React)
    ↓ [Saves CSV]
ML Pipeline (Python)
    ↓ [Trains Model]
Mobile App (React Native + TFLite)
    ↓ [Real-time Inference]
User sees predictions
```

### 2. **Technical Stack**
- **Desktop:** Tauri (Rust backend) + React (TypeScript frontend)
- **Hardware:** ESP32 + 5 flex sensors + BLE
- **ML:** Python, scikit-learn, 74.63% LOUO accuracy
- **Mobile:** React Native + TensorFlow Lite

### 3. **Novel Features**
- ✅ **Person-independent recognition** (74.63% on unseen users)
- ✅ **On-device inference** (no cloud required, privacy-preserving)
- ✅ **Multi-language support** (Turkish & English)
- ✅ **Real-time data visualization** (100Hz sampling)
- ✅ **Automatic calibration** (baseline + maxbend)

### 4. **Progress Summary**
- ✅ Dataset preprocessing & feature engineering
- ✅ ML model training (Random Forest, Gradient Boosting, MLP)
- ✅ Hyperparameter tuning
- ✅ Desktop app (data collection)
- 🔄 Mobile app (in progress)
- ⏳ Hardware integration (waiting for glove)

---

## 🎯 Quick Demo Commands

### **Terminal 1: Simulator**
```bash
cd iot-sign-glove
python scripts/glove_simulator.py --port COM3 --gesture A --loop
```

### **Terminal 2: Desktop App**
```bash
cd C:\Users\Yigit\Desktop\iot-sign-language-desktop
pnpm tauri:dev
```

---

## 📝 Post-Demo: What to Tell Your Professor

```
Professor, as you can see:

1. ✅ The desktop app successfully captures real-time data from the simulated glove
2. ✅ Text-to-speech works in both Turkish and English for accessibility
3. ✅ The UI is internationalized and theme-aware for better user experience
4. ✅ Data is saved in a structured CSV format compatible with our ML pipeline

Next steps:
- Complete mobile app development (React Native + TFLite)
- Integrate the trained Random Forest model (74.63% accuracy)
- Test with actual hardware when available
- Expand gesture set beyond current 20 gestures

Current accuracy: 74.63% Leave-One-User-Out (person-independent)
This means the model works on completely unseen users without calibration.
```

---

## 🚀 Alternative: If Virtual Serial Ports Don't Work

If you can't get virtual serial ports working in time, you can demonstrate using:

1. **Mock Mode in Desktop App** (if implemented)
2. **Show pre-recorded demo video**
3. **Show saved CSV files** from previous recordings
4. **Walk through the code** and explain the architecture

But virtual serial ports should work fine on Windows! Good luck with your demo! 🎉

