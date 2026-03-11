import { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { useTranslation } from "react-i18next";
import { useTheme } from "./context/ThemeContext";
import ConnectionManager, { ImuData } from "./components/ConnectionManager";
import Calibrator from "./components/Calibrator";
import PredictionView from "./components/PredictionView";
import SensorDisplay from "./components/SensorDisplay";
import HandVisualization3D from "./components/HandVisualization3D";
import DebugLog from "./components/DebugLog";
import DataRecorder from "./components/DataRecorder";
import apiService, { PredictionResponse } from "./services/apiService";
import "./App.css";

// Default sensor calibration values for thermistors (physical glove)
// Based on actual sensor readings from the glove
const DEFAULT_BASELINES = [2871, 1949, 2135, 2303, 2348]; // straight position (higher values)
const DEFAULT_MAXBENDS = [2832, 1922, 2105, 2279, 2323];  // fully bent position (lower values)

// ── Quaternion helpers (mirrors HandVisualization3D math) ─────────────────────
// Used to apply the same IMU transformation chain before forwarding to Unity.
type Quat = { w: number; x: number; y: number; z: number };
const qMult = (a: Quat, b: Quat): Quat => ({
  w: a.w*b.w - a.x*b.x - a.y*b.y - a.z*b.z,
  x: a.w*b.x + a.x*b.w + a.y*b.z - a.z*b.y,
  y: a.w*b.y - a.x*b.z + a.y*b.w + a.z*b.x,
  z: a.w*b.z + a.x*b.y - a.y*b.x + a.z*b.w,
});
const qInv  = (q: Quat): Quat => ({ w: q.w, x: -q.x, y: -q.y, z: -q.z });
// Fallback calibration used when the user has never run the calibrator.
// These match SimulatorControl and have a proper wide range per finger.
const SIMULATOR_BASELINES = [2700, 1650, 1850, 2110, 2125];
const SIMULATOR_MAXBENDS  = [2200, 1300, 1480, 1640, 1720];

// Removed unused interface PredictionRecord

interface DebugLogData {
  simulationStartTime?: number;
  simulationEndTime?: number;
  firstSample?: number[];
  lastSample?: number[];
  totalSamples?: number;
  apiCallTime?: number;
  apiResponseTime?: number;
  apiResponse?: PredictionResponse;
  error?: string;
}

function App() {
  const { t, i18n } = useTranslation();
  const { theme, setTheme } = useTheme();
  
  // Prediction state
  const [sensorBuffer, setSensorBuffer] = useState<number[][]>([]);
  const isCollectingRef = useRef(true);
  const [currentPrediction, setCurrentPrediction] = useState<PredictionResponse | null>(null);
  const [predictionError, setPredictionError] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const simulationStartTimeRef = useRef<number>(0);
  
  // Real-time sensor display
  const [currentSample, setCurrentSample] = useState<number[] | null>(null);

  // IMU quaternion (from BNO055, null when IMU not present)
  const [currentImu, setCurrentImu] = useState<ImuData | null>(null);
  const currentImuRef = useRef<ImuData | null>(null); // ref for use inside callbacks

  const handleImuData = useCallback((data: ImuData) => {
    currentImuRef.current = data;
    setCurrentImu(data);
  }, []);

  // Unity Named Pipe state
  const [unityPipeEnabled, setUnityPipeEnabled] = useState(false);
  const [unityConnected,   setUnityConnected]   = useState(false);
  const unityPipeEnabledRef = useRef(false);
  // EMA (Exponential Moving Average) buffer for smoothing data sent to Unity/WebGL
  // Applied to raw ADC values before normalization — lower alpha = smoother but laggier
  const PIPE_EMA_ALPHA = 0.25; // 0=frozen, 1=raw — 0.25 gives ~4-sample smoothing
  const pipeEmaRef = useRef<number[] | null>(null);
  // Reference quaternion captured from the first IMU sample each Unity session.
  // Mirrors HandVisualization3D's refQuat so both show the same relative orientation.
  const unityRefQuatRef = useRef<Quat | null>(null);

  // WebGL twin (embedded iframe)
  const [webglEnabled,       setWebglEnabled]       = useState(false);
  const [webglServerRunning, setWebglServerRunning] = useState(false);
  const webglEnabledRef = useRef(false);
  const webglIframeRef      = useRef<HTMLIFrameElement>(null);
  const webglContainerRef   = useRef<HTMLDivElement>(null);
  const [webglScale, setWebglScale] = useState(0.75); // updated by ResizeObserver
  const WEBGL_PORT = 8787;
  const WEBGL_DIR  = 'C:\\Users\\Yigit\\Desktop\\iot-sign-language-desktop\\unity-handvis\\WebGLBuild';

  // Keep WebGL scale in sync with its column width (960px native canvas → scale to fit)
  useEffect(() => {
    if (!webglEnabled || !webglContainerRef.current) return;
    const observer = new ResizeObserver(entries => {
      const w = entries[0].contentRect.width;
      if (w > 0) setWebglScale(w / 960);
    });
    observer.observe(webglContainerRef.current);
    return () => observer.disconnect();
  }, [webglEnabled]);

  // Poll pipe connection status while enabled
  useEffect(() => {
    if (!unityPipeEnabled) return;
    const id = setInterval(async () => {
      try {
        const s = await invoke<{ running: boolean; connected: boolean }>('unity_pipe_status');
        setUnityConnected(s.connected);
      } catch { /* ignore */ }
    }, 1000);
    return () => clearInterval(id);
  }, [unityPipeEnabled]);
  
  // Data log for debugging (stores last 100 samples)
  const [dataLog, setDataLog] = useState<string[]>([]);
  const dataLogRef = useRef<string[]>([]);
  
  // Debug state
  const [debugLogData, setDebugLogData] = useState<DebugLogData | null>(null);
  
  // Simulator state
  const [isSimulating, setIsSimulating] = useState(false);
  
  // Connection state (for future glove support)
  const [connectedDevice, setConnectedDevice] = useState<string | null>(null);

  // Calibration state
  const [baselines, setBaselines] = useState<number[]>(DEFAULT_BASELINES);
  const [maxbends, setMaxbends] = useState<number[]>(DEFAULT_MAXBENDS);

  // Manual prediction recording
  const [isRecordingPrediction, setIsRecordingPrediction] = useState(false);
  const isRecordingPredictionRef = useRef(false);
  const [predictionProgress, setPredictionProgress] = useState(0);

  // Continuous mode state
  const [detectedLetters, setDetectedLetters] = useState<string[]>([]);
  const detectedLettersRef = useRef<string[]>([]);
  const [recognitionMode, setRecognitionMode] = useState<'manual' | 'single' | 'continuous'>('manual');
  const [minConfidence] = useState(0.6); // Removed unused setter
  const [isWordFinalized, setIsWordFinalized] = useState(false);

  // Real-time prediction state (for continuous streaming)
  const isRealTimePredicting = useRef(false);
  const realTimeBufferRef = useRef<number[][]>([]);
  const lastPredictedLetterRef = useRef<string>('');
  const lastPredictionTimeRef = useRef<number>(0);
  const MIN_PREDICTION_INTERVAL = 200; // 5 predictions/sec = 300/min (backend limit: 1500/min)

  // Dev: use local model instead of cloud API
  const [useLocalModel, setUseLocalModel] = useState(false);

  // Stable mode: only show prediction when confidence is above threshold
  const [stableMode, setStableMode] = useState(false);
  const STABLE_CONFIDENCE_THRESHOLD = 0.35;

  // Keep ref in sync with state
  useEffect(() => {
    detectedLettersRef.current = detectedLetters;
  }, [detectedLetters]);

  // Sync local model switch with apiService
  useEffect(() => {
    apiService.setUseLocalModel(useLocalModel);
  }, [useLocalModel]);

  
  // Calibration handler
  const handleCalibrationComplete = useCallback((newBaselines: number[], newMaxbends: number[]) => {
    console.log('[App] Calibration complete!');
    console.log('[App] Baselines:', newBaselines);
    console.log('[App] Maxbends:', newMaxbends);
    
    // Update state for normalization
    setBaselines(newBaselines);
    setMaxbends(newMaxbends);
    
    // Don't use alert() - it's blocked by Tauri
    console.log(`Calibration Applied! Baselines: [${newBaselines.join(', ')}] Maxbends: [${newMaxbends.join(', ')}]`);
  }, []);

  // Idle detection
  const lastSampleTimeRef = useRef<number>(Date.now());
  const idleTimerRef = useRef<number | null>(null);

  // Data recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingLetter, setRecordingLetter] = useState('');
  const [recordedSamples, setRecordedSamples] = useState<number[][]>([]);
  const recordingDataRef = useRef<{ letter: string; samples: number[][] }[]>([]);

  // Reset collecting flag when starting simulation
  useEffect(() => {
    if (isSimulating) {
      isCollectingRef.current = true;
      simulationStartTimeRef.current = Date.now();
    }
  }, [isSimulating]);

  // When using simulator, auto-enable local model (96% trained on same data)
  useEffect(() => {
    if (isSimulating && !useLocalModel) {
      setUseLocalModel(true);
    }
  }, [isSimulating, useLocalModel]);

  // Auto-restart collection in continuous mode
  useEffect(() => {
    if (recognitionMode === 'continuous' && !isCollectingRef.current && !isAnalyzing && isSimulating) {
      const timer = setTimeout(() => {
        if (isSimulating) {
          console.log('[Continuous mode] Restarting collection for next letter');
          isCollectingRef.current = true;
          setSensorBuffer([]);
          simulationStartTimeRef.current = Date.now();
          lastSampleTimeRef.current = Date.now();
        }
      }, 500);
      
      return () => clearTimeout(timer);
    }
  }, [recognitionMode, isAnalyzing, isSimulating]);

  // Idle detection for word finalization
  useEffect(() => {
    const isActiveInContinuousMode = recognitionMode === 'continuous' && (isSimulating || connectedDevice !== null);
    
    if (isActiveInContinuousMode && detectedLetters.length > 0 && !isWordFinalized) {
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
      }

      idleTimerRef.current = setTimeout(() => {
        const timeSinceLastSample = Date.now() - lastSampleTimeRef.current;
        if (timeSinceLastSample >= 2000 && !isWordFinalized) {
          console.log('[Continuous mode] No samples for 2s - finalizing word and speaking');
          
          const finalWord = detectedLettersRef.current.join('');
          if (finalWord.length > 0 && 'speechSynthesis' in window) {
            console.log(`[Continuous mode] Speaking final word: "${finalWord}"`);
            const utterance = new SpeechSynthesisUtterance(finalWord);
            utterance.lang = 'en-US';
            utterance.rate = 0.8;
            window.speechSynthesis.speak(utterance);
            
            setIsWordFinalized(true);
          }
          
          handleStopSimulation();
        }
      }, 2500);
    }

    return () => {
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
      }
    };
  }, [recognitionMode, isSimulating, connectedDevice, detectedLetters, isWordFinalized]);

  const makePrediction = useCallback(async (samples: number[][]) => {
    const simulationEndTime = Date.now();
    const apiCallTime = Date.now();
    
    console.log(`[App] ===== makePrediction called with ${samples.length} samples =====`);
    console.log('[App] recognitionMode:', recognitionMode);
    setIsAnalyzing(true);
    setPredictionError(null);

    // Always send normalized 0-1 values (both local model and cloud API now expect this)

    // Use SIMULATOR calibration when: (a) in simulator mode, or (b) glove connected but user
    // never ran the calibrator (baselines still equal the narrow factory defaults).
    const useSerialSimulatorCal = connectedDevice && baselines.every((b, i) => Math.abs(b - DEFAULT_BASELINES[i]) < 1);
    const calBaselines = (isSimulating || useSerialSimulatorCal) ? SIMULATOR_BASELINES : baselines;
    const calMaxbends  = (isSimulating || useSerialSimulatorCal) ? SIMULATOR_MAXBENDS  : maxbends;

    // Normalize flex (channels 0-4) to 0-1; pass IMU quaternion (channels 5-8) through as-is.
    // The 21-letter model expects 9 columns — sending real IMU improves accuracy for
    // IMU-trained letters (B, D, G, H, K, L, P, Q, R, W). Falls back to 5-col gracefully.
    const convertedSamples = samples.map(sample => {
      const flexNorm = sample.slice(0, 5).map((value, i) => {
        const thermBaseline = calBaselines[i];
        const thermMaxBend  = calMaxbends[i];
        return Math.max(0, Math.min(1, (thermBaseline - value) / (thermBaseline - thermMaxBend)));
      });
      const imuPart = sample.length >= 9 ? sample.slice(5, 9) : [];
      return [...flexNorm, ...imuPart];
    });

    console.log('[App] Sending normalized 0-1 format');
    console.log('[App] First sample:', convertedSamples[0]);

    // Prepare debug data
    const debugData: DebugLogData = {
      simulationStartTime: simulationStartTimeRef.current,
      simulationEndTime,
      firstSample: samples[0],
      lastSample: samples[samples.length - 1],
      totalSamples: samples.length,
      apiCallTime,
    };

    try {
      // Include current IMU quaternion so the local two-staged model can run stage-2
      // disambiguation for letters G, H, K, P, Q, R, etc. that look flex-identical.
      const imuPayload = currentImuRef.current
        ? [currentImuRef.current.w, currentImuRef.current.x, currentImuRef.current.y, currentImuRef.current.z] as [number, number, number, number]
        : undefined;

      console.log('[App] IMU sent to model:', imuPayload ?? 'none (no IMU data)');

      const response = await apiService.predict({
        flex_sensors: convertedSamples,
        imu: imuPayload,
        device_id: isSimulating ? 'desktop-simulator' : 'desktop-glove'
      });

      debugData.apiResponseTime = Date.now();
      debugData.apiResponse = response;
      setDebugLogData(debugData);

      // Stable mode: only show prediction if confidence is above threshold
      if (!stableMode || response.confidence >= STABLE_CONFIDENCE_THRESHOLD) {
        setCurrentPrediction(response);
      } else {
        setCurrentPrediction(null);
      }

      // In continuous mode, add letter to word (with duplicate prevention for real-time)
      if (recognitionMode === 'continuous') {
        const currentTime = Date.now();
        const timeSinceLastPrediction = currentTime - lastPredictionTimeRef.current;
        
        // Only add if it's a different letter OR enough time has passed (500ms)
        const isDifferentLetter = response.letter !== lastPredictedLetterRef.current;
        const enoughTimePassed = timeSinceLastPrediction > 500;
        
        if (isWordFinalized) {
          console.log('[App] Word was finalized, clearing and starting new word');
          setDetectedLetters([response.letter]);
          setIsWordFinalized(false);
          lastPredictedLetterRef.current = response.letter;
          lastPredictionTimeRef.current = currentTime;
        } else if (response.confidence >= minConfidence && (isDifferentLetter || enoughTimePassed)) {
          // In real-time mode, only add if it's a new letter or enough time passed
          if (isDifferentLetter || enoughTimePassed) {
            setDetectedLetters(prev => {
              const newLetters = [...prev, response.letter];
              console.log(`[App] Added letter "${response.letter}" to word. Current word: "${newLetters.join('')}"`);
              return newLetters;
            });
            lastPredictedLetterRef.current = response.letter;
            lastPredictionTimeRef.current = currentTime;
          } else {
            console.log(`[App] Skipping duplicate letter "${response.letter}"`);
          }
        }
      } else {
        // Single letter mode - speak the letter (only once per gesture)
        const currentTime = Date.now();
        const timeSinceLastPrediction = currentTime - lastPredictionTimeRef.current;
        
        if (timeSinceLastPrediction > 1000) { // Speak only once per second
          console.log('[App] Single letter mode - speaking letter:', response.letter);
          if ('speechSynthesis' in window) {
            // Cancel any existing speech first
            console.log('[App] Cancelling existing speech');
            window.speechSynthesis.cancel();
            
            console.log('[App] Speaking letter:', response.letter);
            const utterance = new SpeechSynthesisUtterance(response.letter);
            utterance.lang = 'en-US';
            utterance.rate = 0.8;
            utterance.onstart = () => console.log('[App] TTS started for:', response.letter);
            utterance.onend = () => console.log('[App] TTS ended for:', response.letter);
            window.speechSynthesis.speak(utterance);
            
            lastPredictionTimeRef.current = currentTime;
          }
        }
      }
      
      // In continuous mode with connected device (real-time mode doesn't need restart)
      // Real-time predictions happen automatically with rolling window
      if (recognitionMode === 'continuous' && connectedDevice) {
        console.log('[App] Continuous real-time mode active');
        // No need to restart collection - it's continuous!
        lastSampleTimeRef.current = Date.now();
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Prediction failed';
      setPredictionError(errorMessage);
      debugData.error = errorMessage;
      setDebugLogData(debugData);
      console.error('[App] Prediction error:', errorMessage);
    } finally {
      setIsAnalyzing(false);
    }
  }, [recognitionMode, minConfidence, isSimulating, isWordFinalized, baselines, maxbends]);

  const makePredictionRef = useRef(makePrediction);
  useEffect(() => {
    makePredictionRef.current = makePrediction;
  }, [makePrediction]);

  // Handle sensor data from simulator
  const handleSensorData = useCallback((data: number[]) => {
    lastSampleTimeRef.current = Date.now();

    // Update real-time display
    setCurrentSample(data);

    // Forward normalized data to Unity (Named Pipe and/or WebGL twin)
    const needsTwinData = (unityPipeEnabledRef.current || webglEnabledRef.current) && data.length >= 5;
    if (needsTwinData) {
      // Apply EMA smoothing to raw ADC values before normalization
      const raw5 = data.slice(0, 5);
      if (!pipeEmaRef.current) pipeEmaRef.current = [...raw5];
      pipeEmaRef.current = pipeEmaRef.current.map((v, i) => v + PIPE_EMA_ALPHA * (raw5[i] - v));
      const smoothed = pipeEmaRef.current;

      // Normalize flex sensors to 0-1
      const useSimCal = isSimulating || baselines.every((b, i) => Math.abs(b - DEFAULT_BASELINES[i]) < 1);
      const calB = useSimCal ? SIMULATOR_BASELINES : baselines;
      const calM = useSimCal ? SIMULATOR_MAXBENDS  : maxbends;
      const normalizedFlex = smoothed.map((v, i) =>
        Math.max(0, Math.min(1, (calB[i] - v) / (calB[i] - calM[i])))
      );

      // IMU processing:
      //   1. Capture reference from first sample (reset when pipe/webgl restarts or user recalibrates)
      //   2. qRel     = inv(refQuat) * currentQuat   (relative rotation)
      //   3. qRelViz  = axis remap {x←y, y←z, z←x}  (aligns BNO frame → Unity coordinate axes)
      //
      // NOTE: Q_TARGET (90° X) is intentionally NOT applied here.
      // Unity's hand rig default pose already has fingers toward the camera,
      // so identity = "flat" correctly — adding Q_TARGET would over-rotate by 90°.
      const imu = currentImuRef.current;
      let imuXYZ: [number, number, number] = [0, 0, 0];
      if (imu) {
        if (!unityRefQuatRef.current) {
          unityRefQuatRef.current = { w: imu.w, x: imu.x, y: imu.y, z: imu.z };
        }
        const ref     = unityRefQuatRef.current;
        const qRel    = qMult(qInv(ref), imu);
        const qRelViz: Quat = { w: qRel.w, x: qRel.y, y: qRel.z, z: qRel.x };
        imuXYZ = [qRelViz.x, qRelViz.y, qRelViz.z];
      }

      if (unityPipeEnabledRef.current) {
        invoke('unity_pipe_send', { data: [...normalizedFlex, ...imuXYZ] }).catch(() => {});
      }

      if (webglEnabledRef.current && webglIframeRef.current?.contentWindow) {
        webglIframeRef.current.contentWindow.postMessage(
          { type: 'sensorData', flex: normalizedFlex, imu: { x: imuXYZ[0], y: imuXYZ[1], z: imuXYZ[2] } },
          '*'
        );
      }
    }
    
    // Add to data log (keep last 100 samples)
    // Append IMU quaternion values if BNO055 is present
    const imu = currentImuRef.current;
    const logLine = imu
      ? `${data.join(',')} | qw:${imu.w.toFixed(4)} qx:${imu.x.toFixed(4)} qy:${imu.y.toFixed(4)} qz:${imu.z.toFixed(4)}`
      : data.join(',');
    dataLogRef.current = [...dataLogRef.current, logLine].slice(-100); // Keep last 100
    setDataLog(dataLogRef.current);

    // If recording for data collection, add sample to recording buffer
    if (isRecording) {
      setRecordedSamples(prev => {
        // Attach the current IMU quaternion snapshot (if BNO055 is present).
        // Falls back to identity quaternion so the CSV always has 9 columns.
        const imuSnap = currentImuRef.current;
        const fullSample = imuSnap
          ? [...data, imuSnap.w, imuSnap.x, imuSnap.y, imuSnap.z]
          : [...data, 1.0, 0.0, 0.0, 0.0];
        const newSamples = [...prev, fullSample];
        if (newSamples.length >= 150 && isRecording) {
          console.log('[App] Recording complete - 150 samples collected');
        }
        return newSamples;
      });
      // Don't process for prediction while recording
      return;
    }

    // If recording for prediction (manual mode button), add to sensor buffer
    if (isRecordingPredictionRef.current) {
      setSensorBuffer(prev => {
        // Include IMU quaternion so the 21-letter model gets real orientation data
        const imuSnap = currentImuRef.current;
        const sample9 = imuSnap
          ? [...data, imuSnap.w, imuSnap.x, imuSnap.y, imuSnap.z]
          : data;
        const newBuffer = [...prev, sample9];
        const targetSamples = 200;
        
        // Update progress
        setPredictionProgress((newBuffer.length / targetSamples) * 100);

        if (newBuffer.length >= targetSamples) {
          console.log(`[App] Prediction recording complete - ${newBuffer.length} samples collected`);
          console.log(`[App] isRecordingPredictionRef.current = ${isRecordingPredictionRef.current}`);
          
          // Check if we already stopped
          if (!isRecordingPredictionRef.current) {
            console.log('[App] Already stopped, skipping duplicate prediction');
            return prev; // Don't clear buffer or trigger prediction again
          }
          
          // Immediately stop further collection
          isRecordingPredictionRef.current = false;
          setIsRecordingPrediction(false);
          setPredictionProgress(0);
          
          // Make prediction
          setTimeout(() => {
            makePredictionRef.current(newBuffer);
          }, 10);

          return [];
        }
        
        return newBuffer;
      });
      return;
    }

    // REAL-TIME CONTINUOUS STREAMING MODE
    // Rolling window: 50 samples (1 sec) = matches model training, faster letter transitions
    const REALTIME_WINDOW = 50;
    if (recognitionMode === 'single' || recognitionMode === 'continuous') {
      // Include IMU so the 21-letter model gets real orientation data
      const imuSnap = currentImuRef.current;
      const sample9 = imuSnap ? [...data, imuSnap.w, imuSnap.x, imuSnap.y, imuSnap.z] : data;
      realTimeBufferRef.current = [...realTimeBufferRef.current, sample9].slice(-REALTIME_WINDOW);
      
      // Update UI buffer for display
      setSensorBuffer(realTimeBufferRef.current);
      
      // Check if enough time has passed since last prediction (rate limiting)
      const now = Date.now();
      const timeSinceLastPrediction = now - lastPredictionTimeRef.current;
      const canMakePrediction = timeSinceLastPrediction >= MIN_PREDICTION_INTERVAL;
      
      // Make predictions when we have enough samples (50 = 1 sec at 50Hz)
      if (realTimeBufferRef.current.length >= REALTIME_WINDOW && !isRealTimePredicting.current && canMakePrediction) {
        isRealTimePredicting.current = true;
        lastPredictionTimeRef.current = now; // Update time immediately to prevent rapid firing
        
        // Make prediction with the rolling window
        const samplesForPrediction = [...realTimeBufferRef.current];
        
        console.log(`[App] Real-time prediction triggered (${timeSinceLastPrediction}ms since last)`);
        
        // Fire and forget - don't wait for response
        makePredictionRef.current(samplesForPrediction).finally(() => {
          // Allow next prediction after this one completes
          isRealTimePredicting.current = false;
        });
      }
      
      return;
    }

    // When in manual mode and not recording, don't collect data
  }, [isRecording, recognitionMode, isSimulating, baselines, maxbends]);

  const handleStopSimulation = () => {
    setIsSimulating(false);
    isCollectingRef.current = false;
  };

  // Manual prediction recording handlers
  const handleStartPredictionRecording = useCallback(() => {
    console.log('[App] Starting manual prediction recording');
    isRecordingPredictionRef.current = true;
    setIsRecordingPrediction(true);
    setPredictionProgress(0);
    setSensorBuffer([]);
  }, []);

  const handleStopPredictionRecording = useCallback(() => {
    console.log('[App] Stopping manual prediction recording');
    isRecordingPredictionRef.current = false;
    setIsRecordingPrediction(false);
    setPredictionProgress(0);
    
    // If we have some samples, make prediction with what we have
    if (sensorBuffer.length > 50) {
      setTimeout(() => {
        makePredictionRef.current(sensorBuffer);
      }, 10);
    }
    
    setSensorBuffer([]);
  }, [sensorBuffer]);

  // Data recording handlers
  const handleStartRecording = useCallback((letter: string) => {
    console.log(`[App] Starting recording for letter: ${letter}`);
    setIsRecording(true);
    setRecordingLetter(letter);
    setRecordedSamples([]);
  }, []);

  const handleStopRecording = useCallback(() => {
    console.log(`[App] Stopping recording. Collected ${recordedSamples.length} samples`);
    
    if (recordedSamples.length > 0) {
      // Save the recording
      recordingDataRef.current.push({
        letter: recordingLetter,
        samples: recordedSamples
      });
      
      // Export to CSV
      exportToCSV();
    }
    
    setIsRecording(false);
    setRecordingLetter('');
    setRecordedSamples([]);
  }, [recordedSamples, recordingLetter]);

  // Auto-stop recording when 150 samples are collected
  useEffect(() => {
    if (isRecording && recordedSamples.length >= 150) {
      handleStopRecording();
    }
  }, [isRecording, recordedSamples.length, handleStopRecording]);

  const exportToCSV = () => {
    const allData = recordingDataRef.current;
    if (allData.length === 0) return;

    // Get unique letters in the recording
    const uniqueLetters = [...new Set(allData.map(r => r.letter))].join('_');
    
    // Create timestamp: YYYY-MM-DD-HH-MM-SS
    const now = new Date();
    const timestamp = now.toISOString()
      .replace(/T/, '-')
      .replace(/:/g, '-')
      .slice(0, 19); // YYYY-MM-DD-HH-MM-SS

    // CSV format: label, 5 normalised flex values, 4 raw quaternion values (w,x,y,z)
    // The quaternion is the raw BNO055 output — no normalisation needed (already unit vector).
    // If the BNO055 was not connected during a recording, columns default to identity (1,0,0,0).
    let csvContent = 'label,ch0_norm,ch1_norm,ch2_norm,ch3_norm,ch4_norm,qw,qx,qy,qz\n';

    // Use the same calibration selection as makePrediction so recorded data
    // and prediction inputs are always normalized identically.
    const useSimCal = baselines.every((b, i) => Math.abs(b - DEFAULT_BASELINES[i]) < 1);
    const expBaselines = useSimCal ? SIMULATOR_BASELINES : baselines;
    const expMaxbends  = useSimCal ? SIMULATOR_MAXBENDS  : maxbends;

    allData.forEach(({ letter, samples }) => {
      samples.forEach(sample => {
        // First 5 values: flex sensors (normalize to 0-1)
        const normalizedFlex = sample.slice(0, 5).map((value, fingerIndex) => {
          const baseline = expBaselines[fingerIndex];
          const maxbend  = expMaxbends[fingerIndex];
          const normalized = (baseline - value) / (baseline - maxbend);
          return Math.max(0, Math.min(1, normalized)).toFixed(4);
        });
        // Values 5-8: quaternion (w, x, y, z) — keep as-is, 4 decimal places
        const imuValues = sample.length >= 9
          ? sample.slice(5, 9).map(v => v.toFixed(4))
          : ['1.0000', '0.0000', '0.0000', '0.0000']; // identity fallback
        csvContent += `${letter},${normalizedFlex.join(',')},${imuValues.join(',')}\n`;
      });
    });

    // Create download with letter(s) and timestamp
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `glove_data_NORMALIZED_${uniqueLetters}_${timestamp}.csv`;
    link.click();
    window.URL.revokeObjectURL(url);

    const calLabel = useSimCal ? 'SIMULATOR (fallback)' : 'USER CALIBRATION';
    console.log(`[App] Exported ${allData.length} recordings to NORMALIZED CSV`);
    console.log(`[App] Calibration used: ${calLabel} — Baselines: ${expBaselines}, Maxbends: ${expMaxbends}`);
    alert(`✅ Data exported as NORMALIZED values! ${allData.reduce((acc, r) => acc + r.samples.length, 0)} samples saved to CSV`);
  };

  const handleClearWord = () => {
    console.log('[App] Clearing word');
    setDetectedLetters([]);
    setCurrentPrediction(null);
    setIsWordFinalized(false);
  };

  const handleDeleteLetter = () => {
    setDetectedLetters(prev => prev.slice(0, -1));
  };

  return (
    <div className="container">
      <div className="header">
        <h1>{t("app.title")}</h1>
        <p className="subtitle">{t("app.subtitle")}</p>

        <div style={{ display: "flex", justifyContent: "center", gap: "1rem", marginTop: "1rem" }}>
          <select
            value={i18n.language}
            onChange={(e) => i18n.changeLanguage(e.target.value)}
            style={{
              padding: "0.5rem",
              borderRadius: "8px",
              border: "1px solid var(--border-color)",
              background: "var(--input-bg)",
              color: "var(--text-primary)"
            }}
          >
            <option value="en">English</option>
            <option value="tr">Türkçe</option>
          </select>

          <select
            value={theme}
            onChange={(e) => setTheme(e.target.value as "light" | "dark" | "system")}
            style={{
              padding: "0.5rem",
              borderRadius: "8px",
              border: "1px solid var(--border-color)",
              background: "var(--input-bg)",
              color: "var(--text-primary)"
            }}
          >
            <option value="light">{t("settings.light")}</option>
            <option value="dark">{t("settings.dark")}</option>
            <option value="system">{t("settings.system")}</option>
          </select>
        </div>
      </div>

      <div className="content">
        <h2 style={{ color: 'var(--text-primary)', fontSize: '1.5rem', fontWeight: '700', marginBottom: '1rem' }}>
          ASL Recognition
        </h2>

        {/* Dev: Use local model switch */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          padding: '0.5rem 0',
          marginBottom: '0.5rem',
          borderBottom: '1px solid var(--border-color)'
        }}>
          <label style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            cursor: 'pointer',
            fontSize: '0.9rem',
            color: 'var(--text-secondary)'
          }}>
            <input
              type="checkbox"
              checked={useLocalModel}
              onChange={(e) => setUseLocalModel(e.target.checked)}
            />
            <span>Use local model (dev)</span>
          </label>
          {useLocalModel && (
            <span style={{ fontSize: '0.75rem', color: 'var(--accent-color)' }}>
              localhost:8765 (96% model) — run: cd iot-sign-glove; python scripts/serve_local_model.py
            </span>
          )}

          <label style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            cursor: 'pointer',
            fontSize: '0.9rem',
            color: 'var(--text-secondary)',
            marginLeft: '1rem'
          }}>
            <input
              type="checkbox"
              checked={stableMode}
              onChange={(e) => setStableMode(e.target.checked)}
            />
            <span>Stable mode</span>
          </label>
          {stableMode && (
            <span style={{ fontSize: '0.75rem', color: 'var(--accent-color)' }}>
              Only shows predictions with confidence ≥ {Math.round(STABLE_CONFIDENCE_THRESHOLD * 100)}%
            </span>
          )}
        </div>

        {/* Unity Named Pipe toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button
            onClick={async () => {
              if (unityPipeEnabled) {
                await invoke('unity_pipe_stop').catch(() => {});
                unityPipeEnabledRef.current = false;
                setUnityPipeEnabled(false);
                setUnityConnected(false);
              } else {
                unityRefQuatRef.current = null;  // capture fresh reference on next IMU sample
                pipeEmaRef.current = null;        // reset EMA buffer on reconnect
                await invoke('unity_pipe_start', { pipeName: 'glove_pipe' }).catch(() => {});
                unityPipeEnabledRef.current = true;
                setUnityPipeEnabled(true);
              }
            }}
            style={{
              padding: '0.4rem 0.9rem', borderRadius: '6px', cursor: 'pointer',
              fontSize: '0.85rem', fontWeight: 600,
              background: unityPipeEnabled ? 'rgba(99,102,241,0.15)' : 'rgba(100,116,139,0.1)',
              color:      unityPipeEnabled ? '#818cf8'               : 'var(--text-secondary)',
              border:     `1px solid ${unityPipeEnabled ? 'rgba(99,102,241,0.45)' : 'rgba(100,116,139,0.25)'}`,
            }}>
            🎮 {unityPipeEnabled ? 'Unity On' : 'Unity Off'}
          </button>
          {/* Launch Unity standalone executable */}
          <button
            onClick={() => invoke('launch_unity', {
              exePath: 'C:\\Users\\Yigit\\Desktop\\iot-sign-language-desktop\\unity-handvis\\Build\\ITU_MoCap.exe'
            }).catch((e: unknown) => alert(String(e)))}
            title="Open Unity 3D Digital Twin (separate window)"
            style={{
              padding: '0.4rem 0.9rem', borderRadius: '6px', cursor: 'pointer',
              fontSize: '0.85rem', fontWeight: 600,
              background: 'rgba(16,185,129,0.1)',
              color: '#34d399',
              border: '1px solid rgba(16,185,129,0.35)',
            }}>
            🪄 Open 3D Twin
          </button>

          {/* WebGL twin (embedded iframe) */}
          <button
            onClick={async () => {
              if (webglEnabled) {
                // Stop server + hide iframe
                await invoke('stop_webgl_server').catch(() => {});
                webglEnabledRef.current = false;
                setWebglEnabled(false);
                setWebglServerRunning(false);
              } else {
                try {
                  unityRefQuatRef.current = null; // fresh IMU reference for the new session
                  pipeEmaRef.current = null;       // reset EMA buffer for new session
                  await invoke('start_webgl_server', { dir: WEBGL_DIR, port: WEBGL_PORT });
                  webglEnabledRef.current = true;
                  setWebglEnabled(true);
                  setWebglServerRunning(true);
                } catch (e) {
                  alert(`WebGL server error: ${String(e)}`);
                }
              }
            }}
            title={webglEnabled ? 'Hide embedded 3D Twin' : 'Embed 3D Twin inside this window'}
            style={{
              padding: '0.4rem 0.9rem', borderRadius: '6px', cursor: 'pointer',
              fontSize: '0.85rem', fontWeight: 600,
              background: webglEnabled ? 'rgba(99,102,241,0.15)' : 'rgba(16,185,129,0.08)',
              color:      webglEnabled ? '#818cf8'               : '#34d399',
              border:     `1px solid ${webglEnabled ? 'rgba(99,102,241,0.45)' : 'rgba(16,185,129,0.25)'}`,
            }}>
            🖼️ {webglEnabled ? 'Hide Twin (WebGL)' : 'Embed 3D Twin'}
          </button>
          {webglServerRunning && (
            <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              serving :8787
            </span>
          )}

          {unityPipeEnabled && (
            <span style={{ fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: unityConnected ? '#10b981' : '#f59e0b', display: 'inline-block' }} />
              <span style={{ color: 'var(--text-secondary)' }}>
                {unityConnected ? 'Unity connected' : 'Waiting for Unity… (pipe: glove_pipe)'}
              </span>
            </span>
          )}
        </div>

        {/* Connection Manager */}
        <ConnectionManager 
          onSensorData={handleSensorData}
          onImuData={handleImuData}
          onConnectionChange={(connected) => {
            setConnectedDevice(connected ? 'serial-device' : null);
            
            // Clear all buffers and state when disconnecting
            if (!connected) {
              console.log('[App] Connection lost - clearing all buffers and state');
              setSensorBuffer([]);
              setCurrentSample(null);
              setCurrentImu(null);
              currentImuRef.current = null;
              setDataLog([]);
              dataLogRef.current = [];
              realTimeBufferRef.current = []; // Clear real-time buffer
              isRealTimePredicting.current = false;
              lastPredictedLetterRef.current = '';
              lastPredictionTimeRef.current = 0;
              setPredictionProgress(0);
              setIsRecordingPrediction(false);
              isRecordingPredictionRef.current = false;
              // Don't clear prediction/letters - user might want to see last result
            }
          }}
        />

        {/* Auto-Calibrator */}
        <Calibrator
          onCalibrationComplete={handleCalibrationComplete}
          isConnected={connectedDevice !== null}
          currentSample={currentSample}
          currentBaselines={baselines}
          currentMaxbends={maxbends}
        />

        {/* Recognition Mode Selector */}
        <div style={{
          padding: '1rem',
          borderRadius: '12px',
          border: '1px solid var(--border-color)',
          background: 'var(--bg-card)',
          marginBottom: '1rem'
        }}>
          <label style={{ 
            display: 'block',
            color: 'var(--text-primary)', 
            fontWeight: '600',
            marginBottom: '0.5rem'
          }}>
            Recognition Mode
          </label>
          <select
            value={recognitionMode}
            onChange={(e) => {
              const newMode = e.target.value as 'manual' | 'single' | 'continuous';
              setRecognitionMode(newMode);
              if (newMode !== 'continuous') {
                handleClearWord();
              }
              // Clear buffer when switching modes
              setSensorBuffer([]);
              realTimeBufferRef.current = [];
              isRealTimePredicting.current = false;
              lastPredictedLetterRef.current = '';
              lastPredictionTimeRef.current = 0;
              setCurrentPrediction(null);
            }}
            style={{
              width: '100%',
              padding: '0.75rem',
              borderRadius: '8px',
              border: '1px solid var(--border-color)',
              background: 'var(--input-bg)',
              color: 'var(--text-primary)',
              fontSize: '0.95rem',
              cursor: 'pointer'
            }}
          >
            <option value="manual">Manual Mode (Click button to record)</option>
            <option value="single">Single Letter Mode (Real-time predictions)</option>
            <option value="continuous">Continuous Mode (Real-time word building)</option>
          </select>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0.5rem 0 0 0' }}>
            {recognitionMode === 'manual' 
              ? 'Click "Record Sign" button to manually capture 200 samples for prediction.'
              : recognitionMode === 'single'
              ? '🔴 LIVE: Real-time predictions with rolling 50-sample window (1 sec). Fast letter transitions!'
              : '🔴 LIVE: Real-time predictions building words. Updates 5x per second - hold each letter steady!'}
          </p>
        </div>

        {/* WebGL 3D Twin + Prediction View side by side */}
        {webglEnabled && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: '2fr 1fr',
            gap: '1rem',
            marginBottom: '1rem',
            alignItems: 'stretch',
          }}>
            {/* WebGL card — 2/3 width */}
            <div style={{
              borderRadius: '12px',
              overflow: 'hidden',
              border: '1px solid var(--border-color)',
              background: 'var(--bg-card)',
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '0.75rem 1rem',
                borderBottom: '1px solid var(--border-color)',
              }}>
                <div>
                  <span style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    🖼️ 3D Digital Twin
                  </span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginLeft: '0.5rem' }}>
                    WebGL · Live Hand Pose
                  </span>
                </div>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                  localhost:{WEBGL_PORT}
                </span>
              </div>
              {/*
                Responsive scaling: ResizeObserver measures this div's width,
                sets webglScale = width/960. The iframe renders at 960×960 then
                scales down; the container height = 960*scale = column width (square).
              */}
              <div
                ref={webglContainerRef}
                style={{
                  width: '100%',
                  height: `${960 * webglScale * 0.6}px`,
                  overflow: 'hidden',
                  background: 'var(--bg-secondary)',
                }}
              >
                <iframe
                  ref={webglIframeRef}
                  src={`http://localhost:${WEBGL_PORT}`}
                  title="Unity 3D Digital Twin"
                  style={{
                    width: '960px',
                    height: '960px',
                    border: 'none',
                    display: 'block',
                    transform: `scale(${webglScale})`,
                    transformOrigin: 'top left',
                  }}
                  allow="fullscreen"
                  // @ts-ignore
                  scrolling="no"
                />
              </div>
            </div>

            {/* Prediction View — 1/3 width, stretched to match WebGL card height */}
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              <PredictionView
                prediction={currentPrediction}
                isLoading={isAnalyzing}
                error={predictionError}
                sampleCount={sensorBuffer.length}
                isContinuousMode={recognitionMode === 'continuous'}
                currentWord={detectedLetters.join('')}
                onClearWord={handleClearWord}
                onDeleteLetter={handleDeleteLetter}
                isRealTimeMode={recognitionMode === 'single' || recognitionMode === 'continuous'}
              />
            </div>
          </div>
        )}

        {/* Manual Prediction Recording */}
        {/* Manual Sign Recording - Only show in Manual mode */}
        {connectedDevice && recognitionMode === 'manual' && (
          <div style={{
            padding: '1rem',
            borderRadius: '12px',
            border: '1px solid var(--border-color)',
            background: 'var(--bg-card)',
            marginBottom: '1rem'
          }}>
            <h3 style={{
              fontSize: '1.1rem',
              fontWeight: '600',
              color: 'var(--text-primary)',
              marginBottom: '0.75rem'
            }}>
              📝 Manual Sign Recording
            </h3>
            <p style={{
              fontSize: '0.9rem',
              color: 'var(--text-secondary)',
              marginBottom: '1rem'
            }}>
              Click "Record Sign" to manually capture 200 samples (4 seconds) for prediction
            </p>
            
            {isRecordingPrediction ? (
              <div>
                <div style={{
                  width: '100%',
                  height: '24px',
                  backgroundColor: 'var(--input-bg)',
                  borderRadius: '12px',
                  overflow: 'hidden',
                  marginBottom: '0.75rem',
                  border: '1px solid var(--border-color)'
                }}>
                  <div style={{
                    height: '100%',
                    width: `${predictionProgress}%`,
                    backgroundColor: 'var(--accent-color)',
                    transition: 'width 0.1s ease',
                    borderRadius: '12px'
                  }} />
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <button
                    onClick={handleStopPredictionRecording}
                    style={{
                      padding: '0.75rem 1.5rem',
                      borderRadius: '8px',
                      border: '1px solid var(--border-color)',
                      background: 'var(--bg-button-danger)',
                      color: 'white',
                      fontSize: '0.95rem',
                      fontWeight: '600',
                      cursor: 'pointer'
                    }}
                  >
                    ⏹️ Stop Recording
                  </button>
                  <span style={{
                    fontSize: '0.9rem',
                    color: 'var(--text-secondary)'
                  }}>
                    Recording... {Math.round(predictionProgress)}%
                  </span>
                </div>
              </div>
            ) : (
              <button
                onClick={handleStartPredictionRecording}
                disabled={isRecording || isAnalyzing}
                style={{
                  padding: '0.75rem 1.5rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  background: isRecording || isAnalyzing ? 'var(--bg-button-disabled)' : 'var(--accent-color)',
                  color: 'white',
                  fontSize: '0.95rem',
                  fontWeight: '600',
                  cursor: isRecording || isAnalyzing ? 'not-allowed' : 'pointer',
                  opacity: isRecording || isAnalyzing ? 0.5 : 1
                }}
              >
                🎬 Record Sign (200 samples)
              </button>
            )}
          </div>
        )}



        {/* Debug Log */}
        <DebugLog data={debugLogData} />
      </div>

        {/* Data Log for Debugging */}
        {dataLog.length > 0 && (
          <div style={{
            padding: '1.5rem',
            borderRadius: '12px',
            border: '1px solid var(--border-color)',
            background: 'var(--bg-card)',
            marginBottom: '1rem'
          }}>
            <div style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center',
              marginBottom: '1rem'
            }}>
              <h3 style={{ 
                fontSize: '1.25rem',
                fontWeight: '700',
                color: 'var(--text-primary)',
                margin: 0
              }}>
                📊 Serial Data Log (Last 100 samples)
              </h3>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  onClick={() => {
                    const text = dataLog.join('\n');
                    navigator.clipboard.writeText(text);
                    alert('Copied to clipboard!');
                  }}
                  style={{
                    padding: '0.5rem 1rem',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)',
                    background: 'var(--input-bg)',
                    color: 'var(--text-primary)',
                    fontSize: '0.875rem',
                    cursor: 'pointer',
                    fontWeight: '500'
                  }}
                >
                  📋 Copy All
                </button>
                <button
                  onClick={() => {
                    setDataLog([]);
                    dataLogRef.current = [];
                  }}
                  style={{
                    padding: '0.5rem 1rem',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)',
                    background: 'var(--input-bg)',
                    color: 'var(--text-primary)',
                    fontSize: '0.875rem',
                    cursor: 'pointer',
                    fontWeight: '500'
                  }}
                >
                  🗑️ Clear
                </button>
              </div>
            </div>
            <div style={{
              maxHeight: '300px',
              overflowY: 'auto',
              background: 'var(--input-bg)',
              borderRadius: '8px',
              padding: '1rem',
              fontFamily: 'monospace',
              fontSize: '0.875rem',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-color)'
            }}>
              {dataLog.map((line, index) => (
                <div key={index} style={{ whiteSpace: 'nowrap', marginBottom: '0.25rem' }}>
                  {line}
                </div>
              ))}
            </div>
            <p style={{ 
              fontSize: '0.75rem', 
              color: 'var(--text-secondary)', 
              margin: '0.75rem 0 0 0' 
            }}>
              Format: Thumb, Index, Middle, Ring, Pinky (same as Serial Monitor)
            </p>
          </div>
        )}



        {/* Data Recorder */}
        <DataRecorder
          isRecording={isRecording}
          onStartRecording={handleStartRecording}
          onStopRecording={handleStopRecording}
          recordedSamples={recordedSamples.length}
          targetSamples={150}
          isConnected={connectedDevice !== null}
        />

        {/* 3D Hand Visualizer + Sensor Display (moved below Data Recorder) */}
        {(() => {
          const SIMULATOR_BASELINES = [2700, 1650, 1850, 2110, 2125];
          const SIMULATOR_MAXBENDS = [2200, 1300, 1480, 1640, 1720];
          const useSimulatorCal = isSimulating || (
            connectedDevice && baselines.every((b, i) => Math.abs(b - DEFAULT_BASELINES[i]) < 1)
          );
          const calBaselines = useSimulatorCal ? SIMULATOR_BASELINES : baselines;
          const calMaxbends = useSimulatorCal ? SIMULATOR_MAXBENDS : maxbends;
          return (
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '1rem',
              marginBottom: '1rem',
              alignItems: 'start'
            }}>
              <HandVisualization3D
                currentSample={currentSample}
                isActive={isSimulating || connectedDevice !== null}
                prediction={currentPrediction?.letter}
                confidence={currentPrediction?.confidence}
                onTestSample={(sample) => setCurrentSample(sample)}
                baselines={calBaselines}
                maxbends={calMaxbends}
                quaternion={currentImu}
                onRecalibrate={() => { unityRefQuatRef.current = null; }}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <SensorDisplay
                  currentSample={currentSample}
                  isActive={isSimulating || connectedDevice !== null}
                  sampleCount={sensorBuffer.length}
                  targetSamples={recognitionMode === 'manual' ? 200 : 50}
                  isCollecting={isCollectingRef.current}
                  baselines={calBaselines}
                  maxbends={calMaxbends}
                />
                <PredictionView
                  prediction={currentPrediction}
                  isLoading={isAnalyzing}
                  error={predictionError}
                  sampleCount={sensorBuffer.length}
                  isContinuousMode={recognitionMode === 'continuous'}
                  currentWord={detectedLetters.join('')}
                  onClearWord={handleClearWord}
                  onDeleteLetter={handleDeleteLetter}
                  isRealTimeMode={recognitionMode === 'single' || recognitionMode === 'continuous'}
                />
              </div>
            </div>
          );
        })()}

      <div className="footer">
        <p className="info-text">{t("app.footer")}</p>
        <p className="version">{t("app.version")}</p>
      </div>
    </div>
  );
}

export default App;
