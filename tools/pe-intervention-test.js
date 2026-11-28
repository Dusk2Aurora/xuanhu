const assert = require('node:assert/strict');
const G = require('../prototype/generator');
const E = require('../prototype/engine');
const procedure = require('../prototype/pe-intervention');

const bed = E.create(G.generate(2, 101, ['pe']));
function advance(patient, seconds) {
  for (let elapsed = 0; elapsed < seconds; elapsed += 10) {
    const step = Math.min(10, seconds - elapsed);
    E.tick(patient, step);
    G.step(patient, step, E);
  }
}
assert.equal(procedure.start(bed).ok, false);
E.orderTest(bed, 'ctpa');
assert.equal(procedure.start(bed).ok, false, '检查待回报');
bed.t = bed.tests.ctpa.readyAt;
E.pollTests(bed);
const stable = { ...bed, map: 85, hematoma: 0, bleedingSites: {}, pumps: {},
  given: [{ id: 'alteplase', d: 1, t: bed.t }], log: [] };
assert.equal(procedure.start(stable).ok, false, '稳定患者刚开始溶栓，应先观察反应');
stable.t += 15 * 60;
assert.equal(procedure.start(stable).ok, true, '复评仍有显著残余血栓');
bed.map = 60;
assert.ok(E.reports(bed, 'ctpa').at(-1).rows.some(row => row.flag === '异常'));
const before = bed.cost;
assert.equal(procedure.start(bed).ok, true);
assert.equal(procedure.start(bed).ok, false);
assert.equal(bed.cost, before + procedure.cost);
assert.ok(E.dischargeCheck(bed).majorReasons.includes('肺动脉导管取栓进行中'));
const restored = Object.assign(E.create(bed.cas), JSON.parse(JSON.stringify({ ...bed, cas: undefined })));
E.restorePatient(restored);
advance(restored, procedure.duration - 1);
assert.equal(procedure.active(restored), true);
const beforeCompletion = restored.clot;
advance(restored, 1);
assert.equal(procedure.status(restored), '已完成');
assert.ok(restored.clot < beforeCompletion / 2);
assert.equal(procedure.start(restored).ok, false);
advance(restored, 10);
assert.equal(restored.log.filter(row => row[1]?.includes('导管取栓完成')).length, 1);
assert.equal(restored.cost, before + procedure.cost);
assert.equal(procedure.active(bed), true, '读档后操作独立');
console.log('介入证据、模拟时钟、单次收费及读档验证通过');
