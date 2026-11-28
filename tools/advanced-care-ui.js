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
      return { cost: S.deviceCost || 0, setup: S.deviceSetupCost || 0, time: S.t, status: E.advancedDevice(S, 'vaEcmo') };
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
    await choose('返回高级设备与介入');
    await choose('VA-ECMO');
    assert.match(await sheet.locator('#deviceReadings').innerText(), /血压.*血氧.*心率.*末梢灌注/);
    await choose('开始试撤');
    assert.match(await sheet.locator('#deviceTrialBaseline').innerText(), /试撤前 \d+:\d+:\d+.*末梢灌注/);
    assert.match(await sheet.locator('#deviceProgress').innerText(), /试撤中/);
    const started = await game();
    await page.locator('#sheetClose').click();
    await page.locator('#ff').click();
    await page.waitForFunction(time => window.__LIFE_GAME.S.t >= time + 10, started.time);
    await page.locator('#ff').click();
    await open();
    await choose('VA-ECMO');
    const advanced = await game();
    assert.deepEqual(advanced.status.trial, started.status.trial);
    assert.ok(advanced.status.seconds >= started.status.seconds + 10 && advanced.cost > started.cost);
    await choose('恢复原支持');
    const restored = await game();
    assert.equal(restored.setup, 45000);
    assert.equal(restored.status.trial, undefined);
    assert.equal(restored.status.startedAt, started.status.startedAt);
    await choose('开始试撤');
    const pending = (await game()).status.trial;

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
    await choose('开始试撤');
    await choose('确认试撤后停机');
    assert.equal((await game()).status.active, false);
    for (const [name, restoreLabel, stopLabel] of [
      ['VV-ECMO', '恢复原支持', '确认试撤后停机'],
      ['CRRT', '恢复原支持', '确认试撤后停机'],
      ['持续脑电监测', '恢复脑电采集', '确认试撤后停机'],
      ['亚低温治疗', '恢复原支持', '结束试撤并受控复温'],
    ]) {
      await choose('返回高级设备与介入');
      await choose(name);
      await choose('确认在本床启用');
      const setup = (await game()).setup;
      await choose('开始试撤');
      assert.match(await sheet.locator('#deviceTrialBaseline').innerText(), /试撤前/);
      await choose(restoreLabel);
      await choose('开始试撤');
      await choose(stopLabel);
      assert.equal((await game()).setup, setup);
    }
    await page.locator('#sheetClose').click();
    await page.reload();
    await enterWard(page);
    assert.equal(await page.evaluate(() => window.__LIFE_GAME.beds.filter(b =>
      window.LIFE.advancedDevice(b.S, 'vaEcmo').active).length), 1);
    assert.deepEqual(await page.evaluate(() => window.__LIFE_GAME.beds
      .map(b => window.LIFE.advancedDevice(b.S, 'vaEcmo').trial).find(Boolean)), pending);
    await page.evaluate(() => {
      const game = window.__LIFE_GAME;
      game.startCase(window.CASEGEN.generate(2, 101, ['aorticDissection']), true);
      game.S.t = game.E.orderTest(game.S, 'aorta_cta');
      game.E.pollTests(game.S);
    });
    await page.locator('#admissionIntro').click();
    await open();
    await choose('手术室体外循环与控温准备');
    await choose('确认在本床启用');
    await choose('开始试撤');
    assert.match(await sheet.locator('#deviceTrialBaseline').innerText(), /核心体温/);
    await choose('恢复原支持');
    await choose('开始试撤');
    await choose('结束试撤并受控复温');
    assert.deepEqual(errors, []);
    console.log('六类设备试撤、恢复与停机，以及 ECMO 报价、同床互斥和跨床读档通过');
  } finally { await browser.close(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
