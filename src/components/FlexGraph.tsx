import { useRef, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import './FlexGraph.css';

// ── Constants ─────────────────────────────────────────────────────────────────
const FINGER_NAMES_FALLBACK = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];
const FINGER_COLORS = ['#818cf8', '#fb923c', '#34d399', '#f87171', '#c084fc'];
const MAX_SAMPLES       = 750;   // 15 s × 50 Hz
const CANVAS_H_NORMAL   = 300;
const CANVAS_H_EXPANDED = 600;
const PAD = { top: 10, right: 10, bottom: 10, left: 42 }; // wider left for 4-digit raw labels

// ── Nice-number tick interval for raw Y-axis ─────────────────────────────────
function niceInterval(range: number, targetTicks: number): number {
  const rough = range / targetTicks;
  const exp   = Math.floor(Math.log10(Math.max(rough, 1)));
  const base  = Math.pow(10, exp);
  if (rough / base < 1.5) return base;
  if (rough / base < 3.5) return 2 * base;
  if (rough / base < 7.5) return 5 * base;
  return 10 * base;
}

// ── Props ─────────────────────────────────────────────────────────────────────
interface FlexGraphProps {
  currentSample: number[] | null;
  baselines?: number[];
  maxbends?: number[];
  isActive: boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────
const FlexGraph: React.FC<FlexGraphProps> = ({
  currentSample,
  baselines,
  maxbends,
  isActive,
}) => {
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const wrapRef      = useRef<HTMLDivElement>(null);
  const historyRef   = useRef<number[][]>([]);
  const rafRef       = useRef<number>(0);
  const visRef          = useRef<boolean[]>([true, true, true, true, true]);
  const baselinesRef    = useRef(baselines);
  const maxbendsRef     = useRef(maxbends);
  const rawModeRef      = useRef(false);
  const mousePosRef     = useRef<{ x: number; y: number } | null>(null);
  const fingerNamesRef  = useRef<string[]>(FINGER_NAMES_FALLBACK);
  const waitingTextRef  = useRef<string>('Waiting for data…');

  const { t } = useTranslation();

  const [visible,      setVisible]      = useState<boolean[]>([true, true, true, true, true]);
  const [rawMode,      setRawMode]      = useState(false);
  const [expanded,     setExpanded]     = useState(false);
  const [fingerNames,  setFingerNames]  = useState<string[]>(FINGER_NAMES_FALLBACK);

  // Keep refs in sync with React state for use inside the RAF callback
  useEffect(() => { visRef.current       = visible;   }, [visible]);
  useEffect(() => { baselinesRef.current = baselines; }, [baselines]);
  useEffect(() => { maxbendsRef.current  = maxbends;  }, [maxbends]);
  useEffect(() => { rawModeRef.current   = rawMode;   }, [rawMode]);
  useEffect(() => {
    const names = [
      t('fingers.thumb'), t('fingers.index'), t('fingers.middle'),
      t('fingers.ring'),  t('fingers.pinky'),
    ];
    fingerNamesRef.current = names;
    setFingerNames(names);
    waitingTextRef.current = t('flex_graph.waiting');
  }, [t]);

  // ── Normalize a single raw value to 0–1 ──────────────────────────────────
  const normalizeVal = (
    val: number, i: number,
    b?: number[], m?: number[],
  ): number => {
    if (b && m && b[i] !== undefined && m[i] !== undefined && b[i] !== m[i])
      return Math.max(0, Math.min(1, (b[i] - val) / (b[i] - m[i])));
    return Math.max(0, Math.min(1, (val - 800) / (2700 - 800)));
  };

  // ── Append raw sample to rolling buffer ──────────────────────────────────
  useEffect(() => {
    if (!isActive || !currentSample || currentSample.length < 5) return;
    const h = historyRef.current;
    h.push(currentSample.slice(0, 5));
    if (h.length > MAX_SAMPLES) h.shift();
  }, [currentSample, isActive]);

  // ── Clear history when glove/sim disconnects ──────────────────────────────
  useEffect(() => {
    if (!isActive) historyRef.current = [];
  }, [isActive]);

  // ── Main RAF draw loop ────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mousePosRef.current = {
        x: (e.clientX - rect.left) * (canvas.width  / rect.width),
        y: (e.clientY - rect.top)  * (canvas.height / rect.height),
      };
    };
    const onMouseLeave = () => { mousePosRef.current = null; };
    canvas.addEventListener('mousemove',  onMouseMove);
    canvas.addEventListener('mouseleave', onMouseLeave);

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const W  = canvas.width;
      const H  = canvas.height;
      const pw = W - PAD.left - PAD.right;
      const ph = H - PAD.top  - PAD.bottom;

      ctx.clearRect(0, 0, W, H);

      // ── Plot area ─────────────────────────────────────────────────────────
      ctx.fillStyle = 'rgba(10,20,40,0.55)';
      ctx.beginPath();
      ctx.roundRect(PAD.left, PAD.top, pw, ph, 4);
      ctx.fill();

      const history = historyRef.current;
      const b       = baselinesRef.current;
      const m       = maxbendsRef.current;
      const isRaw   = rawModeRef.current;
      const vis     = visRef.current;

      // ── Y scale ───────────────────────────────────────────────────────────
      let yMin = 0, yMax = 1;
      let ticks: number[] = [];

      if (isRaw && history.length > 0) {
        let dMin = Infinity, dMax = -Infinity;
        history.forEach(raw =>
          vis.forEach((v, fi) => {
            if (v) { if (raw[fi] < dMin) dMin = raw[fi]; if (raw[fi] > dMax) dMax = raw[fi]; }
          }),
        );
        if (!isFinite(dMin)) { dMin = 0; dMax = 4096; }
        const span = (dMax - dMin) || 512;
        yMin = dMin - span * 0.05;
        yMax = dMax + span * 0.05;
        const interval  = niceInterval(yMax - yMin, 10);
        const tickStart = Math.ceil(yMin / interval) * interval;
        for (let t = tickStart; t <= yMax + interval * 0.01; t += interval)
          ticks.push(Math.round(t));
      } else {
        // Normalized: minor ticks every 0.1, major every 0.2
        for (let t = 0; t <= 1.001; t += 0.1)
          ticks.push(Math.round(t * 10) / 10);
      }
      const ySpan = (yMax - yMin) || 1;

      // ── Grid lines + Y-axis labels ────────────────────────────────────────
      ctx.font      = '9px monospace';
      ctx.textAlign = 'right';

      ticks.forEach(tick => {
        const frac    = (tick - yMin) / ySpan;
        const yPx     = PAD.top + ph * (1 - frac);
        const isMajor = isRaw
          ? true
          : Math.abs(tick - Math.round(tick * 5) / 5) < 0.001; // multiples of 0.2

        ctx.strokeStyle = isMajor ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.035)';
        ctx.lineWidth   = 1;
        ctx.beginPath();
        ctx.moveTo(PAD.left, yPx);
        ctx.lineTo(PAD.left + pw, yPx);
        ctx.stroke();

        if (isMajor) {
          ctx.fillStyle = 'rgba(148,163,184,0.70)';
          ctx.fillText(
            isRaw ? String(Math.round(tick)) : tick.toFixed(1),
            PAD.left - 4, yPx + 3.5,
          );
        }
      });

      // ── No-data placeholder ───────────────────────────────────────────────
      if (history.length < 2) {
        ctx.fillStyle  = 'rgba(148,163,184,0.35)';
        ctx.font       = '11px system-ui';
        ctx.textAlign  = 'center';
        ctx.fillText(waitingTextRef.current, PAD.left + pw / 2, PAD.top + ph / 2 + 4);
        return;
      }

      // ── Finger lines ──────────────────────────────────────────────────────
      FINGER_COLORS.forEach((color, fi) => {
        if (!vis[fi]) return;
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth   = 1.5;
        ctx.lineJoin    = 'round';
        history.forEach((raw, si) => {
          const pv = isRaw
            ? (raw[fi] - yMin) / ySpan
            : normalizeVal(raw[fi], fi, b, m);
          const x = PAD.left + (si / (MAX_SAMPLES - 1)) * pw;
          const y = PAD.top  + ph * (1 - pv);
          si === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.stroke();
      });

      // ── Hover: crosshair + dots + tooltip ─────────────────────────────────
      const mouse = mousePosRef.current;
      if (mouse && mouse.x >= PAD.left && mouse.x <= PAD.left + pw && history.length >= 2) {
        const si = Math.max(
          0,
          Math.min(Math.round((mouse.x - PAD.left) / pw * (MAX_SAMPLES - 1)), history.length - 1),
        );
        const sampleX = PAD.left + (si / (MAX_SAMPLES - 1)) * pw;

        // Dashed vertical line
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.22)';
        ctx.lineWidth   = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(sampleX, PAD.top);
        ctx.lineTo(sampleX, PAD.top + ph);
        ctx.stroke();
        ctx.restore();

        // Dots and tooltip data
        const entries: { color: string; text: string }[] = [];
        FINGER_COLORS.forEach((color, fi) => {
          if (!vis[fi]) return;
          const rawVal = history[si][fi];
          const pv = isRaw
            ? (rawVal - yMin) / ySpan
            : normalizeVal(rawVal, fi, b, m);
          const dotY = PAD.top + ph * (1 - pv);

          ctx.beginPath();
          ctx.arc(sampleX, dotY, 4, 0, Math.PI * 2);
          ctx.fillStyle   = color;
          ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,0.75)';
          ctx.lineWidth   = 1.5;
          ctx.stroke();

          const dispVal = isRaw
            ? Math.round(rawVal).toString()
            : normalizeVal(rawVal, fi, b, m).toFixed(2);
          entries.push({ color, text: `${fingerNamesRef.current[fi] ?? FINGER_NAMES_FALLBACK[fi]}: ${dispVal}` });
        });

        // Tooltip box
        if (entries.length > 0) {
          const TW  = 118;
          const ROW = 17;
          const TH  = entries.length * ROW + 12;
          let   tx  = sampleX + 14;
          let   ty  = mouse.y - TH / 2;
          if (tx + TW > PAD.left + pw) tx = sampleX - TW - 14;
          ty = Math.max(PAD.top, Math.min(ty, PAD.top + ph - TH));

          ctx.fillStyle   = 'rgba(8,16,32,0.93)';
          ctx.strokeStyle = 'rgba(255,255,255,0.13)';
          ctx.lineWidth   = 1;
          ctx.beginPath();
          ctx.roundRect(tx, ty, TW, TH, 6);
          ctx.fill();
          ctx.stroke();

          ctx.font      = '10px monospace';
          ctx.textAlign = 'left';
          entries.forEach(({ color, text }, li) => {
            const ry = ty + 10 + li * ROW;
            ctx.fillStyle = color;
            ctx.fillRect(tx + 8, ry, 6, 6);
            ctx.fillStyle = 'rgba(215,230,248,0.93)';
            ctx.fillText(text, tx + 18, ry + 6.5);
          });
        }
      }
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(rafRef.current);
      canvas.removeEventListener('mousemove',  onMouseMove);
      canvas.removeEventListener('mouseleave', onMouseLeave);
    };
  }, []); // refs keep everything current without restart

  // ── Responsive resize (width + height in expanded mode) ──────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap   = wrapRef.current;
    if (!canvas || !wrap) return;
    const ro = new ResizeObserver(entries => {
      const rect = entries[0].contentRect;
      const w = Math.floor(rect.width);
      if (w > 0 && canvas.width !== w) canvas.width = w;
      if (expanded) {
        const h = Math.max(200, Math.floor(rect.height) - 108);
        if (canvas.height !== h) canvas.height = h;
      }
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [expanded]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const toggle    = (i: number) => setVisible(prev => prev.map((v, j) => j === i ? !v : v));
  const allOn     = visible.every(Boolean);
  const toggleAll = () =>
    setVisible(allOn ? [false,false,false,false,false] : [true,true,true,true,true]);

  // Current live values shown in the bottom strip
  const liveVals = (currentSample && isActive)
    ? currentSample.slice(0, 5).map((v, i) =>
        rawMode
          ? Math.round(v).toString()
          : normalizeVal(v, i, baselines, maxbends).toFixed(2),
      )
    : null;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {expanded && <div className="fg-backdrop" onClick={() => setExpanded(false)} />}
      <div ref={wrapRef} className={`fg-wrap ${expanded ? 'fg-wrap--expanded' : ''}`}>

        {/* Header */}
        <div className="fg-header">
          <h3 className="fg-title">{t('flex_graph.title')}</h3>
          <div className="fg-header-right">
            <div className="fg-mode-toggle">
              <button
                className={`fg-mode-btn ${!rawMode ? 'fg-mode-btn--active' : ''}`}
                onClick={() => setRawMode(false)}
              >{t('flex_graph.norm')}</button>
              <button
                className={`fg-mode-btn ${rawMode ? 'fg-mode-btn--active' : ''}`}
                onClick={() => setRawMode(true)}
              >{t('flex_graph.raw')}</button>
            </div>
            <button className="fg-all-btn" onClick={toggleAll}>
              {allOn ? t('flex_graph.hide_all') : t('flex_graph.show_all')}
            </button>
            <button
              className={`fg-expand-btn ${expanded ? 'fg-expand-btn--active' : ''}`}
              onClick={() => setExpanded(e => !e)}
              title={expanded ? t('flex_graph.collapse') : t('flex_graph.expand')}
            >{expanded ? '⊟' : '⊞'}</button>
            <span className="fg-badge">15 s</span>
          </div>
        </div>

        {/* Canvas */}
        <canvas
          ref={canvasRef}
          className="fg-canvas"
          height={expanded ? CANVAS_H_EXPANDED : CANVAS_H_NORMAL}
        />

        {/* Checkboxes */}
        <div className="fg-legend">
          {fingerNames.map((name, i) => (
            <label key={i} className={`fg-item ${!visible[i] ? 'fg-item--dim' : ''}`}>
              <input type="checkbox" checked={visible[i]} onChange={() => toggle(i)} />
              <span className="fg-dot" style={{ background: FINGER_COLORS[i] }} />
              <span className="fg-name">{name}</span>
            </label>
          ))}
        </div>

        {/* Live value readout */}
        <div className="fg-live">
          {fingerNames.map((name, i) => (
            <div key={i} className={`fg-live-item ${!visible[i] ? 'fg-live-item--dim' : ''}`}>
              <span className="fg-live-dot" style={{ background: FINGER_COLORS[i] }} />
              <span className="fg-live-name">{name}</span>
              <span
                className="fg-live-val"
                style={{ color: FINGER_COLORS[i] }}
              >
                {liveVals ? liveVals[i] : '—'}
              </span>
            </div>
          ))}
        </div>

      </div>
    </>
  );
};

export default FlexGraph;
