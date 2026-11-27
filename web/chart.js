/* ==========================================================================
 * 指标走势图：把 S.history 画成折线图
 * 纯 canvas，不依赖外部库
 * ========================================================================== */
(function (root) {
'use strict';

/* 分组：每组共享一个 y 轴（单位相同） */
const GROUPS = [
  { id: 'bp', name: '血压', unit: 'mmHg',
    series: [{ k: 'sys', label: '收缩压', c: '#c0392b' }, { k: 'dia', label: '舒张压', c: '#e08e79' },
             { k: 'map', label: '平均压', c: '#7f8c8d' }] },
  { id: 'hr', name: '心率 / 呼吸', unit: 'bpm·rpm',
    series: [{ k: 'hr', label: '心率', c: '#c0392b' }, { k: 'rr', label: '呼吸', c: '#2e86c1' }] },
  { id: 'k', name: '血钾 / 血钠', unit: 'mmol/L', dual: true,
    series: [{ k: 'k', label: '血钾', c: '#8e44ad' }, { k: 'na', label: '血钠', c: '#16a085' }] },
  { id: 'glu', name: '血糖', unit: 'mmol/L',
    series: [{ k: 'glu', label: '血糖', c: '#d35400' }] },
  { id: 'ab', name: '酸碱', unit: 'pH / mmol/L', dual: true,
    series: [{ k: 'ph', label: 'pH', c: '#2c3e50' }, { k: 'hco3', label: 'HCO₃⁻', c: '#2980b9' }] },
  { id: 'ox', name: '氧合', unit: '% / mmHg',
    series: [{ k: 'spo2', label: 'SpO₂', c: '#27ae60' }, { k: 'paco2', label: 'PaCO₂', c: '#7f8c8d' }] },
  { id: 'do2', name: '氧输送', unit: 'mL/min',
    series: [{ k: 'do2', label: 'DO₂', c: '#c0392b' }] },
];

function fmtTime(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

function render(canvas, history, groupId) {
  if (!canvas) return;
  const g = GROUPS.find(x => x.id === groupId) || GROUPS[0];
  const dpr = Math.min(2, (root.devicePixelRatio || 1));
  const W = canvas.clientWidth || 320;
  const H = canvas.clientHeight || 180;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const data = (history || []).filter(p => isFinite(p.t));
  const PAD = { l: 40, r: 30, t: 22, b: 22 };
  const w = Math.max(10, W - PAD.l - PAD.r);
  const h = Math.max(10, H - PAD.t - PAD.b);

  if (!data.length) {
    ctx.fillStyle = '#9a9a9a'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('还没有足够数据', W / 2, H / 2);
    return;
  }

  /* y 范围：单轴分组共用刻度；dual 分组每条曲线各自归一化（否则量级小的曲线会被压成直线） */
  function rangeOf(series) {
    let lo = Infinity, hi = -Infinity;
    for (const p of data) {
      const v = p[series.k];
      if (typeof v === 'number' && isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    }
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    if (hi - lo < 1e-6) { hi = lo + 1; lo = lo - 0.5; }
    const padY = (hi - lo) * 0.12;
    return { lo: lo - padY, hi: hi + padY };
  }
  const scales = g.series.map(sr => (g.dual ? rangeOf(sr) : null));
  const shared = g.dual ? null : rangeOf({ k: g.series[0].k });
  if (!g.dual) for (const sr of g.series.slice(1)) {
    const r = rangeOf(sr);
    shared.lo = Math.min(shared.lo, r.lo); shared.hi = Math.max(shared.hi, r.hi);
  }

  const t0 = data[0].t, t1 = data[data.length - 1].t;
  const tx = t => PAD.l + (t1 > t0 ? (t - t0) / (t1 - t0) : 0) * w;
  const tyFor = (i, v) => {
    const r = g.dual ? scales[i] : shared;
    return PAD.t + h - ((v - r.lo) / (r.hi - r.lo)) * h;
  };

  /* 网格 + y 轴刻度 */
  ctx.strokeStyle = '#eeeae7'; ctx.lineWidth = 1;
  ctx.font = '10px sans-serif';
  const base = g.dual ? scales[0] : shared;
  for (let i = 0; i <= 3; i++) {
    const v = base.lo + (base.hi - base.lo) * i / 3;
    const y = tyFor(0, v);
    ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(W - PAD.r, y); ctx.stroke();
    ctx.fillStyle = g.series[0].c; ctx.textAlign = 'right';
    ctx.fillText((Math.round(v * 10) / 10).toString(), PAD.l - 4, y + 3);
  }
  /* 双轴：第二条曲线自己的刻度画在右侧 */
  if (g.dual && scales[1]) {
    const r2 = scales[1];
    ctx.fillStyle = g.series[1].c; ctx.textAlign = 'left';
    for (let i = 0; i <= 3; i++) {
      const v = r2.lo + (r2.hi - r2.lo) * i / 3;
      ctx.fillText((Math.round(v * 10) / 10).toString(), W - PAD.r + 3, tyFor(1, v) + 3);
    }
  }
  /* x 轴时间 */
  ctx.textAlign = 'center';
  for (let i = 0; i <= 3; i++) {
    const t = t0 + (t1 - t0) * i / 3;
    ctx.fillText(fmtTime(t), PAD.l + w * i / 3, H - 6);
  }

  /* 折线 */
  const seriesIdx = {};
  g.series.forEach((sr, i) => { seriesIdx[sr.k] = i; });
  for (const s of g.series) {
    const si = seriesIdx[s.k];
    ctx.strokeStyle = s.c; ctx.lineWidth = 1.6; ctx.beginPath();
    let started = false;
    for (const p of data) {
      const v = p[s.k];
      if (typeof v !== 'number' || !isFinite(v)) continue;
      const x = tx(p.t), y = tyFor(si, v);
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  /* 图例 */
  let lx = PAD.l;
  ctx.font = '10px sans-serif'; ctx.textAlign = 'left';
  for (const s of g.series) {
    ctx.fillStyle = s.c; ctx.fillRect(lx, 6, 8, 3);
    ctx.fillStyle = '#6b625d'; ctx.fillText(s.label, lx + 11, 10);
    lx += 11 + ctx.measureText(s.label).width + 12;
  }
}

const API = { GROUPS, render };
root.CHART = API;
if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
