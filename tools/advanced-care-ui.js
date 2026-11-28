const assert = require('node:assert/strict');
const { gameUrl, launchBrowser, enterWard } = require('./browser');

async function main() {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ offline: true, viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(5000);
    await page.addInitScript(() => {
      localStorage.setItem('life.realismRules', JSON.stringify({ insurance: true }));
    });
    await page.goto(gameUrl);
    await enterWard(page);
    const sheet = page.locator('#sheet.on');
    const choose = name => sheet.locator('.drow .nm').filter({ hasText: new RegExp('^' + name + '$') }).click();
    const open = async () => { await page.locator('#btnOps').click(); await choose('高级设备与介入'); };
    const game = () => page.evaluate(() => {
      const { S, E } = window.__LIFE_GAME;
      return { cost: S.deviceCost || 0, time: S.t, status: E.advancedDevice(S, 'vaEcmo') };
    });

    await open();
    await choose('VA-ECMO');
    const quote = await sheet.innerText();
    assert.match(quote, /45000\.00/);
    assert.match(quote, /47000\.00/);
    assert.match(quote, /预计新增自付 ¥47000\.00/);
    assert.equal((await game()).cost, 0);
    await choose('确认在本床启用');
    assert.equal((await game()).status.active, true);
    await choose('返回高级设备与介入');
    await choose('VV-ECMO');
    await choose('确认在本床启用');
    assert.ok((await game()).cost < 45010, '同床不能同时开两个 ECMO 模式或重复计开机费');

    await page.locator('#sheetClose').click();
    await page.evaluate(() => {
      window.__LIFE_GAME.startCase(window.CASEGEN.generate(6, 41, ['seizure']), false);
    });
    await page.locator('#admissionIntro').click();
    await open();
    await choose('VA-ECMO');
    await choose('确认在本床启用');
    assert.equal(await page.evaluate(() => window.__LIFE_GAME.beds.filter(b =>
      window.LIFE.advancedDevice(b.S, 'vaEcmo').active).length), 2);
    await choose('确认停止本床设备');
    assert.equal((await game()).status.active, false);
    await page.locator('#sheetClose').click();
    await page.reload();
    await enterWard(page);
    assert.equal(await page.evaluate(() => window.__LIFE_GAME.beds.filter(b =>
      window.LIFE.advancedDevice(b.S, 'vaEcmo').active).length), 1);
    assert.deepEqual(errors, []);
    console.log('床旁 ECMO 报价、同床互斥、双床同时开机、停机与读档验证通过');
  } finally { await browser.close(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
