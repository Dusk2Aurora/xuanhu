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

function roundTrip(S) {
  return restore(S, JSON.parse(JSON.stringify({ ...S, cas: undefined })));
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
  const S = bed({ contractility: 0.34, rr: 8, vdvt: 0.66, pao2: 45, paco2: 67, shuntSrc: { other: 0.32 } });
  const trialAction = (patient, operation) => E.advancedDeviceAction(patient, 'vaEcmo', operation);
  const device = patient => E.advancedDevice(patient, 'vaEcmo');
  assert.equal(trialAction(S, 'trial').ok, false);
  act(S, 'vaEcmo');
  E.tick(S, 10);
  const before = E.snapshot(S);
  const baseline = E.vaEcmoReadings(S);
  assert.deepEqual(trialAction(S, 'trial'), { ok: true });
  assert.equal(trialAction(S, 'trial').ok, false);
  assert.equal(E.advancedDeviceAction(S, 'vvEcmo', true).ok, false);
  assert.equal(device(S).active, true);
  assert.deepEqual(device(S).trial, { startedAt: S.t, baseline });
  assert.ok(S.map < before.map && S.spo2 < before.spo2 && S.do2 < before.do2);
  const log = (patient, name) => {
    const entry = patient.log.at(-1);
    assert.match(entry[1], new RegExp(`VA-ECMO ${name}.*操作前.*血氧.*心率.*末梢灌注.*操作后.*血氧.*心率.*末梢灌注`));
    assert.equal(entry[3], patient.t);
    assert.equal(entry[5], true);
  };
  log(S, '开始试撤');
  const loaded = restore(S, JSON.parse(JSON.stringify({ ...S, cas: undefined })));
  assert.deepEqual(device(loaded), device(S));
  assert.equal(E.vaEcmoReadings(loaded), E.vaEcmoReadings(S));
  E.tick(loaded, 20);
  assert.equal(loaded.t - device(loaded).trial.startedAt, 20);
  assert.equal(device(loaded).seconds, 30);
  close(device(loaded).cost, 45000 + 2000 * 30 / 3600);
  const low = E.snapshot(loaded);
  assert.deepEqual(trialAction(loaded, 'restore'), { ok: true });
  log(loaded, '结束试撤，恢复原支持');
  assert.equal(trialAction(loaded, 'restore').ok, false);
  assert.equal(device(loaded).trial, undefined);
  assert.equal(device(loaded).startedAt, device(S).startedAt);
  assert.equal(loaded.deviceSetupCost, 45000);
  assert.ok(loaded.map > low.map && loaded.spo2 > low.spo2);
  assert.deepEqual(trialAction(loaded, 'trial'), { ok: true });
  act(loaded, 'vaEcmo', false);
  log(loaded, '试撤后确认停机');
  assert.equal(device(loaded).trial, undefined);
  assert.equal(device(loaded).stoppedAt, loaded.t);
  E.tick(loaded, 10);
  close(device(loaded).cost, 45000 + 2000 * 30 / 3600);
}

{
  const id = 'vvEcmo';
  const S = bed({ contractility: 0.34, rr: 8, vdvt: 0.66, pao2: 45, paco2: 67, shuntSrc: { other: 0.32 } });
  act(S, id);
  run(S, 20);
  const { spo2, co } = S;
  assert.match(E.advancedDeviceReadings(S, id), /PaCO₂ 待查/);
  S.diagnosticReports.push({ sampledAt: 7, reportedAt: 15, values: { paco2: 65 } });
  const baseline = E.advancedDeviceReadings(S, id);
  assert.match(baseline, /PaCO₂ 65 mmHg（采样 00:00:07）/);
  act(S, id, 'trial');
  assert.ok(S.spo2 < spo2);
  close(S.co, co);
  const loaded = roundTrip(S);
  assert.deepEqual(E.advancedDevice(loaded, id).trial, { startedAt: S.t, baseline });
  run(loaded, 20);
  assert.match(E.advancedDeviceReadings(loaded, id), /PaCO₂ 65 mmHg（采样 00:00:07）/);
  const low = loaded.spo2;
  act(loaded, id, 'restore');
  assert.ok(loaded.spo2 > low);
  assert.equal(loaded.deviceSetupCost, 45000);
  act(loaded, id, 'trial');
  act(loaded, id, false);
  assert.equal(E.advancedDevice(loaded, id).active, false);
  assert.match(loaded.log.at(-1)[1], /VV-ECMO 试撤后确认停机.*操作前.*血氧.*操作后.*血氧/);
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
  const id = 'crrt';
  const fields = { renalFactor: 0.2, cr: 310, bun: 19, k: 6.6, hco3: 16, interstitium: 13, vol: 5.3, lungWater: 0.4 };
  const control = bed(fields);
  const paused = bed(fields);
  act(paused, id);
  assert.match(E.advancedDeviceReadings(paused, id), /血钾 待查.*肌酐 待查/);
  act(paused, id, 'trial');
  for (const S of [control, paused]) run(S, 120);
  for (const field of ['k', 'cr', 'bun', 'hco3', 'vol']) close(paused[field], control[field]);
  assert.match(E.advancedDischargeBlockers(paused).join(), /CRRT/);
  assert.equal(E.advancedDevice(paused, id).seconds, 120);
  close(paused.deviceRunningCost, 15);
  const loaded = roundTrip(paused);
  assert.deepEqual(E.advancedDevice(loaded, id), E.advancedDevice(paused, id));
  act(loaded, id, 'restore');
  for (const S of [control, loaded]) run(S, 120);
  assert.ok(loaded.k < control.k && loaded.cr < control.cr && loaded.vol < control.vol && loaded.hco3 > control.hco3);
  assert.equal(loaded.deviceSetupCost, 3500);
  act(loaded, id, 'trial');
  act(loaded, id, false);
  assert.equal(E.advancedDevice(loaded, id).stoppedAt, loaded.t);
  assert.match(loaded.log.at(-1)[1], /CRRT 试撤后确认停机.*操作前 净化暂停.*操作后 净化已停止/);
}

{
  const scenarios = ['highK', 'aki', 'bph'];
  const advance = (S, minutes) => {
    for (let step = 0; step < minutes * 6; step++) {
      E.tick(S, 10);
      CASEGEN.step(S, 10, E);
    }
    assert.equal(S.death, null);
  };
  for (const id of scenarios) {
    const spec = CASEGEN.generate(2, 43, [id]);
    const control = E.create(spec, identity);
    const intermittent = E.create(spec, identity);
    const continuous = E.create(spec, identity);
    E.ACTIONS.dialysis.apply(intermittent);
    act(continuous, 'crrt');
    for (const S of [control, intermittent, continuous]) advance(S, 30);
    assert.ok(intermittent.k < continuous.k && continuous.k < control.k - 0.5, id);
    if (id === 'highK') {
      const expectedEnd = intermittent.dialysisUntil;
      E.ACTIONS.dialysis.apply(intermittent);
      assert.equal(intermittent.dialysisUntil, expectedEnd);
      assert.match(intermittent.log.at(-1)[1], /预计还需 150 分钟/);
      advance(intermittent, 150);
      const postDialysis = intermittent.k;
      assert.ok(postDialysis < 5.5);
      advance(intermittent, 30);
      assert.ok(intermittent.k > postDialysis + 0.2);
      assert.equal(intermittent.log.filter(([, text]) => text.includes('血液透析已结束')).length, 1);
    }
  }
}

{
  const S = bed({ renalFactor: 0.2, cr: 310, k: 4.5, hco3: 19, kProd: 0.16 });
  act(S, 'crrt');
  act(S, 'crrt', 'trial');
  const sampledAt = S.t;
  E.orderTest(S, 'bmp');
  run(S, 35 * 60);
  E.pollTests(S);
  const report = E.reports(S, 'bmp').at(-1);
  assert.equal(report.sampledAt, sampledAt);
  assert.equal(report.reportedAt, sampledAt + 35 * 60);
  assert.equal(report.values.k, 4.5);
  assert.ok(S.k > report.values.k + 0.3);
  assert.match(E.advancedDeviceReadings(S, 'crrt'), /净化暂停.*血钾 4.5 mmol\/L（采样 00:00:00）/);
  E.orderTest(S, 'poct_abg');
  run(S, 2 * 60);
  E.pollTests(S);
  const potassium = E.knownResults(S).k;
  assert.equal(potassium.sampledAt, report.reportedAt);
  assert.ok(potassium.value > report.values.k);
  assert.match(E.advancedDeviceReadings(S, 'crrt'), /血钾 \d\.\d mmol\/L（采样 00:35:00）/);
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
  const id = 'eeg';
  const S = bed();
  act(S, id);
  run(S, 20);
  act(S, id, 'trial');
  assert.equal(E.eegReading(S).status, 'paused');
  S.seizure = 0.12;
  run(S, 70);
  assert.equal(E.eegReading(S).lastSeizureAt, null);
  const loaded = roundTrip(S);
  assert.deepEqual(E.eegReading(loaded), E.eegReading(S));
  loaded.seizure = 0;
  act(loaded, id, 'restore');
  run(loaded, 39);
  assert.equal(E.eegReading(loaded).status, 'collecting');
  run(loaded, 1);
  assert.equal(E.eegReading(loaded).status, 'normal');
  assert.equal(loaded.deviceSetupCost, 600);
  close(loaded.deviceRunningCost, 120 * 130 / 3600);
  act(loaded, id, 'trial');
  loaded.seizure = 0.12;
  act(loaded, id, false);
  assert.equal(E.eegReading(loaded).lastSeizureAt, null);
  assert.match(loaded.log.at(-1)[1], /试撤后确认停机.*操作前 试撤中.*操作后 已停止监测/);
}

{
  const id = 'ttm';
  const S = bed({ temp: 34 });
  S.roscAt = S.t;
  S.gcs = 8;
  act(S, id);
  act(S, id, 'trial');
  run(S, 20);
  assert.ok(S.temp > 34, '试撤时体温按患者自身变化');
  close(S.deviceRunningCost, 250 * 20 / 3600);
  const loaded = roundTrip(S);
  assert.deepEqual(E.advancedDevice(loaded, id), E.advancedDevice(S, id));
  const warmed = loaded.temp;
  act(loaded, id, 'restore');
  assert.equal(E.advancedDevice(loaded, id).target, 34);
  run(loaded, 1);
  assert.ok(loaded.temp < warmed);
  assert.equal(loaded.deviceSetupCost, 1800);
  act(loaded, id, 'trial');
  act(loaded, id, false);
  assert.equal(E.advancedDevice(loaded, id).trial, undefined);
  assert.equal(E.advancedDevice(loaded, id).phase, 'rewarming');
  assert.match(loaded.log.at(-1)[1], /亚低温治疗 试撤后开始受控复温.*操作前 控温暂停.*操作后 受控复温中/);
  assert.equal(E.advancedDeviceAction(loaded, id, 'trial').ok, false);
}

{
  const id = 'aorticBypass';
  const S = E.create(CASEGEN.generate(2, 101, ['aorticDissection']), identity);
  E.orderTest(S, 'aorta_cta');
  E.give(S, 'labetalol');
  run(S, S.tests.aorta_cta.readyAt);
  E.pollTests(S);
  act(S, id);
  for (let i = 0; i < 1200 && !E.aorticBypassReady(S); i++) E.tick(S, 1);
  assert.equal(E.aorticBypassReady(S), true);
  act(S, id, 'trial');
  assert.match(E.advancedDeviceReadings(S, id), /控温暂停.*核心体温.*末梢灌注/);
  assert.equal(E.aorticBypassReady(S), false);
  assert.equal(E.advancedDevice(S, id).stableSeconds, 0);
  E.ACTIONS.aortic_replacement.apply(S);
  assert.equal(S.aorticSurgeryStartedAt, undefined);
  run(S, 10);
  const loaded = roundTrip(S);
  assert.deepEqual(E.advancedDevice(loaded, id), E.advancedDevice(S, id));
  act(loaded, id, 'restore');
  assert.equal(E.aorticBypassReady(loaded), false);
  for (let i = 0; i < 300 && !E.aorticBypassReady(loaded); i++) E.tick(loaded, 1);
  assert.equal(E.aorticBypassReady(loaded), true);
  E.ACTIONS.aortic_replacement.apply(loaded);
  assert.ok(Number.isFinite(loaded.aorticSurgeryStartedAt));
  assert.equal(E.advancedDeviceAction(loaded, id, 'trial').ok, false);
  assert.equal(E.advancedDeviceAction(loaded, id, false).ok, false);
  assert.equal(loaded.deviceSetupCost, 2400);
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
