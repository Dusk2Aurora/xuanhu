const assert = require('node:assert/strict');
const E = require('../prototype/engine');
const G = require('../prototype/generator');

const catheter = E.ACTIONS.catheter;
const physiology = ({ vol, interstitium, uo, renalFactor, gfr, cr }) => ({ vol, interstitium, uo, renalFactor, gfr, cr });

function advance(state) {
  E.tick(state, 10);
  G.step(state, 10, E);
}

function checkRepeatedCatheter(state) {
  const before = physiology(state);
  catheter.apply(state);
  assert.equal(state.urineDrained, true);
  assert.deepEqual(physiology(state), before);
  assert.deepEqual(state.log.at(-1), ['操作', '导尿管已在位', 'info']);
}

const normalKidney = E.create(G.generate(1, 42, ['co']));
assert.ok(normalKidney.uo > 0.5);

const kidneyCase = G.generate(1, 42, ['aki']);
const kidneyInjury = E.create(kidneyCase);
const uncatheterized = E.create(kidneyCase);
assert.ok(kidneyInjury.uo < 0.3);
assert.ok(kidneyInjury.gfr < normalKidney.gfr);
const beforeMonitoring = physiology(kidneyInjury);
catheter.apply(kidneyInjury);
assert.equal(kidneyInjury.urineDrained, true);
assert.deepEqual(physiology(kidneyInjury), beforeMonitoring);
assert.deepEqual(kidneyInjury.log.at(-1), ['操作', '留置导尿管，开始监测尿量', 'good']);
checkRepeatedCatheter(kidneyInjury);
advance(kidneyInjury);
advance(uncatheterized);
assert.deepEqual(physiology(kidneyInjury), physiology(uncatheterized));

const obstruction = G.generate(1, 42, ['bph']);
const treated = E.create(obstruction);
const untreated = E.create(obstruction);
assert.ok(untreated.uo < 0.1);
assert.ok(untreated.gfr > kidneyInjury.gfr);
const beforeRelief = physiology(treated);
catheter.apply(treated);
assert.equal(treated.urineDrained, true);
assert.equal(treated.vol, beforeRelief.vol);
assert.equal(treated.interstitium, beforeRelief.interstitium);
assert.ok(treated.uo > beforeRelief.uo);
assert.ok(treated.renalFactor > beforeRelief.renalFactor);
assert.match(treated.log.at(-1)[1], /潴留尿液.*膀胱减压/);
checkRepeatedCatheter(treated);

advance(treated);
advance(untreated);
assert.ok(untreated.uo < 0.1);
assert.ok(treated.uo > 0.5);
assert.ok(treated.gfr > untreated.gfr);
assert.ok(treated.cr < untreated.cr);

for (const tags of [['bph', 'aki'], ['aki', 'bph']]) {
  const mixed = E.create(G.generate(3, 42, tags));
  const beforeDrainage = physiology(mixed);
  assert.ok(mixed.uo < 0.1);
  assert.ok(mixed.gfr < 20);
  catheter.apply(mixed);
  advance(mixed);
  assert.ok(mixed.uo < 0.3);
  assert.equal(mixed.renalFactor, beforeDrainage.renalFactor);
}
console.log('首帧梗阻性少尿、肾性少尿、导尿监测和重复操作回归通过');
