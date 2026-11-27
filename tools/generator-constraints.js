/* 用法：node tools/generator-constraints.js */
const assert = require('node:assert/strict');

require('../prototype/traits.js');
const G = require('../prototype/generator.js');

const modules = new Map(G.MODULES.map(m => [m.id, m]));
const toJSON = C => JSON.stringify(C, (key, value) => key === 'genVersion' ? undefined : value);

function fitsPatient(C) {
  return C.cases.every(id => {
    const m = modules.get(id);
    return (!m.sexReq || C.patient.sex === m.sexReq)
      && (!m.ageRange || (C.patient.age >= m.ageRange[0] && C.patient.age <= m.ageRange[1]));
  });
}

const legacy = G.generateLegacy(3, 104);
assert.deepEqual(legacy.cases, ['bph', 'ectopic']);
assert.equal(legacy.patient.sex, '男');
assert.equal(legacy.patient.age, 60);
assert.equal(legacy.genVersion, 1);
assert.equal(legacy.init.genVersion, 1);

const fixed = G.generate(3, 104);
assert.equal(fixed.cases[0], 'bph');
assert.equal(fixed.genVersion, G.VERSION);
assert.equal(fixed.init.genVersion, G.VERSION);
assert.ok(fitsPatient(fixed));

const E = require('../prototype/engine.js');
const share = require('../prototype/share.js');
for (const original of [legacy, fixed]) {
  const message = share.parse(share.make(E.create(original)));
  assert.ok(message.ok);
  assert.deepEqual(share.rebuild(message.data, E).cas.cases, original.cases);
}
assert.deepEqual(share.rebuild({ c: 'gen', d: 3, s: 104 }, E).cas.cases, legacy.cases);

const fixedSelection = G.generate(3, 104, ['ectopic', 'preeclampsia']);
assert.deepEqual(fixedSelection.cases, ['ectopic', 'preeclampsia']);
assert.ok(fitsPatient(fixedSelection));
assert.deepEqual(G.generate(2, 104, ['bph', 'ectopic']).cases, ['bph']);
assert.throws(() => G.generate(3, 104, ['bph', 'ectopic']), RangeError);

/* 独立检查性别冲突和年龄区间无交集。 */
const bph = modules.get('bph');
const { sexReq, ageRange } = bph;
try {
  bph.ageRange = [20, 42];
  assert.throws(() => G.generate(3, 104, ['bph', 'ectopic']), RangeError);
  bph.ageRange = ageRange;
  bph.sexReq = '女';
  assert.throws(() => G.generate(3, 104, ['bph', 'ectopic']), RangeError);
} finally {
  Object.assign(bph, { sexReq, ageRange });
}

const expectedCounts = [1, 1, 2, 3, 3];
for (let difficulty = 1; difficulty <= expectedCounts.length; difficulty++) {
  for (let seed = 0; seed < 512; seed++) {
    const C = G.generate(difficulty, seed);
    const context = `难度 ${difficulty}，种子 ${seed}`;
    assert.equal(C.cases.length, expectedCounts[difficulty - 1], context);
    assert.equal(new Set(C.cases).size, C.cases.length, context);
    assert.ok(fitsPatient(C), context);
    assert.equal(toJSON(C), toJSON(G.generate(difficulty, seed)), context);

    const previous = G.generateLegacy(difficulty, seed);
    if (fitsPatient(previous)) assert.equal(toJSON(C), toJSON(previous), context);
  }
}

console.log('生成器性别与年龄约束通过（5 个难度，每个难度 512 个种子）');
