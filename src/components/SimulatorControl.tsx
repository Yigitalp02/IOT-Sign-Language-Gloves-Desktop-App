import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
// import { useTheme } from '../context/ThemeContext'; // Removed unused
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
// UPDATED FOR ESP32 THERMISTOR SENSORS - PROPERLY WORN GLOVE
// Based on actual sensor data from properly worn glove (Feb 19, 2026)
// Index finger has wide range: 1650 (straight) to 1300 (fully bent)
// Thumb goes very low when bent: 2700 (straight) to 2200 (fully bent)
const BASELINES = [2700, 1650, 1850, 2110, 2125]; // thumb, index, middle, ring, pinky (straight)
const MAXBENDS = [2200, 1300, 1480, 1640, 1720]; // fully bent

function denormalize(normalized: number[], baselines: number[], maxbends: number[]): number[] {
  return normalized.map((val, i) => Math.round(baselines[i] + val * (maxbends[i] - baselines[i])));
}

// Patterns: ASL-correct finger positions (0=straight, 1=bent) for accurate 3D display
// B: thumb tucked, index/middle/ring/pinky all straight
const ASL_PATTERNS: Record<string, number[]> = {
  A: denormalize([0.00, 1.00, 0.90, 1.00, 1.00], BASELINES, MAXBENDS),
  B: denormalize([0.74, 0.05, 0.06, 0.10, 0.13], BASELINES, MAXBENDS),
  C: denormalize([0.00, 1.00, 0.85, 0.98, 0.86], BASELINES, MAXBENDS),
  D: denormalize([0.09, 0.05, 0.85, 1.00, 0.79], BASELINES, MAXBENDS),  // index straight, others bent
  E: denormalize([0.88, 1.00, 0.97, 1.00, 0.97], BASELINES, MAXBENDS),
  F: denormalize([0.04, 0.52, 0.11, 0.26, 0.28], BASELINES, MAXBENDS),
  I: denormalize([0.83, 0.99, 0.85, 0.98, 0.20], BASELINES, MAXBENDS),
  K: denormalize([0.04, 0.53, 0.21, 0.87, 0.50], BASELINES, MAXBENDS),
  O: denormalize([0.02, 0.91, 0.81, 0.98, 0.78], BASELINES, MAXBENDS),
  S: denormalize([0.57, 0.92, 0.87, 1.00, 0.96], BASELINES, MAXBENDS),
  T: denormalize([0.07, 0.88, 0.88, 1.00, 1.00], BASELINES, MAXBENDS),
  V: denormalize([0.55, 0.31, 0.19, 0.94, 0.81], BASELINES, MAXBENDS),
  W: denormalize([0.72, 0.09, 0.03, 0.15, 0.90], BASELINES, MAXBENDS),
  X: denormalize([0.48, 0.33, 0.77, 0.92, 0.91], BASELINES, MAXBENDS),
  Y: denormalize([0.01, 0.98, 0.91, 0.95, 0.03], BASELINES, MAXBENDS),
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
  // const { theme } = useTheme(); // Removed unused
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

