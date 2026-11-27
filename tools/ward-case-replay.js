/* Replay identical patients on both care paths using the ward's 0.2-second step. */
const assert = require('node:assert/strict');
require('../prototype/traits');
const E = require('../prototype/engine');
const G = require('../prototype/generator');
const { treatPatient, observationMinutes, SEEDS } = require('./content-test');

const catalog = [
  ...G.MODULES.filter(m => m.weight > 0).map(m => ({
    id: m.id, name: m.name, type: '生成', treatment: m.id, create: seed => G.generate(2, seed, [m.id]),
  })),
  ...Object.values(E.CASES).map(c => ({
    id: c.id, name: c.name, type: '固定', treatment: c.id === 'hyperkalemia' ? 'highK' : c.id, create: () => c.id,
  })),
];

function replay(c, seed, withTreatment) {
  const previous = Math.random;
  let randomState = seed;
  Math.random = () => (randomState = randomState * 16807 % 2147483647) / 2147483647;
  try {
    const S = E.create(c.create(seed));
    const maxSteps = observationMinutes(c.treatment) * 60 * 5;
    for (let i = 0; i < maxSteps && S.running; i++) {
      if (withTreatment && i % 50 === 0) treatPatient(S, c.treatment);
      E.tick(S, 0.2);
      G.step(S, 0.2, E);
      if (i % 50 !== 49 && S.running) continue;
      E.pollTests(S);
      for (const value of [S.hr, S.gcs, S.ph, S.na, S.k, S.glu, S.spo2, S.rr, S.vol, E.bp(S).map]) {
        assert.ok(Number.isFinite(value), c.id + ' seed=' + seed + ' t=' + S.t);
      }
      if (!S.death && E.dischargeCheck(S).ok) E.endCase(S, 'discharge', '达到出院标准');
    }
    return {
      patient: S.patient,
      minutes: Math.round(S.t / 6) / 10,
      outcome: S.discharged ? '出院' : S.death ? '死亡' : '继续住院',
      reason: S.death?.reason || E.dischargeCheck(S).reasons.join('、'),
    };
  } finally { Math.random = previous; }
}

const explicitSeed = process.argv.find(arg => arg.startsWith('--seed='))?.slice(7);
const seeds = explicitSeed ? [Number(explicitSeed)] : SEEDS;
for (const seed of seeds) {
  assert.ok(Number.isSafeInteger(seed) && seed > 0 && seed < 2147483647, 'seed 超出范围');
  for (const c of catalog) {
    const control = replay(c, seed, false);
    const treated = replay(c, seed, true);
    assert.deepEqual(treated.patient, control.patient);
    const ok = control.outcome !== '出院' && treated.outcome === '出院';
    if (!ok) process.exitCode = 1;
    console.log(JSON.stringify({ seed, type: c.type, id: c.id, name: c.name, control, treated, ok }));
  }
}
