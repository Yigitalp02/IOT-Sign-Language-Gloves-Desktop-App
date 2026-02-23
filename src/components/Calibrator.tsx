import { useState, useCallback, useEffect } from 'react';
// import { useTranslation } from 'react-i18next'; // Removed unused
import { useTheme } from '../context/ThemeContext';

interface CalibratorProps {
  onCalibrationComplete: (baselines: number[], maxbends: number[]) => void;
  isConnected: boolean;
  currentSample: number[] | null;
  currentBaselines: number[]; // Current baselines from App
  currentMaxbends: number[]; // Current maxbends from App
}

const FINGER_NAMES = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];
const FINGER_EMOJIS = ['👍', '☝️', '🖕', '💍', '🤙'];

type CalibrationStep = 'idle' | 'recording-straight' | 'recording-bent';

interface FingerCalibration {
  straightSamples: number[];
  bentSamples: number[];
  baseline: number | null;
  maxbend: number | null;
}

export default function Calibrator({ onCalibrationComplete, isConnected, currentSample, currentBaselines, currentMaxbends }: CalibratorProps) {
  // const { t } = useTranslation(); // Removed unused
  const { theme } = useTheme();
  
  const [currentFinger, setCurrentFinger] = useState(0); // 0-4 for thumb to pinky
  const [step, setStep] = useState<CalibrationStep>('idle');
  const [fingerCalibrations, setFingerCalibrations] = useState<FingerCalibration[]>(
    Array(5).fill(null).map(() => ({
      straightSamples: [],
      bentSamples: [],
      baseline: null,
      maxbend: null
    }))
  );
  const [progress, setProgress] = useState(0);
  
  const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  const SAMPLES_NEEDED = 100; // Collect 100 samples (2 seconds at 50Hz)

  // Calculate median of an array
  const calculateMedian = (values: number[]): number => {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  };

  const startRecordingStraight = useCallback(() => {
    setProgress(0);
    setStep('recording-straight');
  }, []);

  const startRecordingBent = useCallback(() => {
    setProgress(0);
    setStep('recording-bent');
  }, []);

  const handleSensorData = useCallback((data: number[]) => {
    if (step === 'recording-straight') {
      setFingerCalibrations(prev => {
        const updated = [...prev];
        const newSamples = [...updated[currentFinger].straightSamples, data[currentFinger]];
        updated[currentFinger] = {
          ...updated[currentFinger],
          straightSamples: newSamples
        };
        
        const progressValue = Math.min(100, (newSamples.length / SAMPLES_NEEDED) * 100);
        setProgress(progressValue);
        
        if (newSamples.length >= SAMPLES_NEEDED) {
          setStep('idle');
        }
        
        return updated;
      });
    } else if (step === 'recording-bent') {
      setFingerCalibrations(prev => {
        const updated = [...prev];
        const newSamples = [...updated[currentFinger].bentSamples, data[currentFinger]];
        updated[currentFinger] = {
          ...updated[currentFinger],
          bentSamples: newSamples
        };
        
        const progressValue = Math.min(100, (newSamples.length / SAMPLES_NEEDED) * 100);
        setProgress(progressValue);
        
        if (newSamples.length >= SAMPLES_NEEDED) {
          // Calculate calibration for this finger
          const straightMedian = calculateMedian(updated[currentFinger].straightSamples);
          const bentMedian = calculateMedian(updated[currentFinger].bentSamples);
          
          // For thermistors: higher value = straight, lower value = bent
          const baseline = Math.max(straightMedian, bentMedian);
          const maxbend = Math.min(straightMedian, bentMedian);
          
          // Add 5% buffer to avoid edge cases
          const range = baseline - maxbend;
          const bufferedBaseline = Math.round(baseline + range * 0.05);
          const bufferedMaxbend = Math.round(maxbend - range * 0.05);
          
          updated[currentFinger] = {
            ...updated[currentFinger],
            baseline: bufferedBaseline,
            maxbend: bufferedMaxbend
          };
          
          setStep('idle');
          
          // If not the last finger, move to next
          if (currentFinger < 4) {
            setTimeout(() => {
              setCurrentFinger(currentFinger + 1);
            }, 500);
          }
        }
        
        return updated;
      });
    }
  }, [step, currentFinger]);

  // Listen to sensor data from props
  useEffect(() => {
    if (currentSample && currentSample.length === 5) {
      handleSensorData(currentSample);
    }
  }, [currentSample, handleSensorData]);

  const applyCalibration = useCallback(() => {
    // Mix calibrated fingers with current defaults for uncalibrated fingers
    const baselines = fingerCalibrations.map((fc, index) => 
      fc.baseline !== null ? fc.baseline : currentBaselines[index]
    );
    const maxbends = fingerCalibrations.map((fc, index) => 
      fc.maxbend !== null ? fc.maxbend : currentMaxbends[index]
    );
    onCalibrationComplete(baselines, maxbends);
  }, [fingerCalibrations, currentBaselines, currentMaxbends, onCalibrationComplete]);

  const reset = useCallback(() => {
    setFingerCalibrations(
      Array(5).fill(null).map(() => ({
        straightSamples: [],
        bentSamples: [],
        baseline: null,
        maxbend: null
      }))
    );
    setCurrentFinger(0);
    setStep('idle');
    setProgress(0);
  }, []);

  // Reset individual finger for recalibration
  const resetFinger = useCallback((index: number) => {
    setFingerCalibrations(prev => {
      const updated = [...prev];
      updated[index] = {
        straightSamples: [],
        bentSamples: [],
        baseline: null,
        maxbend: null
      };
      return updated;
    });
    setCurrentFinger(index);
    setStep('idle');
    setProgress(0);
  }, []);

  const skipToFinger = useCallback((index: number) => {
    if (step === 'idle') {
      setCurrentFinger(index);
    }
  }, [step]);

  const allCalibrated = fingerCalibrations.every(fc => fc.baseline !== null && fc.maxbend !== null);
  const anyCalibratedFingers = fingerCalibrations.some(fc => fc.baseline !== null && fc.maxbend !== null);
  const calibratedCount = fingerCalibrations.filter(fc => fc.baseline !== null && fc.maxbend !== null).length;
  const currentFingerData = fingerCalibrations[currentFinger];
  const hasStraightData = currentFingerData.straightSamples.length >= SAMPLES_NEEDED;
  const hasBentData = currentFingerData.bentSamples.length >= SAMPLES_NEEDED;

  return (
    <div style={{
      padding: '1.5rem',
      borderRadius: '12px',
      border: '1px solid var(--border-color)',
      background: 'var(--bg-card)',
      marginBottom: '1rem'
    }}>
      <h3 style={{
        fontSize: '1.25rem',
        fontWeight: '700',
        color: 'var(--text-primary)',
        marginBottom: '0.5rem'
      }}>
        🎯 Per-Finger Calibrator
      </h3>

      <p style={{
        fontSize: '0.875rem',
        color: 'var(--text-secondary)',
        marginBottom: '1rem'
      }}>
        Calibrate each finger individually for maximum accuracy.
      </p>

      {!isConnected && (
        <div style={{
          padding: '1rem',
          borderRadius: '8px',
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          marginBottom: '1rem'
        }}>
          <p style={{ color: '#ef4444', margin: 0, fontSize: '0.875rem' }}>
            ⚠️ Please connect to your glove first
          </p>
        </div>
      )}

      {/* Finger Navigation */}
      <div style={{
        display: 'flex',
        gap: '0.5rem',
        marginBottom: '1.5rem',
        overflowX: 'auto'
      }}>
        {FINGER_NAMES.map((name, index) => {
          const fc = fingerCalibrations[index];
          const isCalibrated = fc.baseline !== null && fc.maxbend !== null;
          const isCurrent = currentFinger === index;
          
          return (
            <button
              key={index}
              onClick={() => skipToFinger(index)}
              disabled={!isConnected || step !== 'idle'}
              style={{
                flex: 1,
                minWidth: '80px',
                padding: '0.75rem 0.5rem',
                borderRadius: '8px',
                border: isCurrent ? '2px solid #3b82f6' : '1px solid var(--border-color)',
                background: isCalibrated 
                  ? 'rgba(16, 185, 129, 0.1)' 
                  : isCurrent 
                    ? 'rgba(59, 130, 246, 0.1)'
                    : 'var(--input-bg)',
                color: isCalibrated ? '#10b981' : 'var(--text-primary)',
                fontSize: '0.75rem',
                fontWeight: '600',
                cursor: isConnected && step === 'idle' ? 'pointer' : 'not-allowed',
                opacity: !isConnected || step !== 'idle' ? 0.6 : 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '0.25rem'
              }}
            >
              <span style={{ fontSize: '1.25rem' }}>{FINGER_EMOJIS[index]}</span>
              <span>{name}</span>
              {isCalibrated && <span style={{ fontSize: '0.875rem' }}>✓</span>}
            </button>
          );
        })}
      </div>

      {/* Current Finger Calibration */}
      <div style={{
        padding: '1.5rem',
        borderRadius: '8px',
        background: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.02)',
        border: '2px solid #3b82f6',
        marginBottom: '1rem'
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '1rem'
        }}>
          <h4 style={{
            margin: 0,
            color: 'var(--text-primary)',
            fontSize: '1.125rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}>
            <span style={{ fontSize: '1.5rem' }}>{FINGER_EMOJIS[currentFinger]}</span>
            Calibrating: {FINGER_NAMES[currentFinger]}
          </h4>
          
          {/* Recalibrate button - show if finger is already calibrated */}
          {currentFingerData.baseline !== null && (
            <button
              onClick={() => resetFinger(currentFinger)}
              disabled={step !== 'idle'}
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '6px',
                border: '1px solid #ef4444',
                background: 'rgba(239, 68, 68, 0.1)',
                color: '#ef4444',
                fontSize: '0.75rem',
                fontWeight: '600',
                cursor: step === 'idle' ? 'pointer' : 'not-allowed',
                opacity: step === 'idle' ? 1 : 0.5
              }}
            >
              🔄 Recalibrate
            </button>
          )}
        </div>

        {/* Step 1: Straight */}
        <div style={{
          padding: '1rem',
          borderRadius: '8px',
          background: 'var(--bg-card)',
          marginBottom: '1rem',
          border: step === 'recording-straight' ? '2px solid #10b981' : '1px solid var(--border-color)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <div>
              <h5 style={{ margin: '0 0 0.25rem 0', color: 'var(--text-primary)', fontSize: '0.875rem' }}>
                Step 1: Straighten {FINGER_NAMES[currentFinger]}
              </h5>
              <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                Keep this finger fully straight
              </p>
            </div>
            <button
              onClick={startRecordingStraight}
              disabled={!isConnected || step !== 'idle' || hasStraightData}
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '6px',
                border: 'none',
                background: hasStraightData ? '#10b981' : '#3b82f6',
                color: 'white',
                fontSize: '0.75rem',
                fontWeight: '600',
                cursor: isConnected && step === 'idle' && !hasStraightData ? 'pointer' : 'not-allowed',
                opacity: !isConnected || step !== 'idle' || hasStraightData ? 0.6 : 1
              }}
            >
              {hasStraightData ? '✓ Done' : 'Record'}
            </button>
          </div>
          {step === 'recording-straight' && (
            <div style={{ marginTop: '0.5rem' }}>
              <div style={{
                height: '6px',
                background: 'rgba(59, 130, 246, 0.2)',
                borderRadius: '3px',
                overflow: 'hidden'
              }}>
                <div style={{
                  height: '100%',
                  background: '#3b82f6',
                  width: `${progress}%`,
                  transition: 'width 0.1s'
                }} />
              </div>
              <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.625rem', color: 'var(--text-secondary)' }}>
                {currentFingerData.straightSamples.length}/{SAMPLES_NEEDED} samples
              </p>
            </div>
          )}
        </div>

        {/* Step 2: Bent */}
        <div style={{
          padding: '1rem',
          borderRadius: '8px',
          background: 'var(--bg-card)',
          border: step === 'recording-bent' ? '2px solid #10b981' : '1px solid var(--border-color)',
          opacity: hasStraightData ? 1 : 0.5
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <div>
              <h5 style={{ margin: '0 0 0.25rem 0', color: 'var(--text-primary)', fontSize: '0.875rem' }}>
                Step 2: Bend {FINGER_NAMES[currentFinger]}
              </h5>
              <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                Curl this finger fully bent
              </p>
            </div>
            <button
              onClick={startRecordingBent}
              disabled={!isConnected || !hasStraightData || step !== 'idle' || hasBentData}
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '6px',
                border: 'none',
                background: hasBentData ? '#10b981' : '#3b82f6',
                color: 'white',
                fontSize: '0.75rem',
                fontWeight: '600',
                cursor: isConnected && hasStraightData && step === 'idle' && !hasBentData ? 'pointer' : 'not-allowed',
                opacity: !isConnected || !hasStraightData || step !== 'idle' || hasBentData ? 0.6 : 1
              }}
            >
              {hasBentData ? '✓ Done' : 'Record'}
            </button>
          </div>
          {step === 'recording-bent' && (
            <div style={{ marginTop: '0.5rem' }}>
              <div style={{
                height: '6px',
                background: 'rgba(59, 130, 246, 0.2)',
                borderRadius: '3px',
                overflow: 'hidden'
              }}>
                <div style={{
                  height: '100%',
                  background: '#3b82f6',
                  width: `${progress}%`,
                  transition: 'width 0.1s'
                }} />
              </div>
              <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.625rem', color: 'var(--text-secondary)' }}>
                {currentFingerData.bentSamples.length}/{SAMPLES_NEEDED} samples
              </p>
            </div>
          )}
        </div>

        {/* Finger calibration result */}
        {currentFingerData.baseline !== null && (
          <div style={{
            marginTop: '1rem',
            padding: '0.75rem',
            borderRadius: '6px',
            background: 'rgba(16, 185, 129, 0.1)',
            border: '1px solid rgba(16, 185, 129, 0.3)'
          }}>
            <p style={{ margin: 0, fontSize: '0.75rem', color: '#10b981', fontWeight: '600' }}>
              ✓ {FINGER_NAMES[currentFinger]} calibrated!
            </p>
            <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.625rem', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
              Straight: {currentFingerData.baseline} | Bent: {currentFingerData.maxbend}
            </p>
          </div>
        )}
      </div>

      {/* Apply Calibration - Show if ANY finger is calibrated */}
      {anyCalibratedFingers && (
        <div style={{
          padding: '1rem',
          borderRadius: '8px',
          background: allCalibrated ? 'rgba(16, 185, 129, 0.1)' : 'rgba(59, 130, 246, 0.1)',
          border: allCalibrated ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(59, 130, 246, 0.3)',
          marginBottom: '1rem'
        }}>
          <h4 style={{ margin: '0 0 0.5rem 0', color: allCalibrated ? '#10b981' : '#3b82f6', fontSize: '1rem' }}>
            {allCalibrated ? '✓ All Fingers Calibrated!' : `${calibratedCount}/5 Fingers Calibrated`}
          </h4>
          
          {!allCalibrated && (
            <p style={{ margin: '0 0 0.75rem 0', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              You can apply now. Uncalibrated fingers will use current defaults.
            </p>
          )}
          
          <div style={{ fontSize: '0.675rem', fontFamily: 'monospace', color: 'var(--text-primary)', marginBottom: '1rem' }}>
            {FINGER_NAMES.map((name, index) => {
              const fc = fingerCalibrations[index];
              const isCalibrated = fc.baseline !== null && fc.maxbend !== null;
              return (
                <div key={index} style={{ 
                  marginBottom: '0.25rem',
                  color: isCalibrated ? 'var(--text-primary)' : 'var(--text-secondary)',
                  opacity: isCalibrated ? 1 : 0.6
                }}>
                  <strong>{FINGER_EMOJIS[index]} {name}:</strong> {
                    isCalibrated 
                      ? `${fc.baseline} → ${fc.maxbend} ✓` 
                      : `${currentBaselines[index]} → ${currentMaxbends[index]} (default)`
                  }
                </div>
              );
            })}
          </div>
          
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              onClick={applyCalibration}
              style={{
                flex: 1,
                padding: '0.75rem',
                borderRadius: '8px',
                border: 'none',
                background: allCalibrated ? '#10b981' : '#3b82f6',
                color: 'white',
                fontSize: '0.875rem',
                fontWeight: '600',
                cursor: 'pointer'
              }}
            >
              {allCalibrated ? '✓ Apply All' : `Apply ${calibratedCount} Finger${calibratedCount > 1 ? 's' : ''}`}
            </button>
            <button
              onClick={reset}
              style={{
                padding: '0.75rem 1.5rem',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                background: 'var(--input-bg)',
                color: 'var(--text-primary)',
                fontSize: '0.875rem',
                fontWeight: '600',
                cursor: 'pointer'
              }}
            >
              Reset All
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
