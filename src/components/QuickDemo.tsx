import { useState } from 'react';
import { useTheme } from '../context/ThemeContext';
import './QuickDemo.css';

interface QuickDemoProps {
  onSimulateLetter: (letter: string) => void;
  isActive: boolean;
  onStopSimulator: () => void;
  quickDemoCallbackRef: React.MutableRefObject<(() => void) | null>;
  detectedWord: string; // Add this to get the ACTUAL detected word
  onClearWord: () => void; // Add ability to clear word before demo
  onResetWordFinalization?: () => void; // Reset finalization state
  getCurrentWord: () => string; // Get the CURRENT word from ref (not from prop)
}

const QuickDemo: React.FC<QuickDemoProps> = ({ 
  onSimulateLetter, 
  isActive, 
  onStopSimulator, 
  quickDemoCallbackRef, 
  detectedWord, 
  onClearWord, 
  onResetWordFinalization,
  getCurrentWord 
}) => {
  const { theme } = useTheme();
  const [customWord, setCustomWord] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [currentLetterIndex, setCurrentLetterIndex] = useState(-1);

  const simulateWord = async (word: string) => {
    const letters = word.toUpperCase().split('').filter(l => l !== ' ');
    const availableLetters = 'ABCDEFIKOSTUVWXY'; // 16 letters (no G H J L M N P Q R Z)
    const validLetters = letters.filter(l => availableLetters.includes(l));
    const skippedLetters = letters.filter(l => !availableLetters.includes(l));
    
    if (skippedLetters.length > 0) {
      alert(`Letters not available in model: ${skippedLetters.join(', ')}\n\nWill simulate: ${validLetters.join('')}`);
    }
    
    if (validLetters.length === 0) {
      alert(`No valid letters to simulate!\n\nAvailable: ${availableLetters.split('').join(' ')}`);
      return;
    }

    // CRITICAL: Clear old word before starting new demo
    console.log('[QuickDemo] Clearing old word before starting new demo');
    onClearWord();
    if (onResetWordFinalization) {
      onResetWordFinalization();
    }
    
    // Wait a tick for the clear to propagate
    await new Promise(resolve => setTimeout(resolve, 100));

    setIsRunning(true);

    for (let i = 0; i < validLetters.length; i++) {
      setCurrentLetterIndex(i);
      const letter = validLetters[i];
      
      console.log(`[QuickDemo] Starting letter ${i + 1}/${validLetters.length}: ${letter}`);
      
      // Trigger simulation for this letter
      onSimulateLetter(letter);
      
      // Wait for prediction to complete using a Promise that resolves when callback is called
      await new Promise<void>((resolve) => {
        // Safety timeout in case something goes wrong (10 seconds max per letter)
        const timeoutId = setTimeout(() => {
          if (quickDemoCallbackRef.current) {
            console.log(`[QuickDemo] Timeout waiting for ${letter}, moving to next`);
            quickDemoCallbackRef.current = null;
            resolve();
          }
        }, 10000);
        
        // Set up the callback that will be called when prediction completes
        quickDemoCallbackRef.current = () => {
          console.log(`[QuickDemo] Letter ${letter} prediction complete!`);
          clearTimeout(timeoutId); // ← CRITICAL: Cancel the timeout!
          resolve();
        };
      });
      
      // Small pause before next letter for clarity
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    setIsRunning(false);
    setCurrentLetterIndex(-1);
    
    // CRITICAL: Stop the simulator after demo completes!
    onStopSimulator();
    
    // Wait a moment for final prediction to complete and word to update
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // Get the ACTUAL detected word from the prediction view (using ref for most current value)
    const finalWord = getCurrentWord();
    console.log(`[QuickDemo] Demo complete. Word from prediction view: "${finalWord}"`);
    
    // Speak the word from prediction view!
    if (finalWord.length > 0) {
      console.log(`[QuickDemo] Speaking word from prediction view: "${finalWord}"`);
      if ('speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(finalWord);
        utterance.lang = 'en-US';
        utterance.rate = 0.8;
        window.speechSynthesis.speak(utterance);
      }
    } else {
      console.log('[QuickDemo] WARNING: No word to speak!');
    }
  };

  return (
    <div className="quickdemo-container">
      <h3 className="quickdemo-title">Quick Demo Mode</h3>
      
      <p className="quickdemo-description">
        Auto-simulate words for professor demos
      </p>

      {isRunning && (
        <div className="running-banner">
          <span className="running-text">
            Demo Running... (Letter {currentLetterIndex + 1})
          </span>
        </div>
      )}

      {/* Custom Word */}
      <div className="demo-section">
        <label className="section-label">Enter Word:</label>
        <div className="custom-row">
          <input
            className="custom-input"
            type="text"
            value={customWord}
            onChange={(e) => setCustomWord(e.target.value.toUpperCase())}
            placeholder="Type word here..."
            maxLength={10}
            disabled={isActive || isRunning}
          />
          <button
            className="go-button"
            onClick={() => {
              if (!customWord.trim() || isActive || isRunning) return;
              simulateWord(customWord.trim());
            }}
            disabled={!customWord.trim() || isActive || isRunning}
          >
            GO
          </button>
        </div>
        <p className="helper-text">
          Available letters: A B C D E F I K O S T U V W X Y
        </p>
      </div>
    </div>
  );
};

export default QuickDemo;

