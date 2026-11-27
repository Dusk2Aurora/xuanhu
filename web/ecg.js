/* Four seconds of single-lead monitor history. Each sample and QRS tone uses
 * the same beat phase, driven by wall time even during simulation fast-forward. */
(function (root) {
'use strict';

const STEP_MS = 4, STRIP_MS = 4000;
const SAMPLES = STRIP_MS / STEP_MS + 1;
const unit = value => Math.max(0, Math.min(1, value));

function bump(t, centre, width) {
  const z = (t - centre) / width;
  return Math.abs(z) > 4 ? 0 : Math.exp(-0.5 * z * z);
}

function sinus(phase, rr, patient) {
  const sinceR = phase * rr, untilR = sinceR - rr;
  const nearR = phase < 0.5 ? sinceR : untilR;
  const potassium = patient.k ?? 4;
  const highK = unit((potassium - 5.5) / 2.6);
  const wide = unit(Math.max(patient.qrsWide || 0, patient.tca || 0, (potassium - 6.2) / 2.6));
  const qrs = 1 + 1.6 * wide;
  const pr = Math.min(0.16 + 0.045 * highK, 0.38 * rr);
  const tCentre = Math.min(0.28 * Math.sqrt(rr), 0.52 * rr);
  const p = 0.14 * (1 - highK) * bump(untilR, -pr, Math.min(0.023, rr * 0.055));
  const q = -0.13 * bump(nearR, -0.021 * qrs, 0.006 * qrs);
  const r = (1 - 0.20 * wide) * bump(nearR, 0, 0.011 * qrs);
  const s = -0.24 * bump(nearR, 0.027 * qrs, 0.009 * qrs);
  const t = (0.28 + 0.34 * highK) * bump(sinceR, tCentre, Math.min(0.052 - 0.025 * highK, 0.095 * rr));
  const st = 0.21 * unit(patient.stemi || 0) * unit((sinceR - 0.038 * qrs) / 0.025) *
    unit((tCentre - sinceR) / 0.045);
  return p + q + r + s + t + st;
}

function fibrillation(t) {
  const angle = 2 * Math.PI * t;
  const envelope = 0.22 + 0.09 * Math.sin(0.81 * angle);
  return envelope * Math.sin(4.6 * angle + 1.3 * Math.sin(0.73 * angle)) +
    0.10 * Math.sin(6.37 * angle + 0.8 * Math.sin(0.41 * angle)) + 0.06 * Math.sin(8.19 * angle);
}

class EcgMonitor {
  constructor() {
    this.samples = new Float32Array(SAMPLES);
    this.clear();
  }

  clear() {
    this.patient = this.rhythm = null;
    this.count = this.write = 0;
    this.lastSample = null;
  }

  pause() { this.lastSample = null; }

  update(patient, now) {
    if (patient !== this.patient) {
      this.clear();
      this.patient = patient;
    }
    if (this.lastSample !== null && now - this.lastSample > 500) {
      this.count = this.write = 0; // A suspended tab has no observed signal in the gap.
      this.lastSample = null;
    }
    if (this.lastSample === null) this.lastSample = now - STEP_MS;
    if (patient.rhythm !== this.rhythm) {
      this.phase = 0.6;
      this.rhythm = patient.rhythm;
    }
    const rr = patient.hr > 0 ? 60 / patient.hr : 0;
    let rPeak = false;
    while (this.lastSample + STEP_MS <= now) {
      this.lastSample += STEP_MS;
      let voltage = 0;
      if (this.rhythm === 'sinus' && rr > 0) {
        this.phase += STEP_MS / (1000 * rr);
        if (this.phase >= 1) { this.phase -= 1; rPeak = true; }
        voltage = sinus(this.phase, rr, patient);
      } else if (this.rhythm === 'vf') {
        voltage = fibrillation(this.lastSample / 1000);
      }
      this.samples[this.write] = voltage;
      this.write = (this.write + 1) % SAMPLES;
      if (this.count < SAMPLES) this.count++;
    }
    return rPeak;
  }

  draw(canvas) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    const dpr = root.devicePixelRatio || 1;
    const width = Math.round(w * dpr), height = Math.round(h * dpr);
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(width / w, 0, 0, height / h, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.beginPath();
    for (let col = 0; col <= 20; col++) {
      const x = col * w / 20; // One grid division is 200 ms.
      ctx.moveTo(x, 0); ctx.lineTo(x, h);
    }
    for (let row = 1; row < 5; row++) {
      const y = row * h / 5;
      ctx.moveTo(0, y); ctx.lineTo(w, y);
    }
    ctx.strokeStyle = 'rgba(211,58,58,.12)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.beginPath();
    const first = (this.write - this.count + SAMPLES) % SAMPLES;
    for (let i = 0; i < this.count; i++) {
      const x = (SAMPLES - this.count + i) * (w - 1) / (SAMPLES - 1);
      const y = h * (0.67 - 0.54 * this.samples[(first + i) % SAMPLES]);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#d33a3a'; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'; ctx.stroke();
  }
}
root.EcgMonitor = EcgMonitor;
})(globalThis);
