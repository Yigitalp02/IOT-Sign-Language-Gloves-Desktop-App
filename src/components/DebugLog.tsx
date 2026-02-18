import { useState } from 'react';
import { useTheme } from '../context/ThemeContext';
import './DebugLog.css';

interface DebugLogData {
  simulationStartTime?: number;
  simulationEndTime?: number;
  firstSample?: number[];
  lastSample?: number[];
  totalSamples?: number;
  apiCallTime?: number;
  apiResponseTime?: number;
  apiResponse?: {
    letter: string;
    confidence: number;
    all_probabilities: Record<string, number>;
    processing_time_ms: number;
    model_name: string;
  };
  error?: string;
}

interface DebugLogProps {
  data: DebugLogData | null;
}

export default function DebugLog({ data }: DebugLogProps) {
  const { theme } = useTheme();
  const [isVisible, setIsVisible] = useState(true);

  if (!data) return null;

  const simulationDuration = data.simulationEndTime && data.simulationStartTime 
    ? data.simulationEndTime - data.simulationStartTime 
    : 0;

  const roundTripTime = data.apiResponseTime && data.apiCallTime
    ? data.apiResponseTime - data.apiCallTime
    : 0;

  // Sort probabilities by value
  const sortedProbs = data.apiResponse?.all_probabilities
    ? Object.entries(data.apiResponse.all_probabilities)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5) // Top 5
    : [];

  return (
    <div className="debug-log-container">
      <button 
        className="debug-log-header"
        onClick={() => setIsVisible(!isVisible)}
      >
        <span className="debug-log-header-text">
          {isVisible ? '▼' : '▶'} Debug Log
        </span>
        {data.apiResponse && (
          <span className="debug-log-badge">
            {Math.round(roundTripTime)}ms
          </span>
        )}
      </button>

      {isVisible && (
        <div className="debug-log-content">
          {/* Simulation Info */}
          <div className="debug-section">
            <h4 className="debug-section-title simulation">SIMULATION</h4>
            <p className="debug-log-text">
              Duration: {simulationDuration.toFixed(0)}ms ({(simulationDuration / 1000).toFixed(1)}s)
            </p>
            <p className="debug-log-text">
              Samples: {data.totalSamples || 0}
            </p>
            {data.firstSample && (
              <>
                <p className="debug-log-text">
                  First: [{data.firstSample.map(v => v.toFixed(0)).join(', ')}]
                </p>
                <p className="debug-log-text">
                  Last:  [{data.lastSample?.map(v => v.toFixed(0)).join(', ')}]
                </p>
              </>
            )}
          </div>

          {/* API Info */}
          {data.apiResponse && (
            <div className="debug-section">
              <h4 className="debug-section-title api">API RESPONSE</h4>
              <p className="debug-log-text">
                API: <strong>{import.meta.env.VITE_API_URL || 'https://api.ybilgin.com'}</strong>
              </p>
              <p className="debug-log-text">
                Letter: <strong>{data.apiResponse.letter}</strong>
              </p>
              <p className="debug-log-text">
                Confidence: <strong>{(data.apiResponse.confidence * 100).toFixed(1)}%</strong>
              </p>
              <p className="debug-log-text">
                Round Trip: {roundTripTime.toFixed(0)}ms
              </p>
              <p className="debug-log-text">
                Server Processing: {data.apiResponse.processing_time_ms.toFixed(1)}ms
              </p>
              <p className="debug-log-text">
                Model: {data.apiResponse.model_name}
              </p>
            </div>
          )}

          {/* Top Probabilities */}
          {sortedProbs.length > 0 && (
            <div className="debug-section">
              <h4 className="debug-section-title probs">TOP 5 PREDICTIONS</h4>
              {sortedProbs.map(([letter, prob]) => (
                <div key={letter} className="prob-row">
                  <span className="prob-letter">{letter}</span>
                  <div className="prob-bar-container">
                    <div 
                      className="prob-bar-fill"
                      style={{ 
                        width: `${prob * 100}%`,
                        backgroundColor: letter === data.apiResponse?.letter ? '#10b981' : '#6b7280'
                      }}
                    />
                  </div>
                  <span className="prob-value">{(prob * 100).toFixed(1)}%</span>
                </div>
              ))}
            </div>
          )}

          {/* Error */}
          {data.error && (
            <div className="debug-section">
              <h4 className="debug-section-title error">ERROR</h4>
              <p className="debug-error-text">{data.error}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

