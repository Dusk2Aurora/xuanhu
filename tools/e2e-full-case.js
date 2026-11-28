/* Exercise the fixed teaching case through discharge and persistent records. */
const assert = require('node:assert/strict');
const { launchBrowser, gameUrl, enterWard } = require('./browser');

async function main() {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
    await page.goto(gameUrl);
    await enterWard(page);
    await page.locator('#btnMenu').click();
    const rows = page.locator('#sheetList .drow');
    await rows.filter({ hasText: '切换病例' }).click();
    /* 病名已匿名化：教学病例按序号列出，第 1 个是高钾血症 */
    await rows.filter({ hasText: '教学病例 1' }).click();
    const assessment = await page.evaluate(() => {
      const { S, E } = window.__LIFE_GAME;
      if (S.caseId !== 'hyperkalemia') throw Error('未能切换至固定病例');
      const { attempt } = E.startAccess(S, 'piv');
      E.tick(S, attempt.seconds);
      E.orderMedication(S, 'calcium', 10);
      E.orderMedication(S, 'insulin', 10);
      E.orderMedication(S, 'dextrose50', 25);
      for (let i = 0; i < 480 && S.running && !E.dischargeCheck(S).ok; i++) {
        if (S.k > 5.5 && S.t > 300) E.ACTIONS.dialysis.apply(S);
        E.tick(S, 30);
      }
      if (!E.accessState(S).available) throw Error('出院评估时应仍留有外周通路');
      return E.dischargeCheck(S);
    });
    assert.equal(assessment.ok, true, assessment.reasons.join('、'));
    const warning = page.locator('#sevOk');
    if (await warning.isVisible()) await warning.click();
    await page.locator('#btnMenu').click();
    await rows.filter({ hasText: '办理出院' }).click();
    await page.waitForFunction(() => window.__LIFE_GAME.beds.length === 0);
    await page.getByText('分享本例', { exact: true }).click();
    const shareCode = await page.getByLabel('本例分享码').inputValue();
    assert.match(shareCode, /^HX1-/);
    await page.getByText('接诊病历', { exact: true }).click();
    assert.match(await page.locator('.case-review-body details[open]').filter({ hasText: '接诊病历' }).innerText(), /接诊首测/);
    await page.reload();
    const { records, entries } = await page.evaluate(() => ({
      records: JSON.parse(localStorage.getItem('life.records') || '[]'),
      entries: JSON.parse(localStorage.getItem('life.handbook') || '{}').entries || [],
    }));
    assert.equal(records.length, 1, '一次出院应写入一份病历');
    assert.equal(records[0].结局, '出院');
    assert.ok(records[0].入院记录.chief.sourceLabel);
    assert.ok(Number.isFinite(records[0].入院记录.vitals.hr));
    assert.ok(entries.some(e => e.cured > 0), '手册应保存治愈记录');
    await page.locator('#lobby [data-act="records"]').click();
    await rows.first().click();
    await page.getByText('分享本例', { exact: true }).click();
    assert.equal(await page.getByLabel('本例分享码').inputValue(), shareCode);
    await page.locator('#detailX').click();
    await page.locator('#sheetClose').click();
    await page.locator('#lobby [data-act="consult"]').click();
    await page.locator('#cIn').fill(shareCode);
    await page.locator('#cParse').click();
    assert.match(await page.locator('#cPreview').innerText(), /结局：出院/);
    assert.ok((await page.locator('#cPreview').innerText()).includes('评分 ' + records[0].评分));
    await page.locator('#cTake').click();
    const resumed = await page.evaluate(() => {
      const { S } = window.__LIFE_GAME;
      return [S.caseId, S.patient.name, S.running, S.given?.length || 0];
    });
    assert.deepEqual(resumed, ['hyperkalemia', records[0].患者, true, 0]);
    assert.deepEqual(errors, []);
    console.log('高钾教学病例通过：办理出院，刷新后保留一份病历和手册记录。');
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
