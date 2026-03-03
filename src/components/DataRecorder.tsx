import { useState } from 'react';
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

// Flex-only letters — orientation doesn't matter, model uses random quaternion augmentation
const ASL_LETTERS_FLEX  = ['A', 'B', 'C', 'E', 'F', 'I', 'O', 'S', 'T', 'V', 'W', 'X', 'Y'];
// IMU-required letters — must be recorded with BNO055 connected at specific orientation
// D and K re-recorded with IMU so model can distinguish them from G and P respectively
const ASL_LETTERS_IMU   = ['D', 'K', 'G', 'H', 'L', 'P', 'Q', 'R'];

// LEFT-HAND specific orientation hints for IMU-dependent letters
// (standard ASL descriptions are for right hand; left hand is the mirror)
const LEFT_HAND_HINTS: Record<string, string> = {
  D: 'Palm forward, index pointing UP — normal D position. Distinguishes D from G.',
  K: 'Palm forward, K shape pointing UP — normal K position. Distinguishes K from P.',
  G: 'Index points LEFT (sideways). Thumb parallel to index. Wrist rotated ~90° outward.',
  H: 'Index + middle point LEFT (sideways), together. Wrist rotated ~90° outward.',
  L: 'Thumb up + index pointing forward. "L" shape. Other fingers bent.',
  P: 'Like K but tilt hand DOWN — fingertips point toward floor.',
  Q: 'Like G but tilt hand DOWN — index points toward floor.',
  R: 'Index + middle crossed, pointing DOWNWARD — flip hand so fingertips face the floor. Distinguishes R from V.',
};

export default function DataRecorder({
  isRecording,
  onStartRecording,
  onStopRecording,
  recordedSamples,
  targetSamples,
  isConnected
}: DataRecorderProps) {
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
          📊 Data Recording for Training
        </h3>
        {!isConnected && (
          <p className="warning-text" style={{ color: '#fb923c' }}>
            ⚠️ Connect glove first!
          </p>
        )}
      </div>

      <div className="recording-info" style={{ backgroundColor: bgSecondary, borderColor: borderColor }}>
        <p style={{ color: textSecondary, marginBottom: '0.5rem' }}>
          Collect labeled samples for each ASL letter. <strong style={{ color: textPrimary }}>Left-hand glove</strong> — signs are mirrored from standard ASL diagrams.
        </p>
        <p style={{ color: textSecondary, fontSize: '0.85rem' }}>
          <strong>Best Practice:</strong> Record 10–15 sessions per letter, varying hand position slightly each time. IMU data is captured automatically when the BNO055 is connected.
        </p>
      </div>

      {!isRecording ? (
        <>
          <div className="letter-selector">
            <label style={{ color: textPrimary, fontWeight: 600, marginBottom: '0.5rem', display: 'block' }}>
              Select Letter to Record:
            </label>

            {/* Flex-only letters */}
            <p style={{ color: textSecondary, fontSize: '0.8rem', marginBottom: '0.25rem' }}>Flex sensors only</p>
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
              Flex + IMU orientation <span style={{ color: '#3b82f6', fontWeight: 600 }}>(BNO055 required)</span>
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
                  Left-hand orientation for "{selectedLetter}":
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
            Start Recording "{selectedLetter}"
          </button>
        </>
      ) : (
        <div className="recording-active">
          <div className="recording-banner" style={{ backgroundColor: '#ef4444' + '20', borderColor: '#ef4444' }}>
            <span className="recording-pulse" style={{ backgroundColor: '#ef4444' }}></span>
            <p style={{ color: '#ef4444', fontWeight: 600 }}>
              Recording "{selectedLetter}" — Hold the sign steady!
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
              {recordedSamples} / {targetSamples} samples ({Math.round(progress)}%)
            </p>
          </div>

          <button
            className="stop-button"
            style={{ backgroundColor: '#6b7280' }}
            onClick={onStopRecording}
          >
            ⏹ Stop Recording
          </button>
        </div>
      )}

      <div className="tips-section" style={{ backgroundColor: bgSecondary, borderColor: borderColor }}>
        <p style={{ color: textSecondary, fontWeight: 600, marginBottom: '0.5rem' }}>Recording Tips:</p>
        <ul style={{ color: textSecondary, fontSize: '0.85rem', paddingLeft: '1.5rem' }}>
          <li>Make the ASL sign and hold it steady for 3 seconds</li>
          <li>Record each letter 10–15 times with slight position variations</li>
          <li>Vary: hand angle, finger tightness, wrist rotation</li>
          <li>For IMU letters (D, K, G, H, L, P, Q, R): exaggerate the wrist orientation — the model relies on it</li>
          <li>R must point DOWNWARD (flipped), V points upward — this is what separates them</li>
          <li>CSV columns: <code>label, ch0–ch4 (normalised), qw, qx, qy, qz</code></li>
        </ul>
      </div>
    </div>
  );
}

