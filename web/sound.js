/* ==========================================================================
 * 声音：全部用 WebAudio 实时合成，不需要任何音频文件
 *  v2 音色重做（对外 API 与 v1 完全一致）
 *  - 心跳：三角波 + 低通（截止随血氧）+ 约 55ms 极短包络，模拟监护仪"嗒"
 *  - 报警：880/1174Hz 双音提示，正弦 + 柔和滤波，首尾包络归零，重复无爆音
 *  - 点击/给药：短促轻巧；给药为带泛音的小铃铛
 *  - 成功：C 大三和弦上行分解 + 长尾混响；失败：A 小调下行，低通压暗
 *  - 总线：master → 低通 → 压缩器 → 软限幅 → 用户音量，并带一条轻混响发送
 * ========================================================================== */
(function (root) {
'use strict';

const BUS_LEVEL = 0.9;    // 总音量（压缩器之前）
const TRIM = 0.9;         // 压缩后补偿；末端还有一个软限幅器兜底

let ctx = null, master = null, busLP = null, comp = null, trim = null, limiter = null, output = null;
let space = null;         // 混响发送总线（ConvolverNode 输入）
let enabled = true;
let lastVolume = 40;
try {
  enabled = localStorage.getItem('life.sound') !== '0';
  const saved = Number(localStorage.getItem('life.soundVolume'));
  if (Number.isInteger(saved) && saved >= 1 && saved <= 100) lastVolume = saved;
} catch (e) {}

function setVolume(percent) {
  if (!Number.isFinite(percent)) return;
  const volume = Math.max(0, Math.min(100, Math.round(percent)));
  if (volume === (enabled ? lastVolume : 0)) return;
  enabled = volume > 0;
  if (enabled) lastVolume = volume;
  try {
    localStorage.setItem('life.sound', enabled ? '1' : '0');
    localStorage.setItem('life.soundVolume', String(lastVolume));
  } catch (e) {}
  if (!output) return;
  const gain = output.gain;
  const now = ctx.currentTime;
  const current = gain.value;
  gain.cancelScheduledValues(now);
  gain.setValueAtTime(current, now);
  gain.linearRampToValueAtTime(volume / 100, now + 0.02);
}

/* 轻混响：程序生成的短噪声脉冲响应，给和弦/铃声一点空间感 */
function buildSpace() {
  const sr = ctx.sampleRate;
  const len = Math.max(1, Math.floor(sr * 1.25));
  const ir = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    let seed = ch ? 22222 : 13331;
    for (let i = 0; i < len; i++) {
      seed = (seed * 16807) % 2147483647;
      const n = (seed / 2147483647) * 2 - 1;
      d[i] = n * Math.pow(1 - i / len, 3.4);
    }
  }
  const conv = ctx.createConvolver();
  conv.buffer = ir;
  const damp = ctx.createBiquadFilter();
  damp.type = 'lowpass';
  damp.frequency.value = 4600;
  const ret = ctx.createGain();
  ret.gain.value = 0.75;
  conv.connect(damp);
  damp.connect(ret);
  ret.connect(master);
  space = conv;
}

function ensure() {
  if (ctx) {
    if (ctx.state === 'suspended' && typeof ctx.resume === 'function' && !ctx.startRendering) {
      try { ctx.resume(); } catch (e) {}
    }
    return ctx;
  }
  const AC = root.AudioContext || root.webkitAudioContext;
  if (!AC) return null;
  try { ctx = new AC(); } catch (e) { return null; }

  master = ctx.createGain();
  master.gain.value = BUS_LEVEL;

  // 总线低通：削掉合成器的高频毛刺
  busLP = ctx.createBiquadFilter();
  busLP.type = 'lowpass';
  busLP.frequency.value = 11000;
  busLP.Q.value = 0.6;

  // 轻度压缩：同时发声时不炸，也不做音量抽吸
  comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -12;
  comp.knee.value = 18;
  comp.ratio.value = 2.5;
  comp.attack.value = 0.003;
  comp.release.value = 0.25;

  trim = ctx.createGain();
  trim.gain.value = TRIM;

  // 软限幅器：0.3 以下完全线性，峰顶平滑压到 0.44（约 -7.1 dBFS）
  limiter = ctx.createWaveShaper();
  const N = 4096, T = 0.3, M = 0.44;
  const curve = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const x = (i / (N - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a <= T ? a : T + (M - T) * Math.tanh((a - T) / (M - T));
    curve[i] = Math.sign(x) * Math.min(y, M);
  }
  limiter.curve = curve;
  limiter.oversample = '2x';

  master.connect(busLP);
  busLP.connect(comp);
  comp.connect(trim);
  trim.connect(limiter);
  output = ctx.createGain();
  output.gain.value = enabled ? lastVolume / 100 : 0;
  limiter.connect(output);
  output.connect(ctx.destination);

  buildSpace();
  return ctx;
}

/* 包络：全部从 0.0001 起、回 0.0001 止，避免任何起停爆音
 *  pulse = 极短打击（心跳/点击）
 *  beep  = 短促提示音，有保持段（报警/危急值）
 *  bell  = 快速起音 + 长衰减（铃、和弦）
 */
function env(g, t0, peak, atk, dur, shape) {
  g.setValueAtTime(0.0001, t0);
  g.linearRampToValueAtTime(peak, t0 + atk);
  if (shape === 'beep') {
    const hold = t0 + Math.max(atk + 0.015, dur * 0.55);
    g.setValueAtTime(peak, hold);
    g.exponentialRampToValueAtTime(0.0001, t0 + dur);
  } else if (shape === 'bell') {
    const knee = t0 + Math.max(atk + 0.02, Math.min(dur * 0.3, 0.12));
    g.exponentialRampToValueAtTime(Math.max(0.0002, peak * 0.3), knee);
    g.exponentialRampToValueAtTime(0.0001, t0 + dur);
  } else {
    g.exponentialRampToValueAtTime(0.0001, t0 + dur);
  }
}

function voice(o) {
  if (!enabled) return;
  const c = ensure();
  if (!c) return;

  const t0 = c.currentTime + (o.delay || 0);
  const dur = Math.max(0.02, o.dur == null ? 0.12 : o.dur);
  const atk = Math.max(0.001, o.atk == null ? 0.006 : o.atk);
  const peak = Math.max(0.0005, o.gain == null ? 0.15 : o.gain);

  const osc = c.createOscillator();
  osc.type = o.type || 'triangle';
  osc.frequency.setValueAtTime(Math.max(20, o.freq), t0);
  if (o.freqTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.freqTo), t0 + dur);

  const amp = c.createGain();
  env(amp.gain, t0, peak, Math.min(atk, dur * 0.4), dur, o.shape);

  let tail = osc;
  if (o.filter) {
    const bq = c.createBiquadFilter();
    bq.type = o.filterType || 'lowpass';
    bq.frequency.setValueAtTime(Math.max(60, o.filter), t0);
    if (o.filterTo) {
      bq.frequency.exponentialRampToValueAtTime(Math.max(60, o.filterTo), t0 + dur);
    }
    bq.Q.value = o.q == null ? 0.9 : o.q;
    tail.connect(bq);
    tail = bq;
  }
  tail.connect(amp);
  amp.connect(master);

  if (o.send && space) {
    const s = c.createGain();
    s.gain.value = o.send;
    amp.connect(s);
    s.connect(space);
  }

  osc.start(t0);
  osc.stop(t0 + dur + 0.06);
}

/* 频率 -> 低通截止：血氧高时清亮、低时沉闷 */
function beatCutoff(spo2) {
  const t = Math.max(0, Math.min(1, (spo2 - 55) / 45));
  return 650 + Math.pow(t, 2.2) * 4200;   // 650–4850 Hz
}

/* ---------- 具体音效 ---------- */
const S = {
  get enabled() { return enabled; },
  set enabled(v) { setVolume(v ? lastVolume : 0); },
  get volume() { return enabled ? lastVolume : 0; },
  set volume(v) { setVolume(v); },
  unlock() { ensure(); },

  /* 心电滴声：短促滤波脉冲；音高与亮度都随血氧 */
  beat(spo2, critical) {
    const s = isFinite(spo2) ? Math.max(0, Math.min(100, spo2)) : 98;
    const f = 470 + s * 3.1;                    // 470–780 Hz
    const cut = beatCutoff(s);
    const bright = Math.pow(Math.max(0, Math.min(1, (s - 55) / 45)), 2);

    // 主体：三角波经低通，截止在 55ms 内快速下滑 => "嗒"
    voice({
      freq: f, dur: 0.055, atk: 0.0025, gain: 0.22, shape: 'pulse',
      type: 'triangle', filter: cut, filterTo: Math.max(320, cut * 0.5), q: 1.2,
    });
    // 高频"空气"层：只在高血氧时出现，拉开清亮/沉闷的差别
    voice({
      freq: f * 2, dur: 0.034, atk: 0.0018, gain: 0.012 + 0.095 * bright, shape: 'pulse',
      type: 'sine', filter: Math.min(9000, cut * 1.4), filterTo: Math.max(320, cut * 0.8), q: 0.7,
    });
    // 低八度正弦垫一点厚度，让低血氧时更"闷"
    voice({
      freq: f * 0.5, dur: 0.05, atk: 0.004, gain: 0.07, shape: 'pulse',
      type: 'sine', filter: 1100, q: 0.7,
    });

    if (critical) {
      // 二次确认音，略高
      voice({
        freq: f * 1.5, dur: 0.05, atk: 0.003, gain: 0.16, shape: 'pulse',
        type: 'triangle', delay: 0.095,
        filter: Math.min(6000, cut * 1.2), filterTo: Math.max(320, cut * 0.7), q: 1,
      });
    }
  },

  click() {
    voice({
      freq: 1450, freqTo: 1250, dur: 0.028, atk: 0.002, gain: 0.085,
      shape: 'pulse', type: 'triangle', filter: 5200, q: 0.8, send: 0.05,
    });
    voice({
      freq: 725, dur: 0.024, atk: 0.002, gain: 0.035,
      shape: 'pulse', type: 'sine', filter: 1800, send: 0.03,
    });
  },

  /* 给药：带泛音的小铃铛（基音 + 2/3/4.2 倍泛音） */
  drug() {
    const f = 987.77;   // B5
    const parts = [
      [1.0, 0.145, 0.55],
      [2.0, 0.055, 0.38],
      [3.0, 0.024, 0.26],
      [4.2, 0.012, 0.16],
    ];
    for (const [m, g, d] of parts) {
      voice({
        freq: f * m, dur: d, atk: 0.006, gain: g, shape: 'bell',
        type: 'sine', filter: 7200, filterTo: 5200, q: 0.6, send: 0.16,
      });
    }
  },

  /* 室颤/心静止：880 + 1174Hz 双音，柔和滤波，1.5s 重复无接缝 */
  alarm() {
    voice({
      freq: 880, dur: 0.2, atk: 0.012, gain: 0.22, shape: 'beep',
      type: 'sine', filter: 3400, q: 0.7, send: 0.12,
    });
    voice({
      freq: 1174.66, dur: 0.2, atk: 0.012, gain: 0.145, shape: 'beep',
      type: 'sine', delay: 0.055, filter: 4200, q: 0.7, send: 0.12,
    });
    voice({
      freq: 440, dur: 0.22, atk: 0.015, gain: 0.06, shape: 'beep',
      type: 'triangle', filter: 900, q: 0.6, send: 0.05,
    });
  },

  /* 危急值：短促双响，高但不过分尖锐 */
  critical() {
    for (const d of [0, 0.135]) {
      voice({
        freq: 1318.51, dur: 0.085, atk: 0.004, gain: 0.19, shape: 'beep',
        type: 'sine', delay: d, filter: 5600, q: 0.8, send: 0.08,
      });
    }
    voice({
      freq: 1760, dur: 0.07, atk: 0.005, gain: 0.075, shape: 'beep',
      type: 'sine', filter: 6400, q: 0.8, send: 0.06,
    });
  },

  /* 出院：C 大三和弦上行分解，每个音独立衰减 */
  success() {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => {
      const last = i === notes.length - 1;
      voice({
        freq: f, dur: last ? 1.1 : 0.72, atk: 0.008,
        gain: last ? 0.21 : 0.16, shape: 'bell', type: 'triangle',
        delay: i * 0.115, filter: 7200, filterTo: last ? 3400 : 5000, q: 0.6, send: 0.22,
      });
      voice({
        freq: f * 2, dur: last ? 0.55 : 0.34, atk: 0.006,
        gain: 0.042, shape: 'bell', type: 'sine',
        delay: i * 0.115, filter: 9000, send: 0.18,
      });
    });
    voice({
      freq: 261.63, dur: 1.3, atk: 0.03, gain: 0.095, shape: 'bell',
      type: 'sine', filter: 900, send: 0.1,
    });
  },

  /* 死亡：A 小调下行，锯齿波经低通压暗 */
  fail() {
    const notes = [440, 349.23, 261.63, 220];
    notes.forEach((f, i) => {
      voice({
        freq: f, dur: 0.68 + i * 0.12, atk: 0.012, gain: 0.17,
        shape: 'bell', type: 'sawtooth', delay: i * 0.175,
        filter: 980 - i * 160, filterTo: 360, q: 1, send: 0.18,
      });
    });
    voice({
      freq: 110, dur: 1.4, atk: 0.025, gain: 0.115, shape: 'bell',
      type: 'sine', delay: 0.55, filter: 420, send: 0.15,
    });
  },

  discharge() { S.success(); },

  start() {
    [392, 523.25, 659.25].forEach((f, i) => {
      voice({
        freq: f, dur: 0.5, atk: 0.02, gain: 0.1, shape: 'bell',
        type: 'triangle', delay: i * 0.1, filter: 2600, q: 0.5, send: 0.2,
      });
    });
  },
};

root.SOUND = S;
})(typeof globalThis !== 'undefined' ? globalThis : this);
