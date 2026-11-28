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
]) {
  const report = finish(bed(module), test);
  assert.match(report.rows.map(({ label, value }) => label + ' ' + value).join('\n'), pattern, module);
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
