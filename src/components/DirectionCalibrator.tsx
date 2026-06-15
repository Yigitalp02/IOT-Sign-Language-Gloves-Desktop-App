

export type DirectionKey = 'up' | 'forward' | 'down' | 'sideways';
export type DirectionRefs = Record<DirectionKey, [number,number,number,number] | null>;

interface Props {
  currentImu: { w: number; x: number; y: number; z: number } | null;
  directionRefs: DirectionRefs;
  currentDirection: DirectionKey | null; // live classified direction
  onRecord: (dir: DirectionKey) => void;
  onClear: (dir: DirectionKey) => void;
  onClearAll: () => void;
}

const DIR_LABELS: Record<DirectionKey, { emoji: string; label: string; hint: string }> = {
  up:       { emoji: '☝️',  label: 'Up',       hint: 'Hold hand with fingers pointing UP' },
  forward:  { emoji: '👉',  label: 'Forward',  hint: 'Hold hand with fingers pointing FORWARD (toward camera)' },
  down:     { emoji: '👇',  label: 'Down',     hint: 'Hold hand with fingers pointing DOWN' },
  sideways: { emoji: '➡️',  label: 'Sideways', hint: 'Hold hand with fingers pointing SIDEWAYS' },
};

const DIRS: DirectionKey[] = ['up', 'forward', 'down', 'sideways'];

export default function DirectionCalibrator({ currentImu, directionRefs, currentDirection, onRecord, onClear, onClearAll }: Props) {
  const anyCalibrated = DIRS.some(d => directionRefs[d] !== null);

  return (
    <div style={{
      background: 'var(--card-bg)',
      border: '1px solid var(--border-color)',
      borderRadius: '10px',
      padding: '0.85rem 1.25rem',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.7rem',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <p style={{ margin: 0, fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)' }}>
          Hand Direction Calibration
        </p>
        {anyCalibrated && (
          <button
            onClick={onClearAll}
            style={{ fontSize: '0.72rem', padding: '2px 8px', borderRadius: '5px', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}
          >
            Clear all
          </button>
        )}
      </div>
      <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
        Record a reference pose for each direction. The system will use these to disambiguate letter families (VHR, DG, LPQ…) without needing training-matched quaternions.
      </p>

      {/* Direction slots */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
        {DIRS.map(dir => {
          const { emoji, label, hint } = DIR_LABELS[dir];
          const ref = directionRefs[dir];
          const isActive = currentDirection === dir;
          return (
            <div
              key={dir}
              style={{
                border: `1px solid ${isActive ? 'var(--accent-color)' : 'var(--border-color)'}`,
                borderRadius: '8px',
                padding: '0.5rem 0.7rem',
                background: isActive ? 'rgba(99,102,241,0.07)' : 'transparent',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.3rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                  {emoji} {label}
                  {isActive && (
                    <span style={{ marginLeft: '0.4rem', fontSize: '0.7rem', color: 'var(--accent-color)', fontWeight: 700 }}>
                      ← NOW
                    </span>
                  )}
                </span>
                <div style={{ display: 'flex', gap: '0.3rem' }}>
                  <button
                    onClick={() => onRecord(dir)}
                    disabled={!currentImu}
                    title={hint}
                    style={{
                      fontSize: '0.72rem', padding: '2px 7px', borderRadius: '5px',
                      border: '1px solid var(--accent-color)',
                      background: ref ? 'rgba(99,102,241,0.12)' : 'transparent',
                      color: 'var(--accent-color)',
                      cursor: currentImu ? 'pointer' : 'not-allowed',
                      opacity: currentImu ? 1 : 0.4,
                    }}
                  >
                    {ref ? 'Re-record' : 'Record'}
                  </button>
                  {ref && (
                    <button
                      onClick={() => onClear(dir)}
                      style={{ fontSize: '0.72rem', padding: '2px 6px', borderRadius: '5px', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
              {ref ? (
                <span style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                  w:{ref[0].toFixed(3)} x:{ref[1].toFixed(3)} y:{ref[2].toFixed(3)} z:{ref[3].toFixed(3)}
                </span>
              ) : (
                <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                  Not set — {hint.toLowerCase()}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {!currentImu && (
        <p style={{ margin: 0, fontSize: '0.72rem', color: '#f59e0b', textAlign: 'center' }}>
          ⚠ Waiting for IMU data — connect the glove first
        </p>
      )}
    </div>
  );
}
