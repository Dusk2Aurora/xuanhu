const assert = require('node:assert/strict');
const E = require('../prototype/engine');
const G = require('../prototype/generator');
const intake = require('../prototype/intake');

const counts = { 隐瞒: 0, 回忆遗漏: 0 };
let corroborated = 0;
for (let seed = 1; seed <= 400; seed++) {
  const cas = G.generate(6, seed, ['dka']);
  const state = E.create(cas);
  state.patient.age = 75;
  state.gcs = 15;
  const chart = intake.init(state);
  assert.equal(chart.known.length, 0);
  assert.equal(intake.view(state).selfReportLimits, undefined);
  const limit = chart.selfReportLimits[0];
  if (!limit) continue;
  counts[limit.reason]++;
  assert.ok(!intake.ask(state, 'patient', limit.section).evidence.some(f => f.id === limit.factId));
  assert.ok(limit.asked);
  assert.deepEqual(intake.init({ ...state, intake: structuredClone(chart) }), chart);
  if (limit.alternatives.length) {
    const { evidence } = intake.ask(state, limit.alternatives[0], limit.section);
    assert.ok(evidence.some(f => f.id === limit.factId));
    corroborated++;
    assert.ok(intake.debrief(state)[0].includes('补录'));
  }
  state.vent = 14;
  assert.equal(intake.ask(state, 'patient', limit.section).status, 'unavailable');
  const lower = E.create({ ...cas, diff: 5, init: { ...cas.init, diff: 5 } });
  lower.patient.age = 75;
  assert.equal(intake.init(lower).selfReportLimits.length, 0);
}
assert.ok(counts.隐瞒 > 0 && counts.回忆遗漏 > 0 && corroborated > 0);
assert.ok(counts.隐瞒 + counts.回忆遗漏 < 200);
console.log('高难度病史、旁证、读档与结算复盘通过', counts, '有旁证', corroborated);
