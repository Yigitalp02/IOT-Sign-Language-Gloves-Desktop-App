import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext';
import './DataRecorder.css';

interface DataRecorderProps {
  isRecording: boolean;
  onStartRecording: (letter: string) => void;
  onStopRecording: () => void;
  recordedSamples: number;
  targetSamples: number;
  isConnected: boolean;
}

// Flex-only letters — orientation doesn't matter for these
const ASL_LETTERS_FLEX = ['B', 'C', 'F', 'I', 'O', 'W', 'X', 'Y'];
// IMU-required letters — must be recorded with BNO055 at a specific orientation
// Families: VHRU, AT, ES, DG, LPQ — gravity features separate each family member
const ASL_LETTERS_IMU  = ['V', 'H', 'R', 'U', 'A', 'T', 'E', 'S', 'D', 'K', 'G', 'L', 'P', 'Q'];

// LEFT-HAND specific orientation hints for IMU-dependent letters
// (standard ASL descriptions are for right hand; left hand is the mirror)
const LEFT_HAND_HINTS: Record<string, string> = {
  // VHR family
  V: 'Palm facing FORWARD, index + middle spread apart pointing UP. Normal "peace sign" position.',
  H: 'Index + middle point LEFT (sideways), together. Wrist rotated ~90° outward.',
  R: 'Index + middle crossed, pointing DOWNWARD — flip hand so fingertips face the floor.',
  // AT family
  A: 'Closed fist, thumb resting on the SIDE of the fingers. Palm facing outward/forward.',
  T: 'Closed fist, thumb tucked BETWEEN index and middle fingers. Palm facing outward/forward.',
  // ES family
  E: 'All fingers curled tightly, fingertips touching palm. Thumb tucked under. Palm facing OUTWARD.',
  S: 'Closed fist, thumb crossing OVER the front of all fingers. Palm facing outward.',
  // DG family
  D: 'Palm forward, index pointing UP — normal D position. Distinguishes D from G.',
  G: 'Index points LEFT (sideways). Thumb parallel to index. Wrist rotated ~90° outward.',
  // KU family
  K: 'Hold K exactly how you naturally sign it in everyday use — do NOT adjust based on this hint. Watch the serial log while holding K; record only when the quaternion matches your live prediction session.',
  U: 'Palm facing TOWARD YOU (inward), index + middle together pointing UP. Wrist rolled inward ~90°.',
  // LPQ family
  L: 'Thumb up + index pointing forward. "L" shape. Other fingers bent.',
  P: 'Like K but tilt hand DOWN — fingertips point toward floor.',
  Q: 'Like G but tilt hand DOWN — index points toward floor.',
};

export default function DataRecorder({
  isRecording,
  onStartRecording,
  onStopRecording,
  recordedSamples,
  targetSamples,
  isConnected
}: DataRecorderProps) {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const [selectedLetter, setSelectedLetter] = useState('A');

  const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const textPrimary = isDark ? '#f1f5f9' : '#111827';
  const textSecondary = isDark ? '#94a3b8' : '#6b7280';
  const accentPrimary = isDark ? '#3b82f6' : '#10b981';
  const bgCard = isDark ? 'rgba(30, 41, 59, 0.7)' : '#ffffff';
  const bgSecondary = isDark ? 'rgba(51, 65, 85, 0.5)' : '#f9fafb';
  const borderColor = isDark ? 'rgba(255, 255, 255, 0.1)' : '#d1d5db';

  const progress = (recordedSamples / targetSamples) * 100;

  return (
    <div className="data-recorder-container" style={{ backgroundColor: bgCard, borderColor: borderColor }}>
      <div className="data-recorder-header">
        <h3 className="data-recorder-title" style={{ color: textPrimary }}>
          {t('recorder.title')}
        </h3>
        {!isConnected && (
          <p className="warning-text" style={{ color: '#fb923c' }}>
            {t('recorder.connect_first')}
          </p>
        )}
      </div>

      <div className="recording-info" style={{ backgroundColor: bgSecondary, borderColor: borderColor }}>
        <p style={{ color: textSecondary, marginBottom: '0.5rem' }}>
          {t('recorder.description')} <strong style={{ color: textPrimary }}>{t('recorder.left_hand')}</strong> {t('recorder.left_hand_note')}
        </p>
        <p style={{ color: textSecondary, fontSize: '0.85rem' }}>
          <strong>{t('recorder.best_practice')}</strong> {t('recorder.best_practice_desc')}
        </p>
      </div>

      {!isRecording ? (
        <>
          <div className="letter-selector">
            <label style={{ color: textPrimary, fontWeight: 600, marginBottom: '0.5rem', display: 'block' }}>
              {t('recorder.select_letter')}
            </label>

            {/* Flex-only letters */}
            <p style={{ color: textSecondary, fontSize: '0.8rem', marginBottom: '0.25rem' }}>{t('recorder.flex_only')}</p>
            <div className="letter-grid" style={{ marginBottom: '0.75rem' }}>
              {ASL_LETTERS_FLEX.map(letter => (
                <button
                  key={letter}
                  className={`letter-button ${selectedLetter === letter ? 'selected' : ''}`}
                  style={{
                    backgroundColor: selectedLetter === letter ? accentPrimary : bgSecondary,
                    color: selectedLetter === letter ? '#ffffff' : textPrimary,
                    borderColor: borderColor
                  }}
                  onClick={() => setSelectedLetter(letter)}
                >
                  {letter}
                </button>
              ))}
            </div>

            {/* IMU-dependent letters */}
            <p style={{ color: textSecondary, fontSize: '0.8rem', marginBottom: '0.25rem' }}>
              {t('recorder.flex_imu')} <span style={{ color: '#3b82f6', fontWeight: 600 }}>{t('recorder.bno_required')}</span>
            </p>
            <div className="letter-grid" style={{ marginBottom: '0.5rem' }}>
              {ASL_LETTERS_IMU.map(letter => (
                <button
                  key={letter}
                  className={`letter-button ${selectedLetter === letter ? 'selected' : ''}`}
                  style={{
                    backgroundColor: selectedLetter === letter ? '#3b82f6' : bgSecondary,
                    color: selectedLetter === letter ? '#ffffff' : textPrimary,
                    borderColor: selectedLetter === letter ? '#3b82f6' : '#3b82f6' + '60',
                    outline: `1px solid ${'#3b82f6' + '40'}`
                  }}
                  onClick={() => setSelectedLetter(letter)}
                >
                  {letter}
                </button>
              ))}
            </div>

            {/* Left-hand hint for IMU letters */}
            {LEFT_HAND_HINTS[selectedLetter] && (
              <div style={{
                backgroundColor: '#3b82f6' + '15',
                border: `1px solid ${'#3b82f6' + '40'}`,
                borderRadius: '8px',
                padding: '0.6rem 0.9rem',
                marginTop: '0.25rem',
              }}>
                <p style={{ color: '#3b82f6', fontSize: '0.82rem', fontWeight: 600, marginBottom: '0.2rem' }}>
                  {t('recorder.orientation_hint', { letter: selectedLetter })}
                </p>
                <p style={{ color: textSecondary, fontSize: '0.82rem', margin: 0 }}>
                  {LEFT_HAND_HINTS[selectedLetter]}
                </p>
              </div>
            )}
          </div>

          <button
            className="record-button"
            style={{
              backgroundColor: isConnected ? '#ef4444' : '#6b7280',
              cursor: isConnected ? 'pointer' : 'not-allowed'
            }}
            onClick={() => isConnected && onStartRecording(selectedLetter)}
            disabled={!isConnected}
          >
            {t('recorder.start_recording', { letter: selectedLetter })}
          </button>
        </>
      ) : (
        <div className="recording-active">
          <div className="recording-banner" style={{ backgroundColor: '#ef4444' + '20', borderColor: '#ef4444' }}>
            <span className="recording-pulse" style={{ backgroundColor: '#ef4444' }}></span>
            <p style={{ color: '#ef4444', fontWeight: 600 }}>
              {t('recorder.recording_active', { letter: selectedLetter })}
              {LEFT_HAND_HINTS[selectedLetter] && (
                <span style={{ display: 'block', fontWeight: 400, fontSize: '0.82rem', marginTop: '0.2rem', color: '#fb923c' }}>
                  {LEFT_HAND_HINTS[selectedLetter]}
                </span>
              )}
            </p>
          </div>

          <div className="progress-section">
            <div className="progress-bar-container" style={{ backgroundColor: bgSecondary }}>
              <div
                className="progress-bar-fill"
                style={{
                  width: `${progress}%`,
                  backgroundColor: progress >= 100 ? '#10b981' : accentPrimary
                }}
              />
            </div>
            <p className="progress-text" style={{ color: textPrimary }}>
              {t('recorder.samples_progress', { recorded: recordedSamples, target: targetSamples, percent: Math.round(progress) })}
            </p>
          </div>

          <button
            className="stop-button"
            style={{ backgroundColor: '#6b7280' }}
            onClick={onStopRecording}
          >
            {t('recorder.stop_recording')}
          </button>
        </div>
      )}

      <div className="tips-section" style={{ backgroundColor: bgSecondary, borderColor: borderColor }}>
        <p style={{ color: textSecondary, fontWeight: 600, marginBottom: '0.5rem' }}>{t('recorder.tips_title')}</p>
        <ul style={{ color: textSecondary, fontSize: '0.85rem', paddingLeft: '1.5rem' }}>
          <li>{t('recorder.tip1')}</li>
          <li>{t('recorder.tip2')}</li>
          <li>{t('recorder.tip3')}</li>
          <li>{t('recorder.tip4')}</li>
          <li>{t('recorder.tip5')}</li>
          <li>{t('recorder.tip6')}</li>
          <li>{t('recorder.tip7')}</li>
          <li><code>{t('recorder.tip8')}</code></li>
        </ul>
      </div>
    </div>
  );
}

