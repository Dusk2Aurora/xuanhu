const assert = require('node:assert/strict');
const { enterWard, gameUrl, launchBrowser } = require('./browser');

async function withWard(browser, scenario, { caseId = 'review-test', glucose = 16 } = {}) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.addInitScript(() => {
      const nativeFrame = window.requestAnimationFrame.bind(window);
      let simulationFrame, timestamp = 1000;
      // Keep the game's clock deterministic while leaving browser animation frames available.
      window.requestAnimationFrame = callback => {
        if (callback.name !== 'loop') return nativeFrame(callback);
        simulationFrame = callback;
        return 0;
      };
      window.advanceSimulation = (milliseconds = 250) => simulationFrame(timestamp += milliseconds);
    });
    await page.goto(gameUrl);
    await page.evaluate(({ caseId, glucose }) => {
      const game = window.__LIFE_GAME;
      const patient = (name, glu, id = 'review-test') => game.E.create({
        id, name: '血糖复评测试病例', tags: [], goals: [],
        patient: { name, sex: '女', age: 40, height: 165, weight: 60 },
        init: { ...window.CASEGEN.BASE, glu },
      });
      Object.assign(game.S, patient('测试甲', glucose, caseId));
      game.beds.push({ S: patient('测试乙', 5.3) });
      window.advanceSimulation(0);
    }, { caseId, glucose });
    await enterWard(page);
    await page.locator('#opTitle').selectOption('pancreas');
    assert.match(await page.locator('#glucoseWait').innerText(), /等待血糖变化.*30 分钟/);
    await scenario(page);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
}

async function state(page) {
  return page.evaluate(() => {
    const game = window.__LIFE_GAME;
    return {
      speedLabel: document.querySelector('#ff').textContent,
      toast: document.querySelector('#toast').textContent,
      clocks: game.beds.map(bed => bed.S.t),
      reports: game.beds.map(bed => bed.S.tests.cbc?.done),
      reviewLogs: game.beds.map(bed => bed.S.log.map(row => row[1]).filter(message => message.includes('血糖复评'))),
    };
  });
}

async function startWaiting(page) {
  await page.locator('#glucoseWait').click();
  assert.equal((await state(page)).speedLabel, '结束等待');
  assert.equal(await page.locator('#glucoseWait').innerText(), '结束等待');
}

async function assertPaused(page, reason) {
  const stopped = await state(page);
  assert.equal(stopped.speedLabel, '继续模拟');
  assert.match(stopped.toast, reason);
  assert.equal(stopped.reviewLogs[0].length, 1);
  assert.match(stopped.reviewLogs[0][0], reason);
  assert.deepEqual(stopped.reviewLogs[1], []);
  await page.evaluate(() => {
    window.advanceSimulation();
    window.advanceSimulation();
  });
  const later = await state(page);
  assert.deepEqual(later.clocks, stopped.clocks);
  assert.deepEqual(later.reviewLogs, stopped.reviewLogs);
  return stopped;
}

async function main() {
  const browser = await launchBrowser();
  try {
    await withWard(browser, async page => {
      await startWaiting(page);
      await page.evaluate(() => window.advanceSimulation());
      const waiting = await state(page);
      assert.equal(waiting.speedLabel, '结束等待');
      assert.ok(waiting.clocks.every(seconds => seconds > 1));
      await page.evaluate(() => {
        window.__LIFE_GAME.S.glu = 10.9;
        window.advanceSimulation();
      });
      const stopped = await assertPaused(page, /血糖已进入本病例目标范围/);
      assert.match(stopped.toast, /16\.0 → 10\.9 mmol\/L/);
      assert.deepEqual(stopped.clocks, waiting.clocks);
      await page.locator('#ff').click();
      assert.equal((await state(page)).speedLabel, '快进 20×');
      await page.evaluate(() => window.advanceSimulation());
      const resumed = await state(page);
      assert.ok(resumed.clocks.every((seconds, index) => seconds > stopped.clocks[index]));
      assert.ok(resumed.clocks.every((seconds, index) => seconds - stopped.clocks[index] < 1));
    }, { caseId: 'dka' });

    await withWard(browser, async page => {
      await startWaiting(page);
      await page.evaluate(() => {
        window.__LIFE_GAME.S.glu = 17.9;
        window.advanceSimulation(0);
      });
      assert.equal((await state(page)).speedLabel, '结束等待');
      await page.evaluate(() => {
        window.__LIFE_GAME.S.glu = 18;
        window.advanceSimulation();
      });
      const stopped = await assertPaused(page, /血糖进一步偏离本病例目标/);
      assert.match(stopped.toast, /16\.0 → 18\.0 mmol\/L/);
    });

    await withWard(browser, async page => {
      await startWaiting(page);
      await page.evaluate(() => {
        const { beds } = window.__LIFE_GAME;
        for (const { S } of beds) S.t += 30 * 60 - 0.2;
      });
      assert.equal((await state(page)).speedLabel, '结束等待');
      await page.evaluate(() => window.advanceSimulation());
      const stopped = await assertPaused(page, /已到复评时间，血糖仍未达标/);
      assert.match(stopped.toast, /已过 30 分钟/);
      assert.ok(stopped.clocks.every(seconds => Math.abs(seconds - 1800) < 0.00001));
    });

    await withWard(browser, async page => {
      await startWaiting(page);
      await page.evaluate(() => {
        const game = window.__LIFE_GAME;
        game.S.glu = 11.9;
        game.beds[1].S.rhythm = 'vf';
        window.advanceSimulation();
      });
      const stopped = await assertPaused(page, /床位 2：室颤/);
      assert.deepEqual(stopped.clocks, [0, 0]);
      assert.doesNotMatch(stopped.toast, /已进入本病例目标/);
    });

    await withWard(browser, async page => {
      await page.evaluate(() => { window.__LIFE_GAME.beds[1].S.rhythm = 'vf'; });
      await page.locator('#glucoseWait').click();
      const refused = await state(page);
      assert.equal(refused.speedLabel, '快进 20×');
      assert.match(refused.toast, /床位 2：室颤.*请先处理/);
      assert.deepEqual(refused.reviewLogs, [[], []]);
    });

    await withWard(browser, async page => {
      await page.evaluate(() => {
        const { beds, E } = window.__LIFE_GAME;
        E.orderTest(beds[1].S, 'cbc');
        beds[1].S.tests.cbc.readyAt = 0.2;
      });
      await startWaiting(page);
      await page.evaluate(() => window.advanceSimulation());
      const stopped = await assertPaused(page, /床位 2 的血常规已回报/);
      assert.deepEqual(stopped.reports, [undefined, true]);
      assert.deepEqual(stopped.clocks, [0.2, 0.2]);
    });

    await withWard(browser, async page => {
      await startWaiting(page);
      await page.locator('#ff').click();
      await assertPaused(page, /已手动结束等待/);
    });

    console.log('glucose review UI passed: target, pause/resume, worsening, timeout, critical care, report, manual stop');
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
