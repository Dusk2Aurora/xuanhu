const assert = require('node:assert/strict');
const E = require('../prototype/engine');
const FINANCE = require('../prototype/finance');
const CASEGEN = require('../prototype/generator');
const SUB = require('../prototype/substances');
const PE_INTERVENTION = require('../prototype/pe-intervention');

const identity = { name: '测试患者', sex: '男', age: 45, weight: 70, height: 172 };
const scenario = (init = {}, tags = []) => ({ id: 'advanced-device-test', goals: [], tags, init: { ...CASEGEN.BASE, ...init } });
const bed = (init, tags) => E.create(scenario(init, tags), identity);
const act = (S, id, enable = true) => assert.deepEqual(E.advancedDeviceAction(S, id, enable), { ok: true });
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} ≈ ${expected}`);

function run(S, seconds) {
  for (let i = 0; i < seconds; i++) E.tick(S, 1);
  assert.equal(S.death, null);
}

function restore(S, saved) {
  const loaded = Object.assign(E.create(S.cas, identity), saved);
  E.restorePatient(loaded);
  E.restoreCardiorespiratory(loaded, saved);
  E.restoreDischargeObservation(loaded, saved);
  return loaded;
}

{
  const first = bed();
  const second = bed();
  act(first, 'vaEcmo');
  act(first, 'crrt');
  act(first, 'eeg');
  assert.equal(E.advancedDeviceAction(first, 'vaEcmo', true).ok, false);
  assert.equal(E.advancedDeviceAction(first, 'vvEcmo', true).ok, false);
  act(second, 'vvEcmo');
  act(second, 'crrt');
  assert.equal(first.cost, 49100);
  assert.equal(second.cost, 48500);
  assert.equal(E.advancedDevice(first, 'vvEcmo').active, false);
  assert.equal(E.advancedDevice(second, 'eeg').active, false);

  for (let i = 0; i < 50; i++) E.tick(first, 0.2);
  E.tick(second, 10);
  for (const S of [first, second]) {
    close(E.advancedDevice(S, 'crrt').seconds, 10);
    close(E.advancedDevice(S, 'crrt').cost, 3500 + 450 / 360);
  }
  const { cas, ...state } = first;
  const saved = JSON.parse(JSON.stringify(state));
  const loaded = restore(first, saved);
  assert.deepEqual(E.advancedDevice(loaded, 'vaEcmo'), E.advancedDevice(first, 'vaEcmo'));
  assert.equal(loaded.cost, first.cost, '恢复进行中的器械无需再次收取启动费');
  assert.equal(E.advancedDeviceAction(loaded, 'vvEcmo', true).ok, false);
  act(loaded, 'vaEcmo', false);
  act(loaded, 'vvEcmo');
  run(loaded, 50);
  assert.equal(E.advancedDevice(first, 'vaEcmo').active, true);
  assert.equal(E.advancedDevice(second, 'vvEcmo').seconds, 10);
  close(E.advancedDevice(loaded, 'vaEcmo').cost, 45000 + 2000 / 360);
  close(E.advancedDevice(loaded, 'vvEcmo').cost, 45000 + 2000 * 50 / 3600);
  close(E.advancedDeviceCost(loaded), 94100 + (2000 + 450 + 120) / 60);
  close(E.advancedDeviceCost(loaded), loaded.cost);
  close(loaded.deviceSetupCost, 94100);
  close(loaded.deviceRunningCost, (2000 + 450 + 120) / 60);
  const billing = FINANCE.costSummary(loaded);
  assert.equal(billing.selfPayOnly, 90033.33);
  assert.equal(billing.partialUpfront, 1232.85);

  delete saved.advancedCare;
  for (const key of ['deviceCost', 'deviceSetupCost', 'deviceRunningCost', 'coverageCost']) delete saved[key];
  saved.cost = 200;
  const legacy = restore(first, saved);
  assert.equal(E.advancedDeviceCost(legacy), 0);
  assert.equal(legacy.cost, 200);
  assert.deepEqual(E.advancedDischargeBlockers(legacy), []);
  act(legacy, 'crrt');
  assert.equal(legacy.cost, 3700);
}

{
  const fields = { contractility: 0.34, rr: 8, vdvt: 0.66, pao2: 45, paco2: 67, shuntSrc: { other: 0.32 } };
  const control = bed(fields);
  const va = bed(fields);
  const vv = bed(fields);
  act(va, 'vaEcmo');
  act(vv, 'vvEcmo');
  for (const S of [control, va, vv]) run(S, 120);
  assert.ok(E.bp(va).map > E.bp(control).map + 20 && va.co > control.co + 1.5);
  close(vv.co, control.co);
  assert.equal(E.bp(vv).map, E.bp(control).map);
  for (const S of [va, vv]) {
    assert.ok(S.spo2 > control.spo2 + 15 && S.paco2 < control.paco2);
    assert.equal(S.contractility, fields.contractility);
    assert.equal(S.shuntSrc.other, fields.shuntSrc.other);
  }
  act(va, 'vaEcmo', false);
  act(vv, 'vvEcmo', false);
  assert.ok(E.bp(va).map < 65, '撤除后马上看到原有循环问题');
  assert.ok(vv.spo2 < 90, '撤除后马上看到原有氧合问题');
  assert.equal(E.dischargeCheck(va).circulationObservation.phase, 'unstable');

  const stable = bed();
  act(stable, 'vaEcmo');
  run(stable, 60);
  act(stable, 'vaEcmo', false);
  assert.match(E.dischargeCheck(stable).reasons.join('；'), /撤除 ECMO 后/);
  run(stable, 301);
  assert.equal(E.dischargeCheck(stable).circulationObservation.phase, 'observing');
  run(stable, 600);
  assert.equal(E.dischargeCheck(stable).ok, true);
}

{
  const fields = { renalFactor: 0.2, cr: 310, bun: 19, k: 6.6, hco3: 16, interstitium: 13, vol: 5.3, lungWater: 0.4 };
  const control = bed(fields);
  const treated = bed(fields);
  act(treated, 'crrt');
  E.ACTIONS.dialysis.apply(treated);
  assert.equal(treated.dialysisUntil, -1);
  const intermittent = bed();
  E.ACTIONS.dialysis.apply(intermittent);
  assert.equal(E.advancedDeviceAction(intermittent, 'crrt', true).ok, false);
  assert.equal(intermittent.cost, 0);
  for (const S of [control, treated]) run(S, 30 * 60);
  assert.ok(treated.k < control.k - 0.5 && treated.hco3 > control.hco3 + 1);
  assert.ok(treated.cr < control.cr - 20 && treated.bun < control.bun - 1);
  assert.ok(treated.vol < control.vol && treated.renalFactor === fields.renalFactor);
  assert.deepEqual(E.advancedDischargeBlockers(treated), ['仍在使用 CRRT，撤除后需重新评估']);
  act(treated, 'crrt', false);
  assert.match(E.dischargeCheck(treated).reasons.join('；'), /CRRT 撤除后需连续留观 30/);

  const stable = bed();
  act(stable, 'crrt');
  run(stable, 60);
  act(stable, 'crrt', false);
  assert.equal(E.dischargeCheck(stable).ok, false);
  run(stable, 30 * 60 + 1);
  assert.equal(E.dischargeCheck(stable).ok, true);
}

{
  const observed = bed({ seizure: 0.12 }, ['seizure']);
  const unobserved = bed({ seizure: 0.12 }, ['seizure']);
  assert.equal(E.convulsionSigns(observed), null, '查体无可见抽动');
  act(observed, 'eeg');
  assert.equal(E.eegReading(observed).status, 'collecting');
  for (const S of [observed, unobserved]) run(S, 60);
  assert.equal(E.eegReading(observed).status, 'seizure');
  assert.equal(E.eegReading(unobserved).status, 'off');
  assert.equal(observed.seizure, unobserved.seizure);
  assert.equal(observed.gcs, unobserved.gcs);
  observed.seizure = 0;
  run(observed, 1);
  assert.equal(E.eegReading(observed).lastSeizureAt, 60);
  assert.equal(E.eegReading(observed).status, 'normal');
  assert.equal(E.dischargeCheck(observed).ok, true, '单独监测可随出院结束');
  E.endCase(observed, 'discharge');
  assert.equal(observed.discharged, true);
  assert.equal(E.advancedDevice(observed, 'eeg').active, false);
  assert.equal(E.advancedDevice(observed, 'eeg').stoppedAt, 61);
}

{
  const S = bed();
  act(S, 'vaEcmo');
  act(S, 'crrt');
  E.endCase(S, 'discharge', '测试');
  assert.equal(S.discharged, false);
  assert.equal(S.running, true);
  const outcome = E.signDischarge(S);
  assert.equal(outcome.status, 'failed');
  assert.match(outcome.majorReasons.join('；'), /VA-ECMO.*CRRT/);
  assert.equal(S.discharged, false);
  assert.equal(S.running, false);
  assert.equal(E.advancedDevice(S, 'vaEcmo').active, false);
  const failedCost = S.cost;
  E.tick(S, 3600);
  assert.equal(S.cost, failedCost);

  const terminal = bed();
  act(terminal, 'vvEcmo');
  terminal.insult.acid = 4;
  E.tick(terminal, 0.2);
  assert.ok(terminal.death);
  close(terminal.cost, 45000 + 2000 * 0.2 / 3600);
  assert.equal(E.advancedDevice(terminal, 'vvEcmo').stoppedAt, 0.2);
  const deathCost = terminal.cost;
  E.tick(terminal, 3600);
  assert.equal(terminal.cost, deathCost);
}

{
  const S = bed();
  S.cost = 1040;
  assert.equal(E.finalScore(S), 98, '普通诊疗费用仍使用原有评分规则');
  act(S, 'vaEcmo');
  const fab = SUB.byId('digoxinFab');
  assert.ok(E.give(S, fab.id) > 0);
  assert.equal(S.rescueDrugCost, fab.cost);
  assert.equal(E.finalScore(S), 98);

  S.clot = 0.5;
  S.hematoma = 0.2;
  S.diagnosticReports.push({ type: 'ctpa', rows: [{ label: '肺动脉', flag: '异常' }] });
  assert.deepEqual(PE_INTERVENTION.start(S), { ok: true });
  assert.equal(S.cost, 1040 + 45000 + fab.cost + PE_INTERVENTION.cost);
  assert.equal(E.finalScore(S), 98, '实际记账的设备、救援药和取栓费用独立于临床分');
  S.penalties = 1;
  S.penaltyReasons = [{ label: '缺乏用药指征', count: 1 }];
  assert.equal(E.finalScore(S), 92, '评分仍执行失当用药的带教扣分');
}

console.log('高级设备：逐床状态、计费、病理效应、撤除评估、脑电与旧档通过');
