# ASL Sign Language Recognition System - Complete Project State

**Last Updated**: February 18, 2026  
**AI Assistant Context**: This document is designed to be read by AI assistants to understand the full project state.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Architecture](#architecture)
3. [Desktop Application](#desktop-application)
4. [Mobile Application](#mobile-application)
5. [API Server](#api-server)
6. [Hardware Setup](#hardware-setup)
7. [Data Collection Workflow](#data-collection-workflow)
8. [File Structure](#file-structure)
9. [Critical Implementation Details](#critical-implementation-details)
10. [Known Issues & Workarounds](#known-issues--workarounds)
11. [Next Steps](#next-steps)

---

## Project Overview

### Purpose
A complete ASL (American Sign Language) recognition system using a smart glove with 5 flex sensors, machine learning prediction, and cross-platform applications.

### Components
1. **Smart Glove** (Arduino Nano + 5 flex sensors)
2. **Desktop App** (React + Tauri + Rust)
3. **Mobile App** (React Native + Expo)
4. **ML API Server** (FastAPI + Python + scikit-learn)
5. **Training Pipeline** (Python scripts for data collection & model training)

### Supported ASL Letters
**15 letters**: A, B, C, D, E, F, I, K, O, S, T, V, W, X, Y

*Note: Letters like H, G, J, L, M, N, P, Q, R, U, Z require motion/orientation sensors (not just flex sensors)*

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    USER INTERACTION LAYER                    │
├─────────────────────┬───────────────────────────────────────┤
│   Desktop App       │         Mobile App                     │
│   (Windows/Mac/     │         (Android/iOS)                  │
│    Linux)           │                                        │
│                     │                                        │
│   - Tauri (Rust)    │   - React Native                      │
│   - React Frontend  │   - Expo                              │
│   - Serial Port     │   - Bluetooth (future)                │
│     Connection      │                                        │
└──────────┬──────────┴──────────┬─────────────────────────────┘
           │                     │
           │ HTTP/REST           │ HTTP/REST
           │                     │
           ▼                     ▼
┌─────────────────────────────────────────────────────────────┐
│                    ML API SERVER                             │
│   URL: https://api.ybilgin.com                              │
│                                                              │
│   - FastAPI (Python)                                         │
│   - Random Forest Model (scikit-learn)                       │
│   - PostgreSQL (prediction logging)                          │
│   - Docker (containerized)                                   │
│   - API Key Authentication                                   │
│   - Rate Limiting                                            │
└─────────────────────────────────────────────────────────────┘
           ▲
           │ Model Deployment
           │
┌─────────────────────────────────────────────────────────────┐
│              HARDWARE & DATA COLLECTION                      │
│                                                              │
│   Arduino Nano → Serial USB → Desktop App                   │
│   (5 flex sensors @ 50Hz)                                    │
│                                                              │
│   Desktop App → CSV Export → Training Scripts → New Model   │
└─────────────────────────────────────────────────────────────┘
```

---

## Desktop Application

### Tech Stack
- **Frontend**: React 18 + TypeScript + Vite
- **Backend**: Tauri (Rust) for native capabilities
- **Serial Communication**: Rust `serialport` crate
- **3D Visualization**: Plotly.js
- **Styling**: CSS + Inline styles (theme-aware)
- **Package Manager**: pnpm

### Location
`C:\Users\Yigit\Desktop\iot-sign-language-desktop\`

### Key Features

#### 1. **Serial Connection Manager**
- **File**: `src/components/ConnectionManager.tsx`
- **Rust Backend**: `src-tauri/src/main.rs`
- **Features**:
  - List available COM ports
  - Connect/disconnect to Arduino
  - Real-time data reading at 50Hz
  - Pause/Resume data flow
  - Connection status display

- **Tauri Commands** (Rust):
  ```rust
  list_ports() -> Vec<String>
  connect_serial(port: String) -> Result<(), String>
  disconnect_serial() -> Result<(), String>
  start_reading_serial() -> Result<(), String>
  stop_reading_serial() -> Result<(), String>
  resume_reading_serial() -> Result<(), String>
  ```

- **Events Emitted** (Rust → Frontend):
  ```rust
  "serial-data" → number[] (5 sensor values)
  "serial-connection-change" → boolean
  "serial-error" → string
  ```

#### 2. **ASL Simulator**
- **File**: `src/components/SimulatorControl.tsx`
- **Purpose**: Test predictions without hardware
- **Features**:
  - 15 letter buttons (A-Y)
  - Generates synthetic sensor data
  - Matches real glove patterns
  - Adds realistic noise (±8 units)
  - Sends data at 50Hz

- **ASL Patterns** (Normalized 0-1, then denormalized):
  ```typescript
  BASELINES = [440, 612, 618, 548, 528]  // Straight fingers
  MAXBENDS = [650, 900, 900, 850, 800]   // Fully bent
  
  // Example: Letter A (fist with thumb out)
  A: denormalize([0.02, 0.68, 0.78, 0.65, 0.68], BASELINES, MAXBENDS)
  // Result: [444, 804, 829, 742, 711]
  ```

#### 3. **Real-Time Sensor Display**
- **File**: `src/components/SensorDisplay.tsx`
- **Displays**:
  - 5 horizontal bars (Thumb, Index, Middle, Ring, Pinky)
  - Color-coded: Red (0-340), Yellow (341-681), Green (682-1023)
  - Numeric values
  - Collection status (Collecting / Idle)
  - Sample counter (X/150 or X/200)
  - Buffer cleared indicator

#### 4. **3D Hand Visualization**
- **File**: `src/components/HandVisualization3D.tsx`
- **Library**: Plotly.js (3D scatter + lines)
- **Features**:
  - Real-time hand skeleton
  - Per-finger bending based on sensor calibration
  - Interactive camera (orbit, zoom, pan)
  - Camera persistence (no reset during updates)
  - Test buttons (Straight, Bent, Reset Camera)
  - Dark/light mode support

- **Calibration Ranges** (per finger):
  ```typescript
  BASELINES = [440, 612, 618, 548, 528]   // Straight
  MAXBENDS = [650, 900, 900, 850, 760]    // Bent (Note: Pinky 760 not 800)
  ```

- **Bending Logic**:
  - Knuckle joint: 60% of total bend
  - Middle joint: 50% of total bend
  - Amplification: 1.5x for dramatic visual

#### 5. **Prediction System**
- **File**: `src/App.tsx` → `makePrediction()`
- **Modes**:
  - **Single Letter**: 200 samples (4 seconds)
  - **Continuous**: 150 samples per letter (3 seconds)

- **Process**:
  1. Collect sensor data into buffer (`sensorBuffer`)
  2. When target samples reached → stop collection
  3. Send to API: `POST https://api.ybilgin.com/predict`
  4. Receive: `{ letter, confidence, all_probabilities, ... }`
  5. Display result + speak via TTS

- **Motion Detection** (Continuous Mode):
  - Checks each finger change sample-to-sample
  - Threshold: 15 (simulator) or 100 (real glove)
  - If ANY finger changes > threshold → clear buffer
  - Prevents contamination during transitions

- **State Management**:
  ```typescript
  sensorBuffer: number[][]           // Accumulated samples
  isCollectingRef: React.MutableRefObject<boolean>  // Prevents race conditions
  currentPrediction: PredictionResponse | null
  detectedLetters: string[]          // For continuous mode
  ```

#### 6. **Continuous Word Mode**
- **Logic in**: `src/App.tsx`
- **Features**:
  - Collects letters into a word
  - Auto-finalizes after 2s idle
  - TTS speaks complete word
  - Shows ASL sign PNGs for each letter
  - Buttons: Speak, Delete, Clear

- **Idle Detection**:
  ```typescript
  lastSampleTimeRef.current = Date.now()
  // If no samples for 2 seconds → finalize word
  idleTimerRef → triggers TTS + word finalization
  ```

#### 7. **Quick Demo Mode**
- **File**: `src/components/QuickDemo.tsx`
- **Purpose**: Auto-simulate words for demos
- **Features**:
  - Custom word input (only A-Y letters)
  - Auto-simulate each letter
  - Speaks DETECTED word (not input word)
  - Handles model errors gracefully

#### 8. **Data Recording Feature** (NEW)
- **File**: `src/components/DataRecorder.tsx`
- **Purpose**: Collect labeled training data
- **Features**:
  - Select letter (A-Y)
  - Auto-record 150 samples (3 seconds)
  - Progress bar
  - Accumulates in memory
  - Export to CSV with timestamp

- **CSV Format**:
  ```csv
  label,ch0,ch1,ch2,ch3,ch4
  A,444,804,829,742,711
  A,437,809,834,748,715
  ...
  ```

- **Filename**: `glove_data_{LETTER}_{YYYY-MM-DD-HH-MM-SS}.csv`
  - Example: `glove_data_A_2026-02-18-14-32-15.csv`

- **Workflow**:
  1. Select letter
  2. Click "Start Recording"
  3. Make ASL sign
  4. Hold for 3 seconds (150 samples auto-collect)
  5. Recording stops automatically
  6. Repeat 5 times per letter
  7. CSV downloads with ALL accumulated recordings

#### 9. **Debug Log**
- **File**: `src/components/DebugLog.tsx`
- **Shows**:
  - Simulation duration
  - Sample counts
  - API URL & call time
  - Round-trip latency
  - Model name & processing time
  - Prediction letter & confidence
  - Top 5 probabilities
  - Collapsible interface

#### 10. **Theme System**
- **File**: `src/context/ThemeContext.tsx`
- **Modes**: Light, Dark, System
- **Persistent**: Saved to localStorage
- **Dynamic**: All components adapt

### Running Desktop App

```bash
cd C:\Users\Yigit\Desktop\iot-sign-language-desktop

# Install dependencies (first time only)
pnpm install

# Development mode (with Rust backend)
pnpm run tauri dev

# Production build
pnpm run tauri build
```

### Environment Variables
- **File**: `.env`
```env
VITE_API_URL=https://api.ybilgin.com
VITE_API_KEY='secret'
```

---

## Mobile Application

### Tech Stack
- **Framework**: React Native (Expo)
- **Language**: TypeScript
- **Package Manager**: npm
- **Build Service**: EAS (Expo Application Services)

### Location
`C:\Users\Yigit\Desktop\iot-sign-language-desktop\mobile\`

### Key Features
1. **Bluetooth Glove Connection** (future)
2. **ASL Simulator**
3. **Continuous Mode**
4. **Quick Demo**
5. **Prediction History**
6. **TTS & Haptic Feedback**
7. **Localization** (English/Turkish)

### Version
**0.4.0** (as of last update)

### Running Mobile App

```bash
cd C:\Users\Yigit\Desktop\iot-sign-language-desktop\mobile

# Install dependencies
npm install

# Start Expo dev server
npm start

# Build Android APK
npx eas build --platform android --profile preview
```

### Environment Variables
- **File**: `.env`
```env
EXPO_PUBLIC_API_URL=https://api.ybilgin.com
EXPO_PUBLIC_API_KEY=e18c0f549306487f43311ebc5a1754f119ef885cab988287e19b588478fc4916
```

---

## API Server

### Tech Stack
- **Framework**: FastAPI (Python)
- **ML Model**: Random Forest (scikit-learn)
- **Database**: PostgreSQL
- **Deployment**: Docker + DigitalOcean
- **URL**: https://api.ybilgin.com

### Location (Server)
`/opt/stack/asl-ml-server/` on `homeserver`

### Location (Local Repo)
`C:\Users\Yigit\Desktop\iot-sign-language-desktop\ASL-ML-Inference-API\`

### Endpoints

#### 1. **Health Check**
```http
GET /health
Response: {
  "status": "healthy",
  "model_loaded": true,
  "model_name": "rf_asl_15letters",
  "database_connected": true,
  "uptime_seconds": 123456,
  "authentication_enabled": true,
  "rate_limiting_enabled": true
}
```

#### 2. **Prediction** (Protected)
```http
POST /predict
Headers: {
  "X-API-Key": "your-api-key-here",
  "Content-Type": "application/json"
}
Body: {
  "flex_sensors": [
    [444, 804, 829, 742, 711],  // Sample 1
    [437, 809, 834, 748, 715],  // Sample 2
    ... (150-200 samples)
  ],
  "device_id": "desktop-glove"  // Optional
}

Response: {
  "letter": "A",
  "confidence": 0.95,
  "all_probabilities": {
    "A": 0.95,
    "S": 0.03,
    "E": 0.01,
    ...
  },
  "processing_time_ms": 12.5,
  "model_name": "rf_asl_15letters",
  "timestamp": 1708291200
}
```

#### 3. **Statistics** (Protected)
```http
GET /stats
Headers: { "X-API-Key": "..." }
Response: {
  "total_predictions": 1234,
  "predictions_today": 56,
  "unique_devices": 3,
  "average_confidence": 0.87,
  "letter_distribution": { "A": 120, "B": 98, ... }
}
```

#### 4. **Interactive Docs**
- **Swagger UI**: https://api.ybilgin.com/docs
- **ReDoc**: https://api.ybilgin.com/redoc

### Security
- **API Key Authentication**: Required for `/predict` and `/stats`
- **Rate Limiting**: 100 requests/minute per IP
- **HTTPS**: TLS 1.2+
- **Headers**:
  - `X-RateLimit-Limit`: Max requests allowed
  - `X-RateLimit-Remaining`: Remaining requests

### Model Details
- **Type**: Random Forest Classifier
- **Features**: 5 flex sensors × 150-200 samples (flattened)
- **Input Shape**: (1, 750) for 150 samples or (1, 1000) for 200 samples
- **Classes**: 15 (A, B, C, D, E, F, I, K, O, S, T, V, W, X, Y)
- **Accuracy**: ~85-90% (current model, will improve with new data)

### Deployment

```bash
# SSH to server
ssh bilgin@homeserver

# Navigate to directory
cd /opt/stack/asl-ml-server

# Pull latest code
sudo git pull origin main

# Rebuild and restart
sudo docker-compose down
sudo docker-compose up -d --build

# Check logs
sudo docker-compose logs -f
```

---

## Hardware Setup

### Components
1. **Arduino Nano** (CH340 USB-to-Serial chip)
2. **5× Flex Sensors** (2.2", 0-1023 range)
   - Thumb (CH0 / A0)
   - Index (CH1 / A1)
   - Middle (CH2 / A2)
   - Ring (CH3 / A3)
   - Pinky (CH4 / A4)
3. **USB Cable** (Micro-USB to USB-A)
4. **Glove** (fabric, sensors sewn on)

### Arduino Code
- **File**: `arduino-glove-sketch.ino` (or use provided template)
- **Baud Rate**: 115200
- **Sample Rate**: 50Hz (20ms delay)
- **Output Format**: CSV over Serial
  ```
  444,804,829,742,711\n
  437,809,834,748,715\n
  ...
  ```

### Wiring
```
Flex Sensor → Arduino Analog Pin
----------------------------------------
Thumb  → A0  (CH0)
Index  → A1  (CH1)
Middle → A2  (CH2)
Ring   → A3  (CH3)
Pinky  → A4  (CH4)

Each sensor needs:
- One leg → 5V
- Other leg → Analog Pin + 10kΩ resistor to GND
```

### Driver Installation (Windows)
- **CH340 Driver**: Required for Arduino Nano clone
- **Download**: https://sparks.gogo.co.nz/ch340.html
- **Verify**: Device Manager → Ports (COM & LPT) → "USB-SERIAL CH340 (COMX)"

### Connection to Desktop App
1. Plug Arduino into PC via USB
2. Open Desktop App
3. Click "Refresh Ports" in Connection Manager
4. Select your COM port (e.g., COM3, COM4)
5. Click "Connect"
6. Verify: Real-Time Sensor Display should show values

### Bluetooth Setup (Future)
- **Arduino Nano 33 BLE** or **HC-05/HC-06 module**
- Creates virtual COM port when paired
- Works identically to USB connection

---

## Data Collection Workflow

### Goal
Collect **5 recordings per letter** (750 samples/letter) for training a new model.

### Step-by-Step Process

#### 1. **Setup** (5 minutes)
```bash
1. Connect Arduino to PC
2. Open Desktop App
3. Connect to serial port
4. Verify sensor readings (make fist → see all values change)
5. Check 3D hand visualization (should match your hand)
```

#### 2. **Recording Session** (40 minutes)
```
For EACH letter (A, B, C, D, E, F, I, K, O, S, T, V, W, X, Y):
  
  1. Go to "Data Recording" section
  2. Select letter (e.g., "A")
  3. Make ASL sign for that letter
  4. Click "Start Recording"
  5. Hold steady for 3 seconds (150 samples auto-collect)
  6. Recording auto-stops
  7. Relax for 2 seconds
  8. Repeat 4 more times (total: 5 recordings)
  
  Variation for recordings 2-5:
  - Recording 1: Normal position
  - Recording 2: Wrist tilted 10° right
  - Recording 3: Wrist tilted 10° left
  - Recording 4: Fingers slightly tighter
  - Recording 5: Fingers slightly looser
  
  After 5 recordings → CSV auto-downloads
  Filename: glove_data_A_2026-02-18-14-32-15.csv (750 samples)
```

#### 3. **File Organization** (5 minutes)
```
Downloads/
├── glove_data_A_2026-02-18-14-00-15.csv   (Delete - subset)
├── glove_data_A_2026-02-18-14-01-32.csv   (Delete - subset)
├── glove_data_A_2026-02-18-14-02-48.csv   (Delete - subset)
├── glove_data_A_2026-02-18-14-03-55.csv   (Delete - subset)
├── glove_data_A_2026-02-18-14-05-10.csv   (KEEP - 750 samples) ✅
├── glove_data_B_2026-02-18-14-10-22.csv   (KEEP - 750 samples) ✅
├── glove_data_C_2026-02-18-14-15-44.csv   (KEEP - 750 samples) ✅
└── ... (keep last file for each letter)

Action:
1. Keep only the LAST file for each letter (has all 5 recordings)
2. Delete intermediate files (they're subsets)
3. Move to training folder
```

#### 4. **Combine CSVs** (PowerShell)
```powershell
cd C:\Users\Yigit\Downloads

# Combine all final files
Get-Content glove_data_A_*.csv, glove_data_B_*.csv, ... | Set-Content combined_training_data.csv

# Remove duplicate headers (manually in text editor or script)
# Keep only the first "label,ch0,ch1,ch2,ch3,ch4" line
```

#### 5. **Validate Data**
```bash
cd C:\Users\Yigit\Desktop\iot-sign-language-desktop\iot-sign-glove

python scripts/validate_data.py --input C:\Users\Yigit\Downloads\combined_training_data.csv
```

Expected output:
```
✓ 15 unique letters found
✓ 11,250 total samples (750 per letter)
✓ No missing labels
✓ Sensor ranges valid (0-1023)
✓ Data ready for training!
```

#### 6. **Train New Model**
```bash
python scripts/train_model.py --input C:\Users\Yigit\Downloads\combined_training_data.csv --output models/my_glove_model.pkl
```

Expected output:
```
Training Random Forest with 11,250 samples...
Cross-validation accuracy: 89.3% (±2.1%)
Test set accuracy: 91.5%
Model saved to: models/my_glove_model.pkl
Confusion matrix saved to: models/confusion_matrix.png
```

#### 7. **Deploy Model to API**
```bash
# Copy model to API server
scp models/my_glove_model.pkl bilgin@api.ybilgin.com:/opt/stack/asl-ml-server/models/

# SSH to server and restart
ssh bilgin@api.ybilgin.com
cd /opt/stack/asl-ml-server
sudo docker-compose restart
```

#### 8. **Test New Model**
```
1. Open Desktop App
2. Connect to glove
3. Make ASL signs
4. Verify predictions are more accurate!
```

---

## File Structure

### Desktop App
```
iot-sign-language-desktop/
├── src/
│   ├── components/
│   │   ├── ConnectionManager.tsx     # Serial connection UI + logic
│   │   ├── SimulatorControl.tsx      # Simulate ASL letters
│   │   ├── PredictionView.tsx        # Display predictions + word
│   │   ├── QuickDemo.tsx             # Auto-demo mode
│   │   ├── SensorDisplay.tsx         # Real-time sensor bars
│   │   ├── HandVisualization3D.tsx   # 3D hand skeleton
│   │   ├── DebugLog.tsx              # Technical details
│   │   ├── DataRecorder.tsx          # NEW: Record training data
│   │   └── *.css                     # Component styles
│   ├── context/
│   │   └── ThemeContext.tsx          # Dark/light mode
│   ├── services/
│   │   └── apiService.ts             # API communication
│   ├── locales/
│   │   ├── en.json                   # English translations
│   │   └── tr.json                   # Turkish translations
│   ├── assets/
│   │   └── asl/                      # ASL sign PNG images (15 letters)
│   ├── App.tsx                       # MAIN APP LOGIC ⭐
│   ├── App.css                       # Global styles
│   └── main.tsx                      # Entry point
├── src-tauri/
│   ├── src/
│   │   └── main.rs                   # Rust backend (serial, TTS)
│   ├── Cargo.toml                    # Rust dependencies
│   └── tauri.conf.json               # Tauri configuration
├── public/
│   └── assets/asl/*.png              # ASL images (also here for build)
├── .env                              # Environment variables
├── package.json                      # Node dependencies
├── pnpm-lock.yaml                    # Lockfile
├── vite.config.ts                    # Vite config
├── tsconfig.json                     # TypeScript config
├── test_serial_simulator.py          # Python script to test serial
└── DATA_COLLECTION_GUIDE.md          # Recording best practices
```

### Mobile App
```
mobile/
├── src/
│   ├── components/
│   │   ├── ConnectionManager.tsx     # Bluetooth connection
│   │   ├── SimulatorControl.tsx      # Simulate ASL
│   │   ├── PredictionView.tsx        # Show predictions
│   │   ├── QuickDemo.tsx             # Auto-demo
│   │   └── ...
│   ├── services/
│   │   └── apiService.ts             # API communication
│   ├── locales/                      # Translations
│   └── assets/asl/                   # ASL images
├── App.tsx                           # Main app
├── app.json                          # Expo config
├── package.json                      # Dependencies
├── .env                              # Environment variables
└── eas.json                          # Build configuration
```

### API Server
```
ASL-ML-Inference-API/
├── app/
│   ├── main.py                       # FastAPI app ⭐
│   ├── database.py                   # PostgreSQL connection
│   └── models/
│       └── rf_asl_15letters.pkl      # Current model
├── requirements.txt                  # Python dependencies
├── Dockerfile                        # Docker image
├── docker-compose.yml                # Docker services
├── .env                              # Server config
└── README.md                         # API documentation
```

### Training Scripts
```
iot-sign-glove/
├── scripts/
│   ├── collect_data.py               # CLI data collection
│   ├── validate_data.py              # Check CSV quality
│   ├── train_model.py                # Train Random Forest
│   └── ...
├── data/                             # Training data (gitignored)
├── models/                           # Trained models (gitignored)
├── requirements.txt                  # Python dependencies
└── DATA_COLLECTION_GUIDE.md          # Documentation
```

---

## Critical Implementation Details

### 1. **Race Condition Prevention (Desktop App)**

**Problem**: `handleSensorData` was called at 50Hz, causing multiple predictions to trigger simultaneously.

**Solution**: Use `isCollectingRef` (ref, not state) to prevent concurrent collections:

```typescript
// src/App.tsx
const isCollectingRef = useRef(false);

const handleSensorData = useCallback((data: number[]) => {
  setSensorBuffer(prev => {
    // Double-check inside updater
    if (!isCollectingRef.current) {
      return []; // Not collecting
    }
    
    const newBuffer = [...prev, data];
    if (newBuffer.length >= targetSamples) {
      isCollectingRef.current = false; // Stop IMMEDIATELY
      makePrediction(newBuffer);
      return []; // Clear buffer
    }
    return newBuffer;
  });
}, [/* deps */]);
```

### 2. **Buffer Contamination (Continuous Mode)**

**Problem**: During letter transitions, buffer contained mixed samples from old + new letter.

**Solution**: Motion detection + immediate buffer clear:

```typescript
// Check EACH finger for large movement
const fingerChanges = data.map((value, index) => 
  Math.abs(value - previousSample[index])
);
const maxChange = Math.max(...fingerChanges);

if (maxChange > threshold) {
  console.log('Motion detected, clearing buffer');
  setSensorBuffer([]);
  // Restart collection fresh
}

// After prediction in continuous mode:
if (isContinuousMode) {
  setSensorBuffer([]);  // Clear immediately
  isCollectingRef.current = true;  // Re-enable
}
```

**Thresholds**:
- Simulator: 15 (smooth transitions)
- Real glove: 100 (sharp movements)

### 3. **QuickDemo Word Detection**

**Problem**: TTS was speaking the INPUT word, not the DETECTED word (e.g., model predicted "DXAF" but TTS said "DEAF").

**Solution**: Use ref to get current detected word:

```typescript
// App.tsx
const detectedLettersRef = useRef<string[]>([]);
const getCurrentWord = () => detectedLettersRef.current.join('');

// QuickDemo.tsx
const finalWord = getCurrentWord(); // Get actual detected letters
Speech.speak(finalWord); // Speak what was actually detected
```

### 4. **3D Hand Camera Persistence**

**Problem**: Camera reset every time hand moved.

**Solution**: Use Plotly's `uirevision` to preserve camera state:

```typescript
<Plot
  layout={{
    uirevision: 'true',  // Constant string = preserve camera
    scene: {
      camera: { /* initial position */ },
      aspectmode: 'manual',  // Lock aspect ratio
      aspectratio: { x: 1, y: 1, z: 1 }
    }
  }}
/>
```

### 5. **TTS Double-Speaking**

**Problem**: TTS spoke letters twice in single-letter mode.

**Solution**: Cancel previous speech before starting new:

```typescript
if (!isContinuousMode) {
  console.log('[App] Cancelling existing speech');
  window.speechSynthesis.cancel();
  
  const utterance = new SpeechSynthesisUtterance(letter);
  window.speechSynthesis.speak(utterance);
}
```

### 6. **Serial Data Parsing (Rust)**

**Implementation**:
```rust
// src-tauri/src/main.rs
let mut buffer = vec![0u8; 32];
let mut current_line = String::new();

loop {
    match port.read(buffer.as_mut_slice()) {
        Ok(bytes_read) => {
            let data = String::from_utf8_lossy(&buffer[..bytes_read]);
            current_line.push_str(&data);
            
            // Process complete lines
            while let Some(index) = current_line.find('\n') {
                let line = current_line.drain(..=index).collect::<String>();
                
                // Parse CSV: "444,804,829,742,711"
                let values: Vec<u32> = line.trim()
                    .split(',')
                    .filter_map(|s| s.parse().ok())
                    .collect();
                
                if values.len() == 5 {
                    app_handle.emit_all("serial-data", values).ok();
                }
            }
        }
        Err(e) => { /* handle error */ }
    }
}
```

### 7. **Data Recording Accumulation**

**Design Choice**: Each recording accumulates in memory, so each CSV export contains ALL previous recordings.

**Why?** Simplifies workflow - user gets one final CSV with all data.

**Files**:
```
glove_data_A_...-15.csv  →  150 samples  (recording 1)
glove_data_A_...-32.csv  →  300 samples  (recording 1+2)
glove_data_A_...-48.csv  →  450 samples  (recording 1+2+3)
glove_data_A_...-55.csv  →  600 samples  (recording 1+2+3+4)
glove_data_A_...-10.csv  →  750 samples  (recording 1+2+3+4+5) ← USE THIS
```

**To reset**: Refresh page or close/reopen app.

---

## Known Issues & Workarounds

### Issue 1: Arduino Not Detected (Windows)
**Symptom**: COM port doesn't appear in list  
**Cause**: CH340 driver not installed  
**Fix**: Install driver from https://sparks.gogo.co.nz/ch340.html

### Issue 2: Serial Connection Fails
**Symptom**: "Failed to connect" error  
**Causes**:
1. Port already in use (e.g., Arduino IDE open)
2. Baud rate mismatch
3. Permissions issue

**Fix**:
1. Close all other programs using serial
2. Verify baud rate = 115200 in Arduino code
3. Run app as administrator (if needed)

### Issue 3: Predictions Stuck at 0% Confidence
**Symptom**: All predictions show 0%  
**Cause**: API key invalid or API server down  
**Fix**:
1. Check `.env` file has correct API key
2. Verify API is online: `curl https://api.ybilgin.com/health`
3. Check console for 401/403 errors

### Issue 4: 3D Hand Not Matching Real Hand
**Symptom**: Visualization shows wrong bending  
**Cause**: Sensor calibration off or sensor loose  
**Fix**:
1. Check sensor connections (firm contact)
2. Update `BASELINES` and `MAXBENDS` in code
3. Test: Make fist → all sensors should be near max
4. Test: Open hand → all sensors should be near baseline

### Issue 5: Motion Detection Too Sensitive
**Symptom**: Buffer clears constantly  
**Fix**: Increase `perFingerMotionThreshold` in `src/App.tsx` line 56

### Issue 6: CSV Has Duplicate Headers
**Symptom**: Multiple "label,ch0,ch1,ch2,ch3,ch4" rows  
**Cause**: Combining multiple CSVs  
**Fix**: Manually remove duplicate headers or use script:
```python
import pandas as pd
df = pd.read_csv('combined.csv')
df.to_csv('cleaned.csv', index=False)
```

### Issue 7: Model Training Takes Forever
**Symptom**: Training script hangs  
**Cause**: Too many samples or wrong format  
**Fix**:
1. Validate data first: `python validate_data.py`
2. Check CSV has correct columns
3. Try with smaller dataset first (e.g., 3 letters)

### Issue 8: Tauri Build Fails
**Symptom**: `pnpm run tauri build` errors  
**Causes**:
1. Rust not installed
2. Dependencies missing
3. Windows SDK missing

**Fix**:
1. Install Rust: https://rustup.rs/
2. Install Visual Studio Build Tools
3. Run `pnpm install` again

---

## Next Steps

### Immediate (Tomorrow with Real Glove)
1. ✅ Connect Arduino to PC
2. ✅ Test serial connection in Desktop App
3. ✅ Verify sensor readings (make fist, see values change)
4. ✅ Test single letter prediction (press simulator letter, verify API responds)
5. ✅ Record 5 samples of letter "A"
6. ✅ Train quick test model
7. ✅ If accuracy good → collect full dataset (5 recordings × 15 letters)

### Short-Term (This Week)
1. Train production model with collected data
2. Deploy new model to API server
3. Test accuracy improvements
4. Demo to professors
5. Record demo video

### Medium-Term (Next Week)
1. Add Bluetooth support to mobile app
2. Implement user accounts & cloud sync
3. Add more ASL letters (if sensors allow)
4. Optimize model (smaller, faster)
5. Improve UI/UX based on user feedback

### Long-Term (Thesis Timeline)
1. Collect data from multiple users
2. Train user-agnostic model
3. Add real-time word correction
4. Implement sentence builder
5. Deploy to production (app stores)
6. Write thesis chapters
7. Prepare presentation

---

## Important Files to Read

### When You Start Tomorrow:
1. **This file** (PROJECT_STATE.md) - Overview
2. `DATA_COLLECTION_GUIDE.md` - Recording best practices
3. `src/App.tsx` - Main logic (lines 1-100, 260-360)
4. `src/components/DataRecorder.tsx` - Recording UI

### For Troubleshooting:
1. `src-tauri/src/main.rs` - Serial communication
2. `src/components/ConnectionManager.tsx` - Connection UI
3. `ASL-ML-Inference-API/README.md` - API docs

### For Training:
1. `iot-sign-glove/scripts/train_model.py` - Model training
2. `iot-sign-glove/scripts/validate_data.py` - Data validation

---

## Key Credentials

### API Keys
- **Desktop**: `021bb0cb3958c4770ff625473acd795848b0fac531f3a930d11a77f937595bee`
- **Mobile**: `e18c0f549306487f43311ebc5a1754f119ef885cab988287e19b588478fc4916`

### Server Access
- **SSH**: `bilgin@homeserver`
- **API URL**: https://api.ybilgin.com
- **Docs**: https://api.ybilgin.com/docs

---

## Tips for AI Assistant

### Understanding the Codebase
1. `src/App.tsx` is the **heart** - all state & logic flows through it
2. Components are **controlled** - they receive props, no internal state for core logic
3. **Refs** are used to avoid stale closures in callbacks
4. **Motion detection** prevents buffer contamination in continuous mode
5. **Recording** accumulates in memory for simplicity

### Common Questions
- **"How does prediction work?"** → See `makePrediction()` in `App.tsx`
- **"Why use refs?"** → Prevent race conditions at 50Hz data rate
- **"How to add new letter?"** → Update simulator patterns + retrain model
- **"How to fix connection?"** → Check `ConnectionManager.tsx` + `main.rs`
- **"Data collection not working?"** → Verify serial connection first

### Debugging Strategy
1. Check console logs (very detailed)
2. Look at Debug Log section in app
3. Verify API is responding (`/health` endpoint)
4. Test with simulator first, then real hardware
5. Check file structure matches this document

---

## Checklist for Tomorrow

Before collecting data:
- [ ] Read this file completely
- [ ] Read `DATA_COLLECTION_GUIDE.md`
- [ ] Glove is assembled and sensors are secure
- [ ] Arduino code uploaded (115200 baud, 50Hz)
- [ ] CH340 driver installed (Windows)
- [ ] Desktop app runs: `pnpm run tauri dev`
- [ ] Can connect to COM port
- [ ] Real-time sensor display shows values
- [ ] 3D hand matches your hand position
- [ ] Have ASL reference images ready
- [ ] Understand recording workflow (5 recordings/letter)

Ready to start? Good luck!

---

**End of Document**  
*This file contains everything needed to understand and continue the project.*

