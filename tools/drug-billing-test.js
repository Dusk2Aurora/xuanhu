const assert = require('node:assert/strict');
const SUB = require('../prototype/substances');
const CASEGEN = require('../prototype/generator');
const E = require('../prototype/engine');
const FINANCE = require('../prototype/finance');
const ACHIEVEMENTS = require('../prototype/achievements');
const SHARE = require('../prototype/share');

const baseline = { id: 'drug-billing-test', init: { ...CASEGEN.BASE } };
const bed = (weight = 70, scenario = baseline) => E.create(scenario, { weight });
const close = (actual, expected, message) => {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${message} (${actual} != ${expected})`);
};
const reload = (scenario, saved) => {
  const base = bed(70, scenario);
  const S = Object.assign(base, structuredClone(saved));
  E.restorePatient(S, saved);
  E.restoreDrugCost(S, saved);
  return S;
};

{
  const S = bed();
  const calcium = SUB.byId('calcium');
  const prbc = SUB.byId('prbc');
  const water = SUB.byId('water');
  const levetiracetam = SUB.byId('levetiracetam');
  E.give(S, 'calcium', calcium.dose / 2);
  E.give(S, 'calcium', 2 * calcium.dose);
  assert.deepEqual(S.given.map(order => order.cost), [calcium.cost / 2, 2 * calcium.cost]);
  let drugCost = 2.5 * calcium.cost;
  E.give(S, 'prbc', prbc.dose / 2);
  drugCost += prbc.cost / 2;
  const platelets = SUB.byId('c_plt');
  E.give(S, platelets.id, platelets.dose);
  drugCost += platelets.cost;
  E.give(S, 'water', 2);
  E.orderTest(S, 'bmp');
  E.give(S, 'levetiracetam', levetiracetam.dose / 2, '静滴');
  drugCost += levetiracetam.cost / 2;
  E.tick(S, 15 * 60);
  close(S.drugCost, drugCost, '短时输注按总量结算一次，药费含血液制品');
  close(S.cost, drugCost + 2 * water.cost + E.TESTS.bmp.cost, '食品和检查另入诊疗总费用');
  E.give(S, 'saline', E.DRUGS.saline.defaultDose / 2);
  close(S.drugCost, drugCost + E.DRUGS.saline.cost / 2, '兼容药物路径同样按量结算');
}

{
  const S = bed(70, E.CASES.opioid);
  assert.ok(S.given.some(order => order.id === 'morphine' && order.cost === 0));
  assert.equal(S.drugCost, 0, '院前吗啡保留给药记录');
  assert.equal(S.cost, 0);
  const scenario = { ...baseline, init: { ...baseline.init, preload: [['norepi', 8]] } };
  const running = bed(70, scenario);
  assert.equal(running.drugCost, 0, '创建病例的初始生理步长无需结算');
  E.tick(running, 1);
  close(running.drugCost, E.drugPrice(SUB.byId('norepi'), 8, running.patient) / 3600, '入院后泵入时间开始计费');
}

{
  const S = bed(105);
  const otherBed = bed(70);
  const norepi = SUB.byId('norepi');
  const dobutamine = SUB.byId('dobutamine');
  const nicardipine = SUB.byId('nicardipine');
  assert.equal(E.drugPrice(dobutamine, dobutamine.dose, S.patient), 1.5 * dobutamine.cost);
  assert.equal(E.drugPrice(dobutamine, dobutamine.dose, otherBed.patient), dobutamine.cost);
  assert.equal(E.drugPrice(norepi, norepi.dose, S.patient), norepi.cost);
  for (const patient of [S, otherBed]) E.give(patient, 'norepi', norepi.dose / 2);
  assert.equal(S.drugCost, 0, '开泵不产生整次费用');
  E.tick(S, 0.2);
  assert.ok(S.drugCost > 0 && S.drugCost < 0.01, '保留低于一分钱的累计费用');
  assert.equal(otherBed.drugCost, 0);
  for (let i = 1; i < 300; i++) E.tick(S, 0.2);
  E.tick(otherBed, 60);
  close(S.drugCost, norepi.cost / 120, '按实际低泵速和模拟时间计费');
  close(S.drugCost, otherBed.drugCost, '不同推进步长结算一致');

  const beforeAdjust = S.drugCost;
  E.give(S, 'norepi', norepi.dose * 2);
  E.give(S, 'nicardipine');
  E.give(S, 'dobutamine');
  assert.equal(E.give(S, 'norepi', norepi.dose * 2), null);
  assert.equal(S.drugCost, beforeAdjust, '调速和增设泵只更新速度');
  const { cas, ...state } = S;
  const saved = JSON.parse(JSON.stringify(state));
  const resumed = reload(cas, saved);
  assert.equal(resumed.drugCost, beforeAdjust);
  assert.equal(resumed.drugCostPartial, false);
  E.tick(resumed, 60);
  const withThreePumps = beforeAdjust + (2 * norepi.cost + 1.5 * dobutamine.cost + nicardipine.cost) / 60;
  close(resumed.drugCost, withThreePumps, '重载后同床三台运行中的泵分别结算');
  assert.equal(E.stopPump(resumed, 'norepi'), norepi.dose * 2);
  assert.equal(E.stopPump(resumed, 'norepi'), null);
  E.tick(resumed, 60);
  const withTwoPumps = withThreePumps + (1.5 * dobutamine.cost + nicardipine.cost) / 60;
  close(resumed.drugCost, withTwoPumps, '停泵后只结算其他仍运行的泵');
  close(resumed.cost, resumed.drugCost, '泵入费用同步计入诊疗总费用');

  delete saved.drugCost;
  delete saved.drugCostPartial;
  saved.cost = 170;
  const oldSave = reload(cas, saved);
  assert.equal(oldSave.drugCost, 0);
  assert.equal(oldSave.cost, 170);
  assert.equal(oldSave.drugCostPartial, true);
  oldSave.insult.acid = 4;
  E.tick(oldSave, 0.2);
  assert.ok(oldSave.death && !oldSave.running);
  const throughDeath = (2 * norepi.cost + 1.5 * dobutamine.cost + nicardipine.cost) * 0.2 / 3600;
  close(oldSave.drugCost, throughDeath, '病例结束的最后一个模拟步长正常结算');
  E.tick(oldSave, 60);
  close(oldSave.drugCost, throughDeath, '结束后不继续计费');
  const { cas: oldCas, ...oldState } = oldSave;
  const secondReload = reload(oldCas, JSON.parse(JSON.stringify(oldState)));
  assert.equal(secondReload.drugCostPartial, true);
  close(secondReload.drugCost, throughDeath, '再次存档保留本版累计金额与标记');
  close(secondReload.cost, 170 + throughDeath, '旧档总费用保留并累加新费用');
}

{
  const heparin = SUB.byId('heparin');
  const route = heparin.routes.find(route => route.pumpHalfLife);
  const S = bed(), control = bed();
  const advance = (patient, minutes) => {
    for (let second = 0; second < minutes * 60; second += 10) E.tick(patient, 10);
    assert.ok(patient.running);
  };
  E.setBleedingRate(S, 'test', 0.0005);
  E.setBleedingRate(control, 'test', 0.0005);
  assert.equal(E.give(S, heparin.id, 1200, route.r), 1200);
  assert.equal(S.pk.length, 0, '开泵不会生成静推医嘱');
  assert.equal(S.drugCost, 0);
  advance(S, 30);
  advance(control, 30);
  assert.ok(E.coagulation(S) < E.coagulation(control) && S.rbcMass < control.rbcMass);
  const initialActivity = E.heparinActivity(S);
  assert.equal(E.give(S, heparin.id, 1800, route.r), 1800);
  close(E.heparinActivity(S), initialActivity, '调速延续已有抗凝活性');
  assert.equal(E.give(S, heparin.id, 1800, route.r), null);
  advance(S, 20);
  E.orderTest(S, 'coag');
  const sampled = S.tests.coag.sample;
  assert.ok(sampled.s.aptt > 29 && sampled.s.heparinAntiXa > 0);
  const beforePause = E.heparinActivity(S);
  assert.equal(E.pausePump(S, heparin.id), 1800);
  assert.equal(E.pausePump(S, heparin.id), null);
  assert.match(S.log.at(-1)[1], /暂停泵入.*1800 U\/h.*600 U.*¥5\.40/);
  const { cas, ...state } = S;
  const restored = reload(cas, JSON.parse(JSON.stringify(state)));
  advance(restored, 60);
  close(E.heparinActivity(restored), beforePause / 2, '暂停后按半衰期清除');
  close(restored.drugCost, 10.8, '暂停和重载期间不产生额外泵费');
  E.pollTests(restored);
  const report = E.reports(restored, 'coag').at(-1);
  assert.equal(report.sampledAt, sampled.t);
  assert.equal(report.values.aptt, sampled.s.aptt);
  assert.equal(report.values.heparinAntiXa, sampled.s.heparinAntiXa);
  assert.equal(report.rows.find(row => row.label === '采样时普通肝素泵速')?.value, '1800 U/h');
  E.orderTest(restored, 'coag');
  assert.ok(restored.tests.coag.sample.s.heparinAntiXa < report.values.heparinAntiXa);
  assert.equal(E.give(restored, heparin.id, 1800, route.r), 1800);
  assert.equal(restored.given.at(-1).pumpAction, 'resume');
  advance(restored, 20);
  assert.equal(E.stopPump(restored, heparin.id), 1800);
  const segments = restored.given.filter(given => given.pumpSeconds > 0);
  assert.equal(segments.length, 3);
  for (const segment of segments) {
    assert.equal(segment.unit, 'U/h');
    close(segment.endedAt - segment.t, segment.pumpSeconds, '医嘱时段与运行时长一致');
    close(segment.pumpDose, 600, '药量随每段泵速和时间计算');
    close(segment.cost, 5.4, '按该段实际用量收费一次');
  }
  close(restored.drugCost, 16.2, '三段费用与药费汇总一致');
  close(E.pumpDelivery(restored, heparin.id).dose, 1800, '泵入量汇总与三段医嘱一致');
  E.give(restored, heparin.id);
  E.give(restored, heparin.id, heparin.dose, '皮下');
  assert.deepEqual(restored.pk.map(order => order.route), ['静推', '皮下']);
  close(restored.drugCost, 16.2 + 2 * heparin.cost, '静推与皮下仍按单次剂量计费');

  for (const finish of [
    patient => E.endCase(patient, 'discharge', '达到出院标准'),
    patient => { patient.k = 8; assert.equal(E.signDischarge(patient).status, 'failed'); },
    patient => E.endCase(patient, 'death', '测试病案结束'),
  ]) {
    const patient = bed();
    E.give(patient, heparin.id, 1200, route.r);
    advance(patient, 1);
    finish(patient);
    const [segment, stopped] = patient.given;
    assert.equal(segment.endedAt, patient.t);
    assert.equal(stopped.pumpAction, 'stop');
    close(segment.pumpDose, 20, '结算时关闭最后一段并记录实际泵量');
    close(segment.cost, 0.18, '结算时最后一段费用与汇总一致');
    assert.match(patient.log.at(-2)[1], /停止泵入.*1200 U\/h.*20 U.*¥0\.18/);
    E.finishPumps(patient);
    E.tick(patient, 60);
    assert.equal(patient.given.length, 2, '整理病历时重复结算不增加医嘱');
    close(patient.drugCost, segment.cost, '结算后无新增泵入费用');
  }
}

{
  const esmolol = SUB.byId('esmolol');
  const route = esmolol.routes[0];
  const scenario = CASEGEN.generate(2, 101, ['aorticDissection']);
  const S = bed(105, scenario), control = bed(105, scenario);
  const advance = (patient, minutes) => {
    for (let second = 0; second < minutes * 60; second += 2) {
      E.tick(patient, 2);
      CASEGEN.step(patient, 2, E);
    }
    assert.ok(patient.running);
  };
  assert.equal(esmolol.unit, 'μg/kg/min');
  assert.equal(E.give(S, esmolol.id, 50, '静推'), null);
  assert.equal(E.give(S, esmolol.id, 225, route.r), null);
  assert.equal(E.give(S, esmolol.id, 50, route.r), 50);
  assert.equal(S.drugCost, 0);
  advance(S, 9);
  advance(control, 9);
  assert.ok(S.hr < control.hr - 8 && E.bp(S).sys < E.bp(control).sys);
  assert.ok(S.aorticDissectionLoad < control.aorticDissectionLoad, '较低的心率和血压减缓夹层进展');
  close(E.pumpDelivery(S, esmolol.id).dose, 47.25, '按体重和实际分钟数换算输注毫克量');
  close(S.drugCost, 10.8, '按体重和泵入时间计费');
  const beforeAdjust = E.pumpEffect(S, esmolol.id);
  assert.equal(E.give(S, esmolol.id, 100, route.r), 100);
  close(E.pumpEffect(S, esmolol.id), beforeAdjust, '调速延续已有药效');
  advance(S, 9);
  assert.ok(S.hr < 80 && E.bp(S).map > 65);
  assert.ok(E.dischargeCheck(S).majorReasons.some(reason => reason.includes(esmolol.n)));
  const beforePause = E.pumpEffect(S, esmolol.id);
  const hrBeforePause = S.hr;
  assert.equal(E.pausePump(S, esmolol.id), 100);
  assert.match(S.log.at(-1)[1], /100 μg\/kg\/min.*94\.5 mg.*¥21\.60/);
  const { cas, ...state } = S;
  const restored = reload(cas, JSON.parse(JSON.stringify(state)));
  advance(restored, 9);
  assert.ok(E.pumpEffect(restored, esmolol.id) < beforePause * 0.65 && restored.hr > hrBeforePause);
  close(restored.drugCost, 32.4, '暂停期间保留已计费用');
  assert.equal(E.give(restored, esmolol.id, 100, route.r), 100);
  assert.equal(restored.given.at(-1).pumpAction, 'resume');
  advance(restored, 1);
  assert.equal(E.stopPump(restored, esmolol.id), 100);
  assert.equal(E.pumpDelivery(restored, esmolol.id).unit, 'mg');
  close(E.pumpDelivery(restored, esmolol.id).dose, 152.25, '暂停、恢复和停用保留累计输注量');
  close(restored.drugCost, 34.8, '只对实际泵入时段计费');
}

{
  const budgets = Array.from({ length: 2048 }, (_, seed) => FINANCE.initInsurance({ seed }).oopCap)
    .sort((a, b) => a - b);
  assert.ok(budgets[0] < 9000 && budgets[511] < 25000, '新预算仍覆盖困难家庭和相对有限的家庭');
  assert.ok(budgets[1023] > 45000, '典型家庭的承受力提高');
  assert.ok(budgets[1637] > 100000 && budgets[1945] > 160000, '预算高尾可承担长时高端设备运行');
  assert.deepEqual(FINANCE.initInsurance({ seed: 42 }), FINANCE.initInsurance({ cas: { seed: 42 } }));

  const old = { cost: 1000, bedCost: 25,
    ins: { t: '职工医保', rate: 0.78, ded: 800, cap: 30000, income: 5000, oopCap: 16000 } };
  assert.deepEqual(FINANCE.costSummary(old), {
    total: 1025, reimb: 175.50, selfPay: 849.50, cap: 16000, selfPayOnly: 0, partialUpfront: 0, eligible: 1025,
  });
  const fractional = { ...old, cost: 1000.003 };
  const withSelfPay = FINANCE.costSummary(fractional, 0.004, 'selfPay');
  assert.equal(withSelfPay.total, 1025.01);
  assert.equal(withSelfPay.eligible, 1025, '全自费亚分费用的取整不改变医保基数');
  FINANCE.initInsurance(old, '居民医保');
  assert.equal(old.ins.income, 5000);
  assert.equal(old.ins.oopCap, 16000, '旧档预算在切换参保类型时也保留原值');
}

{
  const S = bed();
  const otherBed = bed();
  FINANCE.initInsurance(S, '职工医保');
  S.cost = 799;
  const pcc = SUB.byId('pcc4');
  const pccCost = E.drugPrice(pcc, pcc.dose / 2, S.patient);
  const pccQuote = FINANCE.costSummary(S, pccCost, pcc.coverage);
  E.give(S, pcc.id, pcc.dose / 2);
  assert.deepEqual(FINANCE.costSummary(S), pccQuote);
  assert.equal(pccQuote.partialUpfront, pccCost * 0.30);
  assert.equal(pccQuote.eligible, 799 + pccCost - pccQuote.partialUpfront);
  assert.equal(S.drugCost, pccCost);

  const reversal = SUB.byId('idarucizumab');
  const price = E.drugPrice(reversal, reversal.dose, S.patient);
  const reversalQuote = FINANCE.costSummary(S, price, reversal.coverage);
  E.give(S, reversal.id);
  assert.deepEqual(FINANCE.costSummary(S), reversalQuote);
  assert.equal(reversalQuote.selfPayOnly, price);
  assert.equal(reversalQuote.reimb, pccQuote.reimb, '全自费药不进入起付线或报销基数');

  const { startCost, hourlyCost, coverage } = E.ADVANCED_DEVICES.crrt;
  const deviceQuote = FINANCE.costSummary(S, startCost, coverage);
  assert.ok(E.advancedDeviceAction(S, 'crrt', true).ok);
  assert.deepEqual(FINANCE.costSummary(S), deviceQuote);
  E.tick(S, 60);
  assert.equal(S.deviceSetupCost, startCost);
  close(S.deviceRunningCost, hourlyCost / 60, '按 CRRT 实际运行时间计费');
  assert.equal(otherBed.cost, 0);
  assert.equal(otherBed.coverageCost, undefined, '同病房的另一床无本床结算分项');

  const { cas, ...state } = S;
  const resumed = reload(cas, JSON.parse(JSON.stringify(state)));
  assert.deepEqual(FINANCE.costSummary(resumed), FINANCE.costSummary(S), '存档保留器械费和医保分项');
  E.tick(resumed, 60);
  close(resumed.deviceRunningCost, hourlyCost / 30, '恢复后从已有运行费继续累加');
  close(resumed.deviceCost, resumed.deviceSetupCost + resumed.deviceRunningCost, '启动费和运行费合计等于器械费');
}

const earnedNoPressor = S => {
  ACHIEVEMENTS.reset();
  S.discharged = true;
  return ACHIEVEMENTS.evaluate(S).includes('no_pressor');
};

{
  const scenario = E.CASES.sepsis;
  const untreated = bed(70, scenario);
  E.give(untreated, 'ceftriaxone');
  E.give(untreated, 'furosemide');
  assert.ok(untreated.drugCost > 0);
  assert.equal(earnedNoPressor(untreated), true, '非升压药费不影响本床成就');
  const penalized = bed(70, scenario);
  penalized.dischargeOutcome = { status: 'penalized' };
  assert.equal(earnedNoPressor(penalized), false, '扣分出院不符合稳定出院条件');

  for (const id of ['norepi', 'dopamine', 'epi', 'phenylephrine', 'vasopressin']) {
    const treated = bed(70, scenario);
    assert.ok(E.give(treated, id) > 0);
    if (E.pumpRate(treated, id)) E.stopPump(treated, id);
    treated.log = [];
    treated.pk = [];
    const { cas, ...saved } = treated;
    const resumed = reload(cas, JSON.parse(JSON.stringify(saved)));
    assert.equal(earnedNoPressor(resumed), false, `给药记录重载后仍可识别 ${id}`);
    assert.equal(earnedNoPressor(untreated), true, '另一张床的升压药不计入本床');
  }

  const treated = bed(70, scenario);
  E.give(treated, 'norepi');
  const preview = SHARE.parse(SHARE.make(treated)).data;
  assert.ok(preview.a.some(order => order[2] === 'norepi'));
  const retaken = SHARE.rebuild(preview, E);
  assert.equal(retaken.drugCost, 0);
  assert.equal(earnedNoPressor(retaken), true, '会诊接手从接诊初始状态独立累计用药');
}

{
  const scenario = { ...baseline, tags: ['sepsis'], init: { ...baseline.init, preload: [['norepi', 8]] } };
  const pretreated = bed(70, scenario);
  assert.deepEqual(pretreated.log, []);
  assert.equal(pretreated.drugCost, 0);
  assert.equal(earnedNoPressor(pretreated), false, '院前已实际使用升压药，即使尚未计费也有用药记录');

  const oldSave = { cost: 60, log: [['给药', '去甲肾上腺素 8 μg/min 泵入', 'good']] };
  assert.equal(earnedNoPressor(reload(E.CASES.sepsis, oldSave)), false, '旧版给药日志可识别');
  oldSave.log = Array.from({ length: 600 }, () => ['10:00', '查看病情', 'info']);
  assert.equal(earnedNoPressor(reload(E.CASES.sepsis, oldSave)), false, '旧档日志达到上限且给药信息不足时不授予');
  oldSave.drugCost = 0;
  oldSave.given = [];
  assert.equal(earnedNoPressor(reload(E.CASES.sepsis, oldSave)), true, '完整给药记录不受日志上限影响');
}

{
  const S = bed();
  assert.equal(E.orderMedication(S, 'water').status, 'given');
  assert.equal(E.orderMedication(S, 'v_rhino').status, 'given');
  assert.equal(E.orderMedication(S, 'naloxone', 0.8, '肌注').status, 'given');
  const before = { cost: S.cost, drugCost: S.drugCost, count: S.given.length };
  assert.equal(E.orderMedication(S, 'prbc', 1, '输血').status, 'access');
  assert.equal(E.orderMedication(S, 'c_plt', 1, '输注').status, 'busy');
  assert.equal(E.orderMedication(S, 'c_plt', 1, '输注', { replacePending: true }).status, 'access');
  const { attempt } = E.startAccess(S, 'piv', 'right');
  assert.equal(E.startAccess(S, 'piv', 'left').ok, false);
  E.tick(S, attempt.seconds - 7);
  assert.equal(E.accessRemaining(S), 7);
  assert.equal(S.cost, before.cost);
  assert.equal(S.given.length, before.count);
  const otherBed = bed();
  assert.equal(E.accessState(otherBed).pending, null);
  assert.equal(E.accessState(otherBed).lines.length, 0);
  const resumed = reload(baseline, JSON.parse(JSON.stringify(S)));
  E.tick(resumed, 8);
  const state = E.accessState(resumed);
  assert.equal(state.pending, null);
  assert.equal(state.lastReceipt.status, 'given');
  assert.equal(state.lastReceipt.entry, resumed.log.find(line => line[1].startsWith('给予 血小板')));
  assert.equal(resumed.given.length, before.count + 1);
  assert.equal(resumed.given.at(-1).t, attempt.endsAt);
  assert.equal(resumed.given.at(-1).accessLineId, state.activeId);
  assert.equal(resumed.drugCost, before.drugCost + SUB.byId('c_plt').cost);
  assert.equal(resumed.cost, before.cost + attempt.cost + SUB.byId('c_plt').cost);
  assert.equal(E.orderMedication(resumed, 'prbc', 1, '输血').status, 'given');
  E.tick(resumed, 1);
  assert.equal(resumed.given.filter(order => order.id === 'c_plt').length, 1);
}

{
  const difficult = { ...baseline, seed: 7, diff: 6,
    vascularAccessSites: { piv: { left: { peripheral: 'collapsed' } } } };
  const S = bed(70, difficult);
  assert.equal(E.orderMedication(S, 'epi', 1, '静推').status, 'access');
  const { attempt } = E.startAccess(S, 'piv', 'left');
  E.tick(S, attempt.seconds);
  assert.equal(E.accessState(S).lastReceipt.status, 'failed');
  assert.equal(E.accessState(S).pending.id, 'epi');
  assert.equal(S.cost, attempt.failureCost);
  assert.equal(S.drugCost, 0);
  assert.equal(S.given.length, 0);

  S.rhythm = 'vf';
  const retry = E.startAccess(S, 'io', 'right');
  assert.ok(retry.ok);
  E.ACTIONS.cpr.apply(S);
  assert.equal(E.accessState(S).attempt, retry.attempt);
  E.tick(S, retry.attempt.seconds);
  assert.equal(E.accessState(S).lastReceipt.status, 'given');
  assert.equal(S.given.at(-1).id, 'epi');
  assert.equal(E.accessState(S).lines[0].type, 'io');
  assert.equal(E.orderMedication(S, 'nacl', 500, '静滴').status, 'given');
}

{
  const S = bed(70, { ...baseline, prehospitalAccess: { type: 'piv', side: 'left' } });
  const heparin = '持续静脉泵入';
  const activeId = E.accessState(S).activeId;
  assert.equal(E.accessState(S).lines[0].origin, 'prehospital');
  assert.equal(E.orderMedication(S, 'heparin', 1200, heparin).status, 'given');
  assert.equal(E.accessState(S).pumps.heparin, activeId);
  assert.equal(S.cost, 0);
  E.pausePump(S, 'heparin');
  assert.equal(E.accessState(S).pumps.heparin, activeId);
  assert.equal(E.orderMedication(S, 'heparin', 1400, heparin).status, 'given');
  assert.equal(E.orderMedication(S, 'insulin', 2, '泵入').status, 'access');
  const { attempt } = E.startAccess(S, 'cvc', 'right');
  E.tick(S, attempt.seconds);
  const centralId = E.accessState(S).lastReceipt.line.id;
  const infusion = S.pk.find(order => order.id === 'insulin');
  assert.equal(E.accessState(S).pumps[infusion.accessPumpId], centralId);
  const previousCost = S.cost;
  const delivery = E.pumpDelivery(S, 'heparin');
  assert.ok(E.migrateAccessPumps(S, centralId).ok);
  assert.equal(S.cost, previousCost);
  assert.equal(E.pumpRate(S, 'heparin'), 1400);
  assert.equal(E.pumpDelivery(S, 'heparin'), delivery);
  assert.equal(E.accessState(S).pumps.heparin, centralId);
  assert.ok(E.stopInfusion(S, infusion));
  assert.equal(E.accessState(S).pumps[infusion.accessPumpId], undefined);
  E.stopPump(S, 'heparin');
  assert.equal(E.accessState(S).pumps.heparin, undefined);
}

{
  const S = bed();
  assert.equal(E.orderMedication(S, 'calcium_cl').status, 'access');
  const { attempt } = E.startAccess(S, 'piv', 'left');
  E.tick(S, attempt.seconds);
  assert.equal(E.accessState(S).lastReceipt.status, 'access-ready');
  assert.equal(E.accessState(S).pending.id, 'calcium_cl');
  assert.equal(S.drugCost, 0);
  assert.equal(E.orderMedication(S, 'calcium').status, 'given');
  assert.ok(E.cancelPendingMedication(S));
  assert.equal(E.orderMedication(S, 'calcium_cl').status, 'access');
  const central = E.startAccess(S, 'cvc', 'left').attempt;
  E.tick(S, central.seconds);
  assert.equal(E.accessState(S).lastReceipt.status, 'given');
  assert.equal(S.given.at(-1).accessLineId, central.id);
  assert.equal(E.orderMedication(S, 'insulin', 2, '泵入').status, 'given');
  const infusion = S.pk.find(order => order.id === 'insulin');
  for (let i = 0; i < infusion.infusionMinutes; i++) E.tick(S, 60);
  assert.equal(E.accessState(S).pumps[infusion.accessPumpId], undefined);

  const ended = bed();
  E.orderMedication(ended, 'calcium');
  const unfinished = E.startAccess(ended, 'piv', 'left').attempt;
  E.endCase(ended, 'death', '测试');
  E.tick(ended, unfinished.seconds);
  assert.equal(E.accessState(ended).lastReceipt.status, 'cancelled');
  assert.equal(E.accessState(ended).attempt, null);
  assert.equal(E.accessState(ended).pending, null);
  assert.equal(ended.cost, 0);
}

{
  const S = bed();
  const route = '持续静脉泵入';
  E.give(S, 'heparin', 1200, route);
  delete S.vascularAccess;
  const restored = reload(baseline, JSON.parse(JSON.stringify(S)));
  assert.equal(E.accessState(restored).lines[0].origin, 'legacy');
  assert.equal(E.orderMedication(restored, 'heparin', 1400, route).status, 'given');
  assert.equal(E.pumpRate(restored, 'heparin'), 1400);
  assert.equal(restored.cost, 0);
}

console.log('药费、器械费用、医保预算、血管通路与升压药成就回归通过');
