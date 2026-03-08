import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext';
import { PredictionResponse } from '../services/apiService';
import './PredictionView.css';

// Import ASL sign images properly for Vite production builds
import A_img from '../assets/asl/A.png';
import B_img from '../assets/asl/B.png';
import C_img from '../assets/asl/C.png';
import D_img from '../assets/asl/D.png';
import E_img from '../assets/asl/E.png';
import F_img from '../assets/asl/F.png';
import G_img from '../assets/asl/G.png';
import H_img from '../assets/asl/H.png';
import I_img from '../assets/asl/I.png';
import K_img from '../assets/asl/K.png';
import L_img from '../assets/asl/L.png';
import O_img from '../assets/asl/O.png';
import P_img from '../assets/asl/P.png';
import Q_img from '../assets/asl/Q.png';
import R_img from '../assets/asl/R.png';
import S_img from '../assets/asl/S.png';
import T_img from '../assets/asl/T.png';
import V_img from '../assets/asl/V.png';
import W_img from '../assets/asl/W.png';
import X_img from '../assets/asl/X.png';
import Y_img from '../assets/asl/Y.png';

const ASL_SIGNS: { [key: string]: string } = {
  A: A_img,
  B: B_img,
  C: C_img,
  D: D_img,
  E: E_img,
  F: F_img,
  G: G_img,
  H: H_img,
  I: I_img,
  K: K_img,
  L: L_img,
  O: O_img,
  P: P_img,
  Q: Q_img,
  R: R_img,
  S: S_img,
  T: T_img,
  V: V_img,
  W: W_img,
  X: X_img,
  Y: Y_img,
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
  isRealTimeMode?: boolean; // New prop to indicate real-time mode (single/continuous)
}

export default function PredictionView({ 
  prediction, 
  isLoading, 
  error, 
  sampleCount, 
  isContinuousMode = false, 
  currentWord = '', 
  onClearWord, 
  onDeleteLetter,
  isRealTimeMode = false 
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

  // In real-time mode, NEVER show loading - keep the last prediction visible
  // Only show loading in manual mode when first starting
  if (isLoading && !isRealTimeMode) {
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
      </div>

      {/* ASL Sign Image for single letter */}
      {ASL_SIGNS[prediction.letter] && (
        <div className="single-letter-sign-container">
          <img 
            key={prediction.letter}
            src={ASL_SIGNS[prediction.letter]} 
            alt={`ASL sign for ${prediction.letter}`}
            className={`single-letter-sign-image ${theme === 'dark' ? 'dark-mode' : ''}`}
          />
          <p className={`sign-hint-text ${theme === 'dark' ? 'sign-hint-text--dark' : ''}`}>
            ASL Sign for "{prediction.letter}"
          </p>
          <p className="sign-hint-text confidence-inline" style={{ color: confidenceColor }}>
            {confidencePercent}%
          </p>
        </div>
      )}

    </div>
  );
}

