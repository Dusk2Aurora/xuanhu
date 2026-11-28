const assert = require('node:assert/strict');
const access = require('../prototype/vascular-access');

const stable = { map: 85, rhythm: 'sinus', do2: 400, do2Crit: 240, vol: 4.5 };
const low = { ...stable, map: 58 };
const collapsed = { ...stable, map: 35, rhythm: 'vf' };
const types = [
  ['piv', 30, 40, 10], ['usPiv', 60, 120, 30], ['io', 20, 320, 200], ['cvc', 180, 600, 200],
];

function option(state, type, details = {}) {
  return access.getOptions(state, { actual: stable, difficulty: 6, ...details }).find(item => item.type === type);
}

const trauma = { tags: ['trauma', 'fallTrauma'] };
for (const [type, seconds, fee, materialFee] of types) {
  const bed = access.createState({ seed: 7 });
  assert.deepEqual(access.getOptions(bed).map(item => item.type), types.map(([kind]) => kind));
  const available = option(bed, type);
  assert.deepEqual([available.seconds, available.cost, available.failureCost], [seconds, fee, materialFee]);
  assert.equal(Object.hasOwn(available, 'side'), false);
  assert.equal(Object.hasOwn(available, 'pumpCapacity'), false);
  assert.equal(Object.hasOwn(available, 'condition'), false);

  const started = access.start(bed, { type, actual: stable, difficulty: 6, now: 4 });
  assert.equal(started.ok, true);
  assert.equal(started.attempt.endsAt, 4 + seconds);
  assert.equal(access.getRemaining(bed, 4), seconds);
  assert.equal(access.hasAccess(bed), false);
  assert.equal(access.start(bed, { type, difficulty: 6, now: 4 }).ok, false);
  assert.equal(bed.nextId, 2, '拒绝重叠操作不消耗穿刺序号');
  assert.equal(access.advance(bed, 4 + seconds - 0.001), null);
  const restored = access.restoreState(JSON.parse(JSON.stringify(bed)));
  const failed = access.advance(bed, 4 + seconds);
  assert.equal(failed.success, false);
  assert.equal(failed.cost, materialFee);
  assert.equal(access.hasAccess(bed), false);
  assert.deepEqual(access.advance(restored, 4 + seconds), failed, '同一次操作在读档后结算相同');
  assert.equal(access.advance(restored, 5 + seconds), null, '只结算一次');
  assert.equal(option(bed, type).enabled, true, '失败后可重试同一方式');

  for (let difficulty = 1; difficulty <= 5; difficulty++) {
    const easy = access.createState({ seed: 7 });
    const context = { difficulty, actual: collapsed, patient: trauma };
    assert.equal(option(easy, type, context).failureChance, 0);
    const accepted = access.start(easy, { type, ...context, now: 4 });
    assert.equal(accepted.ok, true);
    const succeeded = access.advance(easy, 4 + seconds);
    assert.equal(succeeded.success, true, '难度一至五发生外伤也必成');
    assert.equal(succeeded.cost, fee);
    assert.equal(access.hasAccess(easy), true);
    assert.equal(access.getLine(easy, succeeded.line.id), succeeded.line);
    assert.equal(option(easy, type).enabled, false, '已有通路后禁止重复建立同类通路');
    assert.equal(access.start(easy, { type, now: 4 + seconds }).ok, false);
    assert.equal(easy.nextId, 2, '拒绝重复置管不消耗穿刺序号');
  }

  const baseline = option(bed, type, { actual: collapsed });
  const injured = option(bed, type, { actual: collapsed, patient: trauma });
  assert.ok(Math.abs(injured.failureChance - baseline.failureChance - 0.10) < 1e-12,
    '高难度外伤为各方式的已有风险增加十个百分点，多个标签只加一次');
  assert.equal(injured.enabled, true);
}

const scenario = access.createState();
const chances = (type, states) => states.map(actual => option(scenario, type, { actual }).failureChance);
assert.deepEqual(chances('piv', [stable, low, collapsed]), [0.05, 0.25, 0.55]);
assert.deepEqual(chances('usPiv', [stable, low, collapsed]), [0.05, 0.10, 0.30]);
assert.deepEqual(chances('io', [stable, low, collapsed]), [0.05, 0.05, 0.05]);
assert.deepEqual(chances('cvc', [stable, collapsed, { ...stable, agitated: true }, { ...collapsed, agitated: true }]),
  [0.05, 0.15, 0.15, 0.25]);
assert.equal(option(scenario, 'io', { patient: { cases: ['pe'] }, actual: collapsed }).failureChance, 0.15);
for (const id of ['ptx', 'trauma', 'tamponade', 'spleen', 'tbi', 'fallTrauma', 'burn']) {
  assert.equal(option(scenario, 'usPiv', { patient: { id }, actual: collapsed }).failureChance, 0.4);
}
const thyroidStorm = { actual: { ...stable, thyroidHeatDrive: 0.7, gcs: 12 } };
assert.equal(option(scenario, 'cvc', thyroidStorm).failureChance, 0.15);
assert.equal(option(scenario, 'cvc', { ...thyroidStorm, sedated: true }).failureChance, 0.05);
assert.equal(option(scenario, 'cvc', { actual: { ...thyroidStorm.actual, thyroidHeatDrive: 0.2 } }).failureChance, 0.05);
assert.equal(option(scenario, 'cvc', { actual: { ...stable, map: 35, tamponade: 0.8, gcs: 12 } }).failureChance, 0.15);

const bed = access.createState({ seed: 7, prehospitalAccess: { type: 'piv' } });
assert.equal(access.hasAccess(bed), true);
const prehospital = bed.lines[0];
assert.equal(prehospital.origin, 'prehospital');
assert.equal(prehospital.site, '前臂');
assert.equal(access.hasAccess(access.createState()), false, '各床独立');
assert.equal(option(bed, 'piv').enabled, false);
assert.equal(option(bed, 'usPiv').enabled, true);

assert.equal(access.start(bed, { type: 'io', actual: stable, difficulty: 6, now: 0 }).ok, true);
assert.equal(access.hasAccess(bed), true, '进行置管时仍可使用旧通路');
assert.deepEqual(bed.lines, [prehospital]);
assert.ok(access.getOptions(bed).every(item => !item.enabled), '同时只允许进行一次置管');
const resumed = access.restoreState(JSON.parse(JSON.stringify(bed)));
assert.deepEqual(resumed.lines, [prehospital]);
const failedReplacement = access.advance(bed, 20);
assert.equal(failedReplacement.success, false);
assert.equal(failedReplacement.cost, 200);
assert.deepEqual(access.advance(resumed, 20), failedReplacement);
assert.deepEqual(bed.lines, [prehospital], '失败时保留旧通路');
assert.equal(access.hasAccess(bed), true);
assert.equal(option(bed, 'io').enabled, true);

assert.equal(access.start(bed, { type: 'usPiv', difficulty: 5, now: 20 }).ok, true);
assert.equal(access.getLine(bed, prehospital.id), prehospital);
const replacement = access.advance(bed, 80);
assert.equal(replacement.success, true);
assert.deepEqual(bed.lines, [replacement.line], '成功时只保留新通路');
assert.equal(access.getLine(bed, prehospital.id), null);
assert.equal(access.hasAccess(bed), true);
assert.equal(option(bed, 'piv').enabled, true);
assert.equal(option(bed, 'usPiv').enabled, false);

const oldSave = {
  seed: 7,
  lines: [
    { id: 'access-1', type: 'piv', side: 'left', origin: 'prehospital', establishedAt: 0, pumpCapacity: 1 },
    { id: 'access-8', type: 'cvc', side: 'right', origin: 'placed', establishedAt: 180, pumpCapacity: 3 },
    { id: 'legacy-1', type: 'piv', side: null, origin: 'legacy', establishedAt: null },
  ],
  attempt: { id: 'access-3', type: 'io', side: 'right', pumpCapacity: 1, startedAt: 190, endsAt: 210,
    condition: '右下肢肿胀，骨性标志难辨', failureChance: 0 },
  activeId: 'access-1',
  pumps: { norepi: 'access-8' },
};
const oldBed = access.restoreState(oldSave);
assert.equal(access.hasAccess(oldBed), true);
assert.deepEqual(oldBed.lines.map(line => [line.origin, line.site]), [['prehospital', '前臂']]);
assert.deepEqual(access.restoreState({ ...oldSave, activeId: 'missing' }).lines.map(line => line.id), ['access-8']);
assert.equal(oldBed.lines.some(line => Object.hasOwn(line, 'side') || Object.hasOwn(line, 'pumpCapacity')), false);
assert.equal(Object.hasOwn(oldBed, 'pumps') || Object.hasOwn(oldBed, 'activeId'), false);
assert.equal(Object.hasOwn(oldBed.attempt, 'side') || Object.hasOwn(oldBed.attempt, 'pumpCapacity'), false);
assert.equal(Object.hasOwn(oldBed.attempt, 'condition'), false);
assert.equal(access.getRemaining(oldBed, 200), 10);
assert.equal(access.advance(oldBed, 210).line.type, 'io');
assert.deepEqual(oldBed.lines.map(line => line.id), ['access-3']);
assert.equal(oldBed.nextId, 9, '舍弃的旧通路序号也不能复用');
assert.equal(access.addLegacyLine(oldBed), null);

const duplicateAttempt = access.restoreState({
  ...oldSave, attempt: { ...oldSave.attempt, id: 'access-10', type: 'piv' },
});
assert.equal(duplicateAttempt.attempt, null, '旧存档中的同类重复置管自动取消');
assert.equal(duplicateAttempt.nextId, 11);
assert.deepEqual(duplicateAttempt.lines.map(line => line.id), ['access-1']);
assert.equal(access.advance(duplicateAttempt, 210), null);
assert.equal(access.restoreState({
  ...oldSave, attempt: { ...oldSave.attempt, id: 'access-8' },
}).attempt, null, '旧存档中已完成的置管不会再次结算');

const emptyBed = access.createState();
const legacy = access.addLegacyLine(emptyBed);
assert.equal(legacy.id, 'legacy-1');
assert.equal(access.getLine(access.restoreState(JSON.parse(JSON.stringify(emptyBed))), legacy.id).origin, 'legacy');

console.log('vascular access checks passed');
