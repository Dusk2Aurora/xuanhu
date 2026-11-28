const assert = require('node:assert/strict');
const { launchBrowser, gameUrl, enterWard } = require('./browser');

async function main() {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ offline: true, viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      const raf = window.requestAnimationFrame.bind(window);
      let frameTime = 0;
      window.requestAnimationFrame = callback => {
        if (callback.name !== 'loop') return raf(callback);
        window.advanceCatalogFrame = () => callback(frameTime += 500);
        return 0;
      };
    });
    await page.goto(gameUrl);
    await enterWard(page);

    const orders = await page.evaluate(() => window.SUBSTANCES.ALL.flatMap(item =>
      (item.routes || []).flatMap((route, routeIndex, routes) => {
        const timed = route.infusionMinutes || route.infusionMinutesPerUnit;
        const pump = !!route.pumpHalfLife;
        if (!pump && !timed && !/静滴|静脉滴注|输液|挂液|输血|输注|泵入/.test(route.r)) return [];
        const minutes = route.infusionMinutesPerUnit == null ? route.infusionMinutes :
          route.infusionMinutesPerUnit * route.d;
        return [{ id: item.id, name: item.n, route: route.r, routeIndex, routeCount: routes.length,
          pump, minutes, defaultRate: route.d, unit: route.unit || item.unit }];
      })));
    assert.ok(orders.some(order => order.pump) && orders.some(order => order.minutes > 0),
      '药库需同时覆盖定时输注与持续泵药');

    const failures = [];
    for (const order of orders) {
      const result = await page.evaluate(order => {
        const select = selector => document.querySelector(selector);
        const expect = (condition, reason) => {
          if (!condition) throw new Error(reason);
        };
        const click = selector => {
          const element = select(selector);
          expect(element?.getClientRects().length > 0 && !element.disabled, '入口不可用 ' + selector);
          element.click();
        };
        const game = window.__LIFE_GAME;
        const panel = select('#infusionPanel');
        const list = select('#infusionList');
        const detail = '#detail.on[data-view="infusions"]';
        const { id, name, route, routeIndex, routeCount, pump, minutes, defaultRate, unit } = order;
        const itemId = CSS.escape(id);
        const previousToast = select('#toast.on')?.textContent;

        try {
          expect(pump || minutes > 0, '药库途径缺少输注时长');
          game.startCase({
            ...game.E.CASES.exploration,
            prehospitalAccess: { type: 'cvc', side: 'right' },
          }, true);
          click('#admissionIntro');
          expect(panel.hidden && !list.children.length, '新床位已有床旁输注');

          click('#btnDrug');
          const search = select('#sheet.on #drugSearch');
          expect(search, '药库缺少搜索入口');
          search.value = name;
          search.dispatchEvent(new Event('input', { bubbles: true }));
          click(`#drugList button[data-id="${itemId}"]`);

          if (routeCount > 1) {
            const button = `#sheet.on [data-ri="${routeIndex}"]`;
            expect(select(button)?.textContent.trim() === route, '医嘱缺少目标给药途径');
            click(button);
            expect(select(button).getAttribute('aria-pressed') === 'true', '目标给药途径未选中');
          }
          const confirm = '#sheet.on #dGo';
          expect(select(confirm)?.textContent.trim().startsWith(`开始${route} ${name}`), '医嘱确认文案未匹配');
          click(confirm);
          expect(!panel.hidden && list.children.length === 1, '给药后床旁在挂列表未出现');
          const row = list.firstElementChild;
          expect(row.querySelector('.infusion-name').textContent === name, '床旁在挂药物名称未匹配');
          expect(row.querySelector('.infusion-state').textContent === (pump ? '持续泵入' : route), '床旁在挂状态未匹配');
          const progress = row.querySelector('progress');
          expect(progress, '床旁在挂进度条未出现');
          if (pump) {
            expect(progress.position === -1, '持续泵进度条应使用未定进度');
            const rate = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 3, useGrouping: false }).format(defaultRate);
            expect(row.querySelector('.infusion-meta').textContent === `泵速 ${rate} ${unit}`, '床旁泵速或单位未匹配');
          } else {
            expect(progress.value === 0 && Math.abs(progress.max - minutes) < 1e-7, '定时进度初始值或时长未匹配');
            game.S.t += minutes * 60 / 4;
            window.advanceCatalogFrame();
            window.advanceCatalogFrame();
            expect(progress.value >= minutes / 4 && progress.value < minutes, '定时进度未随模拟时间推进');
            const amounts = row.querySelector('.infusion-meta').textContent;
            expect(/已输 .+剩余 /.test(amounts), '床旁缺少已输量或剩余时间');
            if (unit === 'mL') expect(/^已输 <?\d+ \/ /.test(amounts), '床旁体积应显示整毫升');
            else expect(/^已输 <?\d+(?:\.\d)? \/ /.test(amounts), '床旁已输药量最多显示一位小数');
          }

          click('#sheet.on #sheetClose');
          click('#bedsideInfusionDetails');
          if (pump) {
            click(`${detail} [data-pump-id="${itemId}"]`);
            click('#sheet.on #dStop');
          } else {
            click(`${detail} [data-infusion-id="${itemId}"]`);
            click(`${detail} [data-stop-infusion]`);
          }
          expect(panel.hidden && !list.children.length, '停止后床旁仍显示在挂药物');
          const active = select(`${detail} .infusion-section:first-child`);
          expect(active?.querySelector('.infusion-empty'), '停止后详情仍显示在挂药物');
          expect(select(detail).textContent.includes(pump ? '已停泵' : '已停止'), '近期记录未显示停止状态');
          return null;
        } catch (error) {
          const toast = select('#toast.on')?.textContent;
          return toast && toast !== previousToast ? `${error.message}（提示：${toast}）` : error.message;
        }
      }, order);
      if (result) failures.push(`${order.name} · ${order.route}：${result}`);
    }

    assert.deepEqual([...failures, ...errors], [], '药库输注走查发现异常');
    const continuous = orders.filter(order => order.pump).length;
    console.log(`药库共 ${orders.length} 条输注途径通过给药、床旁显示及停止检查（${orders.length - continuous} 条定时输注，${continuous} 条持续泵药）。`);
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
