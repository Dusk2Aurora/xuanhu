const assert = require('node:assert/strict');
require('../prototype/ecg');

function trace(hr, frameMs, extra = {}) {
  const patient = { rhythm: 'sinus', hr, k: 4, ...extra };
  const monitor = new EcgMonitor(), beats = [];
  for (let t = 0; t <= 6000; t += frameMs) {
    if (monitor.update(patient, t)) beats.push(t);
  }
  const strip = Array.from(monitor.samples, (_, i) => monitor.samples[(monitor.write + i) % monitor.count]);
  return { beats, strip };
}

for (const hr of [42, 60, 120, 180]) {
  for (const frameMs of [8, 16, 40]) {
    const { beats, strip } = trace(hr, frameMs);
    const rr = 60000 / hr;
    assert.ok(beats.length >= 4);
    beats.slice(1).forEach((at, i) => assert.ok(Math.abs(at - beats[i] - rr) <= frameMs + 4));
    const rPeaks = strip.filter((v, i) => v > 0.65 && v > strip[i - 1] && v >= strip[i + 1]);
    const audible = beats.filter(t => t > 2000).length;
    assert.ok(Math.abs(rPeaks.length - audible) <= 1, 'Visible QRS count must match audible beats');
  }
}

const normal = trace(60, 4).strip;
const highK = trace(60, 4, { k: 8 }).strip;
assert.ok(highK.filter(v => v > 0.45).length > normal.filter(v => v > 0.45).length);
const vf = trace(0, 16, { rhythm: 'vf' });
assert.equal(vf.beats.length, 0);
assert.ok(Math.max(...vf.strip) - Math.min(...vf.strip) > 0.3);
const flat = trace(0, 16, { rhythm: 'asystole' });
assert.equal(flat.beats.length, 0);
assert.ok(flat.strip.every(v => v === 0));
console.log('ECG rate, QRS count, hyperkalemia, VF and asystole passed');
