'use strict';

const assert = require('node:assert/strict');
const substances = require('../prototype/substances.js');
const G = require('../prototype/generator.js');
const E = require('../prototype/engine.js');
const intake = require('../prototype/intake.js');
const share = require('../prototype/share.js');

const rescueDrugs = ['pcc4', 'idarucizumab', 'digoxinFab', 'glucarpidase', 'fibrinogenConcentrate'];
const bed = id => E.create(G.generate(1, 101, [id]));

assert.ok(substances.search('4f-pcc').some(drug => drug.id === 'pcc4'));
assert.ok(substances.search('glucarpidase').some(drug => drug.id === 'glucarpidase'));

function advance(S, minutes) {
  const end = S.t + minutes * 60;
  while (S.running && S.t < end) {
    const step = Math.min(10, end - S.t);
    E.tick(S, step);
    G.step(S, step, E);
    E.pollTests(S);
  }
  assert.equal(S.t, end, S.death?.reason);
}

function lab(S, id) {
  E.orderTest(S, id);
  advance(S, E.TESTS[id].min);
  return E.reports(S, id).at(-1);
}

function stabilizeBleed(S) {
  E.give(S, 'nacl', 1000);
  E.give(S, 'prbc', 2);
  E.ACTIONS.endoscopy.apply(S);
  assert.equal(S.bleedingSites.bleed, 0);
}

/* 2 分钟回报快；普通血气稍后返回时，仍保留两次的实际采样时刻和趋势。 */
{
  const S = bed('digoxinTox');
  S.k = 6.1;
  assert.equal(E.orderTest(S, 'abg'), 480);
  S.t = 60;
  S.k = 5.7;
  assert.equal(E.orderTest(S, 'poct_abg'), 180);
  assert.equal(S.cost, 120 + 350);
  assert.equal(E.orderTest(S, 'poct_abg'), 180);
  assert.equal(S.cost, 120 + 350);
  assert.deepEqual(E.TESTS.poct_abg.fields, E.TESTS.abg.fields);
  S.k = 4.0;
  S.t = 180;
  E.pollTests(S);
  const quick = E.reports(S, 'poct_abg').at(-1);
  assert.equal(quick.values.k, 5.7);
  assert.equal(quick.sampledAt, 60);
  assert.ok(quick.rows.some(row => row.label === '采样时 FiO₂'));
  S.t = 480;
  E.pollTests(S);
  assert.equal(E.reports(S, 'abg').at(-1).values.k, 6.1);
  assert.equal(E.knownResults(S).k.reportId, quick.id);
}

{
  const S = bed('warfarinBleed');
  const history = intake.ask(S, 'records', 'medications');
  assert.ok(history.evidence.some(fact => fact.text.includes('华法林')));
  stabilizeBleed(S);
  assert.ok(lab(S, 'coag').values.inr > 5);

  E.give(S, 'idarucizumab');
  advance(S, 6);
  assert.ok(substances.warfarinEffect(S) > 0.9);
  E.give(S, 'pcc4');
  advance(S, 2);
  assert.ok(substances.warfarinEffect(S) > 0.5);
  assert.ok(E.stopInfusion(S, S.pk.find(order => order.id === 'pcc4')));
  advance(S, 10);
  assert.ok(substances.warfarinEffect(S) > 0.5);
  E.give(S, 'pcc4');
  E.give(S, 'vitamin_k');
  advance(S, 11);
  assert.ok(lab(S, 'coag').values.inr < 1.5);
  advance(S, 60);
  assert.ok(S.warfarinLoad < 0.35);
}

{
  const S = bed('dabigatranBleed');
  stabilizeBleed(S);
  const before = lab(S, 'coag');
  assert.ok(before.values.thrombinTime > 80);
  assert.equal(before.values.inr, 1);
  E.give(S, 'idarucizumab');
  advance(S, 6);
  assert.ok(lab(S, 'coag').values.thrombinTime <= 21);
}

{
  const S = bed('digoxinTox');
  assert.ok(lab(S, 'ecg').rows.some(row => row.label === '房室传导'));
  assert.ok(lab(S, 'digoxin_level').values.digoxinLevel > 5);
  const before = S.k;
  E.give(S, 'digoxinFab');
  advance(S, 21);
  assert.ok(S.k < before);
  assert.ok(lab(S, 'digoxin_level').values.digoxinLevel < 1);
  assert.ok(lab(S, 'ecg').rows.every(row => row.label !== '房室传导'));
}

{
  const S = bed('mtxDelayed');
  assert.ok(intake.ask(S, 'records', 'medications').evidence.some(fact => fact.text.includes('48 小时')));
  E.give(S, 'nacl', 500);
  assert.ok(lab(S, 'methotrexate_level').values.mtxLevel > 10);
  const enzymeAt = S.t;
  E.give(S, 'glucarpidase');
  advance(S, 3);
  assert.ok(S.mtxLevel < 0.5);
  assert.ok(S.cr > 180 && S.mtxCellularStress > 0.5);
  E.give(S, 'leucovorin');
  advance(S, 11);
  assert.equal(S.mtxFolinicReserve, 0);
  advance(S, (enzymeAt + 121 * 60 - S.t) / 60);
  E.give(S, 'leucovorin');
  advance(S, 30);
  assert.ok(S.mtxCellularStress < 0.25);
  assert.ok(lab(S, 'methotrexate_level').values.mtxLevel < 0.5);
}

for (const drug of ['fibrinogenConcentrate', 'cryoprecipitate']) {
  const S = bed('fibrinogenBleed');
  stabilizeBleed(S);
  assert.ok(lab(S, 'coag').values.fibrinogen < 1.0);
  E.give(S, drug);
  advance(S, 26);
  assert.ok(lab(S, 'coag').values.fibrinogen >= 1.7);
}

/* 无指征时没有特异生理效应，输注医嘱仍按剂量和途径校验。 */
{
  const identity = { name:'测试患者', sex:'男', age:45, weight:70, height:172 };
  const control = E.create({ id:'rescue-control', init:{ ...G.BASE } }, identity);
  const treated = E.create({ id:'rescue-control', init:{ ...G.BASE } }, identity);
  for (const id of rescueDrugs) {
    const sub = substances.byId(id);
    assert.equal(sub.rescue, true);
    assert.equal(E.give(treated, id, -1), null);
    assert.equal(E.give(treated, id, sub.routes[0].maxDose + 1), null);
    assert.equal(E.give(treated, id, sub.dose, '口服'), null);
    assert.equal(E.give(treated, id), sub.dose);
  }
  advance(control, 30);
  advance(treated, 30);
  for (const field of ['hr', 'coag', 'k', 'cr']) assert.equal(treated[field], control[field]);

  assert.equal(E.give(treated, 'digoxinFab', 0.5), 0.5);
  assert.equal(treated.given.at(-1).cost, 8000);
  assert.equal(treated.pk.at(-1).dose, 0.5);
}

/* 实际随机入口能抽到每个新病例，病历及会诊码仍依版本和种子复现。 */
{
  const ids = new Set(['warfarinBleed', 'dabigatranBleed', 'digoxinTox', 'mtxDelayed', 'fibrinogenBleed']);
  for (let seed = 0; seed < 400 && ids.size; seed++) {
    const spec = G.generate(1, seed);
    if (!ids.delete(spec.cases[0])) continue;
    const older = G.generateVersion(1, seed, 4);
    assert.notEqual(older.cases[0], spec.cases[0]);
    for (const entry of [spec, older]) {
      const S = E.create(entry);
      const parsed = share.parse(share.make(S));
      assert.ok(parsed.ok);
      const rebuilt = share.rebuild(parsed.data, E);
      assert.deepEqual(rebuilt.cas.cases, S.cas.cases);
      assert.deepEqual(rebuilt.cas.init, S.cas.init);
      assert.deepEqual(rebuilt.cas.admission, S.cas.admission);
      assert.deepEqual(rebuilt.patient, S.patient);
    }
  }
  assert.equal(ids.size, 0);
}

console.log('救援药针对性、输注、病例证据、快速血气及会诊码验证通过');
