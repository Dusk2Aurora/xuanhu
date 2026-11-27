const assert = require('node:assert/strict');
require('../prototype/substances.js');
const E = require('../prototype/engine.js');
const G = require('../prototype/generator.js');
const { treatPatient } = require('./content-test.js');

function advance(S, minutes, treat = () => {}) {
  const until = S.t + minutes * 60;
  while (S.running && S.t < until) {
    treat(S);
    E.tick(S, 10);
    G.step(S, 10, E);
  }
  assert.equal(S.death, null);
}

function blockedBy(S, reason) {
  const decision = E.dischargeCheck(S);
  assert.equal(decision.ok, false);
  assert.ok(decision.reasons.some(item => item.includes(reason)), decision.reasons.join('、'));
}

const patient = mod => E.create(G.generate(2, 101, [mod]));

function restore(S, obsoleteFields = []) {
  const { cas, ...state } = S;
  const saved = JSON.parse(JSON.stringify(state));
  for (const field of obsoleteFields) delete saved[field];
  const restored = Object.assign(E.create(cas), saved);
  E.restoreDischargeObservation(restored, saved);
  return restored;
}

{
  const S = E.create({ id: 'respiratory-recovery', init: { ...G.BASE, vent: 1, fio2: 0.60 } });
  advance(S, 15);
  assert.ok(S.spo2 >= 94);
  blockedBy(S, '仍需机械通气');
  const legacyVent = restore(S, ['respiratoryAssessmentAt', 'hadOxygenSupport', 'roomAirStableSince']);
  E.ACTIONS.extubate.apply(legacyVent);
  assert.equal(legacyVent.vent, 1);
  advance(legacyVent, 1);
  E.ACTIONS.extubate.apply(legacyVent);
  assert.equal(legacyVent.vent, 0);
  E.ACTIONS.extubate.apply(S);
  assert.equal(S.vent, 0);
  blockedBy(S, '仍在吸氧');
  blockedBy(restore(S, ['fio2', 'hadOxygenSupport']), '仍在吸氧');
  E.ACTIONS.oxygen_off.apply(S);
  blockedBy(S, '室内空气血氧需稳定');
  advance(S, 3);
  const resized = restore(S);
  assert.equal(resized.roomAirStableSince, S.roomAirStableSince);
  advance(resized, 3);
  assert.equal(E.dischargeCheck(resized).ok, true);
  const legacyWeaned = restore(S, ['hadOxygenSupport', 'roomAirStableSince']);
  blockedBy(legacyWeaned, '室内空气血氧需稳定');
  advance(legacyWeaned, 6);
  assert.equal(E.dischargeCheck(legacyWeaned).ok, true);
}

{
  const S = patient('opioid');
  E.give(S, 'naloxone', 0.4);
  advance(S, 10);
  assert.ok(S.spo2 >= 94 && S.gcs === 15);
  assert.ok(S.pk.some(dose => dose.id === 'morphine'));
  blockedBy(S, '阿片中毒观察');
  advance(S, 42);
  assert.ok(S.rr < 12 || S.gcs < 15, '纳洛酮作用消退后可再次出现抑制');
  advance(S, 309, s => treatPatient(s, 'opioid'));
  assert.equal(E.dischargeCheck(S).ok, true, E.dischargeCheck(S).reasons.join('、'));
  E.give(S, 'naloxone', 0.4);
  delete S.lastNaloxoneAt;
  blockedBy(S, '阿片中毒观察还需 240 分钟');
}

{
  const S = patient('hhs');
  for (let i = 0; i < 4; i++) E.give(S, 'nacl', 1000);
  for (let i = 0; i < 6 && S.glu > 12; i++) {
    E.give(S, 'insulin', 5, '静推');
    advance(S, 45, s => {
      if (s.k < 3.8 && !s.pk.some(dose => dose.id === 'kcl')) E.give(s, 'kcl', 20);
    });
  }
  assert.ok(S.glu >= 4 && S.glu <= 12);
  assert.ok(S.na > 145);
  blockedBy(S, '血钠');
  blockedBy(S, '血清渗透压');
}

{
  const S = patient('hyponatremia');
  E.ACTIONS.hyponatremia_care.apply(S);
  for (let i = 0; i < 3; i++) {
    E.give(S, 'hypertonic_saline', 150);
    advance(S, 40);
  }
  assert.ok(S.na >= 130 && S.na < 145);
  assert.ok(S.naOvercorrectedAt > 0);
  assert.equal(Boolean(S.odsDamage), false);
  blockedBy(S, '近期血钠纠正过快');
  delete S.naOvercorrectedAt;
  blockedBy(S, '近期血钠纠正过快');
}

{
  const S = patient('hyponatremia');
  E.ACTIONS.hyponatremia_care.apply(S);
  E.give(S, 'hypertonic_saline', 112.5);
  advance(S, 1450);
  const legacyFields = ['naCorrection', 'naOvercorrectedAt'];
  assert.ok(restore(S, legacyFields).naOvercorrectedAt == null);
  E.give(S, 'hypertonic_saline', 150);
  advance(S, 30);
  assert.ok(S.naOvercorrectedAt == null);
  E.give(S, 'hypertonic_saline', 112.5);
  advance(S, 40);
  blockedBy(S, '近期血钠纠正过快');
  blockedBy(restore(S), '近期血钠纠正过快');
  blockedBy(restore(S, legacyFields), '近期血钠纠正过快');
}

console.log('出院安全回归：机械通气与撤氧、纳洛酮返发、高钠高渗、低钠纠正过快均通过');
