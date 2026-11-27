const assert = require('node:assert/strict');
const { gameUrl, launchBrowser, enterWard } = require('./browser');

const menuRow = (page, name) => page.locator('#sheetList .drow').filter({ hasText: name }).first();

async function openMenuRow(page, name) {
  await page.locator('#btnMenu').click();
  await menuRow(page, name).click();
}

async function addBed(page) {
  await openMenuRow(page, '病房床位');
  await menuRow(page, '开一个新病例').click();
}

async function checkWard(page) {
  await page.goto(gameUrl);
  const first = await page.evaluate(() => {
    const game = window.__LIFE_GAME;
    const saved = JSON.parse(localStorage.getItem('life.save'));
    return {
      matched: game.S === game.beds[0].S && game.activeIdx === 0,
      caseId: game.S.caseId,
      savedCaseId: saved.beds[0].caseId,
    };
  });
  assert.deepEqual(first, { matched: true, caseId: 'gen', savedCaseId: 'gen' });

  const lobby = page.locator('#lobby');
  if (await lobby.isVisible()) await lobby.locator('[data-bed]').first().click();
  await addBed(page);
  await addBed(page);
  assert.equal(await page.evaluate(() => window.HANDBOOK.entries().length), 0);

  await page.locator('#btnDrug').click();
  await page.locator('#drugList .drow').first().click();
  await page.evaluate(() => {
    const { S, beds, E } = window.__LIFE_GAME;
    window.activePatient = S;
    window.admissionDrugs = S.given.map(({ id, d }) => [id, d]);
    window.backgroundPatient = beds[1].S;
    E.endCase(beds[0].S, 'death', '后台病床回归测试');
  });
  await page.waitForFunction(() => window.__LIFE_GAME.beds.length === 2);
  const remained = await page.evaluate(() => {
    const { S, beds, activeIdx } = window.__LIFE_GAME;
    const saved = JSON.parse(localStorage.getItem('life.save'));
    return {
      active: S === window.activePatient && S === beds[activeIdx].S,
      activeIdx,
      name: document.querySelector('#pname').textContent,
      expectedName: S.patient.name,
      savedActive: saved.activeIdx,
      savedCount: saved.beds.length,
      records: JSON.parse(localStorage.getItem('life.records')).length,
    };
  });
  assert.deepEqual(remained, {
    active: true, activeIdx: 1, name: remained.expectedName, expectedName: remained.expectedName,
    savedActive: 1, savedCount: 2, records: 1,
  });

  const administered = await page.evaluate(() => {
    const { S } = window.__LIFE_GAME;
    const activeCount = S.given.length;
    const backgroundCount = window.backgroundPatient.given.length;
    document.querySelector('#dGo').click();
    return S.given.length === activeCount + 1 && window.backgroundPatient.given.length === backgroundCount;
  });
  assert.equal(administered, true);

  await openMenuRow(page, '重新开始本病例');
  await menuRow(page, '确认重新开始').click();
  const restarted = await page.evaluate(() => {
    const { S, beds, activeIdx } = window.__LIFE_GAME;
    const prev = window.activePatient;
    const saved = JSON.parse(localStorage.getItem('life.save'));
    return S !== prev && S.seed === prev.seed && S.patient.name === prev.patient.name &&
      JSON.stringify(S.given.map(({ id, d }) => [id, d])) === JSON.stringify(window.admissionDrugs) &&
      S.cost === 0 && beds[0].S === window.backgroundPatient &&
      activeIdx === 1 && saved.beds[activeIdx].s.patient.name === S.patient.name;
  });
  assert.equal(restarted, true);

  await page.locator('#btnOps').click();
  await page.evaluate(() => {
    const { S, E } = window.__LIFE_GAME;
    window.staleOperation = document.querySelector('#sheetList .drow');
    E.endCase(S, 'death', '前台病床回归测试');
  });
  await page.waitForFunction(() => document.querySelector('#detail').classList.contains('on'));
  const next = await page.evaluate(() => {
    const { S, beds, activeIdx } = window.__LIFE_GAME;
    const cost = S.cost;
    const logLength = S.log.length;
    window.staleOperation.click();
    return {
      changed: S.cost !== cost || S.log.length !== logLength,
      active: S === window.backgroundPatient && S === beds[activeIdx].S,
      visible: document.querySelector('#sheet').classList.contains('on'),
      count: beds.length,
    };
  });
  assert.deepEqual(next, { changed: false, active: true, visible: false, count: 1 });

  await page.locator('#detailX').click();
  await openMenuRow(page, '切换病例');
  await menuRow(page, '高钾血症').click();
  assert.equal(await page.evaluate(() => window.__LIFE_GAME.S.caseId), 'hyperkalemia');

  const discharge = await page.evaluate(() => {
    const { S, E } = window.__LIFE_GAME;
    Object.assign(S, {
      rhythm: 'sinus', hr: 80, sv: 70, svr: 17, spo2: 98, rr: 16, gcs: 15, temp: 37,
      na: 140, hco3: 24, ph: 7.4, k: 4.2, glu: 5.5, odsDamage: false,
    });
    document.querySelector('#btnBody').click();
    const row = [...document.querySelectorAll('#sheetList .drow')].find(el => el.textContent.includes('办理出院'));
    if (!row) throw Error('出院测试病例未达标 ' + E.dischargeCheck(S).reasons.join('、'));
    S.k = 6;
    row.click();
    if (!S.running) throw Error('出院未复核当前血钾');
    S.k = 4.2;
    row.click();
    row.click();
    return S.discharged;
  });
  assert.equal(discharge, true);
  await page.waitForFunction(() => window.__LIFE_GAME.beds.length === 0);
  const final = await page.evaluate(() => ({
    records: JSON.parse(localStorage.getItem('life.records')).map(r => r.结局),
    saved: localStorage.getItem('life.save'),
    recap: document.querySelector('#dName').textContent,
  }));
  assert.deepEqual(final, { records: ['出院', '死亡', '死亡'], saved: null, recap: '患者出院' });
  await page.locator('#detailX').click();
  assert.equal(await page.locator('#lobby').isVisible(), true);
}

async function checkLegacySave(page) {
  await page.goto(gameUrl);
  const expected = await page.evaluate(() => {
    const st = window.LIFE.create(window.CASEGEN.generateLegacy(3, 104));
    const { cas, genVersion, ...s } = st;
    s.patient.name = '旧存档患者';
    s.t = 123;
    const { cas: fixedCase, ...fixed } = window.LIFE.create('hyperkalemia');
    return {
      beds: [{ s: fixed, caseId: fixedCase.id }, { s, caseId: st.caseId, seed: st.seed, diff: st.diff }],
      name: cas.name,
    };
  });

  await page.addInitScript(beds => {
    localStorage.setItem('life.save', JSON.stringify({ v: 3, caseDiff: 3, activeIdx: 1, beds }));
  }, expected.beds);
  await page.reload();
  const restored = await page.evaluate(() => {
    const { S: st, beds, activeIdx } = window.__LIFE_GAME;
    return {
      name: st.cas.name, patient: st.patient.name, t: Math.floor(st.t),
      active: activeIdx === 1 && beds[activeIdx].S === st,
      version: JSON.parse(localStorage.getItem('life.save')).beds[activeIdx].genVersion,
    };
  });
  assert.deepEqual(restored, { name: expected.name, patient: '旧存档患者', t: 123, active: true, version: 1 });
}

async function orderExam(page, name) {
  await page.locator('#btnBody').click();
  await menuRow(page, name).click();
}

async function checkClinicalPanels(page) {
  await page.goto(gameUrl);
  await enterWard(page);
  await openMenuRow(page, '暂停');
  await page.evaluate(() => {
    const { S } = window.__LIFE_GAME;
    Object.assign(S, {
      rhythm: 'sinus', hr: 78, sv: 72, svr: 16, cvp: 4, gcs: 15, spo2: 99, temp: 37,
      k: 4.2, vent: 0, t: 0, tests: {}, labSnap: {},
    });
  });
  await orderExam(page, '12 导联心电图');
  await orderExam(page, '床旁胸片');
  const completed = await page.evaluate(() => {
    const { S, E } = window.__LIFE_GAME;
    S.t = 901;
    E.pollTests(S);
    return [S.tests.ecg.done, S.tests.cxr.done];
  });
  assert.deepEqual(completed, [true, true]);
  await page.locator('#btnBlood').click();
  assert.equal(await page.locator('#dSub').textContent(), '暂无血液化验结果');
  assert.deepEqual(await page.locator('#dKv dt').allTextContents(), ['怎么做']);
  await page.locator('#detailX').click();

  await orderExam(page, '动脉血气');
  await page.evaluate(() => {
    const { S, E } = window.__LIFE_GAME;
    Object.assign(S, { t: 1382, k: 4.8, ph: 7.38, pao2: 91, paco2: 41, hco3: 24, lac: 1.6 });
    E.pollTests(S);
  });
  await orderExam(page, '血常规');
  await page.evaluate(() => {
    const { S, E } = window.__LIFE_GAME;
    Object.assign(S, { t: 2884, hb: 124, wbc: 8.4, plt: 215 });
    E.pollTests(S);
    Object.assign(S, { t: 3000, k: 5.1, hb: 73, wbc: 19, plt: 90 });
  });
  await page.locator('#btnBlood').click();
  assert.deepEqual(await page.locator('#dKv dt').allTextContents(), [
    '血常规', '血红蛋白', '白细胞', '血小板', '动脉血气', 'pH', 'PaCO₂', 'PaO₂', 'HCO₃⁻', '乳酸', '血钾',
  ]);
  assert.deepEqual(await page.locator('#dKv dd').allTextContents(), [
    '采样于病例用时 00:48:04', '124 g/L', '8.4 ×10⁹/L', '215 ×10⁹/L',
    '采样于病例用时 00:23:02', '7.38', '41 mmHg', '91 mmHg', '24 mmol/L', '1.6 mmol/L', '4.8 mmol/L',
  ]);
  await page.locator('#detailX').click();

  const liverValues = await page.evaluate(() => {
    const { S, E } = window.__LIFE_GAME;
    const poisoned = E.create(window.CASEGEN.generate(1, 104, ['apap']));
    poisoned.hepatotox = 0.75;
    E.tick(poisoned, 0.2);
    Object.assign(S, poisoned);
    return { coag: S.coag.toFixed(2), damage: String(E.snapshot(S).hepato) };
  });
  assert.ok(Number(liverValues.coag) < 0.5);
  await page.locator('#opTitle').selectOption('liver');
  const organValues = await page.locator('#opan .row').evaluateAll(rows => Object.fromEntries(
    rows.map(row => [row.querySelector('.lab').textContent, row.querySelector('.val').textContent])
  ));
  assert.deepEqual(organValues, { 凝血系数: liverValues.coag, 肝损伤指数: liverValues.damage });
}

async function checkMentor(page) {
  await page.goto(gameUrl);
  await enterWard(page);
  await openMenuRow(page, '暂停');
  const hints = await page.evaluate(() => {
    const { E } = window.__LIFE_GAME;
    const hintsAt = (tag, state) => {
      const S = Object.assign(E.create('hyperkalemia'), { tags: [tag], map: 80, cvp: 4 }, state);
      return window.MENTOR.hints(S).map(hint => hint.id);
    };
    const edema = { hr: 88, sv: 38, contractility: 0.5, spo2: 93 };
    const brain = { hr: 54, sv: 68, icp: 0.7 };
    const embolism = { hr: 95, sv: 55, spo2: 95 };
    return [
      [hintsAt('edema', { ...edema, svr: 15, sys: 140 }), hintsAt('edema', { ...edema, svr: 32, sys: 75 })],
      [hintsAt('tbi', { ...brain, svr: 42 }), hintsAt('tbi', { ...brain, svr: 20 })],
      [hintsAt('pe', { ...embolism, svr: 9, _sys: 120 }), hintsAt('pe', { ...embolism, svr: 17, _sys: 75 })],
    ];
  });
  const [[lowEdema, highEdema], [highBrain, lowBrain], [lowEmbolism, highEmbolism]] = hints;
  for (const [hint, expected, excluded] of [
    ['inotrope', lowEdema, highEdema], ['ntg', highEdema, lowEdema],
    ['cushing', highBrain, lowBrain], ['flow', lowEmbolism, highEmbolism],
  ]) {
    assert.ok(expected.includes(hint), `应触发导师提示 ${hint}`);
    assert.ok(!excluded.includes(hint), `不应触发导师提示 ${hint}`);
  }

  const costBefore = await page.evaluate(() => {
    const { S } = window.__LIFE_GAME;
    S.bleedingSites = {};
    return S.cost;
  });
  await page.locator('#btnOps').click();
  await menuRow(page, '急诊内镜止血').click();
  assert.match(await page.locator('#toast').textContent(), /内镜暂缓.*无活动性消化道出血/);
  assert.match(await page.locator('#mText').textContent(), /内镜暂缓.*无活动性消化道出血/);
  const refused = await page.evaluate(() => {
    const { S } = window.__LIFE_GAME;
    return { cost: S.cost, feedback: S.log.at(-1)?.slice(1) };
  });
  assert.equal(refused.cost, costBefore);
  assert.match(refused.feedback[0], /^带教点评：内镜暂缓/);
  assert.equal(refused.feedback[1], 'warn');

  await page.evaluate(() => {
    const { S } = window.__LIFE_GAME;
    Object.assign(S, { tags: ['myxedema'], hr: 52, temp: 35 });
  });
  await page.locator('#btnAsk').click();
  assert.match(await page.locator('#mText').textContent(), /左甲状腺素的静脉途径/);
  await page.locator('#btnDrug').click();
  await page.locator('#drugSearch').fill('左甲状腺素');
  await page.locator('#drugList [data-id="levothyroxine"]').click();
  await page.locator('#sheetList [data-ri]').getByText('静推', { exact: true }).click();
  await page.locator('#dGo').click();
  const drug = await page.evaluate(() => {
    const { S } = window.__LIFE_GAME;
    const { id, route } = S.given.at(-1);
    return { id, route, onset: S.pk.at(-1).onset };
  });
  assert.deepEqual(drug, { id: 'levothyroxine', route: '静推', onset: 60 });
}

async function checkObservation(page) {
  await page.goto(gameUrl);
  await enterWard(page);
  await openMenuRow(page, '切换病例');
  await page.locator('#sheetList .drow').filter({ hasText: '阿片' }).click();
  await page.evaluate(() => {
    const { S, E } = window.__LIFE_GAME;
    E.give(S, 'naloxone', 0.4);
    for (let i = 0; i < 3000; i++) E.tick(S, 0.2);
  });
  const popup = page.locator('#sevOk');
  if (await popup.isVisible()) await popup.click();
  await orderExam(page, '12 导联心电图');
  await page.locator('#btnBody').click();
  await page.locator('#sheetList .drow').filter({ hasText: '稳定期留观快进' }).click();
  await page.waitForFunction(() => window.__LIFE_GAME.S.tests.ecg.done && document.getElementById('ff').textContent === '快进');
  const overshoot = await page.evaluate(() => {
    const { S } = window.__LIFE_GAME;
    return S.t - S.tests.ecg.readyAt;
  });
  assert.ok(overshoot >= 0 && overshoot < 5, '在检查完成时退出留观快进');
  await page.locator('#btnBody').click();
  await page.locator('#sheetList .drow').filter({ hasText: '稳定期留观快进' }).click();
  await page.getByRole('button', { name: '结束留观' }).click();
  assert.equal(await page.locator('#ff').getAttribute('aria-pressed'), 'false');
}

async function main() {
  const browser = await launchBrowser();
  const errors = [];
  try {
    const page = await browser.newPage();
    page.on('pageerror', err => errors.push(err.message));
    await checkWard(page);
    await page.close();
    const legacyPage = await browser.newPage();
    legacyPage.on('pageerror', err => errors.push(err.message));
    await checkLegacySave(legacyPage);
    await legacyPage.close();
    const clinicalPage = await browser.newPage();
    clinicalPage.on('pageerror', err => errors.push(err.message));
    await checkClinicalPanels(clinicalPage);
    await clinicalPage.close();
    const mentorPage = await browser.newPage();
    mentorPage.on('pageerror', err => errors.push(err.message));
    await checkMentor(mentorPage);
    await mentorPage.close();
    const observationPage = await browser.newPage();
    observationPage.on('pageerror', err => errors.push(err.message));
    await checkObservation(observationPage);
    assert.deepEqual(errors, []);
    console.log('病房回归通过');
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
