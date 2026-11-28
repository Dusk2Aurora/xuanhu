const assert = require('node:assert/strict');
const SUBSTANCES = require('../prototype/substances.js');
const CASEGEN = require('../prototype/generator.js');
const E = require('../prototype/engine.js');

const patient = { name: '物质效应测试', sex: '男', age: 44, weight: 70, height: 172 };
const fixtures = [
  ['普通病例', { id: 'substance-effects', diff: 1, init: { ...CASEGEN.BASE }, patient }],
  ['急诊首诊', { id: 'substance-effects-ed', diff: 6, init: { ...CASEGEN.BASE }, patient }],
  ['无病探索', 'exploration'],
];

function advance(state, minutes) {
  for (let minute = 0; minute < minutes && state.running; minute++) E.tick(state, 60);
  return state;
}

function compare(fixture, id, minutes, multiplier = 1) {
  const control = E.create(fixture, patient);
  const exposed = E.create(fixture, patient);
  const substance = SUBSTANCES.byId(id);
  const dose = substance.dose * multiplier;
  assert.equal(E.give(exposed, id, dose, substance.route), dose, `${id} 应可从默认途径使用`);
  return [advance(exposed, minutes), advance(control, minutes)];
}

for (const [mode, fixture] of fixtures) {
  const magnesiumMinutes = SUBSTANCES.infusionMinutesFor(SUBSTANCES.byId('magnesium').routes[0]);
  const [standardMg, controlMg] = compare(fixture, 'magnesium', magnesiumMinutes);
  const [excessMg] = compare(fixture, 'magnesium', magnesiumMinutes, 5);
  assert.equal(standardMg.mod.rr, controlMg.mod.rr, `${mode} 常规硫酸镁未触发过量呼吸抑制`);
  assert.ok(excessMg.mod.rr < standardMg.mod.rr - 2 && excessMg.rr < standardMg.rr && excessMg.hr < standardMg.hr - 2,
    `${mode} 硫酸镁蓄积应降低呼吸频率与心率`);

  const [insulin, controlInsulin] = compare(fixture, 'insulin', 35);
  assert.ok(insulin.glu < controlInsulin.glu - 0.5 && insulin.k < controlInsulin.k - 0.1,
    `${mode} 胰岛素应同时影响血糖与血钾`);

  const [ibuprofen, controlIbuprofen] = compare(fixture, 'ibuprofen', 80, 5);
  assert.ok(ibuprofen.coag < controlIbuprofen.coag - 0.06 && ibuprofen.renalFactor < controlIbuprofen.renalFactor - 0.02,
    `${mode} 布洛芬过量应削弱止血与肾清除`);

  const [rice, controlRice] = compare(fixture, 'rice', 45);
  const [water, controlWater] = compare(fixture, 'water', 45);
  const [coffee, controlCoffee] = compare(fixture, 'coffee', 45);
  assert.ok(rice.glu > controlRice.glu + 0.5, `${mode} 米饭应使餐后血糖上升`);
  assert.ok(water.na < controlWater.na - 0.25 && water.vol > controlWater.vol,
    `${mode} 饮水应补充体液并轻度稀释血钠`);
  assert.ok(coffee.hr > controlCoffee.hr + 1, `${mode} 咖啡应短暂提高心率`);

  const [redCells, controlRedCells] = compare(fixture, 'c_rbc', 100);
  const [plasma, controlPlasma] = compare(fixture, 'c_plasma', 100);
  assert.ok(redCells.hb > controlRedCells.hb + 3, `${mode} 红细胞应提高血红蛋白`);
  assert.ok(plasma.coag > controlPlasma.coag + 0.07, `${mode} 血浆应补充凝血能力`);
  assert.ok(redCells.vol > controlRedCells.vol && plasma.vol > controlPlasma.vol,
    `${mode} 输注应增加体液`);
}

// 去除抽签差异，比较同一例室颤在药物起效前后的除颤结果。
function shockWith(prescriptionTime, dose, atMinute) {
  const S = E.create(fixtures[0][1], patient);
  if (dose > 0) {
    S.t = prescriptionTime * 60;
    E.give(S, 'amiodarone', dose, '静推');
  }
  S.t = atMinute * 60;
  S.rhythm = 'vf';
  const random = Math.random;
  try {
    Math.random = () => 0.60;
    E.ACTIONS.defib.apply(S);
  } finally { Math.random = random; }
  return S.rhythm;
}
assert.equal(shockWith(0, 0, 5), 'vf');
assert.equal(shockWith(5, 150, 5), 'vf', '刚下医嘱时药效尚未建立');
assert.equal(shockWith(0, 15, 5), 'vf', '过小剂量不产生完整除颤加成');
assert.equal(shockWith(0, 150, 5), 'sinus');

const standard = E.create('exploration');
const stacked = E.create('exploration');
standard.icp = stacked.icp = 1.1;
for (const S of [standard, stacked]) {
  const bags = S === standard ? 1 : 5;
  for (let i = 0; i < bags; i++) E.give(S, 'mannitol', 250, '静滴');
  assert.equal(S.icp, 1.1, '开单时还未送药');
  advance(S, 30);
}
assert.ok(stacked.renalFactor < standard.renalFactor - 0.03, '多袋输注后的过量暴露损伤肾清除');
assert.ok(stacked.icp < standard.icp && stacked.icp >= 0);

const legacyMannitol = E.create(fixtures[0][1], patient);
const untreatedIcp = E.create(fixtures[0][1], patient);
legacyMannitol.icp = untreatedIcp.icp = 0.8;
const mannitol = SUBSTANCES.byId('mannitol');
legacyMannitol.pk.push({ id: mannitol.id, n: mannitol.n, t: 0, route: mannitol.route, onset: mannitol.onset,
  dur: mannitol.dur, eff: { icp: mannitol.eff.icp }, scale: 1 });
advance(legacyMannitol, 20);
advance(untreatedIcp, 20);
assert.equal(legacyMannitol.icp, untreatedIcp.icp, '旧版即刻结算的甘露醇读档后保持既有降压效果');

const oliguria = { id: 'diuresis-volume-balance', init: { ...CASEGEN.BASE, vol: 3.4, renalFactor: 0.05 } };
for (const [id, dose, legacyVolumeEffect] of [
  ['furosemide', 40, -0.45], ['spironolactone', 20, -0.2], ['hydrochlorothiazide', 25, -0.35],
]) {
  const control = E.create(oliguria, patient);
  const treated = E.create(oliguria, patient);
  for (const S of [control, treated]) S.tags.push('aki', 'bph');
  assert.equal(E.give(treated, id, dose), dose);
  const legacy = { ...JSON.parse(JSON.stringify(treated)), cas: treated.cas };
  legacy.pk[0].eff.vol = legacyVolumeEffect;
  E.restorePatient(legacy);
  const states = [control, treated, legacy];
  const urine = states.map(() => 0);
  for (let minute = 0; minute < 90; minute++) {
    states.forEach((S, index) => {
      urine[index] += S.uo;
      E.tick(S, 60);
    });
  }
  const extraLiters = (urine[1] - urine[0]) / 1000;
  assert.ok(extraLiters > 0 && extraLiters < 0.01 && states.every(S => S.running), `${id} 少尿时仅有少量额外尿量`);
  assert.ok(Math.abs(control.vol - treated.vol - extraLiters * 0.4) < 1e-9 &&
    Math.abs(control.interstitium - treated.interstitium - extraLiters * 0.6) < 1e-9,
    `${id} 少尿时的血浆和组织间液损失与额外尿量一致`);
  assert.deepEqual([legacy.vol, legacy.interstitium, urine[2]], [treated.vol, treated.interstitium, urine[1]],
    `${id} 读档后继续按实际尿量改变容量`);
}

const [coldPatient, warmPatient] = [E.create('exploration'), E.create('exploration')];
coldPatient.temp = 29.5;
E.tick(coldPatient, 60);
E.tick(warmPatient, 60);
assert.ok(coldPatient.vo2 < warmPatient.vo2 && coldPatient.hr < warmPatient.hr && coldPatient._vfRisk > 0);

for (const exposure of SUBSTANCES.ALL.filter(item => item.kind === 'virus')) {
  assert.equal(exposure.cost, 0, `${exposure.n} 为模拟暴露`);
  const [exposed, control] = compare('exploration', exposure.id, 240);
  assert.ok(exposed.infection > control.infection + 0.005, `${exposure.n} 应改变模拟感染状态`);
}

const [cold] = compare('exploration', 'v_rhino', 240);
assert.ok(cold.temp < 38, '轻度模拟感染应维持低热或正常体温');
const [respiratoryExposure, controlRespiration] = compare('exploration', 'v_corona', 240);
assert.ok(respiratoryExposure.spo2 < controlRespiration.spo2 - 0.3, '有低氧效应的模拟暴露应降低血氧');

const cellDeficiency = { id: 'substance-cell-counts', init: { ...CASEGEN.BASE, wbc: 3, plt: 42, coag: 0.58 } };
const [platelets, controlPlatelets] = compare(cellDeficiency, 'c_plt', 100);
const [whiteCells, controlWhiteCells] = compare(cellDeficiency, 'c_wbc', 100);
assert.ok(platelets.plt > controlPlatelets.plt + 15 && platelets.coag > controlPlatelets.coag + 0.1,
  '补充血小板应同时改变血小板计数和止血能力');
assert.ok(whiteCells.wbc > controlWhiteCells.wbc + 0.2, '输注白细胞应改变白细胞计数');

const pairs = SUBSTANCES.INTERACTIONS.map(({ a, b }) => [a, b].sort().join('|'));
for (const procedure of ['intubate', 'chestTube']) {
  const [treated, control] = compare('exploration', 'ketamine', 2);
  assert.ok(treated.gcs < control.gcs && treated.mod.hr > control.mod.hr);
  for (const S of [treated, control]) {
    S.tensionPTX = 0.4;
    S.diff = 1;
    E.ACTIONS[procedure].apply(S);
  }
  assert.ok(control.procedureStress.strength > (treated.procedureStress?.strength || 0));
  assert.ok(treated.log.some(([, msg]) => msg.includes('氯胺酮已起效')));
  assert.equal(treated.vent, control.vent);
}
const [sedated] = compare('exploration', 'ketamine', 2);
const [overdose] = compare('exploration', 'ketamine', 2, 5);
assert.ok(overdose.mod.rr < sedated.mod.rr);
advance(sedated, 18);
assert.ok(sedated.gcs >= 14);
assert.equal(new Set(pairs).size, pairs.length, '每组相互作用只计算一次');

console.log('普通病例、急诊首诊与无病探索的物质效应通过');
