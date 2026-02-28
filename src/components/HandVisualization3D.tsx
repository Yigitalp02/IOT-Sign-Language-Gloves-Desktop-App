// src/components/HandVisualization3D.tsx
import { useMemo, useCallback, useState, useRef, useEffect } from 'react';
import Plot from 'react-plotly.js';
import { useTheme } from '../context/ThemeContext';
import './HandVisualization3D.css';

interface QuaternionData {
  w: number;
  x: number;
  y: number;
  z: number;
}

interface HandVisualization3DProps {
  currentSample: number[] | null;
  isActive: boolean;
  prediction?: string | null;
  confidence?: number | null;
  onTestSample?: (sample: number[]) => void;
  baselines?: number[];
  maxbends?: number[];
  quaternion?: QuaternionData | null;
}

// Hand skeleton structure - rotated so palm faces away from viewer
// Each finger has 4 points: palm origin (shared), knuckle, middle joint, tip
// Coordinates: [X (left-right), Y (up-down), Z (toward/away from viewer)]
  // X-Z plane is the floor, Y is vertical (up-down)
// All fingers start at (0,0,0) and spread from there
const HAND_SKELETON = {
  // Thumb (CH0) - extends to the side
  thumb: [
    [0, -0.8, 0],       // SHARED palm origin
    [0.9, 0.4, 0.1],      // thumb knuckle (extends to side)
    [1.2, 1, 0.2],    // thumb middle joint
    [1.35, 1.4, 0.3]      // thumb tip
  ],
  // Index (CH1) - points upward
  index: [
    [0, -0.8, 0],       // SHARED palm origin
    [0.35, 0.8, 0],      // index knuckle (at palm edge)
    [0.55, 1.5, 0],      // index middle joint
    [0.65, 2.3, 0]       // index tip
  ],
  // Middle (CH2) - points upward
  middle: [
    [0, -0.8, 0],       // SHARED palm origin
    [0, 0.8, -0.2],      // middle knuckle (at palm edge)
    [0, 1.6, -0.2],      // middle middle joint
    [0, 2.5, -0.2]       // middle tip
  ],
  // Ring (CH3) - points upward
  ring: [
    [0, -0.8, 0],       // SHARED palm origin
    [-0.35, 0.8, 0],     // ring knuckle (at palm edge)
    [-0.55, 1.55, 0],     // ring middle joint
    [-0.65, 2.6, 0]      // ring tip
  ],
  // Pinky (CH4) - points upward
  pinky: [
    [0, -0.8, 0],       // SHARED palm origin
    [-0.7, 0.7, 0.2],     // pinky knuckle (at palm edge)
    [-0.9, 1.25, 0.2],     // pinky middle joint
    [-1, 2, 0.2]      // pinky tip
  ]
};

// Default sensor calibration values (matches App.tsx)
// These are fallback values - the actual calibration comes from props
// Based on thermistor readings from properly worn glove
const DEFAULT_BASELINES = [2871, 1949, 2135, 2303, 2348]; // straight position (higher values)
const DEFAULT_MAXBENDS = [2832, 1922, 2105, 2279, 2323];  // fully bent position (lower values)

// Apply rotation to a point around Y-axis (finger bending)
const rotatePoint = (point: number[], angle: number, pivot: number[]): number[] => {
  const rad = (angle * Math.PI) / 180;
  const [x, y, z] = point;
  const [px, py, pz] = pivot;
  
  // Translate to pivot
  const tx = x - px;
  const ty = y - py;
  const tz = z - pz;
  
  // Rotate around X-axis (bending forward)
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const ry = ty * cos - tz * sin;
  const rz = ty * sin + tz * cos;
  
  // Translate back
  return [tx + px, ry + py, rz + pz];
};

// Quaternion multiply: a * b  (Hamilton product)
const quatMultiply = (a: QuaternionData, b: QuaternionData): QuaternionData => ({
  w: a.w*b.w - a.x*b.x - a.y*b.y - a.z*b.z,
  x: a.w*b.x + a.x*b.w + a.y*b.z - a.z*b.y,
  y: a.w*b.y - a.x*b.z + a.y*b.w + a.z*b.x,
  z: a.w*b.z + a.x*b.y - a.y*b.x + a.z*b.w,
});

// Quaternion inverse (conjugate for unit quaternion)
const quatInverse = (q: QuaternionData): QuaternionData => ({
  w: q.w, x: -q.x, y: -q.y, z: -q.z,
});

// Convert a unit quaternion (w, x, y, z) to a 3×3 rotation matrix (row-major)
const quaternionToMatrix = (w: number, x: number, y: number, z: number): number[][] => {
  return [
    [1 - 2*(y*y + z*z),   2*(x*y - w*z),     2*(x*z + w*y)  ],
    [2*(x*y + w*z),        1 - 2*(x*x + z*z), 2*(y*z - w*x)  ],
    [2*(x*z - w*y),        2*(y*z + w*x),     1 - 2*(x*x + y*y)]
  ];
};

// Apply a 3×3 rotation matrix to a 3D point
const applyMatrix = (mat: number[][], p: number[]): number[] => {
  return [
    mat[0][0]*p[0] + mat[0][1]*p[1] + mat[0][2]*p[2],
    mat[1][0]*p[0] + mat[1][1]*p[1] + mat[1][2]*p[2],
    mat[2][0]*p[0] + mat[2][1]*p[1] + mat[2][2]*p[2],
  ];
};

// Calculate bent finger positions
const calculateBentFinger = (finger: number[][], bendAngle: number): number[][] => {
  const result = [...finger.map(p => [...p])]; // Deep copy
  
  // For more dramatic bending, amplify the angle
  const amplifiedAngle = bendAngle * 1.5;
  
  // Distribute bend across the 2 actual joints (NOT the base segment from palm)
  // Point 0: Palm (never moves)
  // Point 1: Knuckle (never moves - it's anchored to palm)
  // Point 2: Middle joint (rotates around knuckle)
  // Point 3: Tip (rotates around knuckle AND middle joint)
  
  const knuckleBend = amplifiedAngle * 0.6;  // Bend at knuckle (point 1)
  const middleJointBend = amplifiedAngle * 0.5; // Bend at middle joint (point 2)
  
  // DON'T rotate anything around point 0 (palm)!
  // Point 0 and Point 1 stay fixed (the base segment from palm to knuckle)
  
  // Bend at knuckle (point 1) - affects points 2 and 3
  for (let i = 2; i < result.length; i++) {
    result[i] = rotatePoint(result[i], knuckleBend, result[1]);
  }
  
  // Bend at middle joint (point 2) - affects point 3 only
  if (result.length > 3) {
    result[3] = rotatePoint(result[3], middleJointBend, result[2]);
  }
  
  return result;
};

export default function HandVisualization3D({ 
  currentSample, 
  isActive, 
  prediction, 
  confidence,
  onTestSample,
  baselines = DEFAULT_BASELINES,
  maxbends = DEFAULT_MAXBENDS,
  quaternion = null
}: HandVisualization3DProps) {
  const { theme } = useTheme();

  // Reference quaternion for relative-rotation mode.
  // The hand rotates relative to this pose, so the 3D model starts in its
  // default position and only shows movements relative to the calibration pose.
  const [refQuat, setRefQuat] = useState<QuaternionData | null>(null);
  const refQuatRef = useRef<QuaternionData | null>(null);

  // Auto-set reference on the very first IMU packet received
  useEffect(() => {
    if (quaternion && !refQuatRef.current) {
      refQuatRef.current = quaternion;
      setRefQuat(quaternion);
    }
  }, [quaternion]);

  const handleSetReference = useCallback(() => {
    if (quaternion) {
      refQuatRef.current = quaternion;
      setRefQuat(quaternion);
    }
  }, [quaternion]);
  
  // Determine if dark mode is active
  const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  // Get CSS color values
  const bgCard = isDark ? '#1e293b' : '#ffffff';
  const borderColor = isDark ? 'rgba(255, 255, 255, 0.1)' : '#d1d5db';
  const textPrimary = isDark ? '#f1f5f9' : '#111827';
  const textSecondary = isDark ? '#94a3b8' : '#6b7280';

  // Map sensor value to bend angle using calibration values
  const sensorToAngle = useCallback((value: number, fingerIndex: number): number => {
    const baseline = baselines[fingerIndex];
    const maxbend = maxbends[fingerIndex];
    
    // Normalize: 0 at baseline (straight), 1 at maxbend (fully bent)
    const normalized = Math.max(0, Math.min(1, (value - baseline) / (maxbend - baseline)));
    
    // Convert to bend angle: 0° straight, 90° fully bent
    return normalized * 90;
  }, [baselines, maxbends]);

  const plotData = useMemo(() => {
    // Default hand position if no data yet - use baseline values (straight fingers)
    const defaultSample = baselines; // Use calibration baselines
    const sampleToUse = currentSample && currentSample.length >= 5 ? currentSample : defaultSample;

    // Calculate bend angles for each finger using per-finger calibration
    const bendAngles = sampleToUse.map((value, index) => sensorToAngle(value, index));

    // Apply bending to each finger
    const bentThumb = calculateBentFinger(HAND_SKELETON.thumb, bendAngles[0]);
    const bentIndex = calculateBentFinger(HAND_SKELETON.index, bendAngles[1]);
    const bentMiddle = calculateBentFinger(HAND_SKELETON.middle, bendAngles[2]);
    const bentRing = calculateBentFinger(HAND_SKELETON.ring, bendAngles[3]);
    const bentPinky = calculateBentFinger(HAND_SKELETON.pinky, bendAngles[4]);

    // Apply IMU quaternion rotation to all finger points (if BNO055 is available)
    //
    // Strategy:
    //   1. q_rel   = inverse(refQuat) × q_current      — removes absolute sensor offset
    //   2. q_viz   = remap axes (cyclic permutation)   — aligns BNO055 axes with viz axes
    //   3. q_final = q_viz × Q_TARGET                  — Q_TARGET applied first (palm-down home),
    //                                                     then q_viz on top in world frame
    //
    // BNO055 mounting (palm-down calibration pose):
    //   BNO055 X  →  along fingers          →  viz  +Z
    //   BNO055 Y  →  across hand width      →  viz  +X   ← wrist-ext axis (stop sign)
    //   BNO055 Z  →  palm normal (upward)   →  viz  +Y
    // Cyclic permutation: (bno_x, bno_y, bno_z) → (bno_y, bno_z, bno_x) = (viz_x, viz_y, viz_z)
    //
    // Q_TARGET = +90° around viz X:  puts default model into palm-down pose
    //   • fingers +Y → +Z  (toward viewer, flat on floor plane)
    //   • palm    +Z → −Y  (palm faces the floor ↓)
    const Q_TARGET: QuaternionData = { w: Math.SQRT1_2, x: Math.SQRT1_2, y: 0, z: 0 };

    const allFingers = [bentThumb, bentIndex, bentMiddle, bentRing, bentPinky];
    let rotatedFingers = allFingers;
    if (quaternion && refQuat) {
      const { w, x, y, z } = quaternion;
      const mag = Math.sqrt(w*w + x*x + y*y + z*z);
      if (mag > 0.9) {
        // Normalise incoming quaternion
        const qCurrent: QuaternionData = { w: w/mag, x: x/mag, y: y/mag, z: z/mag };
        // Relative rotation in BNO055 sensor frame
        const qRel = quatMultiply(quatInverse(refQuat), qCurrent);
        // Remap BNO055 axes → visualization axes (cyclic permutation)
        const qRelViz: QuaternionData = { w: qRel.w, x: qRel.y, y: qRel.z, z: qRel.x };
        // q_final = q_viz × Q_TARGET
        //   Q_TARGET first  → model into palm-down
        //   q_viz after     → physical rotation applied in world frame on top
        const qFinal = quatMultiply(qRelViz, Q_TARGET);
        const rotMat = quaternionToMatrix(qFinal.w, qFinal.x, qFinal.y, qFinal.z);
        rotatedFingers = allFingers.map(finger =>
          finger.map(point => applyMatrix(rotMat, point))
        );
      }
    }

    // Create line traces for each finger
    const fingers = [
      { name: 'Thumb (CH0)', data: rotatedFingers[0], color: '#ef4444' },
      { name: 'Index (CH1)', data: rotatedFingers[1], color: '#f59e0b' },
      { name: 'Middle (CH2)', data: rotatedFingers[2], color: '#10b981' },
      { name: 'Ring (CH3)', data: rotatedFingers[3], color: '#3b82f6' },
      { name: 'Pinky (CH4)', data: rotatedFingers[4], color: '#8b5cf6' }
    ];

    return fingers.map(finger => ({
      type: 'scatter3d' as const,
      mode: 'lines+markers' as const,
      name: finger.name,
      x: finger.data.map(p => p[0]),
      y: finger.data.map(p => p[1]),
      z: finger.data.map(p => p[2]),
      line: {
        color: finger.color,
        width: 6
      },
      marker: {
        size: 6,
        color: finger.color,
        symbol: 'circle'
      }
    }));
  }, [currentSample, baselines, sensorToAngle, quaternion, refQuat]);

  const title = prediction && confidence 
    ? `Prediction: ${prediction} | Conf: ${Math.round(confidence * 100)}%`
    : isActive ? 'Real-Time Hand Pose' : 'Waiting for data...';

  return (
    <div className="hand-viz-container" style={{ 
      backgroundColor: bgCard, 
      borderColor: borderColor 
    }}>
      <div className="hand-viz-header">
        <h3 className="hand-viz-title" style={{ color: textPrimary }}>
          3D Hand Visualization
        </h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {quaternion && (
            <>
              <span style={{
                fontSize: '0.7rem',
                fontWeight: 700,
                padding: '2px 6px',
                borderRadius: '4px',
                background: 'rgba(99, 102, 241, 0.15)',
                color: '#818cf8',
                border: '1px solid rgba(99, 102, 241, 0.4)',
                letterSpacing: '0.04em'
              }}>
                IMU
              </span>
              <button
                onClick={handleSetReference}
                title="Hold your hand palm-down (flat, parallel to the floor) then click to set reference pose"
                style={{
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  padding: '2px 7px',
                  borderRadius: '4px',
                  background: refQuat ? 'rgba(16,185,129,0.12)' : 'rgba(251,146,60,0.12)',
                  color: refQuat ? '#34d399' : '#fb923c',
                  border: `1px solid ${refQuat ? 'rgba(52,211,153,0.4)' : 'rgba(251,146,60,0.4)'}`,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap'
                }}
              >
                {refQuat ? '📍 Re-calibrate' : '📍 Set Reference'}
              </button>
            </>
          )}
          <div
            className="hand-viz-status-dot"
            style={{ backgroundColor: isActive ? '#10b981' : textSecondary }}
          />
        </div>
      </div>

      <div className="hand-viz-plot">
        <Plot
          data={plotData}
          layout={
            {
              title: { text: title },
              uirevision: 'true',
              scene: {
                xaxis: { 
                  title: { text: 'X (Floor)' },
                  range: [-5, 5],
                  gridcolor: isDark ? '#374151' : '#e5e7eb',
                  zerolinecolor: isDark ? '#4b5563' : '#d1d5db',
                  autorange: false
                },
                yaxis: { 
                  title: { text: 'Y (Vertical)' },
                  range: [-3, 3],
                  gridcolor: isDark ? '#374151' : '#e5e7eb',
                  zerolinecolor: isDark ? '#4b5563' : '#d1d5db',
                  autorange: false
                },
                zaxis: { 
                  title: { text: 'Z (Floor)' },
                  range: [-3, 3],
                  gridcolor: isDark ? '#374151' : '#e5e7eb',
                  zerolinecolor: isDark ? '#4b5563' : '#d1d5db',
                  autorange: false
                },
                camera: {
                  // Slightly above and in front — good viewpoint for a palm-down hand
                  eye: { x: 1.2, y: 2.5, z: 2.5 },
                  up: { x: 0, y: 1, z: 0 }
                },
                bgcolor: isDark ? '#1e293b' : '#f9fafb',
                dragmode: 'orbit',
                aspectmode: 'manual',
                aspectratio: { x: 1, y: 1, z: 1 }
              },
              paper_bgcolor: bgCard,
              plot_bgcolor: bgCard,
              showlegend: true,
              legend: {
                font: {
                  color: textSecondary,
                  size: 11
                },
                bgcolor: isDark ? 'rgba(30, 41, 59, 0.8)' : 'rgba(249, 250, 251, 0.8)',
                bordercolor: borderColor,
                borderwidth: 1
              },
              margin: { l: 0, r: 0, t: 40, b: 0 },
              autosize: true
            } as any
          }
          config={{
            displayModeBar: true,
            displaylogo: false,
            modeBarButtonsToRemove: ['toImage', 'sendDataToCloud'],
            responsive: true
          }}
          style={{ width: '100%', height: '400px' }}
        />
      </div>

      {!isActive && (
        <p className="hand-viz-hint" style={{ color: textSecondary }}>
          Start the simulator or connect a glove to see real-time hand pose
        </p>
      )}

      {/* Test pose buttons */}
      {onTestSample && (
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={() => onTestSample([2700, 1650, 1850, 2110, 2125])} // BASELINES - straight
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '6px',
              border: '1px solid ' + borderColor,
              background: bgCard,
              color: textPrimary,
              fontSize: '0.875rem',
              cursor: 'pointer'
            }}
          >
            🖐️ Straight
          </button>
          <button
            onClick={() => onTestSample([2200, 1300, 1480, 1640, 1720])} // MAXBENDS - fully bent
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '6px',
              border: '1px solid ' + borderColor,
              background: bgCard,
              color: textPrimary,
              fontSize: '0.875rem',
              cursor: 'pointer'
            }}
          >
            ✊ Bent
          </button>
        </div>
      )}
    </div>
  );
}

