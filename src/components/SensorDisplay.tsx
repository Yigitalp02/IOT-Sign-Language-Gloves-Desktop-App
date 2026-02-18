import { useTheme } from '../context/ThemeContext';
import './SensorDisplay.css';

interface SensorDisplayProps {
  currentSample: number[] | null;
  isActive: boolean;
  sampleCount?: number;
  targetSamples?: number;
  isCollecting?: boolean;
  motionDetected?: boolean;
}

const SensorDisplay: React.FC<SensorDisplayProps> = ({ 
  currentSample, 
  isActive, 
  sampleCount = 0, 
  targetSamples = 150, 
  isCollecting = false,
  motionDetected = false
}) => {
  const { theme } = useTheme();

  const getBarWidth = (value: number, min: number = 0, max: number = 1023) => {
    return `${((value - min) / (max - min)) * 100}%`;
  };

  const getBarColor = (value: number) => {
    if (value < 341) return '#ef4444'; // Red - low flex
    if (value < 682) return '#fbbf24'; // Yellow - medium flex
    return '#10b981'; // Green - high flex
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
                    width: getBarWidth(value),
                    backgroundColor: getBarColor(value),
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
            <span className="legend-text">0-340</span>
          </div>
          <div className="legend-item">
            <div className="legend-dot yellow" />
            <span className="legend-text">341-681</span>
          </div>
          <div className="legend-item">
            <div className="legend-dot green" />
            <span className="legend-text">682-1023</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default SensorDisplay;

