'use strict';

const assert = require('node:assert/strict');
require('../prototype/substances.js');
const T = require('../prototype/traits.js');
const G = require('../prototype/generator.js');
const E = require('../prototype/engine.js');

const identity = { name: '测试患者', sex: '男', age: 45, weight: 70, height: 172 };

function bed(id, traits = []) {
  return E.create({ ...G.generate(1, 101, [id]), traits: traits.map(T.byId) }, identity);
}

function advance(S, minutes) {
  const end = S.t + minutes * 60;
  while (S.running && S.t < end) {
    const dt = Math.min(10, end - S.t);
    E.tick(S, dt);
    G.step(S, dt, E);
  }
  assert.equal(S.t, end, S.death?.reason);
}

/* 实际给药触发体质反应后，气体交换、脉氧和氧输送一起变化。 */
for (const [trait, drug, effect] of [
  ['pcn_allergy', 'ceftriaxone', 'anaphyl'],
  ['asthma_hx', 'labetalol', 'bronchospasm'],
]) {
  const control = bed('sepsis');
  const reacted = bed('sepsis', [trait]);
  for (const S of [control, reacted]) {
    assert.ok(E.give(S, drug));
    advance(S, 2);
  }
  assert.ok(reacted[effect] > 0);
  assert.ok(reacted.spo2 < control.spo2 - 3);
  assert.ok(reacted.pao2 < control.pao2 - 10);
  assert.ok(reacted.do2 < control.do2);
}

/* 过敏负荷随肾上腺素剂量有序下降，开单即停的输注没有作用。 */
{
  function allergy() {
    const S = bed('sepsis', ['pcn_allergy']);
    assert.ok(E.give(S, 'ceftriaxone'));
    advance(S, 0.5);
    return S;
  }
  const [control, tiny, small, full] = [0, 0.01, 0.1, 1].map(dose => {
    const S = allergy();
    if (dose) assert.equal(E.give(S, 'epi', dose, '静推'), dose);
    advance(S, 5);
    return S;
  });
  assert.ok(control.anaphyl > tiny.anaphyl && tiny.anaphyl > small.anaphyl && small.anaphyl > full.anaphyl);
  assert.ok(full.spo2 > small.spo2);
  advance(full, 7);
  assert.equal(full.anaphyl, 0);

  const stopped = allergy();
  assert.equal(E.give(stopped, 'epi', 1, '泵入'), 1);
  assert.ok(E.stopInfusion(stopped, stopped.pk.at(-1)));
  advance(stopped, 5);
  assert.equal(stopped.anaphyl, control.anaphyl);
}

/* 体质对各药的时程独立计算，读档后仍与肾功能因素叠加。 */
{
  const control = bed('sepsis', ['ckd']);
  const slow = bed('sepsis', ['ckd', 'slow_cyp']);
  for (const S of [control, slow]) assert.ok(E.give(S, 'diazepam'));
  assert.ok(slow.pk.at(-1).dur > control.pk.at(-1).dur);
  control.t = slow.t = 180 * 60;
  assert.ok(E.benzodiazepineExposure(slow).load > E.benzodiazepineExposure(control).load);
  const restored = { ...JSON.parse(JSON.stringify(slow)), cas: slow.cas };
  E.restorePatient(restored);
  for (const id of ['diazepam', 'lorazepam', 'clopidogrel']) {
    for (const S of [control, restored]) assert.ok(E.give(S, id));
    const reference = control.pk.at(-1).dur;
    const actual = restored.pk.at(-1).dur;
    if (id === 'diazepam') assert.equal(actual, slow.pk[0].dur);
    else assert.equal(actual, reference);
  }
  assert.equal(restored.clopidogrelResist, true);
}

/* 隔离病例内这一路糖输出，其他病程与生理进展保持一致。 */
{
  const control = bed('hhs');
  const hhs = bed('hhs');
  control.glucoseIn = 0;
  for (const oldProduction of [0, 0.05]) {
    const restored = { ...JSON.parse(JSON.stringify(hhs)), cas: hhs.cas, glucoseIn: oldProduction };
    E.restorePatient(restored);
    E.tick(restored, 10);
    const newBed = bed('hhs');
    E.tick(newBed, 10);
    assert.equal(restored.glu, newBed.glu);
  }
  advance(control, 30);
  advance(hhs, 30);
  assert.ok(hhs.glu > control.glu + 0.1);
}

console.log('过敏低氧、肾上腺素剂量、CYP2C19 慢代谢与高渗病例糖输出验证通过');
