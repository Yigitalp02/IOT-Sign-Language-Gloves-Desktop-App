import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext';

interface CalibratorProps {
  onCalibrationComplete: (baselines: number[], maxbends: number[]) => void;
  isConnected: boolean;
  currentSample: number[] | null;
}

type CalibrationStep = 'idle' | 'recording-straight' | 'recording-bent' | 'complete';

export default function Calibrator({ onCalibrationComplete, isConnected, currentSample }: CalibratorProps) {
  const { t } = useTranslation();
  const { theme } = useTheme();
  
  const [step, setStep] = useState<CalibrationStep>('idle');
  const [straightSamples, setStraightSamples] = useState<number[][]>([]);
  const [bentSamples, setBentSamples] = useState<number[][]>([]);
  const [progress, setProgress] = useState(0);
  const [calculatedBaselines, setCalculatedBaselines] = useState<number[]>([]);
  const [calculatedMaxbends, setCalculatedMaxbends] = useState<number[]>([]);
  
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

  // Calculate calibration values using median approach
  const calculateCalibration = useCallback(() => {
    if (straightSamples.length === 0 || bentSamples.length === 0) return;

    // For each finger (5 fingers)
    const baselines: number[] = [];
    const maxbends: number[] = [];

    for (let fingerIdx = 0; fingerIdx < 5; fingerIdx++) {
      // Extract all values for this finger
      const straightValues = straightSamples.map(sample => sample[fingerIdx]);
      const bentValues = bentSamples.map(sample => sample[fingerIdx]);

      // Calculate median for each pose
      const straightMedian = calculateMedian(straightValues);
      const bentMedian = calculateMedian(bentValues);

      // For thermistors: higher value = straight, lower value = bent
      // So baseline should be the HIGHER median, maxbend should be the LOWER median
      const baseline = Math.max(straightMedian, bentMedian);
      const maxbend = Math.min(straightMedian, bentMedian);

      // Add 5% buffer to avoid edge cases
      const range = baseline - maxbend;
      const bufferedBaseline = Math.round(baseline + range * 0.05);
      const bufferedMaxbend = Math.round(maxbend - range * 0.05);

      baselines.push(bufferedBaseline);
      maxbends.push(bufferedMaxbend);
    }

    setCalculatedBaselines(baselines);
    setCalculatedMaxbends(maxbends);
  }, [straightSamples, bentSamples]);

  const startRecordingStraight = useCallback(() => {
    setStraightSamples([]);
    setProgress(0);
    setStep('recording-straight');
  }, []);

  const startRecordingBent = useCallback(() => {
    setBentSamples([]);
    setProgress(0);
    setStep('recording-bent');
  }, []);

  const handleSensorData = useCallback((data: number[]) => {
    if (step === 'recording-straight') {
      setStraightSamples(prev => {
        const newSamples = [...prev, data];
        setProgress(Math.min(100, (newSamples.length / SAMPLES_NEEDED) * 100));
        
        if (newSamples.length >= SAMPLES_NEEDED) {
          setStep('idle');
        }
        
        return newSamples;
      });
    } else if (step === 'recording-bent') {
      setBentSamples(prev => {
        const newSamples = [...prev, data];
        setProgress(Math.min(100, (newSamples.length / SAMPLES_NEEDED) * 100));
        
        if (newSamples.length >= SAMPLES_NEEDED) {
          setStep('complete');
          // Calculate calibration after recording bent pose
          setTimeout(() => {
            // Will trigger useEffect to calculate
          }, 100);
        }
        
        return newSamples;
      });
    }
  }, [step]);

  // Calculate when bent samples are complete
  useEffect(() => {
    if (bentSamples.length >= SAMPLES_NEEDED && straightSamples.length >= SAMPLES_NEEDED) {
      calculateCalibration();
    }
  }, [bentSamples.length, straightSamples.length, calculateCalibration]);

  const applyCalibration = useCallback(() => {
    if (calculatedBaselines.length === 5 && calculatedMaxbends.length === 5) {
      onCalibrationComplete(calculatedBaselines, calculatedMaxbends);
      // Reset
      setStraightSamples([]);
      setBentSamples([]);
      setStep('idle');
      setProgress(0);
    }
  }, [calculatedBaselines, calculatedMaxbends, onCalibrationComplete]);

  const reset = useCallback(() => {
    setStraightSamples([]);
    setBentSamples([]);
    setStep('idle');
    setProgress(0);
    setCalculatedBaselines([]);
    setCalculatedMaxbends([]);
  }, []);

  // Listen to sensor data from props
  useEffect(() => {
    if (currentSample && currentSample.length === 5) {
      handleSensorData(currentSample);
    }
  }, [currentSample, handleSensorData]);

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
        marginBottom: '1rem'
      }}>
        🎯 Auto-Calibrator
      </h3>

      <p style={{
        fontSize: '0.875rem',
        color: 'var(--text-secondary)',
        marginBottom: '1rem'
      }}>
        Automatically calibrate sensor ranges by recording your hand in two poses.
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

      {/* Step 1: Record Straight */}
      <div style={{
        padding: '1rem',
        borderRadius: '8px',
        background: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.02)',
        marginBottom: '1rem',
        border: step === 'recording-straight' ? '2px solid #10b981' : '1px solid var(--border-color)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h4 style={{ margin: '0 0 0.5rem 0', color: 'var(--text-primary)', fontSize: '1rem' }}>
              Step 1: Straight Hand ✋
            </h4>
            <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
              Open all fingers completely straight
            </p>
          </div>
          <button
            onClick={startRecordingStraight}
            disabled={!isConnected || step === 'recording-straight' || step === 'recording-bent'}
            style={{
              padding: '0.75rem 1.5rem',
              borderRadius: '8px',
              border: 'none',
              background: straightSamples.length >= SAMPLES_NEEDED ? '#10b981' : '#3b82f6',
              color: 'white',
              fontSize: '0.875rem',
              fontWeight: '600',
              cursor: isConnected && step === 'idle' ? 'pointer' : 'not-allowed',
              opacity: !isConnected || step !== 'idle' ? 0.5 : 1
            }}
          >
            {straightSamples.length >= SAMPLES_NEEDED ? '✓ Recorded' : 'Record'}
          </button>
        </div>
        {step === 'recording-straight' && (
          <div style={{ marginTop: '1rem' }}>
            <div style={{
              height: '8px',
              background: 'rgba(59, 130, 246, 0.2)',
              borderRadius: '4px',
              overflow: 'hidden'
            }}>
              <div style={{
                height: '100%',
                background: '#3b82f6',
                width: `${progress}%`,
                transition: 'width 0.1s'
              }} />
            </div>
            <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              Recording... {straightSamples.length}/{SAMPLES_NEEDED} samples
            </p>
          </div>
        )}
      </div>

      {/* Step 2: Record Bent */}
      <div style={{
        padding: '1rem',
        borderRadius: '8px',
        background: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.02)',
        marginBottom: '1rem',
        border: step === 'recording-bent' ? '2px solid #10b981' : '1px solid var(--border-color)',
        opacity: straightSamples.length < SAMPLES_NEEDED ? 0.5 : 1
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h4 style={{ margin: '0 0 0.5rem 0', color: 'var(--text-primary)', fontSize: '1rem' }}>
              Step 2: Closed Fist ✊
            </h4>
            <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
              Bend all fingers into a tight fist
            </p>
          </div>
          <button
            onClick={startRecordingBent}
            disabled={!isConnected || straightSamples.length < SAMPLES_NEEDED || step === 'recording-straight' || step === 'recording-bent'}
            style={{
              padding: '0.75rem 1.5rem',
              borderRadius: '8px',
              border: 'none',
              background: bentSamples.length >= SAMPLES_NEEDED ? '#10b981' : '#3b82f6',
              color: 'white',
              fontSize: '0.875rem',
              fontWeight: '600',
              cursor: isConnected && straightSamples.length >= SAMPLES_NEEDED && step === 'idle' ? 'pointer' : 'not-allowed',
              opacity: !isConnected || straightSamples.length < SAMPLES_NEEDED || step !== 'idle' ? 0.5 : 1
            }}
          >
            {bentSamples.length >= SAMPLES_NEEDED ? '✓ Recorded' : 'Record'}
          </button>
        </div>
        {step === 'recording-bent' && (
          <div style={{ marginTop: '1rem' }}>
            <div style={{
              height: '8px',
              background: 'rgba(59, 130, 246, 0.2)',
              borderRadius: '4px',
              overflow: 'hidden'
            }}>
              <div style={{
                height: '100%',
                background: '#3b82f6',
                width: `${progress}%`,
                transition: 'width 0.1s'
              }} />
            </div>
            <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              Recording... {bentSamples.length}/{SAMPLES_NEEDED} samples
            </p>
          </div>
        )}
      </div>

      {/* Results */}
      {calculatedBaselines.length === 5 && (
        <div style={{
          padding: '1rem',
          borderRadius: '8px',
          background: 'rgba(16, 185, 129, 0.1)',
          border: '1px solid rgba(16, 185, 129, 0.3)',
          marginBottom: '1rem'
        }}>
          <h4 style={{ margin: '0 0 0.75rem 0', color: '#10b981', fontSize: '1rem' }}>
            ✓ Calibration Complete!
          </h4>
          <div style={{ fontSize: '0.75rem', fontFamily: 'monospace', color: 'var(--text-primary)' }}>
            <div><strong>BASELINES (Straight):</strong> [{calculatedBaselines.join(', ')}]</div>
            <div style={{ marginTop: '0.25rem' }}><strong>MAXBENDS (Bent):</strong> [{calculatedMaxbends.join(', ')}]</div>
          </div>
          <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
            <button
              onClick={applyCalibration}
              style={{
                flex: 1,
                padding: '0.75rem',
                borderRadius: '8px',
                border: 'none',
                background: '#10b981',
                color: 'white',
                fontSize: '0.875rem',
                fontWeight: '600',
                cursor: 'pointer'
              }}
            >
              ✓ Apply Calibration
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
              Reset
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
