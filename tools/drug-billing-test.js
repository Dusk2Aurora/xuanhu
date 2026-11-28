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
  E.restorePatient(S);
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

console.log('药费、器械费用、医保预算与升压药成就回归通过');
