// src/components/HandVisualization3D.tsx
// Uses Three.js + OrbitControls for 3D rendering.
// The camera is owned entirely by OrbitControls and is NEVER touched by React
// renders or data updates — finger geometry updates happen directly on the GPU
// buffers without affecting the camera state.
import { useCallback, useState, useRef, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { useTheme } from '../context/ThemeContext';
import './HandVisualization3D.css';

interface QuaternionData { w: number; x: number; y: number; z: number; }

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

const HAND_SKELETON = {
  thumb:  [[0,-0.8,0],[0.9,0.4,0.1],[1.2,1,0.2],[1.35,1.4,0.3]],
  index:  [[0,-0.8,0],[0.35,0.8,0],[0.55,1.5,0],[0.65,2.3,0]],
  middle: [[0,-0.8,0],[0,0.8,-0.2],[0,1.6,-0.2],[0,2.5,-0.2]],
  ring:   [[0,-0.8,0],[-0.35,0.8,0],[-0.55,1.55,0],[-0.65,2.6,0]],
  pinky:  [[0,-0.8,0],[-0.7,0.7,0.2],[-0.9,1.25,0.2],[-1,2,0.2]],
};

const FINGER_COLORS = [0xef4444, 0xf59e0b, 0x10b981, 0x3b82f6, 0x8b5cf6];
const FINGER_NAMES  = ['Thumb','Index','Middle','Ring','Pinky'];

const DEFAULT_BASELINES = [2871, 1949, 2135, 2303, 2348];
const DEFAULT_MAXBENDS  = [2832, 1922, 2105, 2279, 2323];

// ── Pure math helpers (no React) ──────────────────────────────────────────────
const rotatePoint = (point: number[], angle: number, pivot: number[]): number[] => {
  const rad = (angle * Math.PI) / 180;
  const [tx, ty, tz] = [point[0]-pivot[0], point[1]-pivot[1], point[2]-pivot[2]];
  const cos = Math.cos(rad), sin = Math.sin(rad);
  return [tx+pivot[0], ty*cos-tz*sin+pivot[1], ty*sin+tz*cos+pivot[2]];
};

const calculateBentFinger = (finger: number[][], bendAngle: number): number[][] => {
  const r = finger.map(p => [...p]);
  const amp = bendAngle * 1.5;
  for (let i = 2; i < r.length; i++) r[i] = rotatePoint(r[i], amp*0.6, r[1]);
  if (r.length > 3) r[3] = rotatePoint(r[3], amp*0.5, r[2]);
  return r;
};

const quatMultiply = (a: QuaternionData, b: QuaternionData): QuaternionData => ({
  w: a.w*b.w - a.x*b.x - a.y*b.y - a.z*b.z,
  x: a.w*b.x + a.x*b.w + a.y*b.z - a.z*b.y,
  y: a.w*b.y - a.x*b.z + a.y*b.w + a.z*b.x,
  z: a.w*b.z + a.x*b.y - a.y*b.x + a.z*b.w,
});
const quatInverse = (q: QuaternionData): QuaternionData => ({ w:q.w, x:-q.x, y:-q.y, z:-q.z });
const quaternionToMatrix = (w:number,x:number,y:number,z:number): number[][] => ([
  [1-2*(y*y+z*z), 2*(x*y-w*z),   2*(x*z+w*y)  ],
  [2*(x*y+w*z),   1-2*(x*x+z*z), 2*(y*z-w*x)  ],
  [2*(x*z-w*y),   2*(y*z+w*x),   1-2*(x*x+y*y)],
]);
const applyMatrix = (mat: number[][], p: number[]): number[] => ([
  mat[0][0]*p[0]+mat[0][1]*p[1]+mat[0][2]*p[2],
  mat[1][0]*p[0]+mat[1][1]*p[1]+mat[1][2]*p[2],
  mat[2][0]*p[0]+mat[2][1]*p[1]+mat[2][2]*p[2],
]);

const Q_TARGET: QuaternionData = { w: Math.SQRT1_2, x: Math.SQRT1_2, y: 0, z: 0 };

// ── Component ─────────────────────────────────────────────────────────────────
export default function HandVisualization3D({
  currentSample, isActive, prediction, confidence,
  onTestSample,
  baselines = DEFAULT_BASELINES,
  maxbends  = DEFAULT_MAXBENDS,
  quaternion = null,
}: HandVisualization3DProps) {
  const { theme } = useTheme();
  const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  const canvasRef  = useRef<HTMLDivElement>(null);
  const threeRef   = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    lines: THREE.Line[];
    joints: THREE.Mesh[][];
    rafId: number;
    axisGroup: THREE.Group;
  } | null>(null);

  const [showAxes, setShowAxes] = useState(true);
  const [refQuat, setRefQuat] = useState<QuaternionData | null>(null);
  const refQuatRef = useRef<QuaternionData | null>(null);

  useEffect(() => {
    if (quaternion && !refQuatRef.current) {
      refQuatRef.current = quaternion;
      setRefQuat(quaternion);
    }
  }, [quaternion]);

  const handleSetReference = useCallback(() => {
    if (quaternion) { refQuatRef.current = quaternion; setRefQuat(quaternion); }
  }, [quaternion]);

  // colours derived from theme
  const bgColor   = isDark ? 0x1e293b : 0xf9fafb;
  const gridColor = isDark ? 0x374151 : 0xe5e7eb;

  // ── Three.js init (runs once on mount) ────────────────────────────────────
  useEffect(() => {
    const container = canvasRef.current;
    if (!container) return;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setClearColor(bgColor);
    container.appendChild(renderer.domElement);

    // Scene & camera — match the old Plotly eye=(1.2,2.5,2.5) feel
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(55, container.clientWidth / container.clientHeight, 0.1, 100);
    camera.position.set(3.5, 5.0, 6.5);

    // Orbit controls — these own the camera entirely
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(0.1, 0.5, 0);
    controls.update();

    // ── Axes + grid group (toggled by the Axes button) ─────────────────────
    const axisGroup = new THREE.Group();
    scene.add(axisGroup);

    // Floor grid — always visible, not part of the toggle group
    const grid = new THREE.GridHelper(5, 5, gridColor, gridColor);
    grid.position.y = -1.4;
    scene.add(grid);

    const FLOOR_Y = -1.4;
    const LABEL_COLOR = '#8b9bb4';

    // Helper: render text to a canvas sprite
    const makeLabel = (text: string, scale = 0.9): THREE.Sprite => {
      const cvs = document.createElement('canvas');
      cvs.width = 512; cvs.height = 128;
      const ctx = cvs.getContext('2d')!;
      ctx.font = '600 56px system-ui,sans-serif';
      ctx.fillStyle = LABEL_COLOR;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 256, 64);
      const tex = new THREE.CanvasTexture(cvs);
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
      const sp  = new THREE.Sprite(mat);
      sp.scale.set(scale, scale * (128 / 512), 1);
      return sp;
    };

    // Helper: draw an axis line into the group
    const addAxisLine = (from: [number,number,number], to: [number,number,number], color: number) => {
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(...from), new THREE.Vector3(...to),
      ]);
      axisGroup.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color })));
    };

    // X axis (red) — runs along the floor
    addAxisLine([-2.5, FLOOR_Y, 0], [2.5, FLOOR_Y, 0], 0xef4444);
    const xLabel = makeLabel('X (Floor)', 1.5);
    xLabel.position.set(3.2, FLOOR_Y, 0);
    axisGroup.add(xLabel);
    [-2, -1, 0, 1, 2].forEach(v => {
      const sp = makeLabel(String(v), 1.44);
      sp.position.set(v, FLOOR_Y - 0.45, 0);
      axisGroup.add(sp);
    });

    // Y axis (green) — vertical
    addAxisLine([0, FLOOR_Y, 0], [0, 3.2, 0], 0x10b981);
    const yLabel = makeLabel('Y (Vertical)', 1.5);
    yLabel.position.set(-1.1, 3.6, 0);
    axisGroup.add(yLabel);
    [-1, 0, 1, 2, 3].forEach(v => {
      const sp = makeLabel(String(v), 1.44);
      sp.position.set(-0.75, v, 0);
      axisGroup.add(sp);
    });

    // Z axis (blue) — runs along the floor
    addAxisLine([0, FLOOR_Y, -2.5], [0, FLOOR_Y, 2.5], 0x3b82f6);
    const zLabel = makeLabel('Z (Floor)', 1.5);
    zLabel.position.set(0, FLOOR_Y, 3.2);
    axisGroup.add(zLabel);
    [-2, -1, 0, 1, 2].forEach(v => {
      const sp = makeLabel(String(v), 1.44);
      sp.position.set(0, FLOOR_Y - 0.45, v);
      axisGroup.add(sp);
    });

    // Lights
    scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const dir = new THREE.DirectionalLight(0xffffff, 0.5);
    dir.position.set(3, 6, 5);
    scene.add(dir);

    // Palm pad — flat cylinder so the finger bases look grounded
    const palmGeo = new THREE.CylinderGeometry(0.85, 0.85, 0.06, 24);
    const palmMat = new THREE.MeshPhongMaterial({ color: 0x64748b, opacity: 0.35, transparent: true });
    const palm = new THREE.Mesh(palmGeo, palmMat);
    palm.position.set(0.05, -0.62, 0.02);
    scene.add(palm);

    // Finger lines + joint spheres
    const lines: THREE.Line[] = [];
    const joints: THREE.Mesh[][] = [];
    const skeletonArrays = [
      HAND_SKELETON.thumb, HAND_SKELETON.index, HAND_SKELETON.middle,
      HAND_SKELETON.ring,  HAND_SKELETON.pinky,
    ];

    // Map from sphere UUID → display info for the hover tooltip
    const jointMeta = new Map<string, { finger: string; channel: number }>();

    skeletonArrays.forEach((finger, fi) => {
      const color = FINGER_COLORS[fi];

      // Line (use tube for thickness since linewidth is ignored in WebGL)
      const pts = finger.map(p => new THREE.Vector3(p[0], p[1], p[2]));
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const mat = new THREE.LineBasicMaterial({ color, linewidth: 2 });
      const line = new THREE.Line(geo, mat);
      scene.add(line);
      lines.push(line);

      // Joint spheres — larger at knuckle, smaller at tip
      const fingerJoints: THREE.Mesh[] = [];
      finger.forEach((p, pi) => {
        const radius = pi === 0 ? 0.10 : pi === 1 ? 0.09 : 0.07;
        const sphere = new THREE.Mesh(
          new THREE.SphereGeometry(radius, 12, 12),
          new THREE.MeshPhongMaterial({ color }),
        );
        sphere.position.set(p[0], p[1], p[2]);
        scene.add(sphere);
        fingerJoints.push(sphere);
        jointMeta.set(sphere.uuid, { finger: FINGER_NAMES[fi], channel: fi });
      });
      joints.push(fingerJoints);
    });

    // ── Hover tooltip ──────────────────────────────────────────────────────────
    container.style.position = 'relative';
    const tooltip = document.createElement('div');
    tooltip.style.cssText = [
      'position:absolute',
      'display:none',
      'background:rgba(15,23,42,0.92)',
      'border:1px solid rgba(255,255,255,0.14)',
      'border-radius:7px',
      'padding:7px 11px',
      'font:500 13px/1.7 system-ui,sans-serif',
      'color:#f1f5f9',
      'pointer-events:none',
      'z-index:50',
      'white-space:nowrap',
      'backdrop-filter:blur(6px)',
    ].join(';');
    container.appendChild(tooltip);

    const raycaster = new THREE.Raycaster();
    raycaster.params.Line = { threshold: 0.05 };
    const mouse = new THREE.Vector2();

    const onMouseMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      mouse.x =  ((e.clientX - rect.left)  / container.clientWidth)  * 2 - 1;
      mouse.y = -((e.clientY - rect.top)   / container.clientHeight) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObjects(joints.flat());

      if (hits.length > 0) {
        const { object, point } = hits[0];
        const meta = jointMeta.get(object.uuid);
        if (meta) {
          const color = `#${FINGER_COLORS[meta.channel].toString(16).padStart(6, '0')}`;
          tooltip.innerHTML =
            `x: ${point.x.toFixed(2)}<br>` +
            `y: ${point.y.toFixed(2)}<br>` +
            `z: ${point.z.toFixed(2)}<br>` +
            `<span style="color:${color};font-weight:700">${meta.finger} (CH${meta.channel})</span>`;
          tooltip.style.display = 'block';
          // Keep tooltip inside the container bounds
          const tx = Math.min(e.clientX - rect.left + 14, container.clientWidth - 160);
          const ty = Math.max(e.clientY - rect.top  - 14, 4);
          tooltip.style.left = tx + 'px';
          tooltip.style.top  = ty + 'px';
        }
      } else {
        tooltip.style.display = 'none';
      }
    };

    const onMouseLeave = () => { tooltip.style.display = 'none'; };
    renderer.domElement.addEventListener('mousemove', onMouseMove);
    renderer.domElement.addEventListener('mouseleave', onMouseLeave);

    // Render loop — OrbitControls.update() + renderer.render() only
    const animate = () => {
      const id = requestAnimationFrame(animate);
      threeRef.current!.rafId = id;
      controls.update();
      renderer.render(scene, camera);
    };
    const rafId = requestAnimationFrame(animate);

    // Resize observer
    const ro = new ResizeObserver(() => {
      if (!container) return;
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    });
    ro.observe(container);

    threeRef.current = { renderer, scene, camera, controls, lines, joints, rafId, axisGroup };

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener('mousemove', onMouseMove);
      renderer.domElement.removeEventListener('mouseleave', onMouseLeave);
      renderer.dispose();
      if (container.contains(tooltip)) container.removeChild(tooltip);
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
      threeRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Update background/grid color on theme change ───────────────────────────
  useEffect(() => {
    if (!threeRef.current) return;
    threeRef.current.renderer.setClearColor(bgColor);
  }, [bgColor]);

  // ── Toggle axes/grid visibility ────────────────────────────────────────────
  useEffect(() => {
    if (!threeRef.current) return;
    threeRef.current.axisGroup.visible = showAxes;
  }, [showAxes]);

  // ── Compute finger positions ───────────────────────────────────────────────
  const fingerPoints = useMemo(() => {
    const sampleToUse = currentSample?.length === 5 ? currentSample : baselines;

    const bendAngles = sampleToUse.map((v, i) => {
      const n = Math.max(0, Math.min(1, (v - baselines[i]) / (maxbends[i] - baselines[i])));
      return n * 90;
    });

    const skeletonArrays = [
      HAND_SKELETON.thumb, HAND_SKELETON.index, HAND_SKELETON.middle,
      HAND_SKELETON.ring,  HAND_SKELETON.pinky,
    ];
    let fingers = skeletonArrays.map((f, i) => calculateBentFinger(f, bendAngles[i]));

    // Apply IMU rotation if available
    if (quaternion && refQuat) {
      const { w, x, y, z } = quaternion;
      const mag = Math.sqrt(w*w + x*x + y*y + z*z);
      if (mag > 0.9) {
        const qC: QuaternionData = { w:w/mag, x:x/mag, y:y/mag, z:z/mag };
        const qRel = quatMultiply(quatInverse(refQuat), qC);
        const qRelViz: QuaternionData = { w:qRel.w, x:qRel.y, y:qRel.z, z:qRel.x };
        const qFinal = quatMultiply(qRelViz, Q_TARGET);
        const mat = quaternionToMatrix(qFinal.w, qFinal.x, qFinal.y, qFinal.z);
        fingers = fingers.map(f => f.map(p => applyMatrix(mat, p)));
      }
    }

    return fingers;
  }, [currentSample, baselines, maxbends, quaternion, refQuat]);

  // ── Push new geometry to GPU — camera is never touched ────────────────────
  useEffect(() => {
    const t = threeRef.current;
    if (!t) return;

    fingerPoints.forEach((finger, fi) => {
      // Update line
      const positions = t.lines[fi].geometry.attributes.position;
      finger.forEach((p, pi) => {
        positions.setXYZ(pi, p[0], p[1], p[2]);
      });
      positions.needsUpdate = true;
      t.lines[fi].geometry.computeBoundingSphere();

      // Update joints
      finger.forEach((p, pi) => {
        t.joints[fi][pi].position.set(p[0], p[1], p[2]);
      });
    });
  }, [fingerPoints]);

  const bgCard     = isDark ? 'rgba(30,41,59,0.7)' : '#ffffff';
  const borderColor = isDark ? 'rgba(255,255,255,0.1)' : '#d1d5db';
  const textPrimary = isDark ? '#f1f5f9' : '#111827';
  const textSecondary = isDark ? '#94a3b8' : '#6b7280';

  const title = prediction && confidence
    ? `${prediction}  ${Math.round(confidence * 100)}%`
    : isActive ? 'Real-Time Hand Pose' : 'Waiting for data...';

  return (
    <div className="hand-viz-container" style={{ backgroundColor: bgCard, borderColor }}>
      <div className="hand-viz-header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <div>
            <h3 className="hand-viz-title" style={{ color: textPrimary, margin: 0 }}>
              3D Hand Visualization
            </h3>
            {prediction && confidence ? (
              <span style={{ fontSize: '0.82rem', color: '#ffffff', fontWeight: 500 }}>
                Prediction: <strong style={{ color: '#f1f5f9' }}>{prediction}</strong>
                <span style={{ color: isDark ? '#475569' : '#d1d5db', margin: '0 6px' }}>|</span>
                Confidence: <strong style={{ color: '#f1f5f9' }}>{Math.round(confidence * 100)}%</strong>
              </span>
            ) : (
              <span style={{ fontSize: '0.8rem', color: textSecondary }}>{title}</span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {/* Axes toggle */}
            <button
              onClick={() => setShowAxes(v => !v)}
              title={showAxes ? 'Hide axes & grid' : 'Show axes & grid'}
              style={{ fontSize:'0.7rem', fontWeight:600, padding:'2px 7px', borderRadius:'4px', cursor:'pointer', whiteSpace:'nowrap',
                background: showAxes ? 'rgba(99,102,241,0.15)' : 'rgba(100,116,139,0.12)',
                color:      showAxes ? '#818cf8'               : '#94a3b8',
                border:     `1px solid ${showAxes ? 'rgba(99,102,241,0.4)' : 'rgba(100,116,139,0.3)'}`,
              }}>
              {showAxes ? '📐 Axes On' : '📐 Axes Off'}
            </button>
            {quaternion && (
              <>
                <span style={{ fontSize:'0.7rem', fontWeight:700, padding:'2px 6px', borderRadius:'4px', background:'rgba(99,102,241,0.15)', color:'#818cf8', border:'1px solid rgba(99,102,241,0.4)', letterSpacing:'0.04em' }}>IMU</span>
                <button onClick={handleSetReference} title="Hold hand palm-down then click"
                  style={{ fontSize:'0.7rem', fontWeight:600, padding:'2px 7px', borderRadius:'4px', background: refQuat ? 'rgba(16,185,129,0.12)' : 'rgba(251,146,60,0.12)', color: refQuat ? '#34d399' : '#fb923c', border:`1px solid ${refQuat ? 'rgba(52,211,153,0.4)' : 'rgba(251,146,60,0.4)'}`, cursor:'pointer', whiteSpace:'nowrap' }}>
                  {refQuat ? '📍 Re-calibrate' : '📍 Set Reference'}
                </button>
              </>
            )}
            <div className="hand-viz-status-dot" style={{ backgroundColor: isActive ? '#10b981' : textSecondary }} />
          </div>
        </div>
      </div>

      {/* Three.js canvas + floating legend overlay */}
      <div className="hand-viz-plot" style={{ position: 'relative' }}>
        <div ref={canvasRef} style={{ width: '100%', height: '400px' }} />

        {/* Finger legend — floats top-right inside the canvas, like the old Plotly version */}
        <div style={{
          position: 'absolute', top: 12, right: 12,
          background: isDark ? 'rgba(15,23,42,0.75)' : 'rgba(255,255,255,0.82)',
          border: `1px solid ${borderColor}`,
          borderRadius: 8, padding: '8px 12px',
          display: 'flex', flexDirection: 'column', gap: 5,
          backdropFilter: 'blur(6px)',
          pointerEvents: 'none',
        }}>
          {FINGER_NAMES.map((name, i) => (
            <span key={name} style={{ fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: 7 }}>
              {/* colour swatch that matches Plotly's thick line appearance */}
              <span style={{ width: 18, height: 4, borderRadius: 2, background: `#${FINGER_COLORS[i].toString(16).padStart(6,'0')}`, display: 'inline-block', flexShrink: 0 }} />
              <span style={{ color: textSecondary }}>{name} (CH{i})</span>
            </span>
          ))}
        </div>
      </div>

      {!isActive && (
        <p className="hand-viz-hint" style={{ color: textSecondary }}>
          Start the simulator or connect a glove to see real-time hand pose
        </p>
      )}

      {onTestSample && (
        <div style={{ display:'flex', gap:'0.5rem', marginTop:'0.75rem', justifyContent:'center', flexWrap:'wrap' }}>
          <button onClick={() => onTestSample([2700,1650,1850,2110,2125])} style={{ padding:'0.5rem 1rem', borderRadius:'6px', border:'1px solid '+borderColor, background:bgCard, color:textPrimary, fontSize:'0.875rem', cursor:'pointer' }}>🖐️ Straight</button>
          <button onClick={() => onTestSample([2200,1300,1480,1640,1720])} style={{ padding:'0.5rem 1rem', borderRadius:'6px', border:'1px solid '+borderColor, background:bgCard, color:textPrimary, fontSize:'0.875rem', cursor:'pointer' }}>✊ Bent</button>
        </div>
      )}
    </div>
  );
}
