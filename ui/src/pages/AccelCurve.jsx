import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Box, Typography, Paper, Button, Switch,
  Chip, CircularProgress, TextField, IconButton, Tooltip,
  Fade, Snackbar, Alert, Stack, Divider,
} from '@mui/material';
import { 
  ZoomOutMap, Save, RestartAlt, 
  Visibility, VisibilityOff, Lock, LockOpen,
  CallSplit, Merge
} from '@mui/icons-material';
import { useSettings } from '../context/SettingsContext';

const SVG_W  = 620;
const SVG_H  = 320;
const PAD    = 52;
const PLOT_W = SVG_W - 2 * PAD;
const PLOT_H = SVG_H - 2 * PAD;
const LUT_SIZE   = 512;
const Y_MAX      = 10.0;
const Y_VIEW_DEF = 3.0;

const COLOR_X = '#00e5ff';
const COLOR_Y = '#e040fb';

let _uid = 0;
const mkId = () => ++_uid;
const DEFAULT_MAX_SPEED = 1500;

const DEFAULT_POINTS = () => [
  { id: mkId(), x: 0,    y: 1.0, type: 'smooth' },
  { id: mkId(), x: 300,  y: 1.4, type: 'smooth' },
  { id: mkId(), x: 800,  y: 1.8, type: 'smooth' },
  { id: mkId(), x: 1500, y: 2.2, type: 'smooth' },
];

// ── Curve math ────────────────────────────────────────────────────────────
function segType(sorted, i) {
  if (i < 0 || i >= sorted.length - 1) return null;
  if (sorted[i + 1].type === 'jump')   return 'jump';
  if (sorted[i].type === 'corner' || sorted[i + 1].type === 'corner') return 'corner';
  return 'smooth';
}

function computeTangents(sorted) {
  const n = sorted.length;
  const m = new Array(n).fill(0);
  if (n < 2) return m;
  const delta = Array.from({ length: n - 1 }, (_, i) => {
    const dx = sorted[i + 1].x - sorted[i].x;
    return dx > 0 ? (sorted[i + 1].y - sorted[i].y) / dx : 0;
  });
  for (let i = 0; i < n; i++) {
    if (sorted[i].type !== 'smooth') { m[i] = 0; continue; }
    const L = i > 0     && segType(sorted, i - 1) === 'smooth';
    const R = i < n - 1 && segType(sorted, i)     === 'smooth';
    m[i] = L && R ? (delta[i-1] + delta[i]) / 2 : L ? delta[i-1] : R ? delta[i] : 0;
  }
  for (let i = 0; i < n - 1; i++) {
    if (segType(sorted, i) !== 'smooth') continue;
    if (Math.abs(delta[i]) < 1e-10) { m[i] = m[i + 1] = 0; continue; }
    const r = Math.hypot(m[i] / delta[i], m[i + 1] / delta[i]);
    if (r > 3) { const f = 3 / r; m[i] *= f; m[i + 1] *= f; }
  }
  return m;
}

function hermiteY(y0, y1, m0, m1, dx, t) {
  const a = m0 * dx, b = m1 * dx, t2 = t * t, t3 = t2 * t;
  return (2*t3 - 3*t2 + 1)*y0 + (t3 - 2*t2 + t)*a + (-2*t3 + 3*t2)*y1 + (t3 - t2)*b;
}

function sampleY(sorted, tangents, x) {
  if (!sorted.length) return 1;
  if (sorted.length === 1 || x <= sorted[0].x) return sorted[0].y;
  if (x >= sorted[sorted.length - 1].x) return sorted[sorted.length - 1].y;
  let seg = 0;
  for (let j = 0; j < sorted.length - 1; j++) if (x <= sorted[j + 1].x) { seg = j; break; }
  const st = segType(sorted, seg);
  const dx = sorted[seg + 1].x - sorted[seg].x;
  const t  = dx > 0 ? (x - sorted[seg].x) / dx : 0;
  if (st === 'jump')   return sorted[seg].y;
  if (st === 'corner') return sorted[seg].y + t * (sorted[seg + 1].y - sorted[seg].y);
  return Math.max(0.01, hermiteY(sorted[seg].y, sorted[seg + 1].y, tangents[seg], tangents[seg + 1], dx, t));
}

function computeLUT(points, maxSpeed) {
  const sorted   = [...points].sort((a, b) => a.x - b.x);
  const tangents = computeTangents(sorted);
  return Array.from({ length: LUT_SIZE }, (_, i) =>
    sampleY(sorted, tangents, (i / (LUT_SIZE - 1)) * maxSpeed)
  );
}

// ── Grid ──────────────────────────────────────────────────────────────────
function niceStep(range, target = 6) {
  if (range <= 0) return 1;
  const raw = range / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  for (const f of [1, 2, 2.5, 5, 10]) if (f * mag >= raw * 0.9) return f * mag;
  return mag * 10;
}
function snapPow10(range) {
  return 10 ** Math.round(Math.log10(range / 10));
}

// ── Coordinate transforms ─────────────────────────────────────────────────
function d2s(dx, dy, view) {  // data → SVG px
  return [
    PAD + (dx - view.x0) / (view.x1 - view.x0) * PLOT_W,
    SVG_H - PAD - (dy - view.y0) / (view.y1 - view.y0) * PLOT_H,
  ];
}
function c2s(cx, cy, rect) {  // client px → SVG px
  return [(cx - rect.left) * SVG_W / rect.width, (cy - rect.top) * SVG_H / rect.height];
}
function s2d(sx, sy, view, maxX) {  // SVG px → data (clamped)
  return [
    Math.max(0, Math.min(maxX, view.x0 + (sx - PAD) / PLOT_W * (view.x1 - view.x0))),
    Math.max(0.01, Math.min(Y_MAX, view.y0 + (SVG_H - PAD - sy) / PLOT_H * (view.y1 - view.y0))),
  ];
}

function buildPath(sorted, tangents, view) {
  if (sorted.length < 2) return '';
  const pts = sorted.map(p => d2s(p.x, p.y, view));
  let path = `M ${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < sorted.length - 1; i++) {
    const st = segType(sorted, i);
    const [x2, y2] = pts[i + 1];
    if (st === 'jump') {
      path += ` L ${x2.toFixed(1)},${pts[i][1].toFixed(1)} L ${x2.toFixed(1)},${y2.toFixed(1)}`;
    } else if (st === 'corner') {
      path += ` L ${x2.toFixed(1)},${y2.toFixed(1)}`;
    } else {
      const dx = sorted[i + 1].x - sorted[i].x;
      const [c1x, c1y] = d2s(sorted[i].x   + dx/3, sorted[i].y   + tangents[i]     * dx/3, view);
      const [c2x, c2y] = d2s(sorted[i+1].x - dx/3, sorted[i+1].y - tangents[i + 1] * dx/3, view);
      path += ` C ${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`;
    }
  }
  return path;
}

// ── Presets ───────────────────────────────────────────────────────────────
const PRESETS = [
  { label: 'Flat 1×',    pts: [[0,1,'smooth'],[1,1,'smooth']] },
  { label: 'Gentle',     pts: [[0,0.9,'smooth'],[0.27,1.3,'smooth'],[1,2.0,'smooth']] },
  { label: 'Aggressive', pts: [[0,0.5,'smooth'],[0.13,1.2,'smooth'],[0.4,2.0,'smooth'],[1,2.8,'smooth']] },
  { label: 'Corner',     pts: [[0,1,'smooth'],[0.2,1,'corner'],[0.6,2.0,'smooth'],[1,2.5,'smooth']] },
  { label: 'Jump',       pts: [[0,1,'smooth'],[0.2,2.0,'jump'],[1,2.5,'smooth']] },
];

const TYPE_COLORS = { smooth: '#00e5ff', corner: '#ff9800', jump: '#f44336' };
const TYPE_CYCLE  = { smooth: 'corner', corner: 'jump', jump: 'smooth' };

// ── Component ─────────────────────────────────────────────────────────────
export default function AccelCurve() {
  const { settings } = useSettings();
  const dpi = settings?.Mouse_DPI ?? 800;

  const [enabled,    setEnabled]    = useState(false);
  const [multiCurve, setMultiCurve] = useState(false);
  const [maxSpeed,   setMaxSpeed]   = useState(DEFAULT_MAX_SPEED);
  const [pointsX,    setPointsX]    = useState(DEFAULT_POINTS);
  const [pointsY,    setPointsY]    = useState(DEFAULT_POINTS);
  const [visibleX,   setVisibleX]   = useState(true);
  const [visibleY,   setVisibleY]   = useState(true);
  const [lockedX,    setLockedX]    = useState(false);
  const [lockedY,    setLockedY]    = useState(false);
  const [activeCurve, setActiveCurve] = useState('X');

  const [applied,    setApplied]    = useState(null);
  const [dragInfo,   setDragInfo]   = useState(null); 
  const [isPanning,  setIsPanning]  = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [loading,    setLoading]    = useState(true);
  const [snack,      setSnack]      = useState(null);
  const [view,       setView]       = useState({ x0: 0, x1: DEFAULT_MAX_SPEED, y0: 0, y1: Y_VIEW_DEF });
  const [hoverPos,   setHoverPos]   = useState(null);
  const [snapActive, setSnapActive] = useState(false);
  const [hoverZone,  setHoverZone]  = useState(null); // 'plot' | 'xaxis' | 'yaxis' | null

  const [liveSpeedX, setLiveSpeedX] = useState(null);
  const [liveSpeedY, setLiveSpeedY] = useState(null);

  const svgRef    = useRef(null);
  const nextId    = useRef(_uid);
  const bgDownPos = useRef(null);
  const panRef    = useRef(null);
  const viewRef   = useRef(view);
  const msRef     = useRef(maxSpeed);
  const trailXRef = useRef([]);
  const trailYRef = useRef([]);
  const lastLiveRef = useRef(0);

  useEffect(() => { viewRef.current = view; }, [view]);
  useEffect(() => { msRef.current = maxSpeed; }, [maxSpeed]);

  useEffect(() => {
    window.api.getAccelCurve()
      .then(data => {
        if (data && (data.points || data.pointsX)) {
          const en = data.enabled ?? false;
          const mc = data.multiCurve ?? false;
          const ms = data.maxSpeed ?? DEFAULT_MAX_SPEED;
          const parse = (raw) => (raw || []).map(([x,y,t]) => ({
            id: nextId.current++, x, y,
            type: t===true?'corner':(t==='corner'||t==='jump')?t:'smooth'
          }));
          const px = parse(data.pointsX || data.points);
          const py = parse(data.pointsY || data.points);
          setEnabled(en); setMultiCurve(mc); setMaxSpeed(ms);
          setView({ x0: 0, x1: ms, y0: 0, y1: Y_VIEW_DEF });
          setPointsX(px); setPointsY(py);
          setApplied({ enabled:en, multiCurve:mc, maxSpeed:ms, 
            ptsX: [...px].sort((a,b)=>a.x-b.x).map(p=>[p.x,p.y,p.type]),
            ptsY: [...py].sort((a,b)=>a.x-b.x).map(p=>[p.x,p.y,p.type])
          });
        } else {
          const def = DEFAULT_POINTS();
          setPointsX(def); setPointsY(def);
          setApplied({ enabled:false, multiCurve:false, maxSpeed:DEFAULT_MAX_SPEED, 
            ptsX: def.map(p=>[p.x,p.y,p.type]), ptsY: def.map(p=>[p.x,p.y,p.type]) });
        }
      }).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const fn = (e) => { if (e.key === 'Shift') setSnapActive(e.type === 'keydown'); };
    window.addEventListener('keydown', fn); window.addEventListener('keyup', fn);
    return () => { window.removeEventListener('keydown', fn); window.removeEventListener('keyup', fn); };
  }, []);

  useEffect(() => {
    const offLive = window.api.onLiveSens((d) => {
      const sx = d.speedX ?? 0;
      const sy = d.speedY ?? 0;
      if (sx > 0.1 || sy > 0.1) {
        lastLiveRef.current = Date.now();
        trailXRef.current = [...trailXRef.current.slice(-9), sx];
        trailYRef.current = [...trailYRef.current.slice(-9), sy];
        setLiveSpeedX(sx);
        setLiveSpeedY(sy);
      }
    });
    const offStatus = window.api.onProcessStatus((d) => {
      if (d.status !== 'running') { 
        setLiveSpeedX(null); setLiveSpeedY(null); 
        trailXRef.current = []; trailYRef.current = []; 
        lastLiveRef.current = 0; 
      }
    });
    return () => { offLive?.(); offStatus?.(); };
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      if (lastLiveRef.current && Date.now() - lastLiveRef.current > 400) {
        lastLiveRef.current = 0;
        setLiveSpeedX(null); setLiveSpeedY(null);
        trailXRef.current = []; trailYRef.current = [];
      }
    }, 100);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const svg = svgRef.current; if (!svg) return;
    const onWheel = (e) => {
      const rect = svg.getBoundingClientRect();
      const [sx, sy] = c2s(e.clientX, e.clientY, rect);
      const inPlot  = sx >= PAD && sx <= SVG_W - PAD && sy >= PAD && sy <= SVG_H - PAD;
      const inXAxis = sx >= PAD && sx <= SVG_W - PAD && sy > SVG_H - PAD;
      const inYAxis = sx < PAD && sy >= PAD && sy <= SVG_H - PAD;
      if (!inPlot && !inXAxis && !inYAxis) return;
      e.preventDefault();
      const v = viewRef.current; const ms = msRef.current;
      const factor = e.deltaY > 0 ? 1.2 : 1 / 1.2;
      const cx = v.x0 + (sx - PAD) / PLOT_W * (v.x1 - v.x0);
      const cy = v.y0 + (SVG_H - PAD - sy) / PLOT_H * (v.y1 - v.y0);
      let nx0 = v.x0, nx1 = v.x1, ny0 = v.y0, ny1 = v.y1;
      if (inPlot || inXAxis) {
        nx0 = cx + (v.x0 - cx) * factor; nx1 = cx + (v.x1 - cx) * factor;
        if (nx1 - nx0 < 10) { nx0 = cx - 5; nx1 = cx + 5; }
        if (nx1 - nx0 > ms * 12) { nx0 = cx - ms * 6; nx1 = cx + ms * 6; }
        if (nx0 < 0) { nx1 -= nx0; nx0 = 0; }
      }
      if (inPlot || inYAxis) {
        ny0 = cy + (v.y0 - cy) * factor; ny1 = cy + (v.y1 - cy) * factor;
        if (ny1 - ny0 < 0.02) { ny0 = cy - 0.01; ny1 = cy + 0.01; }
        if (ny1 - ny0 > 40) { ny0 = cy - 20; ny1 = cy + 20; }
        if (ny0 < 0) { ny1 -= ny0; ny0 = 0; }
      }
      setView({ x0: nx0, x1: nx1, y0: ny0, y1: ny1 });
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [loading]);

  const resetView = useCallback(() => setView({ x0: 0, x1: msRef.current, y0: 0, y1: Y_VIEW_DEF }), []);

  const sortedX  = useMemo(() => [...pointsX].sort((a, b) => a.x - b.x), [pointsX]);
  const sortedY  = useMemo(() => [...pointsY].sort((a, b) => a.x - b.x), [pointsY]);
  const isDirty = useMemo(() => {
    if (!applied) return false;
    const curr = { enabled, multiCurve, maxSpeed, 
      ptsX: sortedX.map(p=>[p.x,p.y,p.type]), ptsY: sortedY.map(p=>[p.x,p.y,p.type]) };
    return JSON.stringify(curr) !== JSON.stringify(applied);
  }, [applied, enabled, multiCurve, maxSpeed, sortedX, sortedY]);

  const tangentsX = useMemo(() => computeTangents(sortedX), [sortedX]);
  const tangentsY = useMemo(() => computeTangents(sortedY), [sortedY]);
  const svgPathX  = useMemo(() => buildPath(sortedX, tangentsX, view), [sortedX, tangentsX, view]);
  const svgPathY  = useMemo(() => buildPath(sortedY, tangentsY, view), [sortedY, tangentsY, view]);

  const xStep = useMemo(() => niceStep(view.x1 - view.x0), [view.x0, view.x1]);
  const yStep = useMemo(() => niceStep(view.y1 - view.y0), [view.y0, view.y1]);
  const xTicks = useMemo(() => {
    const s = Math.ceil(view.x0 / xStep) * xStep, arr = [];
    for (let v = s; v <= view.x1 + 1e-9; v += xStep) arr.push(+v.toPrecision(12));
    return arr;
  }, [view.x0, view.x1, xStep]);
  const yTicks = useMemo(() => {
    const s = Math.ceil(view.y0 / yStep) * yStep, arr = [];
    for (let v = s; v <= view.y1 + 1e-9; v += yStep) arr.push(+v.toPrecision(12));
    return arr;
  }, [view.y0, view.y1, yStep]);

  const snapTo = useCallback((x, y, doSnap) => {
    if (!doSnap) return [x, y];
    const v = viewRef.current;
    const xs = snapPow10(v.x1 - v.x0), ys = snapPow10(v.y1 - v.y0);
    return [Math.round(x/xs)*xs, Math.max(0.01, Math.min(Y_MAX, Math.round(y/ys)*ys))];
  }, []);

  const handleSvgMouseDown = useCallback((e) => {
    if (e.button === 1) { e.preventDefault(); panRef.current = { x: e.clientX, y: e.clientY, v: { ...viewRef.current } }; setIsPanning(true); return; }
    if (e.button === 0) { bgDownPos.current = { x: e.clientX, y: e.clientY }; }
    else { bgDownPos.current = null; }
  }, []);

  const handlePointDown = useCallback((id, curve) => (e) => {
    if ((curve === 'X' && lockedX) || (curve === 'Y' && lockedY)) return;
    e.preventDefault(); e.stopPropagation(); bgDownPos.current = null;
    setDragInfo({ id, curve }); setActiveCurve(curve);
  }, [lockedX, lockedY]);

  const handleMouseMove = useCallback((e) => {
    const rect = svgRef.current?.getBoundingClientRect(); if (!rect) return;
    if (panRef.current) {
      const pr = panRef.current;
      const svgDx = (e.clientX - pr.x) * SVG_W / rect.width;
      const svgDy = (e.clientY - pr.y) * SVG_H / rect.height;
      const dataDx = svgDx / PLOT_W * (pr.v.x1 - pr.v.x0);
      const dataDy = svgDy / PLOT_H * (pr.v.y1 - pr.v.y0);
      let nx0 = pr.v.x0 - dataDx, nx1 = pr.v.x1 - dataDx;
      let ny0 = pr.v.y0 + dataDy, ny1 = pr.v.y1 + dataDy;
      if (nx0 < 0) { nx1 -= nx0; nx0 = 0; }
      if (ny0 < 0) { ny1 -= ny0; ny0 = 0; }
      setView({ x0: nx0, x1: nx1, y0: ny0, y1: ny1 }); return;
    }
    if (dragInfo) {
      const { id, curve } = dragInfo;
      const [sx, sy] = c2s(e.clientX, e.clientY, rect);
      let [nx, ny] = s2d(sx, sy, viewRef.current, msRef.current);
      [nx, ny] = snapTo(nx, ny, e.shiftKey);
      const setter = curve === 'X' ? setPointsX : setPointsY;
      setter(prev => {
        const sorted = [...prev].sort((a,b)=>a.x-b.x);
        return prev.map(p => p.id === id ? { ...p, x: sorted[0].id === id ? 0 : nx, y: ny } : p);
      });
      setHoverPos({ x: nx, y: ny }); return;
    }
    const [sx, sy] = c2s(e.clientX, e.clientY, rect);
    const inPlot  = sx >= PAD && sx <= SVG_W - PAD && sy >= PAD && sy <= SVG_H - PAD;
    const inXAxis = sx >= PAD && sx <= SVG_W - PAD && sy > SVG_H - PAD;
    const inYAxis = sx < PAD && sy >= PAD && sy <= SVG_H - PAD;
    if (inPlot) {
      const [dx, dy] = s2d(sx, sy, viewRef.current, msRef.current);
      const [snx, sny] = snapTo(dx, dy, e.shiftKey); setHoverPos({ x: snx, y: sny });
    } else { setHoverPos(null); }
    setHoverZone(inPlot ? 'plot' : inXAxis ? 'xaxis' : inYAxis ? 'yaxis' : null);
  }, [dragInfo, snapTo]);

  const endInteraction = useCallback((e) => {
    if (panRef.current) { panRef.current = null; setIsPanning(false); return; }
    if (dragInfo) {
      const setter = dragInfo.curve === 'X' ? setPointsX : setPointsY;
      setter(prev => [...prev].sort((a,b)=>a.x-b.x));
      setDragInfo(null); bgDownPos.current = null; return;
    }
    if (e && bgDownPos.current) {
      const ddx = e.clientX - bgDownPos.current.x, ddy = e.clientY - bgDownPos.current.y;
      if (Math.hypot(ddx, ddy) < 6) {
        const rect = svgRef.current?.getBoundingClientRect();
        if (rect) {
          const [sx, sy] = c2s(e.clientX, e.clientY, rect);
          if (sx >= PAD && sx <= SVG_W - PAD && sy >= PAD && sy <= SVG_H - PAD) {
            let [nx, ny] = s2d(sx, sy, viewRef.current, msRef.current);
            [nx, ny] = snapTo(nx, ny, e.shiftKey);
            const curve = activeCurve;
            if (!(curve === 'X' ? (lockedX || !visibleX) : (lockedY || !visibleY))) {
              const setter = curve === 'X' ? setPointsX : setPointsY;
              setter(prev => [...prev, { id: nextId.current++, x: nx, y: ny, type: 'smooth' }].sort((a,b)=>a.x-b.x));
            }
          }
        }
      }
      bgDownPos.current = null;
    }
  }, [dragInfo, snapTo, activeCurve, lockedX, lockedY, visibleX, visibleY]);

  const handleMouseLeave = useCallback(() => {
    if (panRef.current) { panRef.current = null; setIsPanning(false); }
    if (dragInfo) {
      const setter = dragInfo.curve === 'X' ? setPointsX : setPointsY;
      setter(prev => [...prev].sort((a,b)=>a.x-b.x));
      setDragInfo(null); bgDownPos.current = null;
    }
    setHoverPos(null);
    setHoverZone(null);
  }, [dragInfo]);

  const handlePointDblClick = useCallback((id, curve) => (e) => {
    if ((curve === 'X' && lockedX) || (curve === 'Y' && lockedY)) return;
    e.preventDefault(); e.stopPropagation();
    const setter = curve === 'X' ? setPointsX : setPointsY;
    setter(prev => prev.map(p => p.id === id ? { ...p, type: TYPE_CYCLE[p.type] || 'smooth' } : p));
  }, [lockedX, lockedY]);

  const handlePointContextMenu = useCallback((id, curve) => (e) => {
    if ((curve === 'X' && lockedX) || (curve === 'Y' && lockedY)) return;
    e.preventDefault();
    const setter = curve === 'X' ? setPointsX : setPointsY;
    setter(prev => {
      if (prev.length <= 2) return prev;
      const sorted = [...prev].sort((a,b)=>a.x-b.x);
      if (sorted[0].id === id) return prev;
      return prev.filter(p => p.id !== id);
    });
  }, [lockedX, lockedY]);

  const handleApply = async () => {
    setSaving(true);
    try {
      const px = sortedX.map(p => [p.x, p.y, p.type]);
      const py = multiCurve ? sortedY.map(p => [p.x, p.y, p.type]) : px;
      const lx = computeLUT(pointsX, maxSpeed);
      const ly = multiCurve ? computeLUT(pointsY, maxSpeed) : lx;
      await window.api.saveAccelCurve({ enabled, multiCurve, maxSpeed, pointsX: px, pointsY: py, lutX: lx, lutY: ly });
      await window.api.restartAppIfRunning();
      setApplied({ enabled, multiCurve, maxSpeed, ptsX: px, ptsY: py });
      setSnack({ type: 'success', msg: 'Acceleration curve applied.' });
    } catch (e) { setSnack({ type: 'error', msg: e.message || 'Failed to apply.' }); }
    finally { setSaving(false); }
  };

  const handleReset = useCallback(() => {
    if (!applied) return;
    setEnabled(applied.enabled); setMultiCurve(applied.multiCurve); setMaxSpeed(applied.maxSpeed);
    setView(prev => ({ ...prev, x0: 0, x1: applied.maxSpeed }));
    setPointsX(applied.ptsX.map(([x,y,t]) => ({ id: nextId.current++, x, y, type: t })));
    setPointsY(applied.ptsY.map(([x,y,t]) => ({ id: nextId.current++, x, y, type: t })));
  }, [applied]);

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', pt: 8 }}><CircularProgress /></Box>;

  const cursor = dragInfo ? 'grabbing' : isPanning ? 'move'
    : hoverZone === 'xaxis' ? 'ew-resize'
    : hoverZone === 'yaxis' ? 'ns-resize'
    : 'crosshair';
  const snapPx = (snapActive && hoverPos) ? d2s(hoverPos.x, hoverPos.y, view) : null;
  const oneRefPx = d2s(0, 1.0, view)[1];
  const showOneRef = oneRefPx >= PAD && oneRefPx <= SVG_H - PAD;

  let liveDotX = null, liveDotY = null;
  if (liveSpeedX !== null) {
    const vY = sampleY(sortedX, tangentsX, liveSpeedX);
    const [lsx, lsy] = d2s(liveSpeedX, vY, view);
    liveDotX = { sx: lsx, sy: lsy, valX: liveSpeedX, valY: vY };
  }
  if (liveSpeedY !== null && multiCurve) {
    const vY2 = sampleY(sortedY, tangentsY, liveSpeedY);
    const [lsx2, lsy2] = d2s(liveSpeedY, vY2, view);
    liveDotY = { sx: lsx2, sy: lsy2, valX: liveSpeedY, valY: vY2 };
  }
  const liveTrailX = trailXRef.current;
  const liveTrailY = trailYRef.current;

  return (
    <Box sx={{ p: 3, height: '100%', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>
      <Paper sx={{ p: 2, mb: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <Box>
          <Typography variant="body1" sx={{ fontWeight: 600 }}>Acceleration Curve</Typography>
          <Typography variant="caption" color="text.secondary">
            {enabled ? 'Enabled — acceleration active on next start' : 'Disabled — no acceleration applied'}
          </Typography>
        </Box>
        <Switch checked={enabled} onChange={e => setEnabled(e.target.checked)} color="primary" />
      </Paper>

      <Paper sx={{ p: 2, flex: 1, minHeight: 0, opacity: enabled ? 1 : 0.5, transition: 'opacity 0.2s', display: 'flex', flexDirection: 'column' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1.5, flexWrap: 'wrap', gap: 1, flexShrink: 0 }}>
          <Box>
            <Typography variant="h6" sx={{ mb: 0.25 }}>Curve Editor</Typography>
            <Typography variant="caption" color="text.secondary">
              Middle-drag to pan · Scroll to zoom · Shift to snap
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Button
              size="small" variant="outlined"
              startIcon={multiCurve ? <Merge /> : <CallSplit />}
              onClick={() => {
                if (!multiCurve) setPointsY(pointsX.map(p => ({ ...p, id: nextId.current++ })));
                setMultiCurve(!multiCurve);
              }}
            >
              {multiCurve ? 'Merge X/Y' : 'Split X/Y'}
            </Button>
            <TextField
              label="Max speed (mm/s)" type="number" size="small" value={maxSpeed}
              onChange={e => { const v = parseInt(e.target.value); if (!isNaN(v) && v >= 100) { setMaxSpeed(v); setView(prev => ({ ...prev, x0: 0, x1: v })); } }}
              inputProps={{ min: 100, max: 10000, step: 100 }} sx={{ width: 150 }}
            />
            <Tooltip title="Reset view">
              <IconButton size="small" onClick={resetView}><ZoomOutMap fontSize="small" /></IconButton>
            </Tooltip>
          </Box>
        </Box>

        {/* Presets */}
        <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap', flexShrink: 0 }}>
          <Typography variant="caption" sx={{ alignSelf: 'center', mr: 1, color: 'text.secondary', fontWeight: 600 }}>Presets:</Typography>
          {PRESETS.map(p => (
            <Button
              key={p.label} size="small" variant="outlined" color="primary"
              sx={{ fontSize: '0.65rem', py: 0, minWidth: 0 }}
              onClick={() => {
                const pts = p.pts.map(([x, y, t]) => ({ id: nextId.current++, x: x * maxSpeed, y, type: t }));
                if (activeCurve === 'X') setPointsX(pts); else setPointsY(pts);
              }}
            >
              {p.label}
            </Button>
          ))}
        </Box>

        <Box sx={{ position: 'relative', flex: 1, width: '100%', bgcolor: 'rgba(0,0,0,0.4)', borderRadius: 1, border: '1px solid rgba(0,229,255,0.1)', overflow: 'hidden', minHeight: 200 }}>
          <svg ref={svgRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', cursor, userSelect: 'none' }} viewBox={`0 0 ${SVG_W} ${SVG_H}`} preserveAspectRatio="none"
            onMouseDown={handleSvgMouseDown} onMouseMove={handleMouseMove} onMouseUp={endInteraction} onMouseLeave={handleMouseLeave}>
            <defs>
              <clipPath id="ac-plot"><rect x={PAD} y={PAD} width={PLOT_W} height={PLOT_H} /></clipPath>
              <clipPath id="ac-pts"><rect x={PAD - 10} y={PAD - 10} width={PLOT_W + 20} height={PLOT_H + 20} /></clipPath>
            </defs>
            <rect data-bg="1" x={PAD} y={PAD} width={PLOT_W} height={PLOT_H} fill="transparent" />

            {xTicks.map(v => {
              const [sx] = d2s(v, 0, view); if (sx < PAD - 1 || sx > SVG_W - PAD + 1) return null;
              return <g key={`gx${v}`}><line x1={sx} y1={PAD} x2={sx} y2={SVG_H - PAD} stroke="rgba(255,255,255,0.07)" /><text x={sx} y={SVG_H - PAD + 13} textAnchor="middle" fill="rgba(255,255,255,0.35)" fontSize={9}>{v >= 10 ? Math.round(v) : v.toFixed(1)}</text></g>;
            })}
            {yTicks.map(v => {
              const [, sy] = d2s(0, v, view); if (sy < PAD - 1 || sy > SVG_H - PAD + 1) return null;
              return <g key={`gy${v}`}><line x1={PAD} y1={sy} x2={SVG_W - PAD} y2={sy} stroke="rgba(255,255,255,0.07)" /><text x={PAD - 5} y={sy + 3.5} textAnchor="end" fill="rgba(255,255,255,0.35)" fontSize={9}>{v.toFixed(2)}</text></g>;
            })}

            {showOneRef && (
              <g clipPath="url(#ac-plot)">
                <line x1={PAD} y1={oneRefPx} x2={SVG_W - PAD} y2={oneRefPx} stroke="rgba(255,255,255,0.18)" strokeDasharray="4,3" />
                <text x={SVG_W - PAD + 4} y={oneRefPx + 3.5} fill="rgba(255,255,255,0.3)" fontSize={8}>1×</text>
              </g>
            )}

            <g clipPath="url(#ac-plot)">
              {visibleY && multiCurve && (
                <path d={svgPathY} fill="none" stroke={COLOR_Y} strokeWidth={2} opacity={lockedY ? 0.4 : 1} strokeDasharray={lockedY ? "4,2" : "0"} />
              )}
              {visibleX && (
                <>
                  <path d={svgPathX + ` L ${(PAD + PLOT_W).toFixed(1)},${(SVG_H - PAD).toFixed(1)} L ${PAD},${(SVG_H - PAD).toFixed(1)} Z`} fill={multiCurve ? 'transparent' : `${COLOR_X}10`} />
                  <path d={svgPathX} fill="none" stroke={COLOR_X} strokeWidth={2} opacity={lockedX ? 0.4 : 1} strokeDasharray={lockedX ? "4,2" : "0"} />
                </>
              )}
            </g>

            {snapPx && <g clipPath="url(#ac-plot)" opacity={0.6}><line x1={snapPx[0]} y1={PAD} x2={snapPx[0]} y2={SVG_H - PAD} stroke={COLOR_X} strokeDasharray="3,2" /><line x1={PAD} y1={snapPx[1]} x2={SVG_W - PAD} y2={snapPx[1]} stroke={COLOR_X} strokeDasharray="3,2" /></g>}

            {/* Live Indicator */}
            <g clipPath="url(#ac-plot)" style={{ pointerEvents: 'none' }}>
              {liveDotX && visibleX && (
                <g>
                  <line x1={liveDotX.sx} y1={PAD} x2={liveDotX.sx} y2={SVG_H - PAD} stroke="rgba(0,229,255,0.1)" strokeWidth={1} strokeDasharray="2,2" />
                  {liveTrailX.slice(0, -1).map((s, i, arr) => {
                    const [tsx, tsy] = d2s(s, sampleY(sortedX, tangentsX, s), view);
                    const alpha = (i + 1) / arr.length;
                    return <circle key={`tx-${i}`} cx={tsx} cy={tsy} r={1.5} fill={COLOR_X} opacity={alpha * 0.3} />;
                  })}
                  <line x1={PAD} y1={liveDotX.sy} x2={SVG_W - PAD} y2={liveDotX.sy} stroke={COLOR_X} strokeWidth={1} opacity={0.2} strokeDasharray="4,4" />
                  <circle cx={liveDotX.sx} cy={liveDotX.sy} r={12} fill={COLOR_X} opacity={0.08} />
                  <circle cx={liveDotX.sx} cy={liveDotX.sy} r={6}  fill={COLOR_X} opacity={0.2} />
                  <circle cx={liveDotX.sx} cy={liveDotX.sy} r={3.5} fill={COLOR_X} stroke="#fff" strokeWidth={1} />
                  <rect x={liveDotX.sx - 20} y={SVG_H - PAD + 2} width={40} height={12} rx={2} fill="rgba(0,0,0,0.8)" />
                  <text x={liveDotX.sx} y={SVG_H - PAD + 11} textAnchor="middle" fill={COLOR_X} fontSize={8} fontWeight={700}>{Math.round(liveDotX.valX)}</text>
                  <rect x={PAD - 38} y={liveDotX.sy - 6} width={34} height={12} rx={2} fill="rgba(0,0,0,0.8)" />
                  <text x={PAD - 6} y={liveDotX.sy + 3} textAnchor="end" fill={COLOR_X} fontSize={8} fontWeight={700}>{liveDotX.valY.toFixed(2)}</text>
                </g>
              )}

              {liveDotY && visibleY && multiCurve && (
                <g>
                  <line x1={liveDotY.sx} y1={PAD} x2={liveDotY.sx} y2={SVG_H - PAD} stroke="rgba(224,64,251,0.1)" strokeWidth={1} strokeDasharray="2,2" />
                  {liveTrailY.slice(0, -1).map((s, i, arr) => {
                    const [tsx, tsy] = d2s(s, sampleY(sortedY, tangentsY, s), view);
                    const alpha = (i + 1) / arr.length;
                    return <circle key={`ty-${i}`} cx={tsx} cy={tsy} r={1.5} fill={COLOR_Y} opacity={alpha * 0.3} />;
                  })}
                  <line x1={PAD} y1={liveDotY.sy} x2={SVG_W - PAD} y2={liveDotY.sy} stroke={COLOR_Y} strokeWidth={1} opacity={0.2} strokeDasharray="4,4" />
                  <circle cx={liveDotY.sx} cy={liveDotY.sy} r={12} fill={COLOR_Y} opacity={0.08} />
                  <circle cx={liveDotY.sx} cy={liveDotY.sy} r={6}  fill={COLOR_Y} opacity={0.2} />
                  <circle cx={liveDotY.sx} cy={liveDotY.sy} r={3.5} fill={COLOR_Y} stroke="#fff" strokeWidth={1} />
                  <rect x={liveDotY.sx - 20} y={SVG_H - PAD + 16} width={40} height={12} rx={2} fill="rgba(0,0,0,0.8)" />
                  <text x={liveDotY.sx} y={SVG_H - PAD + 25} textAnchor="middle" fill={COLOR_Y} fontSize={8} fontWeight={700}>{Math.round(liveDotY.valX)}</text>
                  <rect x={PAD - 38} y={liveDotY.sy - 6} width={34} height={12} rx={2} fill="rgba(0,0,0,0.8)" />
                  <text x={PAD - 6} y={liveDotY.sy + 3} textAnchor="end" fill={COLOR_Y} fontSize={8} fontWeight={700}>{liveDotY.valY.toFixed(2)}</text>
                </g>
              )}
            </g>

            <g clipPath="url(#ac-pts)">
              {visibleY && multiCurve && sortedY.map(p => {
                const [sx, sy] = d2s(p.x, p.y, view); const color = lockedY ? '#666' : COLOR_Y;
                return <g key={p.id} onMouseDown={handlePointDown(p.id, 'Y')} onContextMenu={handlePointContextMenu(p.id, 'Y')} onDoubleClick={handlePointDblClick(p.id, 'Y')}>
                  <circle cx={sx} cy={sy} r={dragInfo?.id === p.id ? 8 : 5} fill={`${color}30`} stroke={color} strokeWidth={2} style={{ cursor: lockedY ? 'default' : 'grab' }} />
                </g>;
              })}
              {visibleX && sortedX.map(p => {
                const [sx, sy] = d2s(p.x, p.y, view); const color = lockedX ? '#666' : COLOR_X;
                return <g key={p.id} onMouseDown={handlePointDown(p.id, 'X')} onContextMenu={handlePointContextMenu(p.id, 'X')} onDoubleClick={handlePointDblClick(p.id, 'X')}>
                  <circle cx={sx} cy={sy} r={dragInfo?.id === p.id ? 8 : 5} fill={`${color}30`} stroke={color} strokeWidth={2} style={{ cursor: lockedX ? 'default' : 'grab' }} />
                </g>;
              })}
            </g>
          </svg>

          {hoverPos && (
            <Box sx={{ position: 'absolute', bottom: 7, right: 9, bgcolor: 'rgba(0,0,0,0.65)', px: 1, py: 0.3, borderRadius: 0.5 }}>
              <Typography sx={{ fontFamily: 'monospace', fontSize: '0.65rem', color: 'rgba(255,255,255,0.65)' }}>
                {hoverPos.x.toFixed(0)} mm/s → {hoverPos.y.toFixed(3)}×
              </Typography>
            </Box>
          )}
        </Box>

        <Box sx={{ mt: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <Stack direction="row" spacing={2} divider={<Divider orientation="vertical" flexItem />}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: COLOR_X }} />
              <Typography variant="caption" sx={{ fontWeight: 700, minWidth: 40 }}>X-AXIS</Typography>
              <IconButton size="small" onClick={() => setVisibleX(!visibleX)}>{visibleX ? <Visibility fontSize="small" /> : <VisibilityOff fontSize="small" />}</IconButton>
              <IconButton size="small" onClick={() => setLockedX(!lockedX)} color={lockedX ? 'primary' : 'default'}>{lockedX ? <Lock fontSize="small" /> : <LockOpen fontSize="small" />}</IconButton>
              <Button size="small" variant={activeCurve === 'X' ? 'contained' : 'outlined'} onClick={() => setActiveCurve('X')} sx={{ py: 0, px: 1, fontSize: '0.6rem', minWidth: 0 }}>Edit</Button>
            </Stack>
            {multiCurve && (
              <Stack direction="row" alignItems="center" spacing={1}>
                <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: COLOR_Y }} />
                <Typography variant="caption" sx={{ fontWeight: 700, minWidth: 40 }}>Y-AXIS</Typography>
                <IconButton size="small" onClick={() => setVisibleY(!visibleY)}>{visibleY ? <Visibility fontSize="small" /> : <VisibilityOff fontSize="small" />}</IconButton>
                <IconButton size="small" onClick={() => setLockedY(!lockedY)} color={lockedY ? 'primary' : 'default'}>{lockedY ? <Lock fontSize="small" /> : <LockOpen fontSize="small" />}</IconButton>
                <Button size="small" variant={activeCurve === 'Y' ? 'contained' : 'outlined'} onClick={() => setActiveCurve('Y')} sx={{ py: 0, px: 1, fontSize: '0.6rem', minWidth: 0 }}>Edit</Button>
              </Stack>
            )}
          </Stack>
          <Typography variant="caption" color="text.secondary">Double-click point to cycle type · Right-click to delete</Typography>
        </Box>
      </Paper>

      <Fade in={isDirty || saving}>
        <Paper elevation={12} sx={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', p: 1.5, borderRadius: 3, display: 'flex', gap: 1.5, bgcolor: 'background.paper', border: '1px solid', borderColor: 'primary.main', zIndex: 1000 }}>
          <Button variant="text" color="inherit" startIcon={<RestartAlt />} onClick={handleReset} disabled={saving} size="small">Reset</Button>
          <Button variant="contained" color="primary" size="small" startIcon={saving ? <CircularProgress size={18} color="inherit" /> : <Save />} onClick={handleApply} disabled={saving} sx={{ px: 3, fontWeight: 700 }}>
            {saving ? 'Applying…' : 'Apply'}
          </Button>
        </Paper>
      </Fade>
      <Snackbar open={!!snack} autoHideDuration={4000} onClose={() => setSnack(null)} anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
        <Alert severity={snack?.type}>{snack?.msg}</Alert>
      </Snackbar>
    </Box>
  );
}
