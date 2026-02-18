# IoT Sign Language Desktop Application

A cross-platform desktop application built with Tauri (Rust + React + TypeScript) for real-time American Sign Language (ASL) recognition using a smart glove with flex sensors and cloud-based machine learning inference.

**Version**: 0.5.0  
**Last Updated**: February 2026

---

## Project Overview

This graduation project is a complete sign language interpretation system with:

- **Hardware**: IoT glove with 5 flex sensors measuring finger bending
- **Desktop App** (this project): Real-time sensor visualization, ASL prediction, and data collection
- **Mobile App**: Android/iOS companion app with Bluetooth support
- **Cloud API**: FastAPI-based ML inference server
- **Training Pipeline**: Tools for collecting data and training custom models

---

## Features

### Core Features
- **Real-Time ASL Recognition**: Predict 15 ASL letters (A, B, C, D, E, F, I, K, O, S, T, V, W, X, Y)
- **Serial Port Connection**: Connect to Arduino-based glove via USB
- **3D Hand Visualization**: Interactive 3D skeleton showing real-time finger bending
- **Continuous Mode**: Build words letter by letter
- **Text-to-Speech**: Automatic voice output for predicted letters/words
- **ASL Simulator**: Test predictions without physical hardware
- **Data Recording**: Collect labeled training data for model improvement
- **Quick Demo Mode**: Automated letter simulation for presentations
- **Debug Logging**: Detailed performance metrics and API diagnostics
- **Theme Support**: Light, dark, and system themes
- **Multi-language**: English and Turkish interface

---

## Quick Start

### Prerequisites

**All Platforms:**
- [Node.js](https://nodejs.org/) (v18 or later)
- [pnpm](https://pnpm.io/installation) (v8 or later)
  ```bash
  npm install -g pnpm
  ```
- [Rust](https://www.rust-lang.org/tools/install) (latest stable)

**Platform-Specific:**

**Windows:**
- Visual Studio Build Tools (for Rust compilation)
- CH340 USB-to-Serial driver (for Arduino Nano)

**macOS:**
- Xcode Command Line Tools
- `say` command (pre-installed)

**Linux:**
- Build essentials: `sudo apt-get install build-essential pkg-config libssl-dev`
- Speech Dispatcher: `sudo apt-get install speech-dispatcher`

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd iot-sign-language-desktop
   ```

2. **Install dependencies**
   ```bash
   pnpm install
   ```

3. **Configure environment variables**
   ```bash
   # Create .env file
   cp .env.example .env
   
   # Edit .env and add your API key
   # VITE_API_URL=https://api.ybilgin.com
   # VITE_API_KEY=your-api-key-here
   ```

4. **Run development build**
   ```bash
   pnpm run tauri dev
   ```
   
   Note: First build takes 5-10 minutes (Rust compilation). Subsequent runs: ~30 seconds.

5. **Build for production**
   ```bash
   pnpm run tauri build
   ```

---

## Hardware Setup

### Components
1. **Arduino Nano** (with CH340 USB-to-Serial chip)
2. **5x Flex Sensors** (2.2", resistance-based)
   - Thumb (A0)
   - Index (A1)
   - Middle (A2)
   - Ring (A3)
   - Pinky (A4)
3. **USB Cable** (Micro-USB to USB-A)
4. **Fabric Glove** (sensors sewn onto fingers)

### Arduino Code
Upload the provided sketch (`arduino-glove-sketch.ino`) with:
- **Baud Rate**: 115200
- **Sample Rate**: 50Hz (20ms delay)
- **Output Format**: CSV over Serial
  ```
  444,804,829,742,711
  437,809,834,748,715
  ...
  ```

### Connection
1. Connect Arduino to PC via USB
2. Install CH340 driver if needed (Windows)
3. Open Desktop App
4. Click "Refresh Ports" in Connection Manager
5. Select COM port (e.g., COM3, COM4)
6. Click "Connect"
7. Verify sensor values in Real-Time Sensor Display

---

## Usage

### Testing Without Hardware (Simulator)
1. Go to "ASL Simulator" section
2. Click any letter button (A-Y)
3. App simulates 200 samples at 50Hz
4. Prediction appears with confidence score
5. TTS speaks the letter automatically

### Using Real Glove
1. Connect glove via Connection Manager
2. Make an ASL sign
3. App collects 150-200 samples automatically
4. Prediction appears in Prediction View
5. TTS speaks the detected letter

### Continuous Word Mode
1. Select "Continuous (150 samples / letter)" from Recognition Mode dropdown
2. Make multiple ASL signs in sequence
3. Word builds letter by letter
4. After 2 seconds idle, TTS speaks complete word
5. Use Speak/Delete/Clear buttons as needed

### Recording Training Data
1. Go to "Data Recording" section
2. Select letter to record
3. Make ASL sign with glove
4. Click "Start Recording"
5. Hold for 3 seconds (150 samples auto-collect)
6. Repeat 5 times per letter with variations
7. CSV auto-downloads after each recording

---

## Project Structure

```
iot-sign-language-desktop/
├── src/                          # React frontend (TypeScript)
│   ├── components/
│   │   ├── ConnectionManager.tsx     # Serial port connection
│   │   ├── SimulatorControl.tsx      # ASL letter simulator
│   │   ├── PredictionView.tsx        # Prediction display
│   │   ├── QuickDemo.tsx             # Auto-demo mode
│   │   ├── SensorDisplay.tsx         # Real-time sensor bars
│   │   ├── HandVisualization3D.tsx   # 3D hand skeleton
│   │   ├── DebugLog.tsx              # Debug information
│   │   └── DataRecorder.tsx          # Training data recorder
│   ├── services/
│   │   └── apiService.ts             # API client
│   ├── context/
│   │   └── ThemeContext.tsx          # Theme management
│   ├── locales/                      # i18n translations
│   ├── App.tsx                       # Main app logic
│   └── App.css                       # Global styles
├── src-tauri/                    # Rust backend
│   ├── src/
│   │   └── main.rs                   # Serial comm, TTS commands
│   ├── Cargo.toml                    # Rust dependencies
│   └── tauri.conf.json               # Tauri configuration
├── public/
│   └── assets/asl/                   # ASL sign images (15 letters)
├── .env                              # Environment variables
├── package.json                      # Node dependencies
├── PROJECT_STATE.md                  # Complete project documentation
└── README.md                         # This file
```

---

## API Integration

The app connects to a cloud-based ML API:

- **Endpoint**: `https://api.ybilgin.com/predict`
- **Authentication**: API Key (X-API-Key header)
- **Model**: Random Forest (15 ASL letters)
- **Response Time**: ~50ms average
- **Input**: 150-200 samples of 5 sensor values
- **Output**: Letter, confidence, probabilities, timing

See `ASL-ML-Inference-API/README.md` for API documentation.

---

## Data Collection & Model Training

### Workflow
1. **Record Data**: Use Data Recorder feature (5 recordings per letter)
2. **Validate**: Run `python iot-sign-glove/scripts/validate_data.py`
3. **Train**: Run `python iot-sign-glove/scripts/train_model.py`
4. **Deploy**: Copy model to API server
5. **Test**: Verify improved accuracy in app

See `iot-sign-glove/README.md` and `DATA_COLLECTION_GUIDE.md` for details.

---

## Troubleshooting

### Serial Connection Issues
**Problem**: COM port not detected  
**Solution**: 
- Install CH340 driver for Arduino Nano
- Check Device Manager (Windows) for port
- Close other programs using serial port
- Try different USB cable/port

### Prediction Errors
**Problem**: 401/403 API errors  
**Solution**:
- Check `.env` file has valid API key
- Verify API is online: `curl https://api.ybilgin.com/health`
- Check console for detailed error messages

### 3D Hand Not Matching
**Problem**: Visualization doesn't match real hand  
**Solution**:
- Check sensor connections (firm contact)
- Verify sensor wiring (A0-A4 pins)
- Update BASELINES and MAXBENDS in `SimulatorControl.tsx`
- Test: Open hand = low values, closed fist = high values

### Build Failures
**Problem**: Tauri build errors  
**Solution**:
- Ensure Rust is installed: `rustc --version`
- Install Visual Studio Build Tools (Windows)
- Clear cache: `cargo clean` and `pnpm store prune`
- Reinstall: `pnpm install`

---

## Technology Stack

- **Frontend**: React 18 + TypeScript + Vite
- **Backend**: Rust (Tauri framework)
- **Serial Communication**: Rust `serialport` crate
- **3D Visualization**: Plotly.js
- **API Client**: Fetch API
- **TTS**: OS-native engines (SAPI/say/spd-say)
- **Package Manager**: pnpm
- **i18n**: react-i18next

---

## Related Projects

- **Mobile App**: `mobile/` - React Native + Expo companion app
- **API Server**: `ASL-ML-Inference-API/` - FastAPI ML inference server
- **Training Tools**: `iot-sign-glove/` - Data collection & model training scripts

---

## Academic Context

This is a Computer Science graduation project focused on:
- IoT sensor integration
- Real-time signal processing
- Machine learning for gesture recognition
- Cross-platform desktop application development
- Edge computing and embedded systems

---

## Documentation

- **PROJECT_STATE.md**: Complete project overview and state
- **DATA_COLLECTION_GUIDE.md**: Best practices for recording training data
- **API_CONFIG.md**: API configuration instructions
- **SECURITY_SETUP.md**: API security documentation

---

## License

MIT License - Part of Computer Science Graduation Project

**Author**: Yigit Alp Bilgin  
**Institution**: Computer Science Department  
**Year**: 2026

For questions or support, refer to PROJECT_STATE.md or contact the project team.
