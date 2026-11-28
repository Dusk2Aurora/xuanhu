const assert = require('node:assert/strict');
const { launchBrowser, gameUrl, enterWard } = require('./browser');

async function main() {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, offline: true });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem('life.realismRules', JSON.stringify({ insurance: true })));
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
    await page.locator('#btnMenu').click();
    assert.equal(await rows.getByText('医保说明 / 切换', { exact: true }).count(), 0);
    await choose('处置参考费用');
    assert.match(await page.locator('#detail').innerText(), /无预算上限/);
    assert.doesNotMatch(await page.locator('#dKv').innerText(), /家庭自付|承受力|床位费/);
    await page.locator('#detailX').click();
    if (await page.locator('#sheetClose').isVisible()) await page.locator('#sheetClose').click();
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
    const budget = () => page.evaluate(() => {
      const { S, beds } = window.__LIFE_GAME;
      window.__checkBudget(S);
      return [!!S.ins, S.bedCost || 0, !!S._refused, S.usedRealismRules.includes('insurance'),
        beds.some(b => !b.S.cas.exploration && b.S.ins), S.cost > 0];
    });
    assert.deepEqual(await budget(), [false, 0, false, false, true, true]);
    assert.equal(await page.locator('#budgetChip').isVisible(), false);
    await page.evaluate(() => {
      const { S, E } = window.__LIFE_GAME;
      if (!E.advancedDeviceAction(S, 'vaEcmo', true).ok) throw new Error('探索床 ECMO 启动失败');
      window.__checkBudget(S);
      if (S.deviceSetupCost !== 45000 || S._overWarned || S._refused) throw new Error('探索预算干扰设备开机');
      Object.assign(S, { ins: { t: '异地自费', oopCap: 100 }, bedCost: 80, _overWarned: 1, _refused: 1 });
    });
    await page.reload();
    await enterWard(page);
    assert.equal((await state())[0], 'exploration');
    assert.deepEqual(await budget(), [false, 0, false, false, true, true]);
    assert.equal(await page.locator('#budgetChip').isVisible(), false);
    await page.locator('#btnMenu').click();
    await choose('结束本床探索');
    await choose('结束并查看本次记录');
    assert.match(await page.locator('#dName').innerText(), /探索结束/);
    assert.equal(await page.locator('#detail').getByText('分享本例', { exact: true }).count(), 0);
    assert.equal(await page.locator('#detail').getByLabel('本例分享码').count(), 0);
    assert.ok((await page.locator('#dKv').innerText()).includes(tests[1]));
    assert.deepEqual(await page.evaluate(() => [window.__LIFE_GAME.beds.length, JSON.parse(localStorage.getItem('life.records') || '[]').length]), [original, 0]);
    assert.deepEqual(errors, []);
    console.log('无病探索、连续检查、读档、结束与普通病历隔离通过');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
