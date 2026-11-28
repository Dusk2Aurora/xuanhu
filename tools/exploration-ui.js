const assert = require('node:assert/strict');
const { launchBrowser, gameUrl, enterWard } = require('./browser');

async function main() {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, offline: true });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(gameUrl);
    const original = await page.evaluate(() => window.__LIFE_GAME.beds.length);
    await page.locator('[data-explore]').click();
    await page.locator('#admissionIntro').click();
    const state = () => page.evaluate(() => {
      const { S } = window.__LIFE_GAME;
      return [S.caseId, S.cas.exploration, S.cas.cases.length, S.gcs, S.t];
    });
    const start = await state();
    assert.deepEqual(start.slice(0, 4), ['exploration', true, 0, 15]);
    assert.ok(start[4] < 30, '无病床位应从零时开始');
    const rows = page.locator('#sheetList');
    const choose = text => rows.getByText(text, { exact: true }).click();
    await page.locator('#btnBody').click();
    const tests = await page.evaluate(() => {
      const e = window.LIFE;
      const ids = Object.entries(e.TESTS).filter(([, t]) => t.group === e.TESTS.glucose.group).slice(0, 2);
      return [e.TEST_GROUPS.find(g => g.id === e.TESTS.glucose.group).name, ...ids.map(([,t]) => t.name)];
    });
    await choose(tests[0]);
    await choose(tests[1]);
    await choose(tests[2]);
    assert.equal(await rows.getByText('待出报告', { exact: true }).count(), 2);
    await page.reload();
    await enterWard(page);
    assert.equal((await state())[0], 'exploration');
    await page.locator('#btnMenu').click();
    await choose('结束本床探索');
    await choose('结束并查看本次记录');
    assert.match(await page.locator('#dName').innerText(), /探索结束/);
    assert.ok((await page.locator('#dKv').innerText()).includes(tests[1]));
    assert.deepEqual(await page.evaluate(() => [window.__LIFE_GAME.beds.length, JSON.parse(localStorage.getItem('life.records') || '[]').length]), [original, 0]);
    assert.deepEqual(errors, []);
    console.log('无病探索、连续检查、读档、结束与普通病历隔离通过');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
