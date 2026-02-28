import { useState, useCallback, useEffect } from 'react';
import { useTheme } from '../context/ThemeContext';

interface CalibratorProps {
  onCalibrationComplete: (baselines: number[], maxbends: number[]) => void;
  isConnected: boolean;
  currentSample: number[] | null;
  currentBaselines: number[];
  currentMaxbends: number[];
}

const FINGER_NAMES = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];

type CalibrationStep = 'idle' | 'recording-straight' | 'recording-bent';
type CalibrationMode = 'per-finger' | 'full-hand';

interface FingerCalibration {
  straightSamples: number[];
  bentSamples: number[];
  baseline: number | null;
  maxbend: number | null;
}

const SAMPLES_NEEDED = 100;

const emptyCalibrations = (): FingerCalibration[] =>
  Array(5).fill(null).map(() => ({
    straightSamples: [],
    bentSamples: [],
    baseline: null,
    maxbend: null,
  }));

export default function Calibrator({ onCalibrationComplete, isConnected, currentSample, currentBaselines, currentMaxbends }: CalibratorProps) {
  const { theme } = useTheme();
  const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  const [mode, setMode] = useState<CalibrationMode>('per-finger');
  const [currentFinger, setCurrentFinger] = useState(0);
  const [step, setStep] = useState<CalibrationStep>('idle');
  const [fingerCalibrations, setFingerCalibrations] = useState<FingerCalibration[]>(emptyCalibrations());
  const [progress, setProgress] = useState(0);

  // ── Median helper ────────────────────────────────────────────────────────────
  const calculateMedian = (values: number[]): number => {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  };

  // ── Calculate calibration result for one finger ───────────────────────────
  const calcFingerCalib = (fc: FingerCalibration): Pick<FingerCalibration, 'baseline' | 'maxbend'> => {
    const straightMedian = calculateMedian(fc.straightSamples);
    const bentMedian = calculateMedian(fc.bentSamples);
    const baseline = Math.max(straightMedian, bentMedian);
    const maxbend = Math.min(straightMedian, bentMedian);
    const range = baseline - maxbend;
    return {
      baseline: Math.round(baseline + range * 0.05),
      maxbend: Math.round(maxbend - range * 0.05),
    };
  };

  // ── Sensor data handler ───────────────────────────────────────────────────
  const handleSensorData = useCallback((data: number[]) => {
    if (step === 'idle') return;

    if (mode === 'full-hand') {
      // ── Full-Hand mode: all 5 fingers at once ─────────────────────────────
      setFingerCalibrations(prev => {
        const updated = prev.map((fc, i) => {
          const samples = step === 'recording-straight'
            ? [...fc.straightSamples, data[i]]
            : [...fc.bentSamples, data[i]];
          return step === 'recording-straight'
            ? { ...fc, straightSamples: samples }
            : { ...fc, bentSamples: samples };
        });

        const sampleCount = step === 'recording-straight'
          ? updated[0].straightSamples.length
          : updated[0].bentSamples.length;

        setProgress(Math.min(100, (sampleCount / SAMPLES_NEEDED) * 100));

        if (sampleCount >= SAMPLES_NEEDED) {
          setStep('idle');

          // If bent recording just finished, compute calibration for all fingers
          if (step === 'recording-bent') {
            return updated.map(fc => ({
              ...fc,
              ...calcFingerCalib(fc),
            }));
          }
        }

        return updated;
      });

    } else {
      // ── Per-Finger mode ───────────────────────────────────────────────────
      setFingerCalibrations(prev => {
        const updated = [...prev];
        const fc = updated[currentFinger];

        if (step === 'recording-straight') {
          const newSamples = [...fc.straightSamples, data[currentFinger]];
          updated[currentFinger] = { ...fc, straightSamples: newSamples };
          setProgress(Math.min(100, (newSamples.length / SAMPLES_NEEDED) * 100));
          if (newSamples.length >= SAMPLES_NEEDED) setStep('idle');

        } else {
          const newSamples = [...fc.bentSamples, data[currentFinger]];
          updated[currentFinger] = { ...fc, bentSamples: newSamples };
          setProgress(Math.min(100, (newSamples.length / SAMPLES_NEEDED) * 100));

          if (newSamples.length >= SAMPLES_NEEDED) {
            const result = calcFingerCalib({ ...updated[currentFinger], bentSamples: newSamples });
            updated[currentFinger] = { ...updated[currentFinger], bentSamples: newSamples, ...result };
            setStep('idle');
            if (currentFinger < 4) setTimeout(() => setCurrentFinger(currentFinger + 1), 500);
          }
        }

        return updated;
      });
    }
  }, [step, mode, currentFinger]);

  useEffect(() => {
    if (currentSample && currentSample.length === 5) handleSensorData(currentSample);
  }, [currentSample, handleSensorData]);

  // ── Actions ───────────────────────────────────────────────────────────────
  const startRecordingStraight = useCallback(() => { setProgress(0); setStep('recording-straight'); }, []);
  const startRecordingBent     = useCallback(() => { setProgress(0); setStep('recording-bent');     }, []);

  const applyCalibration = useCallback(() => {
    const baselines = fingerCalibrations.map((fc, i) => fc.baseline ?? currentBaselines[i]);
    const maxbends  = fingerCalibrations.map((fc, i) => fc.maxbend  ?? currentMaxbends[i]);
    onCalibrationComplete(baselines, maxbends);
  }, [fingerCalibrations, currentBaselines, currentMaxbends, onCalibrationComplete]);

  const reset = useCallback(() => {
    setFingerCalibrations(emptyCalibrations());
    setCurrentFinger(0);
    setStep('idle');
    setProgress(0);
  }, []);

  const resetFinger = useCallback((index: number) => {
    setFingerCalibrations(prev => {
      const updated = [...prev];
      updated[index] = { straightSamples: [], bentSamples: [], baseline: null, maxbend: null };
      return updated;
    });
    setCurrentFinger(index);
    setStep('idle');
    setProgress(0);
  }, []);

  const switchMode = (newMode: CalibrationMode) => {
    if (step !== 'idle') return;
    setMode(newMode);
    reset();
  };

  // ── Derived state ─────────────────────────────────────────────────────────
  const allCalibrated        = fingerCalibrations.every(fc => fc.baseline !== null);
  const anyCalibratedFingers = fingerCalibrations.some(fc => fc.baseline !== null);
  const calibratedCount      = fingerCalibrations.filter(fc => fc.baseline !== null).length;
  const currentFingerData    = fingerCalibrations[currentFinger];

  // Full-hand uses finger[0] as the representative sample count
  const hasStraightData = mode === 'full-hand'
    ? fingerCalibrations[0].straightSamples.length >= SAMPLES_NEEDED
    : currentFingerData.straightSamples.length >= SAMPLES_NEEDED;
  const hasBentData = mode === 'full-hand'
    ? fingerCalibrations[0].bentSamples.length >= SAMPLES_NEEDED
    : currentFingerData.bentSamples.length >= SAMPLES_NEEDED;

  const progressSampleCount = mode === 'full-hand'
    ? (step === 'recording-straight' ? fingerCalibrations[0].straightSamples.length : fingerCalibrations[0].bentSamples.length)
    : (step === 'recording-straight' ? currentFingerData.straightSamples.length : currentFingerData.bentSamples.length);

  // ── Shared sub-components ─────────────────────────────────────────────────
  const ProgressBar = () => (
    <div style={{ marginTop: '0.5rem' }}>
      <div style={{ height: '6px', background: 'rgba(59,130,246,0.2)', borderRadius: '3px', overflow: 'hidden' }}>
        <div style={{ height: '100%', background: '#3b82f6', width: `${progress}%`, transition: 'width 0.1s' }} />
      </div>
      <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.625rem', color: 'var(--text-secondary)' }}>
        {progressSampleCount}/{SAMPLES_NEEDED} samples
      </p>
    </div>
  );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border-color)', background: 'var(--bg-card)', marginBottom: '1rem' }}>

      {/* Header + Mode Toggle */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
        <div>
          <h3 style={{ fontSize: '1.25rem', fontWeight: '700', color: 'var(--text-primary)', margin: '0 0 0.25rem 0' }}>
            Sensor Calibrator
          </h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0 }}>
            {mode === 'per-finger' ? 'Calibrate each finger individually' : 'Calibrate all fingers at once (full hand)'}
          </p>
        </div>

        {/* Mode Toggle Pill */}
        <div style={{
          display: 'flex',
          background: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)',
          borderRadius: '8px',
          padding: '3px',
          gap: '2px',
          flexShrink: 0
        }}>
          {(['per-finger', 'full-hand'] as CalibrationMode[]).map(m => (
            <button
              key={m}
              onClick={() => switchMode(m)}
              disabled={step !== 'idle'}
              style={{
                padding: '0.35rem 0.75rem',
                borderRadius: '6px',
                border: 'none',
                background: mode === m ? (isDark ? '#3b82f6' : '#3b82f6') : 'transparent',
                color: mode === m ? 'white' : 'var(--text-secondary)',
                fontSize: '0.7rem',
                fontWeight: '600',
                cursor: step === 'idle' ? 'pointer' : 'not-allowed',
                opacity: step !== 'idle' && mode !== m ? 0.4 : 1,
                transition: 'all 0.15s',
                whiteSpace: 'nowrap'
              }}
            >
              {m === 'per-finger' ? '☝️ Per-Finger' : '✋ Full Hand'}
            </button>
          ))}
        </div>
      </div>

      {!isConnected && (
        <div style={{ padding: '1rem', borderRadius: '8px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', marginBottom: '1rem' }}>
          <p style={{ color: '#ef4444', margin: 0, fontSize: '0.875rem' }}>Please connect to your glove first</p>
        </div>
      )}

      {/* ── Per-Finger mode: Finger navigation tabs ── */}
      {mode === 'per-finger' && (
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', overflowX: 'auto' }}>
          {FINGER_NAMES.map((name, index) => {
            const fc = fingerCalibrations[index];
            const isCalibrated = fc.baseline !== null;
            const isCurrent = currentFinger === index;
            return (
              <button
                key={index}
                onClick={() => step === 'idle' && setCurrentFinger(index)}
                disabled={!isConnected || step !== 'idle'}
                style={{
                  flex: 1, minWidth: '80px', padding: '0.75rem 0.5rem', borderRadius: '8px',
                  border: isCurrent ? '2px solid #3b82f6' : '1px solid var(--border-color)',
                  background: isCalibrated ? 'rgba(16,185,129,0.1)' : isCurrent ? 'rgba(59,130,246,0.1)' : 'var(--input-bg)',
                  color: isCalibrated ? '#10b981' : 'var(--text-primary)',
                  fontSize: '0.75rem', fontWeight: '600',
                  cursor: isConnected && step === 'idle' ? 'pointer' : 'not-allowed',
                  opacity: !isConnected || step !== 'idle' ? 0.6 : 1,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem'
                }}
              >
                <span>{name}</span>
                {isCalibrated && <span style={{ fontSize: '0.875rem' }}>✓</span>}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Calibration Steps Box ── */}
      <div style={{
        padding: '1.5rem', borderRadius: '8px',
        background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.02)',
        border: '2px solid #3b82f6', marginBottom: '1rem'
      }}>
        {/* Box header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h4 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '1.1rem' }}>
            {mode === 'full-hand' ? 'Calibrating: All Fingers' : `Calibrating: ${FINGER_NAMES[currentFinger]}`}
          </h4>
          {/* Recalibrate button for per-finger */}
          {mode === 'per-finger' && currentFingerData.baseline !== null && (
            <button onClick={() => resetFinger(currentFinger)} disabled={step !== 'idle'} style={{
              padding: '0.5rem 1rem', borderRadius: '6px', border: '1px solid #ef4444',
              background: 'rgba(239,68,68,0.1)', color: '#ef4444', fontSize: '0.75rem', fontWeight: '600',
              cursor: step === 'idle' ? 'pointer' : 'not-allowed', opacity: step === 'idle' ? 1 : 0.5
            }}>Recalibrate</button>
          )}
          {/* Reset all button for full-hand */}
          {mode === 'full-hand' && allCalibrated && (
            <button onClick={reset} disabled={step !== 'idle'} style={{
              padding: '0.5rem 1rem', borderRadius: '6px', border: '1px solid #ef4444',
              background: 'rgba(239,68,68,0.1)', color: '#ef4444', fontSize: '0.75rem', fontWeight: '600',
              cursor: step === 'idle' ? 'pointer' : 'not-allowed'
            }}>Redo</button>
          )}
        </div>

        {/* Step 1: Straight */}
        <div style={{
          padding: '1rem', borderRadius: '8px', background: 'var(--bg-card)', marginBottom: '1rem',
          border: step === 'recording-straight' ? '2px solid #10b981' : '1px solid var(--border-color)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <div>
              <h5 style={{ margin: '0 0 0.25rem 0', color: 'var(--text-primary)', fontSize: '0.875rem' }}>
                Step 1: Straighten {mode === 'full-hand' ? 'All Fingers' : FINGER_NAMES[currentFinger]}
              </h5>
              <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                {mode === 'full-hand' ? 'Hold your hand flat, all fingers fully extended' : `Keep ${FINGER_NAMES[currentFinger]} fully straight`}
              </p>
            </div>
            <button
              onClick={startRecordingStraight}
              disabled={!isConnected || step !== 'idle' || hasStraightData}
              style={{
                padding: '0.5rem 1rem', borderRadius: '6px', border: 'none',
                background: hasStraightData ? '#10b981' : '#3b82f6', color: 'white',
                fontSize: '0.75rem', fontWeight: '600',
                cursor: isConnected && step === 'idle' && !hasStraightData ? 'pointer' : 'not-allowed',
                opacity: !isConnected || step !== 'idle' || hasStraightData ? 0.6 : 1
              }}
            >
              {hasStraightData ? '✓ Done' : 'Record'}
            </button>
          </div>
          {step === 'recording-straight' && <ProgressBar />}
        </div>

        {/* Step 2: Bent */}
        <div style={{
          padding: '1rem', borderRadius: '8px', background: 'var(--bg-card)',
          border: step === 'recording-bent' ? '2px solid #10b981' : '1px solid var(--border-color)',
          opacity: hasStraightData ? 1 : 0.5
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <div>
              <h5 style={{ margin: '0 0 0.25rem 0', color: 'var(--text-primary)', fontSize: '0.875rem' }}>
                Step 2: Bend {mode === 'full-hand' ? 'All Fingers' : FINGER_NAMES[currentFinger]}
              </h5>
              <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                {mode === 'full-hand' ? 'Make a fist, all fingers fully curled' : `Curl ${FINGER_NAMES[currentFinger]} fully bent`}
              </p>
            </div>
            <button
              onClick={startRecordingBent}
              disabled={!isConnected || !hasStraightData || step !== 'idle' || hasBentData}
              style={{
                padding: '0.5rem 1rem', borderRadius: '6px', border: 'none',
                background: hasBentData ? '#10b981' : '#3b82f6', color: 'white',
                fontSize: '0.75rem', fontWeight: '600',
                cursor: isConnected && hasStraightData && step === 'idle' && !hasBentData ? 'pointer' : 'not-allowed',
                opacity: !isConnected || !hasStraightData || step !== 'idle' || hasBentData ? 0.6 : 1
              }}
            >
              {hasBentData ? '✓ Done' : 'Record'}
            </button>
          </div>
          {step === 'recording-bent' && <ProgressBar />}
        </div>

        {/* Result preview — full-hand shows all 5 */}
        {mode === 'full-hand' && allCalibrated && (
          <div style={{ marginTop: '1rem', padding: '0.75rem', borderRadius: '6px', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)' }}>
            <p style={{ margin: '0 0 0.4rem 0', fontSize: '0.75rem', color: '#10b981', fontWeight: '600' }}>All fingers calibrated ✓</p>
            {fingerCalibrations.map((fc, i) => (
              <div key={i} style={{ fontSize: '0.65rem', fontFamily: 'monospace', color: 'var(--text-secondary)', marginBottom: '0.15rem' }}>
                <strong style={{ color: 'var(--text-primary)' }}>{FINGER_NAMES[i]}:</strong> {fc.baseline} → {fc.maxbend}
              </div>
            ))}
          </div>
        )}

        {/* Per-finger: single finger result */}
        {mode === 'per-finger' && currentFingerData.baseline !== null && (
          <div style={{ marginTop: '1rem', padding: '0.75rem', borderRadius: '6px', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)' }}>
            <p style={{ margin: 0, fontSize: '0.75rem', color: '#10b981', fontWeight: '600' }}>{FINGER_NAMES[currentFinger]} calibrated ✓</p>
            <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.625rem', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
              Straight: {currentFingerData.baseline} | Bent: {currentFingerData.maxbend}
            </p>
          </div>
        )}
      </div>

      {/* Apply section */}
      {anyCalibratedFingers && (
        <div style={{
          padding: '1rem', borderRadius: '8px', marginBottom: '1rem',
          background: allCalibrated ? 'rgba(16,185,129,0.1)' : 'rgba(59,130,246,0.1)',
          border: allCalibrated ? '1px solid rgba(16,185,129,0.3)' : '1px solid rgba(59,130,246,0.3)'
        }}>
          <h4 style={{ margin: '0 0 0.5rem 0', color: allCalibrated ? '#10b981' : '#3b82f6', fontSize: '1rem' }}>
            {allCalibrated ? 'All Fingers Calibrated' : `${calibratedCount}/5 Fingers Calibrated`}
          </h4>

          {!allCalibrated && (
            <p style={{ margin: '0 0 0.75rem 0', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              You can apply now — uncalibrated fingers will use current defaults.
            </p>
          )}

          <div style={{ fontSize: '0.675rem', fontFamily: 'monospace', color: 'var(--text-primary)', marginBottom: '1rem' }}>
            {FINGER_NAMES.map((name, index) => {
              const fc = fingerCalibrations[index];
              const isCalibrated = fc.baseline !== null;
              return (
                <div key={index} style={{ marginBottom: '0.25rem', color: isCalibrated ? 'var(--text-primary)' : 'var(--text-secondary)', opacity: isCalibrated ? 1 : 0.6 }}>
                  <strong>{name}:</strong> {isCalibrated ? `${fc.baseline} → ${fc.maxbend}` : `${currentBaselines[index]} → ${currentMaxbends[index]} (default)`}
                </div>
              );
            })}
          </div>

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={applyCalibration} style={{
              flex: 1, padding: '0.75rem', borderRadius: '8px', border: 'none',
              background: allCalibrated ? '#10b981' : '#3b82f6', color: 'white',
              fontSize: '0.875rem', fontWeight: '600', cursor: 'pointer'
            }}>
              {allCalibrated ? 'Apply All' : `Apply ${calibratedCount} Finger${calibratedCount > 1 ? 's' : ''}`}
            </button>
            <button onClick={reset} style={{
              padding: '0.75rem 1.5rem', borderRadius: '8px', border: '1px solid var(--border-color)',
              background: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: '0.875rem', fontWeight: '600', cursor: 'pointer'
            }}>Reset All</button>
          </div>
        </div>
      )}
    </div>
  );
}
