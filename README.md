# IoT Sign Language Desktop Application

## Current Phase: Text-to-Speech Demo

A cross-platform desktop application built with Tauri (Rust + React + TypeScript) for demonstrating Text-to-Speech capabilities. This is the foundation for an IoT-based sign language interpretation system using a glove with conductive sensors.

## Project Overview

This graduation project aims to create a complete sign language interpretation system:
- **Hardware**: IoT glove with conductive material sensors that measure finger resistance/movement
- **Desktop App** (this project): UI for visualization and text-to-speech output
- **Future**: Real-time finger movement detection → sign language recognition → speech output

## Quick Start

### Prerequisites

**All Platforms:**
- [Node.js](https://nodejs.org/) (v18 or later)
- [pnpm](https://pnpm.io/installation) (v8 or later) - Fast, disk-efficient package manager
  ```bash
  npm install -g pnpm
  ```
- [Rust](https://www.rust-lang.org/tools/install) (latest stable)

**Platform-Specific TTS Requirements:**

**Windows:**
- PowerShell (pre-installed)
- Turkish voice pack (optional, for Turkish TTS):
  1. Settings → Time & Language → Speech
  2. Add "Turkish (Turkey)" voice pack if not installed

**macOS:**
- `say` command (pre-installed)
- Turkish voice (optional):
  ```bash
  # Check available voices
  say -v ?
  # Install Turkish voice from System Preferences → Accessibility → Spoken Content → System Voice
  ```

**Linux:**
- Install Speech Dispatcher:
  ```bash
  # Ubuntu/Debian
  sudo apt-get install speech-dispatcher
  
  # Fedora
  sudo dnf install speech-dispatcher
  
  # Arch
  sudo pacman -S speech-dispatcher
  ```

### Installation

1. **Clone or extract the project**

2. **Install dependencies:**
   ```bash
   pnpm install
   ```

3. **Generate app icons** (first time only):
   ```bash
   # If you don't have icons yet, generate them from app-icon.png
   # (app-icon.png should already exist; if not, create a 1024x1024 PNG)
   pnpm tauri icon app-icon.png
   ```

4. **Run the development build:**
   ```bash
   pnpm tauri dev
   ```
   
   **Note:** First build takes 5-10 minutes (Rust compilation). Subsequent runs: ~30 seconds.

5. **Build for production:**
   ```bash
   pnpm tauri build
   ```

## Usage

1. Launch the application
2. Enter text in the text area (default demo text is provided)
3. Click **"Speak (Turkish)"** to hear the text in Turkish
4. Click **"Speak (English)"** to hear the text in English

The application uses your operating system's native text-to-speech engine—no internet connection required!

## Project Structure

```
iot-sign-language-desktop/
├── src/                          # React frontend (TypeScript)
│   ├── App.tsx                   # Main UI component
│   ├── App.css                   # Styles
│   ├── main.tsx                  # React entry point
│   └── vite-env.d.ts            # TypeScript definitions
├── src-tauri/                    # Rust backend
│   ├── src/
│   │   └── main.rs              # Tauri commands (TTS logic)
│   ├── Cargo.toml               # Rust dependencies
│   ├── tauri.conf.json          # Tauri configuration
│   └── icons/                   # App icons
├── public/                       # Static assets
├── index.html                    # HTML entry point
├── package.json                  # Node dependencies
├── tsconfig.json                # TypeScript config
├── vite.config.ts               # Vite config
└── README.md                     # This file
```

## Troubleshooting

### Common Issues

**Missing Icons Error:**
If you get `icons/icon.ico not found` error, run:
```bash
pnpm tauri icon app-icon.png
```

### Windows
- **No sound**: Check volume mixer, ensure PowerShell has audio permissions
- **Turkish not working**: Install Turkish voice pack from Windows Settings
- **PowerShell errors**: Run PowerShell as administrator once to test SAPI

### macOS
- **Turkish voice missing**: Install from System Preferences → Accessibility → Spoken Content
- **Permission denied**: Grant Terminal/IDE microphone/accessibility permissions in System Preferences → Security & Privacy

### Linux
- **spd-say not found**: Install speech-dispatcher package
- **No audio output**: Check `spd-say "test"` in terminal; verify audio system (PulseAudio/PipeWire)
- **Service not running**: Start with `sudo systemctl start speech-dispatcher`

### General
- **Tauri CLI errors**: Reinstall with `cargo install tauri-cli`
- **Build failures**: Clear cache with `cargo clean` and `pnpm store prune`, then reinstall with `pnpm install`

## Future Roadmap

### Phase 2: Data Ingestion & Streaming (Next Sprint)
- **BLE/Serial Integration**: Use Rust crates (`serialport` or `btleplug`) to establish connection with IoT glove
- **High-frequency data**: Handle 50-100 Hz sampling rate for 5 finger channels
- **Real-time broadcast**: Stream sensor data to UI via Tauri events (`emit`)
- **CSV logging**: Record sessions for later analysis and model training

### Phase 3: Data Processing & Calibration
- **CSV Schema Implementation**:
  ```
  timestamp_ms, user_id, session_id, class_label, 
  ch0_raw, ch1_raw, ch2_raw, ch3_raw, ch4_raw,
  ch0_norm, ch1_norm, ch2_norm, ch3_norm, ch4_norm,
  baseline_ch0, baseline_ch1, baseline_ch2, baseline_ch3, baseline_ch4,
  maxbend_ch0, maxbend_ch1, maxbend_ch2, maxbend_ch3, maxbend_ch4,
  glove_fit, sensor_map_ref, notes
  ```
- **Per-user calibration**: Capture baseline (fingers straight) and max-bend (fingers fully bent) for each user
- **Normalization**: Apply formula `x̂ = (x - baseline) / (maxbend - baseline)` to normalize 0-1 range
- **Rationale**: Resistance values vary by hand size, glove fit, and sensor placement; normalization ensures model generalization

### Phase 4: Windowing & Feature Engineering
- **Rolling windows**: 0.5-1.0 second sliding windows for temporal context
- **Feature extraction**: Statistical features (mean, std, min, max, range per channel)
- **Overlap strategy**: 50-75% overlap for smooth predictions
- **Rationale**: Sign language gestures are temporal; static snapshots miss movement dynamics

### Phase 5: Machine Learning Models
- **Stage 1 - MLP (Multi-Layer Perceptron)**:
  - Input: Flattened window features (5 channels × window size)
  - Output: Sign class probabilities
  - Fast inference, good for static hand shapes
  - Baseline accuracy target: 70-80%

- **Stage 2 - LSTM (Long Short-Term Memory)**:
  - Sequential model for temporal patterns
  - Better handling of gesture transitions
  - Expected accuracy improvement: 85-90%
  
- **Stage 3 - TCN (Temporal Convolutional Network)**:
  - Parallel processing of temporal sequences
  - Lower latency than LSTM
  - Target accuracy: 90-95%

### Phase 6: Edge Deployment (TinyML)
- **Quantization**: Convert model to INT8 (TensorFlow Lite)
- **TFLite Micro**: Deploy on microcontroller (ESP32/STM32)
- **Benefits**: 
  - On-device inference (no PC dependency)
  - Ultra-low latency (<50ms)
  - Privacy (data stays on device)
  - Reduced power consumption
- **Trade-off**: 1-3% accuracy drop acceptable for edge deployment

### Phase 7: Model Evaluation & Validation
- **LOUO (Leave-One-User-Out) Cross-Validation**: Train on N-1 users, test on held-out user to verify generalization
- **Metrics**:
  - Confusion matrix: Per-sign accuracy analysis
  - Streaming accuracy: Real-world performance with continuous input
  - End-to-end latency: Measure sensor→prediction→TTS pipeline (<200ms target)
- **Error analysis**: Identify confusing sign pairs, retrain with hard negatives

### Phase 8: UI Evolution
- **Live prediction panel**: Real-time display of detected signs with confidence scores
- **Visualization**: Line charts of normalized sensor values per finger
- **Confidence threshold**: Only trigger TTS when prediction confidence > 85% and stable for 500ms
- **Auto-TTS mode**: Automatically speak detected signs vs. manual trigger
- **Session management**: User profiles, calibration history, performance tracking
- **Feedback loop**: Allow users to correct misclassifications for model improvement

### Phase 9: Production Readiness
- **Multi-language support**: Expand beyond Turkish/English (Arabic, German, etc.)
- **Accessibility features**: High contrast mode, font size adjustment
- **Documentation**: User manual, API documentation for extensibility
- **Installer**: Signed executables for Windows/macOS, .deb/.rpm for Linux
- **Testing**: Automated unit/integration tests, user acceptance testing with target demographic

## Technology Stack

- **Frontend**: React 18 + TypeScript + Vite
- **Backend**: Rust (Tauri framework)
- **Package Manager**: pnpm (fast, disk-efficient)
- **TTS**: OS-native engines (SAPI/say/spd-say)
- **Future**: serialport/btleplug (sensor data), TensorFlow Lite (ML inference)

## Academic Context

This is a Computer Science graduation project focused on:
- IoT sensor integration
- Real-time signal processing
- Machine learning for gesture recognition
- Cross-platform desktop application development
- Edge computing and TinyML deployment

---

**Version**: 0.1.0 (TTS Demo)  
**Last Updated**: November 2025

