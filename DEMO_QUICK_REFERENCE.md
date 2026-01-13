# 🚀 Quick Demo Reference

## Before the Demo

1. **Install com0com** (virtual serial port driver)
   - Creates COM3 ↔ COM4 pair
   - Download: https://sourceforge.net/projects/com0com/

2. **Test the setup:**
   ```bash
   # Terminal 1: Start simulator
   cd iot-sign-glove
   python scripts/glove_simulator.py --port COM3 --gesture A --loop

   # Terminal 2: Start desktop app
   cd C:\Users\Yigit\Desktop\iot-sign-language-desktop
   pnpm tauri:dev
   ```

---

## Demo Flow (8 minutes total)

### 1️⃣ Text-to-Speech (2 min)
- Show language switcher (EN/TR)
- Type: "Hello professor, this is a sign language demo"
- Click "Speak (English)" 🔊
- Switch to Turkish
- Type: "Merhaba hocam, bu işaret dili demosu"
- Click "Konuş (Türkçe)" 🔊

### 2️⃣ Hardware Simulation (3 min)
**Terminal 1:**
```bash
cd iot-sign-glove
python scripts/glove_simulator.py --port COM3 --gesture A --loop
```

**Desktop App:**
- Click "↻ Scan"
- Select COM4
- Click "Connect"
- Show real-time sensor data (5 channels updating)

**Explain:**
> "I'm simulating the glove by reading your dataset and sending it over a virtual serial port. The app receives it exactly as it would from real Bluetooth hardware."

### 3️⃣ Data Capture (3 min)
1. **Calibration:**
   - Click "Baseline (straight)" → Wait 2s
   - Click "Max Bend (fist)" → Wait 2s

2. **Recording:**
   - Set User ID: "DEMO01"
   - Set Session: "S1"
   - Select Gesture: "A"
   - Click "⏺ Start Recording"
   - Wait 3 seconds (watch counter: 0 → 250)
   - Click "⏹ Stop Recording"
   - Show saved CSV file

---

## Key Talking Points

### ✅ What Works Now:
- Desktop app: Real-time data collection, TTS
- ML Pipeline: 74.63% LOUO accuracy (person-independent)
- Feature engineering: 30 features, 1.0s windows
- Preprocessing: Butterworth filter, min-max normalization

### 🔄 In Progress:
- Mobile app (React Native + TFLite)
- Model deployment (Random Forest → TFLite conversion)

### ⏳ Waiting For:
- Physical hardware (glove not available)

---

## Architecture Summary

```
IoT Glove (ESP32 + 5 flex sensors)
    ↓ Bluetooth/Serial (100 Hz)
Desktop App (Tauri + React)
    ↓ Saves CSV with calibration
ML Pipeline (Python + scikit-learn)
    ↓ Trains Random Forest (200 trees)
Mobile App (React Native)
    ↓ TFLite inference (<10ms)
Real-time predictions
```

---

## Technical Details

| Component | Technology | Status |
|-----------|-----------|--------|
| Hardware | ESP32 + 5 flex sensors | ⏳ Unavailable |
| Desktop | Tauri (Rust) + React (TypeScript) | ✅ Complete |
| ML | Python, scikit-learn, Random Forest | ✅ Complete |
| Mobile | React Native + TensorFlow Lite | 🔄 In Progress |
| Accuracy | 74.63% LOUO (person-independent) | ✅ Complete |
| Dataset | 12 users × 20 gestures × 5 reps | ✅ Complete |
| Features | 30 (statistical + temporal) | ✅ Optimized |
| Window | 1.0s (100 samples) | ✅ Optimized |

---

## Troubleshooting

**No ports found?**
- Check com0com is installed
- Restart both simulator and app

**Simulator fails to connect?**
- Try different port: `--port COM5`
- List available ports: `python -c "import serial.tools.list_ports; [print(p.device) for p in serial.tools.list_ports.comports()]"`

**Desktop app not receiving data?**
- Ensure simulator uses COM3, app uses COM4 (paired)
- Check baud rate: 115200
- Restart both

---

## Questions Your Professor Might Ask

**Q: Why simulate instead of using real hardware?**
> A: The physical glove isn't available right now, so I'm using your dataset to demonstrate the system architecture and data flow. The app handles simulated and real data identically.

**Q: How does the ML model work?**
> A: We use a Random Forest with 200 trees trained on windowed features (1-second windows). It achieves 74.63% accuracy on completely unseen users without calibration. The model extracts 30 features including mean, std, min, max, velocity, and acceleration from 5 sensor channels.

**Q: How will this work on mobile?**
> A: We'll convert the Random Forest to TensorFlow Lite format (quantized to INT8), resulting in ~500KB model with <10ms inference time. The mobile app will run predictions on-device without internet.

**Q: What about the "learning UI"?**
> A: The learning UI includes:
> - Language switcher (Turkish/English) for accessibility
> - Theme support (light/dark/system) for comfort
> - Real-time sensor visualization for teaching proper finger positioning
> - Gesture selection for guided practice

**Q: What's next?**
> A: Next steps are:
> 1. Complete mobile app with TFLite integration
> 2. Test with actual hardware when available
> 3. Expand gesture set (currently 20 gestures)
> 4. Add ensemble learning for higher accuracy

---

## Simulator Commands Cheat Sheet

```bash
# Basic usage
python scripts/glove_simulator.py

# Custom port
python scripts/glove_simulator.py --port COM5

# Different gesture
python scripts/glove_simulator.py --gesture B

# Different user
python scripts/glove_simulator.py --user 5

# Faster playback
python scripts/glove_simulator.py --speed 2.0

# Loop continuously
python scripts/glove_simulator.py --loop

# Full command
python scripts/glove_simulator.py --port COM3 --gesture A --user 1 --loop --speed 1.0
```

---

## Data Format

**CSV Format (saved by DataRecorder):**
```
timestamp_ms,user_id,session_id,class_label,ch0_raw,ch1_raw,ch2_raw,ch3_raw,ch4_raw,ch0_norm,ch1_norm,ch2_norm,ch3_norm,ch4_norm,baseline_ch0,baseline_ch1,baseline_ch2,baseline_ch3,baseline_ch4,maxbend_ch0,maxbend_ch1,maxbend_ch2,maxbend_ch3,maxbend_ch4,glove_fit,sensor_map_ref,notes
1234567890,DEMO01,S1,A,520,540,530,525,535,0.057,0.057,0.057,0.056,0.057,...
```

**Serial Format (transmitted by simulator):**
```
timestamp,ch0,ch1,ch2,ch3,ch4
1234567890,520,540,530,525,535
```

---

Good luck! 🎉

