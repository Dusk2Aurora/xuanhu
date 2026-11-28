const assert = require('node:assert/strict');
const { launchBrowser, gameUrl, enterWard } = require('./browser');

async function setSlider(page, id, value, unit) {
  const slider = page.locator('#' + id);
  await slider.fill(String(value));
  assert.equal(await slider.getAttribute('aria-valuetext'), value + ' ' + unit);
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
    await setSlider(page, 'respFlowInput', 6, 'L/min');
    await page.getByRole('button', { name: '应用流量' }).click();
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
    await page.locator('#sheetList .drow').filter({ hasText: '呼吸机设置' }).click();
    await setSlider(page, 'respFlowInput', 15, 'L/min');
    await setSlider(page, 'respRateInput', 20, '次/分');
    await setSlider(page, 'respFio2Input', 38, '%');
    assert.match(await page.locator('.flow-settings').innerText(), /300 \/ 450 mL · 吸气 1.20 秒 · 呼气 1.80 秒/);
    await page.getByRole('button', { name: '应用设置' }).click();
    assert.match(await meter.innerText(), /呼吸机设置 · 15 L\/min/);
    assert.match(await page.locator('#opan').innerText(), /RR\s+20\s+rpm · 机械通气/);
    assert.match(await page.locator('#opan').innerText(), /FiO₂\s+38\s+%/);
    await meter.click();
    await setSlider(page, 'respFlowInput', 90, 'L/min');
    assert.match(await page.locator('.flow-settings').innerText(), /450 \/ 450 mL · 吸气 0.30 秒 · 呼气 2.70 秒/);
    await page.getByRole('button', { name: '应用设置' }).click();
    assert.match(await meter.innerText(), /90 L\/min/);
    await page.reload();
    await enterWard(page);
    await page.locator('#opTitle').selectOption('lung');
    assert.match(await meter.innerText(), /呼吸机设置 · 90 L\/min/);
    assert.match(await page.locator('#opan').innerText(), /PaO₂/);
    assert.match(await page.locator('#opan').innerText(), /RR\s+20\s+rpm · 机械通气/);
    assert.match(await page.locator('#opan').innerText(), /FiO₂\s+38\s+%/);
    await meter.click();
    assert.equal(await page.locator('#respRateInput').inputValue(), '20');
    assert.equal(await page.locator('#respFio2Input').inputValue(), '38');
    assert.deepEqual(errors, []);
    console.log('Bedside oxygen and ventilator controls, intubation, and reload passed.');
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
