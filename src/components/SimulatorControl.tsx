import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext';
import './SimulatorControl.css';

interface SimulatorControlProps {
  onSensorData: (data: number[]) => void;
  isSimulating: boolean;
  setIsSimulating: (value: boolean) => void;
  onCurrentSampleChange?: (data: number[]) => void;
  isContinuousMode?: boolean;
  simulateLetterRef?: React.MutableRefObject<string | null>;
  onClearBuffer?: () => void; // New callback to clear buffer when switching letters
}

// ASL patterns for 15 distinguishable letters (calibrated for our sensor range)
// Converted from normalized values (0-1) to raw ADC values using baselines and maxbends
// Source: iot-sign-glove/scripts/synthetic_asl_simulator.py
const BASELINES = [440, 612, 618, 548, 528]; // thumb, index, middle, ring, pinky
const MAXBENDS = [650, 900, 900, 850, 800];

function denormalize(normalized: number[], baselines: number[], maxbends: number[]): number[] {
  return normalized.map((val, i) => Math.round(baselines[i] + val * (maxbends[i] - baselines[i])));
}

const ASL_PATTERNS: Record<string, number[]> = {
  A: denormalize([0.02, 0.68, 0.78, 0.65, 0.68], BASELINES, MAXBENDS),
  B: denormalize([0.42, 0.13, 0.24, 0.26, 0.32], BASELINES, MAXBENDS),
  C: denormalize([0.31, 0.56, 0.70, 0.59, 0.59], BASELINES, MAXBENDS),
  D: denormalize([0.40, 0.04, 0.74, 0.64, 0.66], BASELINES, MAXBENDS),
  E: denormalize([0.53, 0.61, 0.81, 0.64, 0.64], BASELINES, MAXBENDS),
  F: denormalize([0.44, 0.43, 0.13, 0.22, 0.33], BASELINES, MAXBENDS),
  I: denormalize([0.47, 0.68, 0.74, 0.66, 0.22], BASELINES, MAXBENDS),
  K: denormalize([0.13, 0.00, 0.35, 0.65, 0.68], BASELINES, MAXBENDS),
  O: denormalize([0.50, 0.50, 0.58, 0.58, 0.54], BASELINES, MAXBENDS),
  S: denormalize([0.55, 0.67, 0.74, 0.68, 0.69], BASELINES, MAXBENDS),
  T: denormalize([0.33, 0.20, 0.67, 0.63, 0.68], BASELINES, MAXBENDS),
  V: denormalize([0.26, 0.03, 0.02, 0.95, 0.95], BASELINES, MAXBENDS), // Ring and pinky fully bent
  W: denormalize([0.23, 0.12, 0.11, 0.22, 0.73], BASELINES, MAXBENDS),
  X: denormalize([0.38, 0.47, 0.71, 0.65, 0.71], BASELINES, MAXBENDS),
  Y: denormalize([0.00, 0.58, 0.71, 0.65, 0.24], BASELINES, MAXBENDS),
};

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'I', 'K', 'O', 'S', 'T', 'V', 'W', 'X', 'Y'];

export default function SimulatorControl({ 
  onSensorData, 
  isSimulating, 
  setIsSimulating, 
  onCurrentSampleChange, 
  isContinuousMode = false,
  simulateLetterRef,
  onClearBuffer
}: SimulatorControlProps) {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const [selectedLetter, setSelectedLetter] = useState<string | null>(null);
  const [sampleCount, setSampleCount] = useState(0);

  // Watch for programmatic letter simulation from QuickDemo
  useEffect(() => {
    if (simulateLetterRef && simulateLetterRef.current) {
      const letter = simulateLetterRef.current;
      console.log(`[SimulatorControl] Programmatic trigger for letter: ${letter}`);
      simulateLetterRef.current = null; // Clear the ref immediately
      
      // Stop any existing simulation first
      if (isSimulating && selectedLetter !== letter) {
        console.log(`[SimulatorControl] Switching from ${selectedLetter} to ${letter}`);
      }
      
      setSelectedLetter(letter);
      setSampleCount(0);
      // Don't set isSimulating here - it's already set by the parent
    }
  }, [simulateLetterRef?.current]);

  useEffect(() => {
    if (!isSimulating || !selectedLetter) return;

    const interval = setInterval(() => {
      const basePattern = ASL_PATTERNS[selectedLetter];
      if (!basePattern) return;

      // Add realistic noise (±8) and round to integers
      const noisyData = basePattern.map(value => 
        Math.round(Math.max(0, Math.min(1023, value + Math.random() * 16 - 8)))
      );

      onSensorData(noisyData);
      if (onCurrentSampleChange) {
        onCurrentSampleChange(noisyData); // Send to real-time display
      }
      setSampleCount(prev => prev + 1);
    }, 20); // 50Hz sampling

    return () => clearInterval(interval);
  }, [isSimulating, selectedLetter, onSensorData, onCurrentSampleChange]);

  const handleLetterPress = (letter: string) => {
    console.log(`[SimulatorControl] Manual letter press: ${letter}`);
    
    // Clear parent's buffer before starting new letter
    if (onClearBuffer) {
      onClearBuffer();
    }
    
    setSelectedLetter(letter);
    setSampleCount(0);
    setIsSimulating(true);
  };

  const handleStop = () => {
    setIsSimulating(false);
    setSampleCount(0);
  };

  return (
    <div className="simulator-container">
      <div className="simulator-header">
        <h3 className="simulator-title">{t('simulator.title')}</h3>
        {isSimulating && (
          <button className="stop-button" onClick={handleStop}>
            ⏹ {t('buttons.stop')}
          </button>
        )}
      </div>

      <p className="simulator-description">
        {t('simulator.description')}
      </p>

      {isSimulating && selectedLetter && (
        <div className="simulator-status">
          <span className="simulator-status-text">
            {isContinuousMode 
              ? `${t('simulator.simulating')}: ${selectedLetter} (continuous mode)`
              : `${t('simulator.simulating')}: ${selectedLetter} (${sampleCount}/200)`
            }
          </span>
        </div>
      )}

      <div className="letter-grid">
        {LETTERS.map(letter => (
          <button
            key={letter}
            className={`letter-button ${selectedLetter === letter && isSimulating ? 'active' : ''}`}
            onClick={() => handleLetterPress(letter)}
            disabled={isSimulating}
          >
            {letter}
          </button>
        ))}
      </div>
    </div>
  );
}

