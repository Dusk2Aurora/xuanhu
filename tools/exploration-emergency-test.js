const assert = require('node:assert/strict');
const G = require('../prototype/generator');
const E = require('../prototype/engine');
const PE = require('../prototype/pe-intervention');
require('../prototype/substances');

const patient = { name: '测试患者', sex: '男', age: 43, weight: 71, height: 172 };
const caseFor = (diff = 2, init = {}, seed = 1) => ({
  id: 'emergency-test', diff, seed, goals: [], tags: [], init: { ...G.BASE, ...init },
});
const roundTrip = S => {
  const saved = JSON.parse(JSON.stringify({ ...S, cas: undefined }));
  const restored = Object.assign(E.create(S.cas, patient), saved);
  E.restorePatient(restored);
  E.restoreCardiorespiratory(restored, saved);
  return restored;
};

function run(S, seconds, step = 1) {
  for (let elapsed = 0; elapsed < seconds; elapsed += step) {
    const duration = Math.min(step, seconds - elapsed);
    E.tick(S, duration);
    G.step(S, duration, E);
  }
}

function runUntil(S, condition, limit) {
  for (let elapsed = 0; !condition(S) && S.running && elapsed < limit; elapsed++) run(S, 1);
  assert.ok(condition(S), '在预期时间内达到测试条件');
}

function arrest(C) {
  const S = E.create(C, patient);
  S.rhythm = 'asystole';
  E.tick(S, 1);
  assert.equal(S.co, 0);
  assert.equal(E.snapshot(S).spo2, null);
  return S;
}

{
  const normal = E.create(caseFor(), patient);
  const high = E.create(caseFor(6), patient);
  const exploration = E.create('exploration', patient);
  assert.equal(E.allowsRiskyActions(normal), false);
  for (const S of [high, exploration]) assert.equal(E.allowsRiskyActions(S), true);
  assert.equal(exploration.cas.exploration, true);
  assert.deepEqual(exploration.tags, []);

  E.ACTIONS.cpr.apply(normal);
  E.ACTIONS.defib.apply(normal);
  assert.equal(normal.cprUntil, undefined);
  assert.equal(normal.lastDefibrillationAt, undefined);
  E.ACTIONS.intubate.apply(normal);
  assert.equal(normal.vent, 0);

  const nativeOutput = exploration.co;
  E.ACTIONS.cpr.apply(exploration);
  assert.equal(exploration.co, nativeOutput, '有自主循环时错误按压不能增加心排量');
  E.ACTIONS.cpr.apply(exploration);
  assert.equal(exploration.cppProgress, 1, '进行中的按压轮次不会叠加');
  run(exploration, 30);
  assert.ok(exploration.cprTrauma > 0);
  assert.equal(exploration.rhythm, 'sinus');
  E.ACTIONS.defib.apply(exploration);
  assert.equal(exploration.lastDefibrillationAt, 30);
  assert.ok(exploration.inappropriateShockUntil > exploration.t);
  assert.match(exploration.log.at(-1)[1], /误用非同步电击/);
  E.ACTIONS.intubate.apply(high);
  assert.equal(high.vent, 1);
  E.ACTIONS.extubate.apply(high);
  assert.equal(high.vent, 0);
  E.ACTIONS.surgery.apply(high);
  assert.equal(high.cost, 0, '没有可治疗的活动性出血时不执行止血手术');
  assert.match(high.log.at(-1)[1], /未启动/);
}

{
  const S = E.create('exploration', patient);
  run(S, 6 * 3600, 10);
  const current = E.snapshot(S);
  assert.equal(S.death, null);
  assert.equal(current.rhythm, 'sinus');
  assert.equal(current.gcs, 15);
  assert.ok(current.spo2 >= 94 && current.map >= 65);
  assert.ok(current.k >= 3.5 && current.k <= 5.2);
  assert.ok(current.na >= 135 && current.na <= 145);
  assert.ok(current.hb >= 130 && current.temp >= 36 && current.temp <= 37.5);
}

{
  const cprOnly = arrest(caseFor());
  E.ACTIONS.cpr.apply(cprOnly);
  assert.ok(cprOnly.co > 1.4 && cprOnly.map > 20);
  const initial = cprOnly.co;
  run(cprOnly, 30);
  assert.ok(Math.abs(cprOnly.co - initial) < 0.1);
  const loaded = roundTrip(cprOnly);
  run(loaded, 89);
  assert.ok(loaded.co > 1.4);
  run(loaded, 1);
  assert.equal(loaded.co, 0);
  assert.equal(loaded.cprUntil, null);

  const va = arrest(caseFor(6));
  E.ACTIONS.cpr.apply(va);
  assert.deepEqual(E.advancedDeviceAction(va, 'vaEcmo', true), { ok: true });
  assert.equal(va.cprUntil, null);
  assert.equal(va.rr, 0);
  assert.ok(va.co >= 3 && va.co <= 3.8);
  assert.equal(E.snapshot(va).spo2, null, '非脉动循环无指脉氧信号');
  assert.ok(va.sao2 >= 0.95, '同时可从血气获得动脉氧饱和度');
  const circuitOutput = va.co;
  E.ACTIONS.cpr.apply(va);
  assert.equal(va.co, circuitOutput, '误按压不叠加至充足的 VA 回路流量');
  run(va, 21 * 60);
  assert.equal(va.death, null);
  assert.equal(va.rhythm, 'asystole');
  assert.ok(va.asystoleInsult < 1 && va.paco2 < 65);
  E.ACTIONS.defib.apply(va);
  assert.equal(va.rhythm, 'asystole');
  assert.match(va.log.at(-1)[1], /心静止持续/);
  assert.deepEqual(E.advancedDeviceAction(va, 'vaEcmo', false), { ok: true });
  assert.equal(va.co, 0);

  const vv = arrest(caseFor(6));
  const pao2 = vv.pao2;
  assert.deepEqual(E.advancedDeviceAction(vv, 'vvEcmo', true), { ok: true });
  assert.equal(vv.co, 0);
  assert.equal(vv.pao2, pao2, '没有血液经过肺循环时，VV 回路不能抬高动脉氧合');
  E.ACTIONS.cpr.apply(vv);
  assert.ok(vv.co > 1.4 && vv.co < 2);
}

{
  const normal = E.create(caseFor(), patient);
  assert.equal(E.advancedDeviceAction(normal, 'ttm', true).ok, false);
  normal.roscAt = normal.t;
  normal.gcs = 8;
  assert.equal(E.advancedDeviceAction(normal, 'ttm', true).ok, true);

  const control = E.create('exploration', patient);
  const treated = E.create('exploration', patient);
  const device = () => E.advancedDevice(treated, 'ttm');
  assert.deepEqual(E.advancedDeviceAction(treated, 'ttm', true), { ok: true });
  assert.equal(device().phase, 'cooling');
  E.setEnv(treated, 'warming', true);
  assert.equal(treated.env.warming, 0);
  for (const S of [control, treated]) run(S, 12 * 60);
  assert.equal(device().phase, 'maintaining');
  assert.equal(treated.temp, 34);
  assert.ok(treated.hr < control.hr && treated.vo2 < control.vo2 && treated.vco2 < control.vco2);
  assert.match(E.advancedDischargeBlockers(treated).join(), /亚低温治疗/);
  assert.deepEqual(E.advancedDeviceAction(treated, 'ttm', false), { ok: true });
  assert.equal(device().phase, 'rewarming');
  run(treated, 10 * 60);
  assert.ok(treated.temp > 34 && treated.temp < 36.5);
  const restored = roundTrip(treated);
  assert.deepEqual(E.advancedDevice(restored, 'ttm'), device());
  assert.equal(restored.cost, treated.cost);
  run(restored, 30 * 60);
  assert.equal(E.advancedDevice(restored, 'ttm').phase, 'complete');
  assert.ok(restored.temp >= 36.5);
  const cost = restored.cost;
  run(restored, 1);
  assert.equal(restored.cost, cost);
  assert.deepEqual(E.advancedDischargeBlockers(restored), []);
}

{
  const severe = { map: 36, ph: 6.93, spo2: 75, hb: 65, coag: 0.38 };
  const activeBleed = { bleedingSites: { trauma: 0.05 } };
  const operation = E.ACTIONS.surgery;
  const makeBed = (seed, diff = 6) => E.create(caseFor(diff, activeBleed, seed), patient);
  let seed;
  for (let candidate = 0; candidate < 100; candidate++) {
    const S = makeBed(candidate);
    const stable = Object.fromEntries(Object.keys(severe).map(key => [key, S[key]]));
    Object.assign(S, severe);
    operation.apply(S);
    const draw = S.procedures.surgery.at(-1);
    if (draw.outcome !== 'failed') continue;
    Object.assign(S, stable, { t: 1 });
    operation.apply(S);
    if (S.procedures.surgery.at(-1).outcome === 'completed') {
      seed = candidate;
      break;
    }
  }
  assert.ok(Number.isInteger(seed));
  const normal = Object.assign(makeBed(seed, 2), severe);
  operation.apply(normal);
  assert.equal(normal.bleedRate, 0);

  const bed = makeBed(seed);
  const stable = Object.fromEntries(Object.keys(severe).map(key => [key, bed[key]]));
  const stableRisk = E.procedureRisk(bed, 0.08);
  Object.assign(bed, severe);
  assert.ok(E.procedureRisk(bed, 0.08) > stableRisk);
  const beforeAttempt = roundTrip(bed);
  operation.apply(bed);
  operation.apply(beforeAttempt);
  assert.deepEqual(bed.procedures.surgery, beforeAttempt.procedures.surgery, '读档前后的抽签一致');
  assert.ok(bed.bleedRate > 0 && bed.death === null);
  const last = bed.procedures.surgery.at(-1);
  assert.equal(last.outcome, 'failed');
  assert.ok(last.cost > 0 && last.cost < operation.cost);
  assert.equal(bed.cost, last.cost);
  assert.equal(E.getReport(bed, last.reportId).kind, 'procedure');
  const restored = roundTrip(bed);
  operation.apply(restored);
  assert.equal(restored.procedures.surgery.length, 1);
  assert.equal(restored.cost, bed.cost, '拒绝原地重试时不会再次收费');
  Object.assign(restored, stable);
  operation.apply(restored);
  assert.equal(restored.procedures.surgery.length, 1, '同一时点即使体征改善也不能刷新抽签');
  restored.t += 1;
  operation.apply(restored);
  assert.equal(restored.bleedRate, 0);
  assert.equal(restored.procedures.surgery.at(-1).attemptNumber, 2);
  assert.notEqual(restored.procedures.surgery.at(-1).roll, last.roll);
  assert.equal(restored.procedures.surgery.at(-1).outcome, 'completed');
  assert.equal(restored.cost, last.cost + operation.cost);
}

{
  const baseline = E.create(caseFor(6), patient);
  baseline.clot = 0.8;
  assert.equal(PE.start(baseline).ok, false, '高难度仍要求有造影证据');
  const severe = { map: 31, ph: 6.93, spo2: 75, hb: 65, coag: 0.38 };
  let bed;
  for (let seed = 0; seed < 100; seed++) {
    const candidate = E.create(caseFor(6, {}, seed), patient);
    candidate.clot = 0.8;
    candidate.diagnosticReports.push({ type: 'ctpa', rows: [{ label: '肺动脉', flag: '异常' }] });
    assert.equal(PE.start(candidate).ok, true, '有明确栓塞时高难度允许跳过稳定性临床限制');
    candidate.t = candidate.peIntervention.dueAt;
    Object.assign(candidate, severe);
    PE.advance(candidate);
    if (PE.status(candidate) === '介入失败') {
      bed = candidate;
      break;
    }
  }
  assert.ok(bed);
  bed.clot = 0.8;
  assert.equal(PE.status(bed), '介入失败');
  assert.equal(bed.clot, 0.8);
  assert.equal(bed.cost, PE.cost);
  assert.equal(bed.procedures.peIntervention.at(-1).cost, PE.cost);
  assert.equal(PE.canRequest(bed), true);
  const loaded = roundTrip(bed);
  delete loaded.peInterventionCost; // Legacy saves recorded the current order's charge only.
  assert.equal(PE.start(loaded).ok, false);
  loaded.t += 599;
  assert.equal(PE.start(loaded).ok, false);
  loaded.t += 1;
  assert.equal(PE.start(loaded).ok, true, '即使状态持平，复评间隔后可再次会诊');
  assert.equal(loaded.cost, PE.cost * 2);
  assert.equal(PE.billedCost(loaded), loaded.cost);
  assert.ok(!E.scoreBreakdown(loaded).items.some(item => item.label === '诊疗费用'));
}

{
  const aorta = E.create(G.generate(2, 101, ['aorticDissection']), patient);
  const action = E.ACTIONS.aortic_replacement;
  const unit = 'aorticBypass';
  const device = S => E.advancedDevice(S, unit);
  const healthy = E.create('exploration', patient);
  assert.equal(E.advancedDeviceAction(healthy, unit, true).ok, false);
  assert.equal(E.advancedDeviceAction(aorta, unit, true).ok, false, '启动设备需要 CTA 确认弓部受累');
  E.orderTest(aorta, 'aorta_cta');
  E.give(aorta, 'labetalol');
  run(aorta, aorta.tests.aorta_cta.readyAt);
  E.pollTests(aorta);
  assert.equal(E.aorticBypassIndicated(aorta), true);
  action.apply(aorta);
  assert.equal(aorta.aorticSurgeryStartedAt, undefined);

  const bedside = E.create(G.generate(6, 101, ['aorticDissection']), patient);
  bedside.diagnosticReports.push(aorta.diagnosticReports.at(-1));
  assert.equal(E.advancedDeviceAction(bedside, 'ttm', true).ok, true);
  bedside.temp = 33.5;
  assert.equal(E.advancedDeviceAction(bedside, unit, true).ok, false);
  assert.equal(E.aorticBypassReady(bedside), false, '床旁亚低温设备与相同温度读数均不能替代手术室准备');

  assert.deepEqual(E.advancedDeviceAction(aorta, unit, true), { ok: true });
  assert.equal(device(aorta).phase, 'cooling');
  runUntil(aorta, S => device(S).stableSeconds >= 30, 20 * 60);
  assert.equal(aorta.temp, device(aorta).target);
  assert.ok(!device(aorta).ready);
  const previousHr = aorta.hr;
  aorta.hr = 40;
  run(aorta, 1);
  assert.equal(device(aorta).stableSeconds, 0, '灌注条件中断后重新计时');
  aorta.hr = previousHr;
  runUntil(aorta, S => device(S).stableSeconds >= 20, 5 * 60);

  const restored = roundTrip(aorta);
  assert.deepEqual(device(restored), device(aorta));
  const pausedTime = restored.t;
  const pausedCost = restored.cost;
  const pausedTemp = restored.temp;
  restored.running = false;
  E.tick(restored, 120);
  assert.equal(restored.t, pausedTime);
  assert.equal(restored.cost, pausedCost);
  assert.equal(restored.temp, pausedTemp);
  restored.running = true;
  runUntil(restored, E.aorticBypassReady, 10 * 60);
  assert.equal(device(restored).stableSeconds, device(restored).stableSecondsRequired);
  const costBeforeSurgery = restored.cost;
  const routineScore = S => E.scoreBreakdown(S).items.find(item => item.label === '诊疗费用');
  const scoreBeforeSurgery = routineScore(restored);
  action.apply(restored);
  assert.equal(restored.cost, costBeforeSurgery + action.cost, '必要手术在低难度也收取实际费用');
  assert.equal(restored.essentialProcedureCost, action.cost);
  assert.deepEqual(routineScore(restored), scoreBeforeSurgery);
  assert.equal(E.advancedDeviceAction(restored, unit, false).ok, false, '手术过程中保留控温');
  action.apply(restored);
  assert.equal(restored.cost, costBeforeSurgery + action.cost, '手术进行中重按不会重复收费');
  runUntil(restored, S => device(S).phase === 'rewarming', 12 * 60);
  assert.ok(restored.aorticSurgeryCompletedAt != null);
  assert.match(E.advancedDischargeBlockers(restored).join(), /手术室体外循环与控温准备/);
  const warming = roundTrip(restored);
  runUntil(warming, S => device(S).phase === 'complete', 12 * 60);
  assert.ok(warming.temp >= 36.5);
  assert.deepEqual(E.advancedDischargeBlockers(warming), []);
}

console.log('探索保护、健康基线、CPR/ECMO、亚低温、弓部手术控温和术中失败读档验证通过');
