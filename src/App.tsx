import { useState, useCallback, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useTheme } from "./context/ThemeContext";
import ConnectionManager from "./components/ConnectionManager";
import SimulatorControl from "./components/SimulatorControl";
import PredictionView from "./components/PredictionView";
import QuickDemo from "./components/QuickDemo";
import SensorDisplay from "./components/SensorDisplay";
import HandVisualization3D from "./components/HandVisualization3D";
import DebugLog from "./components/DebugLog";
import DataRecorder from "./components/DataRecorder";
import apiService, { PredictionResponse } from "./services/apiService";
import "./App.css";

interface PredictionRecord {
  letter: string;
  confidence: number;
  timestamp: number;
}

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
  
  // Debug state
  const [debugLogData, setDebugLogData] = useState<DebugLogData | null>(null);
  
  // Simulator state
  const [isSimulating, setIsSimulating] = useState(false);
  
  // Connection state (for future glove support)
  const [connectedDevice, setConnectedDevice] = useState<string | null>(null);

  // Motion detection for automatic buffer clearing (declared after connectedDevice)
  const previousSampleRef = useRef<number[] | null>(null);
  const perFingerMotionThreshold = 15; // Temporarily low for smooth Python simulator testing (will be 100 for real glove)
  const [motionDetected, setMotionDetected] = useState(false);

  // Continuous mode state
  const [detectedLetters, setDetectedLetters] = useState<string[]>([]);
  const detectedLettersRef = useRef<string[]>([]);
  const [isContinuousMode, setIsContinuousMode] = useState(false);
  const [minConfidence, setMinConfidence] = useState(0.6);
  const [isWordFinalized, setIsWordFinalized] = useState(false);

  // Keep ref in sync with state
  useEffect(() => {
    detectedLettersRef.current = detectedLetters;
  }, [detectedLetters]);

  // QuickDemo control
  const quickDemoCallbackRef = useRef<(() => void) | null>(null);
  const simulateLetterRef = useRef<string | null>(null);

  // Idle detection
  const lastSampleTimeRef = useRef<number>(Date.now());
  const idleTimerRef = useRef<number | null>(null);

  // Data recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingLetter, setRecordingLetter] = useState('');
  const [recordedSamples, setRecordedSamples] = useState<number[][]>([]);
  const recordingDataRef = useRef<{ letter: string; samples: number[][] }[]>([]);

  // Handler to programmatically trigger letter simulation
  const simulateLetter = useCallback((letter: string) => {
    if (!isContinuousMode) {
      setIsContinuousMode(true);
    }
    
    setIsSimulating(true);
    setSensorBuffer([]);
    isCollectingRef.current = true;
    simulationStartTimeRef.current = Date.now();
    simulateLetterRef.current = letter;
  }, [isContinuousMode, connectedDevice, isSimulating]);

  // Reset collecting flag when starting simulation
  useEffect(() => {
    if (isSimulating) {
      isCollectingRef.current = true;
      simulationStartTimeRef.current = Date.now();
    }
  }, [isSimulating]);

  // Auto-restart collection in continuous mode
  useEffect(() => {
    if (quickDemoCallbackRef.current) {
      return;
    }
    
    if (isContinuousMode && !isCollectingRef.current && !isAnalyzing && isSimulating) {
      const timer = setTimeout(() => {
        if (isSimulating && !quickDemoCallbackRef.current) {
          console.log('[Continuous mode] Restarting collection for next letter');
          isCollectingRef.current = true;
          setSensorBuffer([]);
          simulationStartTimeRef.current = Date.now();
          lastSampleTimeRef.current = Date.now();
        }
      }, 500);
      
      return () => clearTimeout(timer);
    }
  }, [isContinuousMode, isAnalyzing, isSimulating]);

  // Idle detection for word finalization
  useEffect(() => {
    const isActiveInContinuousMode = isContinuousMode && (isSimulating || connectedDevice !== null);
    
    if (isActiveInContinuousMode && detectedLetters.length > 0 && !isWordFinalized) {
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
      }

      idleTimerRef.current = setTimeout(() => {
        const timeSinceLastSample = Date.now() - lastSampleTimeRef.current;
        if (timeSinceLastSample >= 2000 && !quickDemoCallbackRef.current && !isWordFinalized) {
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
  }, [isContinuousMode, isSimulating, connectedDevice, detectedLetters, isWordFinalized]);

  const makePrediction = useCallback(async (samples: number[][]) => {
    const simulationEndTime = Date.now();
    const apiCallTime = Date.now();
    
    console.log(`[App] ===== makePrediction called with ${samples.length} samples =====`);
    console.log('[App] isContinuousMode:', isContinuousMode);
    setIsAnalyzing(true);
    setPredictionError(null);

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
      const response = await apiService.predict({
        flex_sensors: samples,
        device_id: isSimulating ? 'desktop-simulator' : 'desktop-glove'
      });

      debugData.apiResponseTime = Date.now();
      debugData.apiResponse = response;
      setDebugLogData(debugData);

      setCurrentPrediction(response);

      // In continuous mode, add letter to word
      if (isContinuousMode) {
        const isQuickDemoRunning = quickDemoCallbackRef.current !== null;
        
        if (isWordFinalized) {
          console.log('[App] Word was finalized, clearing and starting new word');
          setDetectedLetters([response.letter]);
          setIsWordFinalized(false);
        } else if (isQuickDemoRunning || response.confidence >= minConfidence) {
          setDetectedLetters(prev => {
            const newLetters = [...prev, response.letter];
            console.log(`[App] Added letter "${response.letter}" to word. Current word: "${newLetters.join('')}"`);
            return newLetters;
          });
        }
      } else {
        // Single letter mode - speak the letter
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
        }
      }

      // Notify QuickDemo that prediction is complete
      if (quickDemoCallbackRef.current) {
        console.log('[App] Calling QuickDemo callback');
        const callback = quickDemoCallbackRef.current;
        quickDemoCallbackRef.current = null;
        callback();
      }
      
      // In continuous mode with connected device, restart collection immediately
      if (isContinuousMode && connectedDevice && !quickDemoCallbackRef.current) {
        console.log('[App] Continuous mode: Restarting collection for next letter');
        isCollectingRef.current = true;
        setSensorBuffer([]);
        simulationStartTimeRef.current = Date.now();
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
  }, [isContinuousMode, minConfidence, isSimulating, isWordFinalized]);

  const makePredictionRef = useRef(makePrediction);
  useEffect(() => {
    makePredictionRef.current = makePrediction;
  }, [makePrediction]);

  // Handle sensor data from simulator
  const handleSensorData = useCallback((data: number[]) => {
    lastSampleTimeRef.current = Date.now();
    
    // Update real-time display
    setCurrentSample(data);

    // If recording, add sample to recording buffer
    if (isRecording) {
      setRecordedSamples(prev => {
        const newSamples = [...prev, data];
        // Auto-stop at 150 samples (3 seconds) - using ref to avoid dependency issues
        if (newSamples.length >= 150 && isRecording) {
          console.log('[App] Recording complete - 150 samples collected');
          // Will trigger useEffect to stop recording
        }
        return newSamples;
      });
      // Don't process for prediction while recording
      return;
    }
    
    // Motion detection: Check if there's significant hand movement
    // This runs ALWAYS (even when not collecting) to detect transitions
    // Works for both connected device AND simulator
    if (previousSampleRef.current && (connectedDevice !== null || isSimulating)) {
      // Check EACH finger individually - if ANY finger changes > 100, it's a transition
      const fingerChanges = data.map((value, index) => 
        Math.abs(value - (previousSampleRef.current![index] || 0))
      );
      
      const maxFingerChange = Math.max(...fingerChanges);
      const changedFingerIndex = fingerChanges.indexOf(maxFingerChange);
      const fingerNames = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];
      
      console.log(`[App] Motion check: max change = ${maxFingerChange.toFixed(0)} (${fingerNames[changedFingerIndex]}), threshold = ${perFingerMotionThreshold}`);
      
      if (maxFingerChange > perFingerMotionThreshold) {
        console.log(`[App] 🔄 Large motion detected on ${fingerNames[changedFingerIndex]} (change: ${maxFingerChange}), clearing buffer to avoid contamination`);
        console.log(`[App] Previous sample:`, previousSampleRef.current);
        console.log(`[App] Current sample:`, data);
        console.log(`[App] Buffer had ${sensorBuffer.length} samples before clearing`);
        setSensorBuffer([]);
        simulationStartTimeRef.current = Date.now();
        setMotionDetected(true);
        // Clear the motion indicator after 1 second
        setTimeout(() => setMotionDetected(false), 1000);
        
        // If we were collecting, restart collection
        if (isCollectingRef.current) {
          console.log(`[App] Restarting collection after motion detection`);
        }
      }
    }
    
    // Store current sample for next comparison
    previousSampleRef.current = data;
    
    // Start collecting if connected to device (not simulating)
    if (connectedDevice && !isSimulating && !isCollectingRef.current) {
      isCollectingRef.current = true;
      simulationStartTimeRef.current = Date.now();
      setSensorBuffer([]);
    }
    
    if (!isCollectingRef.current) {
      return;
    }

    setSensorBuffer(prev => {
      // Double-check collecting flag inside the state updater to prevent race conditions
      if (!isCollectingRef.current) {
        return prev;
      }

      const newBuffer = [...prev, data];
      const targetSamples = isContinuousMode ? 150 : 200;

      if (newBuffer.length >= targetSamples) {
        console.log(`[App] Buffer reached ${newBuffer.length} samples, triggering prediction`);
        isCollectingRef.current = false; // Immediately stop further collections
        
        // In single-letter mode, stop the simulator after collecting samples
        if (!isContinuousMode) {
          setIsSimulating(false);
        }
        
        setTimeout(() => {
          makePredictionRef.current(newBuffer);
        }, 10);

        return [];
      }
      
      return newBuffer;
    });
  }, [isContinuousMode, connectedDevice, isSimulating, sensorBuffer, isRecording]);

  const handleStopSimulation = () => {
    setIsSimulating(false);
    isCollectingRef.current = false;
  };

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

    // CSV format: label,ch0,ch1,ch2,ch3,ch4
    let csvContent = 'label,ch0,ch1,ch2,ch3,ch4\n';
    
    allData.forEach(({ letter, samples }) => {
      samples.forEach(sample => {
        csvContent += `${letter},${sample.join(',')}\n`;
      });
    });

    // Create download with letter(s) and timestamp
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `glove_data_${uniqueLetters}_${timestamp}.csv`;
    link.click();
    window.URL.revokeObjectURL(url);

    console.log(`[App] Exported ${allData.length} recordings to CSV: glove_data_${uniqueLetters}_${timestamp}.csv`);
    alert(`✅ Data exported! ${allData.reduce((acc, r) => acc + r.samples.length, 0)} samples saved to CSV`);
  };

  const getCurrentWord = useCallback(() => {
    return detectedLettersRef.current.join('');
  }, []);

  const handleClearWord = () => {
    console.log('[App] Clearing word');
    setDetectedLetters([]);
    setCurrentPrediction(null);
    setIsWordFinalized(false);
  };

  const handleDeleteLetter = () => {
    setDetectedLetters(prev => prev.slice(0, -1));
  };

  const handleResetWordFinalization = () => {
    setIsWordFinalized(false);
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

        {/* Connection Manager (for future glove support) */}
        <ConnectionManager 
          onSensorData={handleSensorData}
          onConnectionChange={(connected) => setConnectedDevice(connected ? 'serial-device' : null)}
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
            value={isContinuousMode ? 'continuous' : 'single'}
            onChange={(e) => {
              const newMode = e.target.value === 'continuous';
              setIsContinuousMode(newMode);
              if (newMode) {
                handleClearWord();
              }
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
            <option value="single">Single Letter Mode (200 samples, 4s)</option>
            <option value="continuous">Continuous Mode (150 samples, 3s per letter)</option>
          </select>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0.5rem 0 0 0' }}>
            {isContinuousMode 
              ? 'Letters automatically build into words. Stop signing for 2s to finalize.'
              : 'Predicts one letter at a time. TTS speaks the letter immediately.'}
          </p>
        </div>

        {/* Quick Demo */}
        <QuickDemo
          onSimulateLetter={simulateLetter}
          isActive={isSimulating}
          onStopSimulator={handleStopSimulation}
          quickDemoCallbackRef={quickDemoCallbackRef}
          detectedWord={detectedLetters.join('')}
          onClearWord={handleClearWord}
          onResetWordFinalization={handleResetWordFinalization}
          getCurrentWord={getCurrentWord}
        />

        {/* Data Recorder */}
        <DataRecorder
          isRecording={isRecording}
          onStartRecording={handleStartRecording}
          onStopRecording={handleStopRecording}
          recordedSamples={recordedSamples.length}
          targetSamples={150}
          isConnected={connectedDevice !== null}
        />

        {/* Simulator Control */}
        <SimulatorControl
          onSensorData={handleSensorData}
          isSimulating={isSimulating}
          setIsSimulating={setIsSimulating}
          onCurrentSampleChange={setCurrentSample}
          isContinuousMode={isContinuousMode}
          simulateLetterRef={simulateLetterRef}
          onClearBuffer={() => {
            console.log('[App] Clearing buffer for new letter');
            setSensorBuffer([]);
            isCollectingRef.current = true;
            simulationStartTimeRef.current = Date.now();
          }}
        />

        {/* 3D Hand Visualization */}
        <HandVisualization3D
          currentSample={currentSample}
          isActive={isSimulating || connectedDevice !== null}
          prediction={currentPrediction?.letter}
          confidence={currentPrediction?.confidence}
          onTestSample={(sample) => setCurrentSample(sample)}
        />

        {/* Real-Time Sensor Display */}
        <SensorDisplay 
          currentSample={currentSample}
          isActive={isSimulating || connectedDevice !== null}
          sampleCount={sensorBuffer.length}
          targetSamples={isContinuousMode ? 150 : 200}
          isCollecting={isCollectingRef.current}
          motionDetected={motionDetected}
        />

        {/* Prediction View */}
        <PredictionView
          prediction={currentPrediction}
          isLoading={isAnalyzing}
          error={predictionError}
          sampleCount={sensorBuffer.length}
          isContinuousMode={isContinuousMode}
          currentWord={detectedLetters.join('')}
          onClearWord={handleClearWord}
          onDeleteLetter={handleDeleteLetter}
        />

        {/* Debug Log */}
        <DebugLog data={debugLogData} />
      </div>

      <div className="footer">
        <p className="info-text">{t("app.footer")}</p>
        <p className="version">{t("app.version")}</p>
      </div>
    </div>
  );
}

export default App;
