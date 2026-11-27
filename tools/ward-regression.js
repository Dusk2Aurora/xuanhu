const assert = require('node:assert/strict');
const { gameUrl, launchBrowser } = require('./browser');

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
      S.given.length === 0 && S.cost === 0 && beds[0].S === window.backgroundPatient &&
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
