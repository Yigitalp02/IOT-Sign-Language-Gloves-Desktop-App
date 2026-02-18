// src/components/HandVisualization3D.tsx
import { useMemo } from 'react';
import Plot from 'react-plotly.js';
import { useTheme } from '../context/ThemeContext';
import './HandVisualization3D.css';

interface HandVisualization3DProps {
  currentSample: number[] | null;
  isActive: boolean;
  prediction?: string | null;
  confidence?: number | null;
  onTestSample?: (sample: number[]) => void; // New callback to test samples
}

// Hand skeleton structure - rotated so palm faces away from viewer
// Each finger has 4 points: palm origin (shared), knuckle, middle joint, tip
// Coordinates: [X (left-right), Y (up-down), Z (toward/away from viewer)]
  // X-Z plane is the floor, Y is vertical (up-down)
// All fingers start at (0,0,0) and spread from there
const HAND_SKELETON = {
  // Thumb (CH0) - extends to the side
  thumb: [
    [0, -0.8, -2],       // SHARED palm origin
    [0.9, 0.4, -1.9],      // thumb knuckle (extends to side)
    [1.2, 1, -1.8],    // thumb middle joint
    [1.35, 1.4, -1.7]      // thumb tip
  ],
  // Index (CH1) - points upward
  index: [
    [0, -0.8, -2],       // SHARED palm origin
    [0.35, 0.8, -2],      // index knuckle (at palm edge)
    [0.55, 1.5, -2],      // index middle joint
    [0.65, 2.3, -2]       // index tip
  ],
  // Middle (CH2) - points upward
  middle: [
    [0, -0.8, -2],       // SHARED palm origin
    [0, 0.8, -2.2],      // middle knuckle (at palm edge)
    [0, 1.6, -2.2],      // middle middle joint
    [0, 2.5, -2.2]       // middle tip
  ],
  // Ring (CH3) - points upward
  ring: [
    [0, -0.8, -2],       // SHARED palm origin
    [-0.35, 0.8, -2],     // ring knuckle (at palm edge)
    [-0.55, 1.55, -2],     // ring middle joint
    [-0.65, 2.6, -2]      // ring tip
  ],
  // Pinky (CH4) - points upward
  pinky: [
    [0, -0.8, -2],       // SHARED palm origin
    [-0.7, 0.7, -1.8],     // pinky knuckle (at palm edge)
    [-0.9, 1.25, -1.8],     // pinky middle joint
    [-1, 2, -1.8]      // pinky tip
  ]
};

// Sensor calibration values (from SimulatorControl)
const BASELINES = [440, 612, 618, 548, 528]; // thumb, index, middle, ring, pinky (straight)
const MAXBENDS = [600, 900, 900, 850, 760];   // fully bent

// Map sensor value (0-1023) to bend angle (0-90 degrees)
// Higher sensor value = more bent
const sensorToAngle = (value: number, fingerIndex: number): number => {
  const baseline = BASELINES[fingerIndex];
  const maxbend = MAXBENDS[fingerIndex];
  
  // Normalize: 0 at baseline (straight), 1 at maxbend (fully bent)
  const normalized = Math.max(0, Math.min(1, (value - baseline) / (maxbend - baseline)));
  
  // Convert to bend angle: 0° straight, 90° fully bent
  return normalized * 90;
};

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
  onTestSample
}: HandVisualization3DProps) {
  const { theme } = useTheme();
  
  // Determine if dark mode is active
  const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  // Get CSS color values
  const bgCard = isDark ? '#1e293b' : '#ffffff';
  const borderColor = isDark ? 'rgba(255, 255, 255, 0.1)' : '#d1d5db';
  const textPrimary = isDark ? '#f1f5f9' : '#111827';
  const textSecondary = isDark ? '#94a3b8' : '#6b7280';

  const plotData = useMemo(() => {
    // Default hand position if no data yet - use baseline values (straight fingers)
    const defaultSample = [440, 612, 618, 548, 528]; // BASELINES - completely straight hand
    const sampleToUse = currentSample && currentSample.length >= 5 ? currentSample : defaultSample;

    // Calculate bend angles for each finger using per-finger calibration
    const bendAngles = sampleToUse.map((value, index) => sensorToAngle(value, index));

    // Apply bending to each finger
    const bentThumb = calculateBentFinger(HAND_SKELETON.thumb, bendAngles[0]);
    const bentIndex = calculateBentFinger(HAND_SKELETON.index, bendAngles[1]);
    const bentMiddle = calculateBentFinger(HAND_SKELETON.middle, bendAngles[2]);
    const bentRing = calculateBentFinger(HAND_SKELETON.ring, bendAngles[3]);
    const bentPinky = calculateBentFinger(HAND_SKELETON.pinky, bendAngles[4]);

    // Create line traces for each finger
    const fingers = [
      { name: 'Thumb (CH0)', data: bentThumb, color: '#ef4444' },
      { name: 'Index (CH1)', data: bentIndex, color: '#f59e0b' },
      { name: 'Middle (CH2)', data: bentMiddle, color: '#10b981' },
      { name: 'Ring (CH3)', data: bentRing, color: '#3b82f6' },
      { name: 'Pinky (CH4)', data: bentPinky, color: '#8b5cf6' }
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
  }, [currentSample]);

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
        <div
          className="hand-viz-status-dot"
          style={{ backgroundColor: isActive ? '#10b981' : textSecondary }}
        />
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
                  range: [-2, 2.5],
                  gridcolor: isDark ? '#374151' : '#e5e7eb',
                  zerolinecolor: isDark ? '#4b5563' : '#d1d5db',
                  autorange: false
                },
                yaxis: { 
                  title: { text: 'Y (Vertical)' },
                  range: [-1, 3],
                  gridcolor: isDark ? '#374151' : '#e5e7eb',
                  zerolinecolor: isDark ? '#4b5563' : '#d1d5db',
                  autorange: false
                },
                zaxis: { 
                  title: { text: 'Z (Floor)' },
                  range: [-4, 1],
                  gridcolor: isDark ? '#374151' : '#e5e7eb',
                  zerolinecolor: isDark ? '#4b5563' : '#d1d5db',
                  autorange: false
                },
                camera: {
                  eye: { x: 1.5, y: 2, z: 0.5 },
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
            onClick={() => onTestSample([440, 612, 618, 548, 528])} // BASELINES - straight
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
            onClick={() => onTestSample([600, 900, 900, 850, 760])} // MAXBENDS - fully bent
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

