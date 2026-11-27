const assert = require('node:assert/strict');
const G = require('../prototype/generator');
const E = require('../prototype/engine');
const diagnosis = require('../prototype/diagnosis');
require('../prototype/mentor');

function patient(...ids) {
  return E.create(G.generate(ids.length === 1 ? 1 : 3, 42, ids));
}

for (const [site, seed] of [['preeclampsia',36], ['ectopic',4]]) {
  const S = E.create(G.generate(1, seed));
  assert.ok(S.tags.includes(site));
  assert.equal(MENTOR.evaluate(S, 'action', 'endoscopy').ok, false);
  const rate = S.bleedRate;
  E.ACTIONS.endoscopy.apply(S);
  assert.equal(S.bleedRate, rate);
  G.step(S, 0.2, E);
  assert.ok(!S.delivered);
  if (site === 'ectopic') assert.ok(S.bleedingSites.ectopic > 0);
}

for (const internal of ['ectopic', 'spleen', 'trauma']) {
  for (const first of ['surgery','endoscopy']) {
    const S = patient('bleed', internal);
    const copy = E.create(S.cas);
    S.map = 80;
    const next = first === 'surgery' ? 'endoscopy' : 'surgery';
    const pending = first === 'surgery' ? 'bleed' : internal;
    E.ACTIONS[first].apply(S);
    G.step(S, 0.2, E);
    assert.ok(S.bleedingSites[pending] > 0);
    assert.equal(S.bleedRate, S.bleedingSites[pending]);
    assert.equal(S.bleedStopped, false);
    E.ACTIONS[next].apply(S);
    G.step(S, 0.2, E);
    assert.equal(S.bleedRate, 0);
    assert.equal(S.bleedStopped, true);
    assert.ok(copy.bleedingSites[internal] > 0);
  }
}

const combined = patient('trauma','bleed');
const originalGutRate = combined.bleedingSites.bleed;
E.ACTIONS.tourniquet.apply(combined);
const once = combined.bleedRate;
E.ACTIONS.tourniquet.apply(combined);
assert.equal(combined.bleedRate, once);
assert.equal(combined.bleedingSites.bleed, originalGutRate);
E.restoreBleeding(combined, {bleedRate: 0, bleedStopped:true});
assert.equal(combined.bleedRate, 0);
assert.ok(Object.values(combined.bleedingSites).every(rate => rate === 0));

const obstetric = patient('preeclampsia','bleed');
obstetric.map = 80;
E.ACTIONS.endoscopy.apply(obstetric);
G.step(obstetric, 0.2, E);
assert.ok(obstetric.bleedStopped && !obstetric.delivered);
assert.ok(E.dischargeCheck(obstetric).reasons.some(text => text.includes('产科病因')));
E.ACTIONS.delivery.apply(obstetric);
assert.equal(obstetric.delivered, true);
const fixed = E.create('bleed');
assert.ok(diagnosis.classifyAll(fixed).some(d => d.primaryId === 'hemorrhagicShock'));
const withoutBloodLoss = E.create('bleed');
E.setBleedingRate(withoutBloodLoss, 'bleed', 0);
assert.ok(!diagnosis.classifyAll(withoutBloodLoss).some(d => d.primaryId === 'hemorrhagicShock'));
fixed.map = 80;
E.ACTIONS.delivery.apply(fixed);
assert.ok(!fixed.delivered);
E.ACTIONS.endoscopy.apply(fixed);
assert.equal(fixed.bleedRate, 0);
for (const [id, action] of [['spleen', 'surgery'], ['ectopic', 'surgery'], ['tbi', 'craniotomy'], ['stemi', 'pci']]) {
  const S = patient(id);
  S.t = 1200;
  const check = G.MODULES.find(m => m.id === id).check;
  if (id === 'spleen') assert.ok(check(S).includes('脾脏仍在出血'));
  E.ACTIONS[action].apply(S);
  assert.ok(check(S).some(reason => reason.includes('观察未满')), id);
  S.t += 900;
  assert.ok(!check(S).some(reason => reason.includes('观察未满')), id);
}
console.log('单病种、复合出血源、产科操作隔离和旧存档回归通过');
