import { useTheme } from '../context/ThemeContext';
import './SensorDisplay.css';

interface SensorDisplayProps {
  currentSample: number[] | null;
  isActive: boolean;
  sampleCount?: number;
  targetSamples?: number;
  isCollecting?: boolean;
  motionDetected?: boolean;
  baselines?: number[];
  maxbends?: number[];
}

const SensorDisplay: React.FC<SensorDisplayProps> = ({ 
  currentSample, 
  isActive, 
  sampleCount = 0, 
  targetSamples = 150,
  isCollecting = false,
  motionDetected = false,
  baselines,
  maxbends
}) => {
  const { theme } = useTheme();

  // Calculate color based on calibration (if provided) or use per-finger defaults
  const getBarColor = (value: number, fingerIndex: number) => {
    if (baselines && maxbends && baselines[fingerIndex] && maxbends[fingerIndex]) {
      const baseline = baselines[fingerIndex];
      const maxbend = maxbends[fingerIndex];
      
      // Normalize value: 0 = straight (baseline), 1 = fully bent (maxbend)
      // For thermistors: baseline > maxbend (higher = straight, lower = bent)
      const normalized = (value - baseline) / (maxbend - baseline);
      
      // Color thresholds based on bend percentage
      if (normalized < 0.33) return '#10b981'; // Green - mostly straight
      if (normalized < 0.66) return '#fbbf24'; // Yellow - partially bent
      return '#ef4444'; // Red - mostly/fully bent
    }
    
    // Fallback to fixed thresholds if no calibration
    if (value > 2000) return '#10b981'; // Green - straight
    if (value > 1500) return '#fbbf24'; // Yellow - partially bent
    return '#ef4444'; // Red - fully bent
  };

  const getBarWidth = (value: number, fingerIndex: number) => {
    if (baselines && maxbends && baselines[fingerIndex] && maxbends[fingerIndex]) {
      const baseline = baselines[fingerIndex];
      const maxbend = maxbends[fingerIndex];
      const min = Math.min(baseline, maxbend);
      const max = Math.max(baseline, maxbend);
      return `${((value - min) / (max - min)) * 100}%`;
    }
    
    // Fallback to fixed range
    return `${((value - 800) / (2700 - 800)) * 100}%`;
  };

  const fingerNames = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];

  return (
    <div className="sensor-display-container">
      <div className="sensor-display-header">
        <h3 className="sensor-display-title">Real-Time Sensor Values</h3>
        <div className={`status-dot ${isActive ? 'active' : ''}`} />
      </div>

      {/* Collection Status */}
      {isActive && (
        <div style={{
          padding: '0.75rem',
          borderRadius: '8px',
          backgroundColor: isCollecting ? 'rgba(16, 185, 129, 0.1)' : 'rgba(100, 116, 139, 0.1)',
          border: `1px solid ${isCollecting ? '#10b981' : '#64748b'}`,
          marginBottom: '0.75rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div>
            <span style={{ 
              fontWeight: 600, 
              color: isCollecting ? '#10b981' : '#64748b',
              marginRight: '0.5rem'
            }}>
              {isCollecting ? '📊 Collecting' : '⏸ Idle'}
            </span>
            {motionDetected && (
              <span style={{
                fontSize: '0.85rem',
                color: '#fb923c',
                backgroundColor: 'rgba(251, 146, 60, 0.1)',
                padding: '0.25rem 0.5rem',
                borderRadius: '4px',
                marginLeft: '0.5rem'
              }}>
                🔄 Buffer Cleared
              </span>
            )}
          </div>
          <div style={{ 
            fontSize: '0.9rem', 
            fontWeight: 600,
            color: isCollecting ? '#10b981' : '#64748b'
          }}>
            {sampleCount}/{targetSamples} samples
          </div>
        </div>
      )}

      {!currentSample || currentSample.length === 0 ? (
        <p className="no-data-text">No sensor data yet...</p>
      ) : (
        <div className="sensors-container">
          {currentSample.map((value, index) => (
            <div key={index} className="sensor-row">
              {/* Sensor Label */}
              <span className="sensor-label">
                {fingerNames[index] || `CH${index}`}
              </span>

              {/* Progress Bar */}
              <div className="bar-container">
                <div
                  className="bar-fill"
                  style={{
                    width: getBarWidth(value, index),
                    backgroundColor: getBarColor(value, index),
                  }}
                />
              </div>

              {/* Numeric Value */}
              <span className="value-text">{value}</span>
            </div>
          ))}
        </div>
      )}

      {/* Legend */}
      {currentSample && currentSample.length > 0 && (
        <div className="legend">
          <div className="legend-item">
            <div className="legend-dot red" />
            <span className="legend-text">800-1500 (Bent)</span>
          </div>
          <div className="legend-item">
            <div className="legend-dot yellow" />
            <span className="legend-text">1501-2000 (Partial)</span>
          </div>
          <div className="legend-item">
            <div className="legend-dot green" />
            <span className="legend-text">2001-2700 (Straight)</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default SensorDisplay;

