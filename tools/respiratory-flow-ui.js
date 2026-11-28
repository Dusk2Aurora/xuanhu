const assert = require('node:assert/strict');
const { launchBrowser, gameUrl, enterWard } = require('./browser');

async function applyFlow(page, rate) {
  const slider = page.getByRole('slider');
  await slider.fill(String(rate));
  assert.equal(await slider.getAttribute('aria-valuetext'), rate + ' L/min');
  await page.getByRole('button', { name: '应用流量' }).click();
}

async function main() {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(gameUrl);
    await enterWard(page);
    await page.locator('#pause').click();
    await page.locator('#opTitle').selectOption('lung');
    const meter = page.locator('#respiratoryFlow');
    await meter.click();
    await applyFlow(page, 6);
    assert.match(await meter.innerText(), /氧疗供氧流量 · 6 L\/min/);
    const oxygen = await page.evaluate(() => {
      const { E, S } = window.__LIFE_GAME;
      return [E.oxygenSettings(S).flow, S.fio2, !!S.vent];
    });
    assert.equal(oxygen[0], 6);
    assert(oxygen[1] > 0.21 && oxygen[1] < 1);
    assert.equal(oxygen[2], false);

    await page.evaluate(() => { window.__LIFE_GAME.S.gcs = 6; });
    /* 做完操作后面板会留在操作页，先收起再点第二次 */
    const closeSheetIfOpen = async () => {
      await page.evaluate(() => {
        const sheet = document.getElementById('sheet');
        if (sheet && sheet.classList.contains('on')) {
          const btn = document.getElementById('sheetClose');
          if (btn) btn.click();
        }
      });
      await page.waitForTimeout(200);
    };
    await closeSheetIfOpen();
    await page.locator('#btnOps').click();
    await page.locator('#sheetList .drow').filter({ hasText: '气管插管 + 机械通气' }).click();
    await closeSheetIfOpen();
    await page.locator('#btnOps').click();
    await page.locator('#sheetList .drow').filter({ hasText: '调节呼吸机吸气流量' }).click();
    await applyFlow(page, 15);
    assert.match(await meter.innerText(), /呼吸机吸气流量 · 15 L\/min/);
    await meter.click();
    assert.match(await page.locator('.flow-settings').innerText(), /300 mL/);
    await applyFlow(page, 90);
    assert.match(await meter.innerText(), /90 L\/min/);
    await meter.click();
    assert.match(await page.locator('.flow-settings').innerText(), /450 mL/);
    await page.locator('#sheetClose').click();
    await page.reload();
    await enterWard(page);
    await page.locator('#opTitle').selectOption('lung');
    assert.match(await meter.innerText(), /呼吸机吸气流量 · 90 L\/min/);
    assert.match(await page.locator('#opan').innerText(), /PaO₂/);
    assert.deepEqual(errors, []);
    console.log('Bedside oxygen and ventilator flow controls, intubation, and reload passed.');
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
