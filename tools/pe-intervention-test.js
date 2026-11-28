const assert = require('node:assert/strict');
const G = require('../prototype/generator');
const E = require('../prototype/engine');
const procedure = require('../prototype/pe-intervention');

const bed = E.create(G.generate(3, 101, ['pe', 'tbi']));
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

restored.t = E.orderTest(restored, 'cthead');
E.pollTests(restored);
E.ACTIONS.craniotomy.apply(restored);
assert.equal(restored.cranied, true);
const withoutAnticoagulation = seconds => {
  restored.t += seconds;
  G.step(restored, seconds, E);
};
withoutAnticoagulation(20 * 60);
assert.ok(restored.clot > 0.25 && restored.clot < 0.50);
assert.equal(procedure.canRequest(restored), false, '仅少量残留或回升不触发再次会诊');

withoutAnticoagulation(65 * 60);
assert.ok(restored.clot >= 0.50);
assert.equal(procedure.canRequest(restored), true);
assert.match(procedure.start(restored).reason, /复查 CT/);
E.orderTest(restored, 'ctpa');
assert.match(procedure.start(restored).reason, /复查 CT/, '等待新采样回报');
restored.t = restored.tests.ctpa.readyAt;
E.pollTests(restored);
const newReport = E.reports(restored, 'ctpa').at(-1);
assert.ok(newReport.sampledAt > restored.peIntervention.completedAt);
assert.ok(newReport.values.pulmonaryClotBurden >= 0.50);
restored.map = 85;
assert.match(procedure.start(restored).reason, /循环不稳/, '开颅术后出血风险仍需结合循环指征');

E.give(restored, 'dobutamine', 5, '泵入');
assert.equal(E.pumpRate(restored, 'dobutamine'), 5);
const repeated = Object.assign(E.create(restored.cas), JSON.parse(JSON.stringify({ ...restored, cas: undefined })));
E.restorePatient(repeated);
const beforeRepeat = repeated.cost;
assert.equal(procedure.start(repeated).ok, true, '在强心支持下维持血压仍需评估循环');
assert.equal(repeated.peIntervention.previousSuccessAt, restored.peIntervention.completedAt);
assert.equal(repeated.cost, beforeRepeat + procedure.cost);
assert.equal(procedure.start(repeated).ok, false);
console.log('介入证据、模拟时钟、收费、读档及复发后再次介入验证通过');
