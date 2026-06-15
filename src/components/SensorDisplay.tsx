// import { useTheme } from '../context/ThemeContext'; // Removed unused
import { useTranslation } from 'react-i18next';
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
  // const { theme } = useTheme(); // Removed unused
  const { t } = useTranslation();

  // S-curve toggle — must match App.tsx FLEX_SCURVE_ENABLED so bars reflect what the model sees.
  const FLEX_SCURVE_ENABLED = true;
  const flexSmoothstep = (t: number) => { const c = Math.max(0, Math.min(1, t)); return c * c * (3 - 2 * c); };

  // Calculate color based on calibration (if provided) or use per-finger defaults
  // Fallback calibration constants (mirror App.tsx DEFAULT_BASELINES / DEFAULT_MAXBENDS)
  // Only used when the parent does not supply baselines/maxbends props.
  // Positive Ohm format: straight = low Ohm, bent = high Ohm.
  const FALLBACK_BASELINES = [  850, 1370, 1480, 1040, 1760]; // straight (lower Ohm)
  const FALLBACK_MAXBENDS  = [ 1050, 1950, 2050, 1450, 2200]; // fully bent (higher Ohm)

  const resolveCalibration = (_value: number, fingerIndex: number) => {
    if (baselines && maxbends &&
        baselines[fingerIndex] !== undefined && maxbends[fingerIndex] !== undefined) {
      return { baseline: baselines[fingerIndex], maxbend: maxbends[fingerIndex] };
    }
    return {
      baseline: FALLBACK_BASELINES[fingerIndex] ?? -1200,
      maxbend:  FALLBACK_MAXBENDS[fingerIndex]  ?? -1800,
    };
  };

  const getBarColor = (value: number, fingerIndex: number) => {
    const { baseline, maxbend } = resolveCalibration(value, fingerIndex);
    const linear = (value - baseline) / (maxbend - baseline); // 0=straight, 1=bent
    const normalized = FLEX_SCURVE_ENABLED ? flexSmoothstep(linear) : Math.max(0, Math.min(1, linear));
    // Visual is inverted: wide green = straight, narrow red = bent
    if (normalized < 0.25) return '#10b981'; // Green  - mostly straight
    if (normalized < 0.55) return '#fbbf24'; // Yellow - partially bent
    return '#ef4444';                         // Red    - mostly/fully bent
  };

  const getBarWidth = (value: number, fingerIndex: number) => {
    const { baseline, maxbend } = resolveCalibration(value, fingerIndex);
    const linear = (value - baseline) / (maxbend - baseline); // 0=straight, 1=bent
    const normalized = FLEX_SCURVE_ENABLED ? flexSmoothstep(linear) : Math.max(0, Math.min(1, linear));
    const display = 1 - normalized;     // invert: wide when straight
    return `${display * 100}%`;
  };

  const fingerNames = [
    t('fingers.thumb'), t('fingers.index'), t('fingers.middle'),
    t('fingers.ring'),  t('fingers.pinky'),
  ];

  return (
    <div className="sensor-display-container">
      <div className="sensor-display-header">
        <h3 className="sensor-display-title">{t('sensor.title')}</h3>
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
              {targetSamples <= 50
                ? (sampleCount >= 50 ? t('sensor.live') : t('sensor.filling'))
                : (isCollecting ? t('sensor.collecting') : t('sensor.idle'))}
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
                {t('sensor.buffer_cleared')}
              </span>
            )}
          </div>
          <div style={{ 
            fontSize: '0.9rem', 
            fontWeight: 600,
            color: isCollecting ? '#10b981' : '#64748b'
          }}>
            {targetSamples <= 50
              ? t('sensor.window', { current: sampleCount, target: targetSamples })
              : t('sensor.samples_counter', { current: sampleCount, target: targetSamples })}
          </div>
        </div>
      )}

      {!currentSample || currentSample.length === 0 ? (
        <p className="no-data-text">{t('sensor.no_data')}</p>
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

      {/* Legend - colors reflect normalized bend (0-33% straight, 33-66% partial, 66-100% bent) */}
      {currentSample && currentSample.length > 0 && (
        <div className="legend">
          <div className="legend-item">
            <div className="legend-dot red" />
            <span className="legend-text">{t('sensor.legend_bent')}</span>
          </div>
          <div className="legend-item">
            <div className="legend-dot yellow" />
            <span className="legend-text">{t('sensor.legend_partial')}</span>
          </div>
          <div className="legend-item">
            <div className="legend-dot green" />
            <span className="legend-text">{t('sensor.legend_straight')}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default SensorDisplay;

