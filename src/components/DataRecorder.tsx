import React, { useState, useCallback } from 'react';
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

const ASL_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'I', 'K', 'O', 'S', 'T', 'V', 'W', 'X', 'Y'];

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
          Collect labeled samples for each ASL letter to train a better model.
        </p>
        <p style={{ color: textSecondary, fontSize: '0.85rem' }}>
          <strong>Best Practice:</strong> Record 10-15 samples per letter, varying hand position slightly each time.
        </p>
      </div>

      {!isRecording ? (
        <>
          <div className="letter-selector">
            <label style={{ color: textPrimary, fontWeight: 600 }}>Select Letter to Record:</label>
            <div className="letter-grid">
              {ASL_LETTERS.map(letter => (
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
            🔴 Start Recording "{selectedLetter}"
          </button>
        </>
      ) : (
        <div className="recording-active">
          <div className="recording-banner" style={{ backgroundColor: '#ef4444' + '20', borderColor: '#ef4444' }}>
            <span className="recording-pulse" style={{ backgroundColor: '#ef4444' }}>🔴</span>
            <p style={{ color: '#ef4444', fontWeight: 600 }}>
              Recording "{selectedLetter}" - Hold the sign steady!
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
        <p style={{ color: textSecondary, fontWeight: 600, marginBottom: '0.5rem' }}>📝 Recording Tips:</p>
        <ul style={{ color: textSecondary, fontSize: '0.85rem', paddingLeft: '1.5rem' }}>
          <li>Make the ASL sign and hold it steady for 3 seconds</li>
          <li>Record each letter 10-15 times with slight variations</li>
          <li>Vary: hand angle, finger tightness, wrist position</li>
          <li>Keep consistent speed and timing</li>
          <li>Data auto-saves to: <code>recordings/glove_data.csv</code></li>
        </ul>
      </div>
    </div>
  );
}

