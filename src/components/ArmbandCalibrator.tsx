import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext';
import { ArmImuData } from './ConnectionManager';

export interface ArmQuat { w: number; x: number; y: number; z: number; }
export interface ArmPose  { q1: ArmQuat; q2: ArmQuat; }

export interface ArmbandCalibration {
  neutral: ArmPose | null;  // Step 1 — arm hanging down
  forward: ArmPose | null;  // Step 2 — arm pointing straight forward
  tpose:   ArmPose | null;  // Step 3 — arm horizontal to the side (T-pose)
}

const EMPTY_CAL: ArmbandCalibration = { neutral: null, forward: null, tpose: null };

const STORAGE_KEY = 'armband_calibration';

function loadSaved(): ArmbandCalibration {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as ArmbandCalibration;
  } catch {}
  return EMPTY_CAL;
}

interface ArmbandCalibratorProps {
  currentArmImu: ArmImuData | null;
  onCalibrationComplete: (cal: ArmbandCalibration) => void;
}

const STEPS = ['neutral', 'forward', 'tpose'] as const;
type StepKey = typeof STEPS[number];

export default function ArmbandCalibrator({ currentArmImu, onCalibrationComplete }: ArmbandCalibratorProps) {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  const [cal, setCal] = useState<ArmbandCalibration>(loadSaved);
  const [activeStep, setActiveStep] = useState<StepKey | null>(null);
  const [justCaptured, setJustCaptured] = useState<StepKey | null>(null);

  const isArmbandConnected = currentArmImu !== null && (
    currentArmImu.q1.w !== 1.0 || currentArmImu.q1.x !== 0.0 ||
    currentArmImu.q1.y !== 0.0 || currentArmImu.q1.z !== 0.0 ||
    currentArmImu.q2.w !== 1.0 || currentArmImu.q2.x !== 0.0 ||
    currentArmImu.q2.y !== 0.0 || currentArmImu.q2.z !== 0.0
  );

  const capture = useCallback((step: StepKey) => {
    if (!currentArmImu) return;
    const pose: ArmPose = {
      q1: { ...currentArmImu.q1 },
      q2: { ...currentArmImu.q2 },
    };
    setCal(prev => {
      const updated = { ...prev, [step]: pose };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(updated)); } catch {}
      return updated;
    });
    setActiveStep(null);
    setJustCaptured(step);
    setTimeout(() => setJustCaptured(null), 2000);
  }, [currentArmImu]);

  const applyCalibration = useCallback(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cal)); } catch {}
    onCalibrationComplete(cal);
  }, [cal, onCalibrationComplete]);

  const resetAll = useCallback(() => {
    setCal(EMPTY_CAL);
    setActiveStep(null);
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
  }, []);

  const allCaptured = STEPS.every(s => cal[s] !== null);
  const anyCaptured = STEPS.some(s => cal[s] !== null);

  const stepMeta: Record<StepKey, { icon: string; titleKey: string; descKey: string; color: string }> = {
    neutral: { icon: '⬇️', titleKey: 'armband_cal.step1_title', descKey: 'armband_cal.step1_desc', color: '#6366f1' },
    forward: { icon: '➡️', titleKey: 'armband_cal.step2_title', descKey: 'armband_cal.step2_desc', color: '#3b82f6' },
    tpose:   { icon: '↔️', titleKey: 'armband_cal.step3_title', descKey: 'armband_cal.step3_desc', color: '#10b981' },
  };

  const fmtQ = (q: ArmQuat) =>
    `w:${q.w.toFixed(3)} x:${q.x.toFixed(3)} y:${q.y.toFixed(3)} z:${q.z.toFixed(3)}`;

  return (
    <div style={{
      padding: '1.5rem', borderRadius: '12px',
      border: '1px solid var(--border-color)',
      background: 'var(--bg-card)', marginBottom: '1rem'
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
        <div>
          <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 0.25rem 0' }}>
            {t('armband_cal.title')}
          </h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0 }}>
            {t('armband_cal.subtitle')}
          </p>
        </div>
        {anyCaptured && (
          <button onClick={resetAll} style={{
            padding: '0.35rem 0.75rem', borderRadius: '6px',
            border: '1px solid rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.08)',
            color: '#ef4444', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer'
          }}>
            {t('armband_cal.reset')}
          </button>
        )}
      </div>

      {/* Not connected warning */}
      {!isArmbandConnected && (
        <div style={{
          padding: '0.75rem 1rem', borderRadius: '8px',
          background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.35)',
          marginBottom: '1rem', fontSize: '0.8rem', color: '#d97706'
        }}>
          {t('armband_cal.no_armbands')}
        </div>
      )}

      {/* 3 Steps */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1rem' }}>
        {STEPS.map((step, idx) => {
          const meta    = stepMeta[step];
          const pose    = cal[step];
          const done    = pose !== null;
          const active  = activeStep === step;
          const flashed = justCaptured === step;

          return (
            <div key={step} style={{
              padding: '1rem', borderRadius: '10px',
              border: `2px solid ${active ? meta.color : done ? `${meta.color}55` : 'var(--border-color)'}`,
              background: active
                ? (isDark ? `${meta.color}18` : `${meta.color}0c`)
                : done
                  ? (isDark ? `${meta.color}10` : `${meta.color}08`)
                  : 'var(--bg-card)',
              transition: 'all 0.2s'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                {/* Step number + icon */}
                <div style={{
                  width: '2.2rem', height: '2.2rem', borderRadius: '50%', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: done ? meta.color : (isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)'),
                  fontSize: '1rem'
                }}>
                  {done ? '✓' : meta.icon}
                </div>

                {/* Text */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontWeight: 600, fontSize: '0.875rem', color: 'var(--text-primary)' }}>
                    {t('armband_cal.step_n', { n: idx + 1 })}: {t(meta.titleKey)}
                  </p>
                  <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    {t(meta.descKey)}
                  </p>
                  {done && pose && (
                    <div style={{ marginTop: '0.4rem', fontSize: '0.62rem', fontFamily: 'monospace', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                      <span style={{ color: meta.color, fontWeight: 600 }}>Q1 </span>{fmtQ(pose.q1)}<br />
                      <span style={{ color: meta.color, fontWeight: 600 }}>Q2 </span>{fmtQ(pose.q2)}
                    </div>
                  )}
                </div>

                {/* Action button */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', flexShrink: 0 }}>
                  {!active ? (
                    <button
                      onClick={() => setActiveStep(step)}
                      disabled={!isArmbandConnected}
                      style={{
                        padding: '0.45rem 0.9rem', borderRadius: '6px',
                        background: done ? `${meta.color}22` : meta.color,
                        color: done ? meta.color : 'white',
                        fontSize: '0.75rem', fontWeight: 600,
                        cursor: isArmbandConnected ? 'pointer' : 'not-allowed',
                        opacity: isArmbandConnected ? 1 : 0.5,
                        border: done ? `1px solid ${meta.color}66` : 'none',
                        minWidth: '80px'
                      } as React.CSSProperties}
                    >
                      {flashed ? '✓ Saved!' : done ? t('armband_cal.redo') : t('armband_cal.set_pose')}
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => capture(step)}
                        style={{
                          padding: '0.45rem 0.9rem', borderRadius: '6px', border: 'none',
                          background: meta.color, color: 'white',
                          fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer',
                          minWidth: '80px', animation: 'pulse 1s infinite'
                        }}
                      >
                        {t('armband_cal.capture')}
                      </button>
                      <button
                        onClick={() => setActiveStep(null)}
                        style={{
                          padding: '0.3rem 0.9rem', borderRadius: '6px',
                          border: '1px solid var(--border-color)', background: 'transparent',
                          color: 'var(--text-secondary)', fontSize: '0.7rem', cursor: 'pointer'
                        }}
                      >
                        {t('armband_cal.cancel')}
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Active instruction banner */}
              {active && (
                <div style={{
                  marginTop: '0.75rem', padding: '0.6rem 0.75rem', borderRadius: '6px',
                  background: `${meta.color}22`, border: `1px solid ${meta.color}55`,
                  fontSize: '0.78rem', color: 'var(--text-primary)', fontWeight: 500
                }}>
                  👉 {t(meta.descKey)} — {t('armband_cal.hold_still')}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Apply section */}
      {anyCaptured && (
        <div style={{
          padding: '1rem', borderRadius: '8px', marginTop: '0.5rem',
          background: allCaptured ? 'rgba(16,185,129,0.08)' : 'rgba(59,130,246,0.08)',
          border: `1px solid ${allCaptured ? 'rgba(16,185,129,0.3)' : 'rgba(59,130,246,0.3)'}`
        }}>
          <p style={{ margin: '0 0 0.75rem 0', fontSize: '0.82rem', color: allCaptured ? '#10b981' : '#3b82f6', fontWeight: 600 }}>
            {allCaptured ? t('armband_cal.all_done') : t('armband_cal.partial_done', { count: STEPS.filter(s => cal[s] !== null).length })}
          </p>
          <button onClick={applyCalibration} style={{
            width: '100%', padding: '0.75rem', borderRadius: '8px', border: 'none',
            background: allCaptured ? '#10b981' : '#3b82f6',
            color: 'white', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer'
          }}>
            {t('armband_cal.apply')}
          </button>
        </div>
      )}
    </div>
  );
}
