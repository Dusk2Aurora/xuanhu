const assert = require('node:assert/strict');
const { launchBrowser, gameUrl, enterWard } = require('./browser');

async function main() {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 412, height: 850 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      const raf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = fn => fn.name === 'loop' ? 0 : raf(fn);
    });
    await page.goto(gameUrl);
    await enterWard(page);
    const start = async id => page.evaluate(id => {
      window.__LIFE_GAME.startCase(window.CASEGEN.generate(2, 10, [id]), true);
      const E = window.LIFE;
      return { bp: E.EXAMS.bilateral_bp.name, group: E.TEST_GROUPS.find(g => g.id === E.TESTS.aorta_cta.group).name,
        scan: E.TESTS.aorta_cta.name, surgery: E.ACTIONS.aortic_replacement.name, tevar: E.ACTIONS.tevar.name,
        bypass: E.ADVANCED_DEVICES.aorticBypass.name };
    }, id);
    const options = await start('aorticDissection');
    await page.locator('#admissionIntro').click();
    const rows = page.locator('#sheetList');
    const choose = text => rows.getByText(text, { exact: true }).click();
    const close = () => page.locator('#sheetClose').click();
    const advanced = async name => {
      await page.locator('#btnOps').click();
      await choose('高级设备与介入');
      await choose(name);
    };
    const runClock = (seconds, labetalol = false) => page.evaluate(([seconds, give]) => {
      const { S, E } = window.__LIFE_GAME;
      if (give) E.give(S, 'labetalol');
      for (let t = 0; t < seconds && S.running; t += 2) {
        E.tick(S, 2);
        CASEGEN.step(S, 2, E);
        E.pollTests(S);
      }
    }, [seconds, labetalol]);
    const cost = () => page.evaluate(() => window.__LIFE_GAME.S.cost);
    const initial = await cost();
    await advanced(options.surgery);
    assert.match(await rows.innerText(), /尚缺本床主动脉 CTA/);
    await close();
    assert.equal(await cost(), initial);
    await page.locator('#btnBody').click();
    await choose('床旁查体');
    await choose(options.bp);
    assert.match(await page.locator('#dKv').innerText(), /左|右/);
    await page.locator('#detailX').click();
    await choose('返回检查');
    await choose(options.group);
    await choose(options.scan);
    await close();
    await runClock(8 * 60, true);
    await advanced(options.surgery);
    await choose('申请' + options.surgery);
    assert.equal(await page.evaluate(() => window.__LIFE_GAME.S.aorticSurgeryStartedAt), undefined);
    await choose('手术室控温与灌注');
    await choose('确认在本床启用');
    await close();
    await runClock(14 * 60);
    await advanced(options.surgery);
    assert.match(await rows.innerText(), /准备就绪/);
    await choose('申请' + options.surgery);
    assert.ok(await page.evaluate(() => window.__LIFE_GAME.S.aorticSurgeryStartedAt > 0));
    await close();
    await runClock(13 * 60);
    assert.equal(await page.evaluate(() => window.LIFE.advancedDevice(window.__LIFE_GAME.S, 'aorticBypass').phase), 'rewarming');

    await start('aorticDissectionB');
    await page.locator('#admissionIntro').click();
    await page.locator('#btnBody').click();
    await choose(options.group);
    await choose(options.scan);
    await close();
    await runClock(9 * 60, true);
    await advanced(options.surgery);
    assert.match(await rows.innerText(), /尚未证实这项术式/);
    await choose('返回高级设备与介入');
    await choose(options.tevar);
    assert.match(await rows.innerText(), /准备就绪/);
    await choose('申请' + options.tevar);
    assert.ok(await page.evaluate(() => window.__LIFE_GAME.S.tevarStartedAt > 0));
    await close();
    await runClock(13 * 60);
    assert.ok(await page.evaluate(() => window.__LIFE_GAME.S.tevarCompletedAt > 0));
    for (const [id, wrong, correct] of [
      ['spleen', '创伤手术止血', '急诊手术止血'],
      ['fallTrauma', '急诊手术止血', '创伤手术止血'],
    ]) {
      await start(id);
      await page.locator('#admissionIntro').click();
      await page.locator('#btnOps').click();
      assert.match(await rows.getByRole('button', { name: /^急诊手术止血/ }).innerText(), /脾破裂、宫外孕破裂或肢体创伤出血/);
      assert.match(await rows.getByRole('button', { name: /^创伤手术止血/ }).innerText(), /坠落多发伤的腹腔出血/);
      const bleeding = () => page.evaluate(id => window.__LIFE_GAME.S.bleedingSites[id], id);
      const initialRate = await bleeding();
      assert.ok(initialRate > 0);
      await choose(wrong);
      assert.equal(await bleeding(), initialRate);
      const log = await page.evaluate(() => window.__LIFE_GAME.S.log.map(entry => entry[1]).join('\n'));
      assert.ok(log.includes('「' + correct + '」'));
      await choose(correct);
      assert.equal(await bleeding(), 0);
      await close();
    }
    assert.deepEqual(errors, []);
    console.log('CTA 分型、A 型术前控温与置换、术后复温及复杂 B 型 TEVAR 开单通过');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
