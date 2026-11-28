/* 急诊检查流程的诊断报告、复查和存档回归。 */
'use strict';
const assert = require('node:assert/strict');
require('../prototype/substances.js');
const CASEGEN = require('../prototype/generator.js');
const E = require('../prototype/engine.js');

const bed = module => E.create(CASEGEN.generate(2, 43, [module]));
const healthy = () => E.create({ id: 'diagnostics-test', init: { ...CASEGEN.BASE } });
const restore = S => {
  const saved = { ...JSON.parse(JSON.stringify(S)), cas: S.cas };
  E.restorePatient(saved);
  return saved;
};
const finish = (S, type) => {
  S.t = E.orderTest(S, type);
  E.pollTests(S);
  const report = E.reports(S, type).at(-1);
  assert.equal(E.getReport(S, report.id), report);
  assert.equal(S.log.at(-1)[4], report.id);
  return report;
};
const reportText = report => report.rows.map(({ label, value }) => label + ' ' + value).join('\n');
{
  const S = healthy();
  const cbc = hb => {
    S.hb = hb;
    return finish(S, 'cbc');
  };
  const hbRow = report => report.rows.find(row => row.label === '血红蛋白');
  S.wbc = 12.5;
  S.plt = 95;
  const first = cbc(55);
  assert.deepEqual(first.rows.map(row => row.flag), ['偏低', '偏高', '偏低']);
  const repeat = cbc(65);
  assert.deepEqual(hbRow(repeat), { label: '血红蛋白', value: '65 g/L', flag: '偏低' });
  for (const [value, flag] of [[119, '偏低'], [120, undefined], [160, undefined], [161, '偏高']]) {
    assert.equal(hbRow(cbc(value)).flag, flag);
  }
  const legacy = JSON.parse(JSON.stringify(S));
  delete hbRow(legacy.diagnosticReports[0]).flag;
  const archived = E.getReport(restore(legacy), first.id);
  assert.deepEqual(archived, first);
}

const advance = (S, minutes) => {
  for (let i = 0; i < minutes; i++) {
    E.tick(S, 60);
    CASEGEN.step(S, 60, E);
  }
};

/* 开颅判断只使用已回报的影像和已记录的神经查体。 */
{
  const trauma = bed('tbi');
  const operation = E.ACTIONS.craniotomy;
  operation.apply(trauma);
  assert.match(trauma.log.at(-1)[1], /先取得急诊头颅 CT/);
  assert.equal(trauma.cost, 0);
  E.orderTest(trauma, 'cthead');
  operation.apply(trauma);
  assert.match(trauma.log.at(-1)[1], /待回报/);
  assert.equal(trauma.cranied, undefined);

  advance(trauma, 8);
  E.pollTests(trauma);
  const report = E.reports(trauma, 'cthead').at(-1);
  assert.equal(report.reportedAt, 480);
  assert.ok(report.values.epiduralHematomaVolume > 30);
  const postoperative = restore(trauma);
  operation.apply(postoperative);
  assert.equal(postoperative.hematoma, 0);
  assert.equal(postoperative.craniotomyAt, 480);
  const cost = postoperative.cost;
  operation.apply(postoperative);
  assert.equal(postoperative.cost, cost);
  assert.match(postoperative.log.at(-1)[1], /术后观察/);
  advance(postoperative, 60);
  assert.equal(postoperative.death, null);
  assert.equal(postoperative.gcs, 15);

  // 旧存档实有文字影像所见时，可沿用报告。过期或出具新报告后重新评估。
  const oldSave = JSON.parse(JSON.stringify(trauma));
  delete oldSave.diagnosticReports.at(-1).values.epiduralHematomaVolume;
  assert.ok(E.craniotomyAssessment(restore({ ...oldSave, cas: trauma.cas })).ok);
  trauma.t = 31 * 60;
  assert.match(E.craniotomyAssessment(trauma).reason, /超过 30 分钟/);
  trauma.hematoma = 0;
  finish(trauma, 'cthead');
  trauma.hematoma = 0.70;
  operation.apply(trauma);
  assert.match(trauma.log.at(-1)[1], /最近的头颅 CT 未见/);
  assert.equal(trauma.cranied, undefined);
}

{
  const smallHematoma = bed('tbi');
  smallHematoma.hematoma = 0.40;
  assert.equal(finish(smallHematoma, 'cthead').values.epiduralHematomaVolume, 24);
  smallHematoma.gcs = 8;
  smallHematoma.icp = 0.80;
  assert.equal(E.craniotomyAssessment(smallHematoma).status, 'requiresExam');
  E.examine(smallHematoma, 'neuro');
  E.examine(smallHematoma, 'pupils');
  assert.equal(E.craniotomyAssessment(smallHematoma).ok, true);
  smallHematoma.t += 6 * 60;
  assert.equal(E.craniotomyAssessment(smallHematoma).status, 'requiresExam');
}

/* 待出期间不公布其他化验，重开同一检查也不重复扣费。 */
{
  const S = healthy();
  S.glu = 2.3;
  assert.equal(E.orderTest(S, 'glucose'), 60);
  assert.deepEqual(E.knownResults(S), {});
  S.t = 50;
  S.glu = 7.5;
  assert.equal(E.orderTest(S, 'glucose'), 60);
  assert.equal(S.cost, E.TESTS.glucose.cost);
  const restored = restore(S);
  const first = finish(restored, 'glucose');
  assert.equal(first.values.glu, 2.3);
  assert.equal(first.sampledAt, 0);
  assert.equal(first.reportedAt, 60);
  assert.equal(E.knownResults(restored).k, undefined);
  assert.equal(E.reports(S).length, 0);

  E.orderTest(restored, 'glucose');
  assert.equal(E.knownResults(restored).glu.value, 2.3);
  const second = finish(restored, 'glucose');
  assert.notEqual(first.id, second.id);
  assert.equal(second.values.glu, 7.5);
  assert.deepEqual(E.reports(restore(restored), 'glucose'), [first, second]);
  assert.ok(Object.isFrozen(first.rows[0]));
}

/* 晚回报的早期样本不会覆盖已取得的新样本。 */
{
  const S = healthy();
  S.k = 6.8;
  E.orderTest(S, 'bmp');
  S.t = 120;
  S.k = 4.5;
  const recent = finish(S, 'abg');
  const older = finish(S, 'bmp');
  assert.equal(older.values.k, 6.8);
  assert.equal(E.knownResults(S).k.reportId, recent.id);
  assert.equal(E.knownResults(S).k.value, 4.5);
}

/* 查体、影像和旧存档的双肺听诊共用可复阅档案。 */
{
  const S = bed('ptx');
  const abnormal = E.examine(S, 'lungs');
  assert.match(abnormal.rows[0].value, /消失/);
  E.orderTest(S, 'cxr');
  E.ACTIONS.chestTube.apply(S);
  const chest = finish(S, 'cxr');
  assert.match(chest.rows[0].value, /左侧胸腔积气/);
  assert.equal(E.examine(S, 'lungs').rows[0].value, '呼吸音可闻');
  assert.match(finish(S, 'cxr').findings, /未见胸腔积气/);
  assert.equal(E.chestXrayReports(S).length, 2);
  assert.equal(E.getReport(restore(S), chest.id).id, chest.id);

  const legacy = Object.assign(healthy(), { lungExam: S.lungExam, xrayReports: S.xrayReports });
  E.restorePatient(legacy);
  E.restorePatient(legacy);
  assert.equal(E.reports(legacy).length, 4);
}

/* 代表性病种的支持证据来自当次发病表现。 */
for (const [module, test, pattern] of [
  ['highK', 'ecg', /T 波高尖/],
  ['sepsis', 'cxr', /局灶斑片状实变影/],
  ['stemi', 'ecg', /ST 段抬高/],
  ['tca', 'ecg', /QRS 波群.*增宽/],
  ['co', 'coox', /碳氧血红蛋白.*\d\d/],
  ['tamponade', 'echo', /积液伴右心腔受压/],
  ['spleen', 'fast', /脾肾间隙.*见游离液体/],
  ['ptx', 'lungus', /左侧肺滑动.*未见肺滑动/],
  ['tbi', 'cthead', /双凸形高密度影/],
  ['pe', 'ctpa', /可见肺动脉充盈缺损/],
  ['bph', 'bladderus', /明显扩张/],
  ['pancreatitis', 'lipase', /明显升高/],
  ['ectopic', 'pelvicus', /附件区有异常回声/],
  ['preeclampsia', 'pelvicus', /宫内妊娠，约 34 周/],
  ['apap', 'apap', /存在暴露标志/],
  ['thyroid', 'thyroid', /游离 T₄.*升高/],
  ['myxedema', 'thyroid', /游离 T₄.*降低/],
  ['edema', 'lungus', /B 线.*增多/],
]) {
  assert.match(reportText(finish(bed(module), test)), pattern, module);
}

/* 心电图和床旁所见反映检查当时的状态，各自留档。 */
for (const [ca, qt, sign] of [
  [0.75, /QT 间期.*延长/, /手足痉挛/],
  [1.80, /QT 间期.*缩短/, /抗阻力量减弱/],
]) {
  const S = healthy();
  S.ca = ca;
  E.orderTest(S, 'bmp');
  E.orderTest(S, 'ecg');
  const bedside = E.examine(S, 'neuro');
  assert.match(reportText(bedside), sign);
  S.ca = 1.18;

  const abnormal = finish(S, 'ecg');
  assert.match(reportText(abnormal), qt);
  assert.equal(E.knownResults(S).ca, undefined);
  assert.doesNotMatch(reportText(finish(S, 'ecg')), qt);
  assert.doesNotMatch(reportText(E.examine(S, 'neuro')), sign);
  assert.equal(finish(S, 'bmp').values.ca, ca);
  const saved = restore(S);
  assert.match(reportText(E.getReport(saved, abnormal.id)), qt);
  assert.match(reportText(E.getReport(saved, bedside.id)), sign);
}

/* DKA 的模拟血酮与血糖/渗透压分开，采样时留档，复查反映酮体逐步清除。 */
for (const S of [bed('dka'), E.create('dka')]) {
  S.running = false;
  const first = finish(S, 'ketones');
  assert.equal(first.sampledAt, 0);
  assert.match(reportText(first), /明显升高/);
  const legacy = { ...S };
  delete legacy.ketoneBurden;
  assert.match(reportText(finish(restore(legacy), 'ketones')), /明显升高/);

  S.running = true;
  E.give(S, 'insulin', 10, '静推');
  advance(S, 25);
  E.give(S, 'insulin', 10, '静推');
  advance(S, 40);
  assert.match(reportText(finish(S, 'ketones')), /轻度升高/);
  assert.match(reportText(E.getReport(S, first.id)), /明显升高/);
}

/* 肺部感染胸片提供病灶线索；治疗后的短期观察使用灌注和乳酸。 */
{
  const S = E.create('sepsis');
  assert.match(finish(S, 'cxr').findings, /局灶斑片状实变影/);
  const first = finish(S, 'lac');
  E.give(S, 'ceftriaxone', 2, '静滴');
  E.give(S, 'nacl', 2000);
  advance(S, 75);
  assert.match(finish(S, 'cxr').findings, /局灶斑片状实变影/);
  assert.ok(finish(S, 'lac').values.lac < first.values.lac);
}
{
  const S = bed('hhs');
  assert.match(reportText(finish(S, 'ketones')), /未见明显升高/);
  const report = finish(S, 'metabolism');
  assert.ok(report.values.effectiveOsmolality > 300);
  assert.ok(report.values.osmolality > report.values.effectiveOsmolality);
}

/* 尿潴留和肾性少尿都可引起尿量下降，膀胱充盈及导尿后趋势提供鉴别。 */
{
  const obstruction = bed('bph');
  assert.deepEqual(E.examine(obstruction, 'urine').values, {});
  E.orderTest(obstruction, 'bladderus');
  E.ACTIONS.catheter.apply(obstruction);
  assert.match(reportText(finish(obstruction, 'bladderus')), /明显扩张/);
  assert.match(reportText(finish(obstruction, 'bladderus')), /未见明显过度充盈/);
  const postDrainage = E.examine(obstruction, 'urine');
  assert.ok(postDrainage.values.uoPerKg > 0.5);
  assert.equal(E.knownResults(restore(obstruction)).uoHourly.reportId, postDrainage.id);

  const kidney = bed('aki');
  assert.match(reportText(finish(kidney, 'bladderus')), /未见明显过度充盈/);
  E.ACTIONS.catheter.apply(kidney);
  assert.ok(E.examine(kidney, 'urine').values.uoPerKg < 0.5);
}

/* 上消化道内镜在复苏后记录活动出血和即时止血所见。 */
for (const S of [bed('bleed'), E.create('bleed')]) {
  E.ACTIONS.endoscopy.apply(S);
  assert.equal(E.reports(S, 'endoscopy').length, 0);
  E.give(S, 'nacl', 2000);
  advance(S, 15);
  E.ACTIONS.endoscopy.apply(S);
  const [report] = E.reports(S, 'endoscopy');
  assert.match(reportText(report), /可见活动性出血.*\n.*未见继续出血/);
  assert.equal(S.bleedingSites.bleed, 0);
  assert.equal(S.log.at(-1)[4], report.id);
  assert.equal(E.getReport(restore(S), report.id).id, report.id);
}

/* 肝损伤和凝血指数保留独立趋势，可与对乙酰氨基酚暴露证据并读。 */
{
  const S = bed('liverFailure');
  const before = finish(S, 'liver');
  assert.match(reportText(E.examine(S, 'skin')), /巩膜与皮肤黄染/);
  assert.match(reportText(finish(S, 'apap')), /未记录暴露/);
  E.give(S, 'lactulose', 30, '口服');
  advance(S, 20);
  const after = finish(S, 'liver');
  assert.ok(after.values.hepato < before.values.hepato);
  assert.ok(after.values.coag > before.values.coag);
}

/* 急诊模式仍可复核和出院使用同一计算的血管收缩驱动。 */
{
  const S = E.create(CASEGEN.generate(6, 43, ['htnEmergency']));
  let tone = CASEGEN.vascularTone(S);
  let report = E.examine(S, 'circulation');
  assert.equal(report.values.svrDrive, tone.value);
  assert.equal(report.rows.at(-1).value, tone.text);
  assert.equal(report.rows.at(-1).flag, '偏高');
  E.give(S, 'labetalol', 10, '静推');
  advance(S, 1);
  assert.ok(!CASEGEN.vascularTone(S).controlled, '尚在起效，保留血管张力异常');
  advance(S, 20);
  tone = CASEGEN.vascularTone(S);
  report = E.examine(S, 'circulation');
  assert.ok(tone.controlled);
  assert.equal(report.rows.at(-1).value, tone.text);
  assert.equal(report.rows.at(-1).flag, undefined);
}

const before = bed('stemi');
const initial = finish(before, 'troponin').values.troponin;
for (let i = 0; i < 50; i++) E.tick(before, 60);
const subsequent = finish(before, 'troponin').values.troponin;
assert.ok(subsequent > initial);
E.ACTIONS.pci.apply(before);
assert.ok(finish(before, 'troponin').values.troponin > initial);

const negative = finish(healthy(), 'hcg');
assert.equal(negative.values.pregnant, 0);
assert.equal(negative.rows[0].value, '未检出');
assert.equal(finish(bed('preeclampsia'), 'pelvicus').values.gestationalWeeks, 34);
console.log('急诊检查、复查、病例线索与报告存档验证通过');
