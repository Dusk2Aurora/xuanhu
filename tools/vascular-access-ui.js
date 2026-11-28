const assert = require('node:assert/strict');
const { launchBrowser, gameUrl, enterWard } = require('./browser');

async function main() {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, offline: true });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem('life.level', 'intern');
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

    const rows = page.locator('#sheetList');
    const title = page.locator('#sheetTitle');
    const choose = name => rows.getByText(name, { exact: true }).click();
    const closeSheet = () => page.locator('#sheetClose').click();
    const advance = frames => page.evaluate(count => window.advanceSimulation(count), frames);
    const startCase = async (diff, replace) => {
      await page.evaluate(({ diff, replace }) => {
        const game = window.__LIFE_GAME;
        game.startCase({ ...game.E.CASES.exploration, diff }, replace, diff);
      }, { diff, replace });
      await page.locator('#admissionIntro').click();
    };
    const state = () => page.evaluate(() => {
      const { E, S } = window.__LIFE_GAME;
      const { attempt, lines, available } = E.accessState(S);
      return { t: S.t, cost: S.cost, given: S.given, attempt, lines, available,
        norepi: E.pumpRate(S, 'norepi'), dobutamine: E.pumpRate(S, 'dobutamine'), log: S.log };
    });
    const openDrug = async (query, id) => {
      await page.locator('#btnDrug').click();
      await page.locator('#drugSearch').fill(query);
      await page.locator('#drugList [data-id="' + id + '"]').click();
    };
    const openAccess = async () => {
      await page.locator('#btnOps').click();
      await choose('血管通路');
    };
    const checkRoutineOptions = async () => {
      assert.deepEqual(await rows.locator('.drow .nm').allTextContents(),
        ['外周静脉置管', '超声引导外周静脉置管', '骨内置管', '返回操作']);
      assert.doesNotMatch(await rows.innerText(), /概率|失败率|%|左侧|右侧|泵位|待执行|回执|血管良好|细弱|塌陷|肿胀|骨性标志|充盈|躁动/);
    };

    await startCase(1, true);
    await openAccess();
    await checkRoutineOptions();
    await closeSheet();

    await startCase(6, false);
    const testBed = await page.evaluate(() => {
      const game = window.__LIFE_GAME;
      const model = window.VascularAccess;
      const context = { patient: game.S.cas, actual: game.S, difficulty: 6, now: 0 };
      for (let seed = 0; seed < 1000; seed++) {
        const trial = model.createState({ seed });
        const run = type => {
          const { attempt } = model.start(trial, { ...context, type });
          return model.advance(trial, attempt.endsAt).success;
        };
        if (!run('piv') && run('io') && run('cvc')) {
          game.S.vascularAccess.seed = seed;
          return game.activeIdx;
        }
      }
      throw new Error('无法准备置管失败和重试的测试病例');
    });

    await openDrug('对乙酰氨基酚', 'acetaminophen');
    await page.locator('#dGo').click();
    assert.ok((await state()).given.some(order => order.id === 'acetaminophen'));
    assert.deepEqual((await state()).lines, []);
    await closeSheet();

    await openDrug('去甲肾上腺素', 'norepi');
    const defaultOrder = await page.locator('#dGo').innerText();
    await page.locator('#dPlus').click();
    assert.notEqual(await page.locator('#dGo').innerText(), defaultOrder);
    const before = await state();
    await page.locator('#dGo').click();
    assert.match(await page.locator('#toast').innerText(), /到「操作」建立血管通路，完成后重新开药/);
    assert.equal(await page.locator('#drugSearch').inputValue(), '去甲肾上腺素');
    assert.equal(await page.locator('#dGo').count(), 0);
    assert.deepEqual(await state(), before);
    await closeSheet();

    await page.locator('#ff').click();
    await openAccess();
    await checkRoutineOptions();
    await choose('外周静脉置管');
    assert.match(await title.innerText(), /建立血管通路/);
    assert.deepEqual(await state(), before);
    await choose('取消');
    await checkRoutineOptions();
    await choose('外周静脉置管');
    await choose('确认建立');
    assert.match(await title.innerText(), /置管进度/);
    assert.doesNotMatch(await rows.innerText(), /暂停|继续时钟|待执行|回执|%|左侧|右侧/);
    const started = await state();
    await advance(2);
    assert.ok((await state()).t > started.t);
    const progress = page.locator('#accessProgress');
    const elapsed = await progress.evaluate(node => node.value);
    assert.ok(elapsed > 0);
    await closeSheet();
    await page.locator('#pause').click();
    const pausedAt = (await state()).t;
    await openAccess();
    await advance(4);
    assert.equal((await state()).t, pausedAt);
    assert.equal(await progress.evaluate(node => node.value), elapsed);
    await choose('返回');
    assert.match(await title.innerText(), /^操作/);
    await choose('胸外按压');
    assert.ok((await state()).log.some(entry => /按压/.test(entry[1])));
    await closeSheet();
    await page.locator('#pause').click();
    await advance(4);
    const failed = await state();
    assert.equal(failed.attempt, null);
    assert.equal(failed.available, false);
    assert.equal(failed.cost - before.cost, 10);
    assert.deepEqual(failed.given, before.given);
    assert.ok(failed.log.some(entry => /外周静脉置管失败/.test(entry[1])));

    await openAccess();
    await choose('骨内置管');
    await choose('确认建立');
    assert.match(await page.locator('#accessProgressText').innerText(), /剩余/);
    await closeSheet();
    assert.equal(await page.locator('#sheet').evaluate(node => node.classList.contains('on')), false);
    const otherBefore = await page.evaluate(() => {
      const game = window.__LIFE_GAME;
      const other = game.beds.find(({ S }) => S !== game.S).S;
      game.switchBed(other);
      return { count: other.given.length, cost: other.cost };
    });
    await advance(3);
    assert.equal((await state()).given.length, otherBefore.count);
    assert.equal((await state()).cost, otherBefore.cost);

    await page.evaluate(index => window.__LIFE_GAME.switchBed(window.__LIFE_GAME.beds[index].S), testBed);
    const connected = await state();
    assert.equal(connected.available, true);
    assert.equal(connected.attempt, null);
    assert.deepEqual(connected.lines.map(line => line.type), ['io']);
    assert.deepEqual(connected.given, before.given);
    assert.equal(connected.norepi, 0);
    await openAccess();
    assert.ok(await rows.getByRole('button', { name: /^骨内置管/ }).isDisabled());
    assert.ok(await rows.getByRole('button', { name: /^外周静脉置管/ }).isEnabled());
    await closeSheet();

    await openDrug('去甲肾上腺素', 'norepi');
    assert.equal(await page.locator('#dGo').innerText(), defaultOrder);
    await page.locator('#dGo').click();
    assert.ok((await state()).norepi > 0);
    await closeSheet();
    await openDrug('多巴酚丁胺', 'dobutamine');
    await page.locator('#dGo').click();
    const treated = await state();
    assert.ok(treated.dobutamine > 0);
    assert.deepEqual(treated.lines.map(line => line.type), ['io']);
    await closeSheet();

    await page.locator('#btnOps').click();
    await choose('高级设备与介入');
    const central = rows.getByRole('button', { name: /^超声引导中心静脉置管/ });
    assert.equal(await central.count(), 1);
    assert.doesNotMatch(await central.innerText(), /概率|失败率|%|左侧|右侧|泵位|目标血管|充盈|躁动/);
    await central.click();
    assert.match(await rows.innerText(), /骨内置管.*超声引导中心静脉置管/);
    assert.deepEqual(await state(), treated);
    await choose('取消');
    assert.match(await title.innerText(), /高级设备与介入/);
    await central.click();
    await choose('确认更换');
    assert.match(await title.innerText(), /置管进度/);
    assert.deepEqual((await state()).lines.map(line => line.type), ['io']);
    await advance(20);
    assert.match(await title.innerText(), /高级设备与介入/);
    const finished = await state();
    assert.deepEqual(finished.lines.map(line => line.type), ['cvc']);
    assert.ok(await central.isDisabled());
    assert.equal(finished.norepi, treated.norepi);
    assert.equal(finished.dobutamine, treated.dobutamine);
    assert.doesNotMatch(await rows.innerText(), /泵位|迁移|回执/);
    await closeSheet();

    await page.locator('#btnMenu').click();
    await choose('当前输液与泵药');
    const pumpCards = await page.locator('#dKv').innerText();
    assert.match(pumpCards, /去甲肾上腺素/);
    assert.match(pumpCards, /多巴酚丁胺/);
    assert.doesNotMatch(pumpCards, /通路|泵位|迁移/);
    assert.deepEqual(errors, []);
    console.log('通路菜单、置管进度与重试、跨床推进、重新开药及共用一条通路通过。');
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
