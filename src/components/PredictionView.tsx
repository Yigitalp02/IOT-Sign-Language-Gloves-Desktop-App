import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext';
import { PredictionResponse } from '../services/apiService';
import './PredictionView.css';

// Import ASL sign images
const ASL_SIGNS: { [key: string]: string } = {
  A: '/src/assets/asl/A.png',
  B: '/src/assets/asl/B.png',
  C: '/src/assets/asl/C.png',
  D: '/src/assets/asl/D.png',
  E: '/src/assets/asl/E.png',
  F: '/src/assets/asl/F.png',
  I: '/src/assets/asl/I.png',
  K: '/src/assets/asl/K.png',
  O: '/src/assets/asl/O.png',
  S: '/src/assets/asl/S.png',
  T: '/src/assets/asl/T.png',
  V: '/src/assets/asl/V.png',
  W: '/src/assets/asl/W.png',
  X: '/src/assets/asl/X.png',
  Y: '/src/assets/asl/Y.png',
};

interface PredictionViewProps {
  prediction: PredictionResponse | null;
  isLoading: boolean;
  error: string | null;
  sampleCount: number;
  isContinuousMode?: boolean;
  currentWord?: string;
  onClearWord?: () => void;
  onDeleteLetter?: () => void;
}

export default function PredictionView({ 
  prediction, 
  isLoading, 
  error, 
  sampleCount, 
  isContinuousMode = false, 
  currentWord = '', 
  onClearWord, 
  onDeleteLetter 
}: PredictionViewProps) {
  const { t } = useTranslation();
  const { theme } = useTheme();

  // DEBUG: Log props to see what we're receiving
  useEffect(() => {
    console.log(`[PredictionView] Props - isContinuousMode: ${isContinuousMode}, currentWord: "${currentWord}" (${currentWord.length} letters), prediction: ${prediction?.letter || 'null'}`);
  }, [isContinuousMode, currentWord, prediction]);

  const getConfidenceColor = (confidence: number): string => {
    if (confidence >= 0.8) return '#34d399'; // Green
    if (confidence >= 0.6) return '#fbbf24'; // Yellow
    if (confidence >= 0.4) return '#fb923c'; // Orange
    return '#ef4444'; // Red
  };

  const handleSpeak = (text: string) => {
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US';
      utterance.rate = 0.8;
      window.speechSynthesis.speak(utterance);
    }
  };

  if (error) {
    return (
      <div className="prediction-container error">
        <span className="error-icon">!</span>
        <p className="error-text">{error}</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="prediction-container">
        <div className="loading-icon">...</div>
        <p className="loading-text">
          {t('prediction.analyzing')} ({sampleCount}/{isContinuousMode ? 150 : 200})
        </p>
      </div>
    );
  }

  // In continuous mode, show the word being built (PRIORITY over individual letter)
  if (isContinuousMode && currentWord.length > 0) {
    console.log(`[PredictionView] Showing word: "${currentWord}" (${currentWord.length} letters)`);
    return (
      <div className="prediction-container">
        <div className="main-result">
          <div className="word-box">
            <span className="word-text">{currentWord}</span>
          </div>
        </div>
        
        {/* ASL Sign Images for each letter */}
        <div className="asl-signs-container">
          {currentWord.split('').map((letter, index) => (
            <div key={`${letter}-${index}`} className="asl-sign-wrapper">
              {ASL_SIGNS[letter] && (
                <img 
                  src={ASL_SIGNS[letter]} 
                  alt={`ASL sign for ${letter}`}
                  className={`asl-sign-image ${theme === 'dark' ? 'dark-mode' : ''}`}
                />
              )}
              <span className="asl-sign-label">{letter}</span>
            </div>
          ))}
        </div>
        
        <p className="continuous-mode-hint">
          {currentWord.length} letter{currentWord.length !== 1 ? 's' : ''} detected
        </p>

        {/* Action Buttons */}
        <div className="action-buttons">
          <button
            className="action-button speak-button"
            onClick={() => handleSpeak(currentWord)}
          >
            Speak
          </button>

          {onDeleteLetter && (
            <button
              className="action-button delete-button"
              onClick={onDeleteLetter}
            >
              Delete
            </button>
          )}

          {onClearWord && (
            <button
              className="action-button clear-button"
              onClick={onClearWord}
            >
              Clear
            </button>
          )}
        </div>

        {prediction && (
          <div className="metadata">
            <div className="metadata-item">
              <span className="metadata-label">Last letter:</span>
              <span className="metadata-value">{prediction.letter}</span>
            </div>
            <div className="metadata-item">
              <span className="metadata-label">Confidence:</span>
              <span 
                className="metadata-value" 
                style={{ color: getConfidenceColor(prediction.confidence) }}
              >
                {Math.round(prediction.confidence * 100)}%
              </span>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (!prediction) {
    return (
      <div className="prediction-container">
        <p className="placeholder-text">{t('prediction.waiting')}</p>
      </div>
    );
  }

  const confidenceColor = getConfidenceColor(prediction.confidence);
  const confidencePercent = Math.round(prediction.confidence * 100);

  return (
    <div className="prediction-container">
      <div className="main-result">
        <div 
          className="letter-circle" 
          style={{ 
            borderColor: confidenceColor, 
            backgroundColor: `${confidenceColor}20` 
          }}
        >
          <span className="letter-text" style={{ color: confidenceColor }}>
            {prediction.letter}
          </span>
        </div>
        
        <div className="confidence">
          <span className="confidence-label">{t('prediction.confidence')}</span>
          <span className="confidence-value" style={{ color: confidenceColor }}>
            {confidencePercent}%
          </span>
        </div>
      </div>

      {/* ASL Sign Image for single letter */}
      {ASL_SIGNS[prediction.letter] && (
        <div className="single-letter-sign-container">
          <img 
            src={ASL_SIGNS[prediction.letter]} 
            alt={`ASL sign for ${prediction.letter}`}
            className={`single-letter-sign-image ${theme === 'dark' ? 'dark-mode' : ''}`}
          />
          <p className="sign-hint-text">
            ASL Sign for "{prediction.letter}"
          </p>
        </div>
      )}

      <div className="metadata">
        <div className="metadata-item">
          <span className="metadata-label">{t('prediction.samples')}:</span>
          <span className="metadata-value">{sampleCount}</span>
        </div>
        <div className="metadata-item">
          <span className="metadata-label">{t('prediction.time')}:</span>
          <span className="metadata-value">
            {prediction.processing_time_ms.toFixed(1)}ms
          </span>
        </div>
      </div>

      <p className="model-info">
        {t('prediction.model')}: {prediction.model_name}
      </p>
    </div>
  );
}

