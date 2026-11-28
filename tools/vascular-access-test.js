const assert = require('node:assert/strict');
const access = require('../prototype/vascular-access');

const stable = { map: 85, rhythm: 'sinus', do2: 400, do2Crit: 240, vol: 4.5 };
const low = { ...stable, map: 58 };
const collapsed = { ...stable, map: 35, rhythm: 'vf' };
const types = [
  ['piv', 30, 40, 10], ['usPiv', 60, 120, 30], ['io', 20, 320, 200], ['cvc', 180, 600, 200],
];

function option(state, type, side, details = {}) {
  return access.getOptions(state, { actual: stable, difficulty: 6, ...details })
    .find(item => item.type === type && item.side === side);
}

function place(state, type, side, now) {
  const result = access.start(state, { type, side, actual: collapsed, difficulty: 5, now });
  assert.equal(result.ok, true);
  return access.advance(state, result.attempt.endsAt).line;
}

for (const [type, seconds, fee, materialFee] of types) {
  const bed = access.createState({ seed: 7 });
  assert.deepEqual([option(bed, type, 'left').seconds, option(bed, type, 'left').cost,
    option(bed, type, 'left').failureCost], [seconds, fee, materialFee]);
  const started = access.start(bed, { type, side: 'left', actual: stable, difficulty: 6, now: 4 });
  assert.equal(started.ok, true);
  assert.equal(started.attempt.endsAt, 4 + seconds);
  assert.equal(access.getRemaining(bed, 4), seconds);
  assert.equal(access.getActive(bed), null);
  assert.equal(access.start(bed, { type, side: 'right', difficulty: 6, now: 4 }).ok, false);
  assert.equal(bed.nextId, 2, '拒绝重叠操作不消耗穿刺序号');
  assert.equal(access.advance(bed, 4 + seconds - 0.001), null);
  const restored = access.restoreState(JSON.parse(JSON.stringify(bed)));
  const failed = access.advance(bed, 4 + seconds);
  assert.equal(failed.success, false);
  assert.equal(failed.cost, materialFee);
  assert.equal(access.getActive(bed), null);
  assert.deepEqual(access.advance(restored, 4 + seconds), failed, '同一次操作在读档后结算相同');
  assert.equal(access.advance(restored, 5 + seconds), null, '只结算一次');
  assert.equal(option(bed, type, 'left').enabled, true, '失败后可再尝试原侧');

  const easy = access.createState({ seed: 7 });
  assert.equal(option(easy, type, 'left', { difficulty: 5, actual: collapsed }).failureChance, 0);
  const accepted = access.start(easy, { type, side: 'left', actual: collapsed, difficulty: 5, now: 4 });
  assert.equal(accepted.ok, true);
  const succeeded = access.advance(easy, 4 + seconds);
  assert.equal(succeeded.success, true, '难度五及以下可行操作必成');
  assert.equal(succeeded.cost, fee);
  assert.equal(access.getActive(easy), succeeded.line);
  assert.equal(option(easy, type, 'left').enabled, false, '不可在同一部位重复建通路');
  assert.equal(option(easy, type, 'right').enabled, true);
}

const scenario = access.createState();
const chances = (type, states) => states.map(actual => option(scenario, type, 'left', { actual }).failureChance);
assert.deepEqual(chances('piv', [stable, low, collapsed]), [0.05, 0.25, 0.55]);
assert.deepEqual(chances('usPiv', [stable, low, collapsed]), [0.05, 0.10, 0.30]);
assert.deepEqual(chances('io', [stable, low, collapsed]), [0.05, 0.05, 0.05]);
assert.deepEqual(chances('cvc', [stable, collapsed, { ...stable, agitated: true }, { ...collapsed, agitated: true }]),
  [0.05, 0.15, 0.15, 0.25]);
assert.equal(option(scenario, 'io', 'left', {
  actual: collapsed, patient: { vascularAccessSites: { io: { left: { difficult: true } } } },
}).failureChance, 0.15);
const embolism = { patient: { cases: ['pe'] }, actual: collapsed };
assert.equal(option(scenario, 'io', 'right', embolism).failureChance, 0.15);
assert.equal(option(scenario, 'io', 'left', embolism).failureChance, 0.05);
const thyroidStorm = { actual: { ...stable, thyroidHeatDrive: 0.7, gcs: 12 } };
assert.equal(option(scenario, 'cvc', 'left', thyroidStorm).failureChance, 0.15);
assert.equal(option(scenario, 'cvc', 'left', { ...thyroidStorm, sedated: true }).failureChance, 0.05);
assert.equal(option(scenario, 'cvc', 'left', { actual: { ...thyroidStorm.actual, thyroidHeatDrive: 0.2 } }).failureChance, 0.05);
assert.equal(option(scenario, 'cvc', 'left', { actual: { ...stable, map: 35, tamponade: 0.8, gcs: 12 } }).failureChance, 0.15);

const patient = { vascularAccessSites: {
  piv: { right: { noVein: true } }, usPiv: { right: { ultrasoundVisible: true } },
  io: { left: { targetFracture: true } }, cvc: { right: { contraindication: '该侧拟穿刺部位不可用' } },
} };
assert.equal(option(scenario, 'piv', 'right', { patient }).enabled, false);
assert.equal(option(scenario, 'usPiv', 'right', { patient }).enabled, true);
assert.equal(option(scenario, 'piv', 'left', { patient }).enabled, true);
assert.equal(option(scenario, 'io', 'left', { patient }).enabled, false);
assert.equal(option(scenario, 'io', 'right', { patient }).enabled, true);
assert.equal(option(scenario, 'cvc', 'right', { patient }).enabled, false);
assert.equal(option(scenario, 'cvc', 'left', { patient }).enabled, true);
assert.equal(access.start(scenario, { type: 'io', side: 'left', patient, difficulty: 1, now: 0 }).ok, false);
assert.equal(access.advance(scenario, 20), null);
assert.equal(scenario.nextId, 1, '禁用部位不产生操作或费用');
assert.match(option(scenario, 'io', 'right', { patient: { cases: ['trauma'] } }).reason, /右下肢/);

const bed = access.createState({ prehospitalAccess: { type: 'piv', side: 'left' } });
const first = access.getActive(bed);
assert.equal(first.origin, 'prehospital');
assert.equal(option(bed, 'usPiv', 'left').enabled, false);
assert.equal(access.assignPump(bed, 'norepi').lineId, first.id);
assert.equal(access.assignPump(bed, 'vasopressin').ok, false);
const second = place(bed, 'io', 'right', 10);
assert.equal(access.assignPump(bed, 'vasopressin').lineId, second.id);
const central = place(bed, 'cvc', 'left', 40);
assert.equal(access.getActive(bed), first, '中心建成后仍可沿用原通路');
assert.equal(access.getAvailablePumpLine(bed, 'centralOnly', ['cvc']), central);
assert.equal(access.getPumpLine(bed, 'norepi'), first);
assert.equal(access.assignPump(bed, 'norepi', central.id).ok, false, '分配不会静默迁泵');
assert.equal(access.assignPump(bed, 'one', central.id).ok, true);
assert.equal(access.assignPump(bed, 'two', central.id).ok, true);
assert.equal(access.migrate(bed, central.id).ok, false);
assert.equal(access.getPumpLine(bed, 'vasopressin'), second, '容量不足时整批迁移不改接');
access.releasePump(bed, 'two');
assert.deepEqual(access.getMigration(bed, central.id).moved, ['norepi', 'vasopressin']);
assert.equal(access.getPumpLine(bed, 'norepi'), first, '预览不改接');
const resumed = access.restoreState(JSON.parse(JSON.stringify(bed)));
assert.deepEqual(access.migrate(resumed, central.id).moved, ['norepi', 'vasopressin']);
assert.equal(access.getPumpLine(resumed, 'vasopressin').id, central.id);
assert.equal(access.getPumpLine(resumed, 'norepi').id, central.id);
assert.equal(access.getActive(resumed).id, central.id);
assert.equal(access.selectLine(resumed, first.id).ok, true);
assert.equal(access.getPumpLine(resumed, 'norepi').id, central.id, '选择给药通路不改接既有泵');
assert.equal(access.assignPump(resumed, 'spare', central.id).ok, false);

const oldBed = access.createState();
const legacy = access.addLegacyLine(oldBed);
access.assignPump(oldBed, 'legacyPump', legacy.id);
const oldRestored = access.restoreState(JSON.parse(JSON.stringify(oldBed)));
assert.equal(access.getPumpLine(oldRestored, 'legacyPump').origin, 'legacy');
assert.equal(option(oldRestored, 'piv', 'left').enabled, true, '旧档里未注明部位的通路不占用真实部位');
assert.equal(access.getActive(access.createState()), null, '各床独立');

console.log('vascular access checks passed');
