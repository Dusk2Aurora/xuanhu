const assert = require('node:assert/strict');
const { launchBrowser, gameUrl, enterWard } = require('./browser');

async function main() {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, offline: true });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem('life.level', 'expert');
      const raf = window.requestAnimationFrame.bind(window);
      let scheduled, time = 100;
      window.requestAnimationFrame = callback => {
        if (callback.name !== 'loop') return raf(callback);
        scheduled = callback;
        return 0;
      };
      window.advanceSimulation = frames => {
        for (let i = 0; i < frames; i++) scheduled(time += 500);
      };
    });
    await page.goto(gameUrl);
    await enterWard(page);
    await page.evaluate(() => {
      const game = window.__LIFE_GAME;
      game.startCase(game.E.CASES.exploration, true, 1);
      const caseSpec = {
        ...game.E.CASES.exploration, diff: 6,
        vascularAccessSites: {
          piv: { left: { peripheral: 'collapsed' } },
          io: { right: { targetFracture: true } },
        },
      };
      game.startCase(caseSpec, false, 6);
      const model = window.VascularAccess;
      const context = { patient: caseSpec, difficulty: 6, now: 0, side: 'left' };
      for (let seed = 0; seed < 1000; seed++) {
        const trial = model.createState({ seed });
        model.start(trial, { ...context, type: 'piv' });
        const outside = model.advance(trial, 30);
        model.start(trial, { ...context, type: 'io' });
        const bone = model.advance(trial, 20);
        model.start(trial, { ...context, type: 'cvc' });
        const central = model.advance(trial, 180);
        if (!outside.success && bone.success && central.success) {
          game.S.vascularAccess.seed = seed;
          break;
        }
      }
    });
    await page.locator('#admissionIntro').click();
    const testBed = await page.evaluate(() => window.__LIFE_GAME.activeIdx);
    const rows = page.locator('#sheetList');
    const choose = name => rows.getByText(name, { exact: true }).click();
    const state = () => page.evaluate(() => {
      const { E, S } = window.__LIFE_GAME;
      const { attempt, pending, lastReceipt, lines, pumps } = E.accessState(S);
      return { t: S.t, cost: S.cost, given: S.given, attempt, pending, receipt: lastReceipt, lines, pumps,
        norepi: E.pumpRate(S, 'norepi'), log: S.log };
    });
    const openDrug = async (query, id) => {
      await page.locator('#btnDrug').click();
      await page.locator('#drugSearch').fill(query);
      await page.locator(`#drugList [data-id="${id}"]`).click();
    };
    const openAccess = async () => {
      await page.locator('#btnOps').click();
      await choose('血管通路');
    };
    const closeSheet = () => page.locator('#sheetClose').click();
    const advance = frames => page.evaluate(count => window.advanceSimulation(count), frames);

    await openDrug('对乙酰氨基酚', 'acetaminophen');
    await page.locator('#dGo').click();
    assert.ok((await state()).given.some(order => order.id === 'acetaminophen'));
    assert.deepEqual((await state()).lines, []);
    await closeSheet();

    await openDrug('去甲肾上腺素', 'norepi');
    await page.locator('#dPlus').click();
    const orderText = await page.locator('#dGo').innerText();
    const before = await state();
    await page.locator('#dGo').click();
    assert.match(await page.locator('#drugAccessNotice').innerText(), /缺少合适的血管通路/);
    assert.match(await page.locator('#sheetTitle').innerText(), /去甲肾上腺素/);
    assert.equal(await rows.getByText('选择通路及穿刺部位', { exact: true }).count(), 0);
    const ordered = await state();
    assert.equal(ordered.cost, before.cost);
    assert.deepEqual(ordered.given, before.given);
    assert.equal(ordered.pending.id, 'norepi');
    assert.ok(orderText.includes(String(ordered.pending.dose)));
    await page.locator('#drugAccessOps').click();
    await choose('血管通路');

    const blocked = rows.getByRole('button', { name: /骨内置管 · 右侧胫骨近端/ });
    assert.equal(await blocked.isDisabled(), true);
    assert.match(await blocked.innerText(), /胫骨已有骨折.*无费用/s);
    const peripheral = rows.getByRole('button', { name: /^外周静脉置管 · 左侧前臂/ });
    assert.match(await peripheral.innerText(), /失败率 55%.*失败耗材 ¥10/s);
    await choose('暂停模拟时钟');
    await peripheral.click();
    const paused = await state();
    await advance(8);
    assert.equal((await state()).t, paused.t);
    assert.equal((await state()).attempt.id, paused.attempt.id);
    assert.match(await page.locator('#accessProgressText').innerText(), /模拟已暂停/);
    await choose('收起，返回床旁');

    await page.locator('#btnOps').click();
    await choose('胸外按压');
    await choose('电除颤');
    assert.ok((await state()).log.some(entry => /按压/.test(entry[1])));
    assert.ok((await state()).log.some(entry => /电击|除颤/.test(entry[1])));
    await closeSheet();
    await page.locator('#pause').click();
    await page.locator('#ff').click();
    await advance(5);
    const failed = await state();
    assert.equal(failed.receipt.status, 'failed');
    assert.equal(failed.cost - before.cost, 10);
    assert.deepEqual(failed.pending, ordered.pending);
    assert.deepEqual(failed.given, before.given);
    await openAccess();
    assert.match(await rows.innerText(), /原医嘱|待执行医嘱/);
    await choose('骨内置管 · 左侧胫骨近端');
    await choose('收起，返回床旁');

    const other = await page.evaluate(() => {
      const game = window.__LIFE_GAME;
      const other = game.beds.find(({ S }) => S !== game.S).S;
      game.switchBed(other);
      return { count: other.given.length, cost: other.cost };
    });
    await advance(4);
    assert.equal((await state()).given.length, other.count);
    assert.equal((await state()).cost, other.cost);
    assert.match(await page.locator('#toast').innerText(), new RegExp(`床位 ${testBed + 1}.*去甲肾上腺素`, 's'));
    await page.evaluate(index => window.__LIFE_GAME.switchBed(window.__LIFE_GAME.beds[index].S), testBed);
    const treated = await state();
    assert.equal(treated.pending, null);
    assert.equal(treated.receipt.status, 'given');
    assert.equal(treated.norepi, ordered.pending.dose);
    assert.equal(treated.given.filter(order => order.id === 'norepi').length, 1);
    assert.equal(treated.lines[0].type, 'io');
    assert.ok(treated.cost >= failed.cost + 320);
    assert.match(await page.locator('#accessNotice').innerText(), /升压.*中心静脉通路/s);

    await page.locator('#btnOps').click();
    await choose('高级设备与介入');
    await choose('中心静脉置管（CVC）');
    await choose('超声引导中心静脉置管 · 左侧颈内静脉');
    await advance(20);
    assert.match(await rows.innerText(), /通路已建立/);
    await choose('一键迁移泵药至此通路');
    const migrated = await state();
    const centralLine = migrated.lines.find(line => line.type === 'cvc');
    assert.equal(migrated.pumps.norepi, centralLine.id);
    assert.equal(migrated.norepi, treated.norepi);
    assert.equal(migrated.given.filter(order => order.id === 'norepi').length, 1);
    assert.match(await rows.innerText(), /当前首选.*泵位 1 \/ 3.*去甲肾上腺素/s);
    await closeSheet();
    await page.locator('#btnMenu').click();
    await choose('当前输液与泵药');
    assert.match(await page.locator('#dKv').innerText(), /左侧颈内静脉/);
    assert.deepEqual(errors, []);
    console.log('静脉医嘱留存、暂停与急救、置管失败重试、跨床回执及中心静脉迁泵通过。');
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
