/* 端到端：完整打完一个病例（node 侧驱动引擎，UI 侧跑主循环）
 * 验证：主循环 → 出院判定 → onEnd → 手册建档 → 成就 → 病历归档
 */
const { chromium } = require('playwright-core');
const { pathToFileURL } = require('url');
const path = require('path');

(async () => {
  const b = await chromium.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: true,
  });
  const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERR: ' + e.message));
  await p.goto(pathToFileURL(path.resolve('prototype', 'ui-v4.html')).href);
  await p.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await p.reload();
  await p.waitForTimeout(1500);

  /* 切到固定病例：高钾血症（治疗路径最短、最确定） */
  await p.evaluate(()=>{document.getElementById('severePopup')?.remove();}); await p.click('#btnMenu'); await p.waitForTimeout(300);
  await p.evaluate(() => {
    const r = [...document.querySelectorAll('.drow')].find(x => x.textContent.includes('切换病例'));
    if (r) r.click();
  });
  await p.waitForTimeout(500);
  await p.evaluate(() => {
    const r = [...document.querySelectorAll('#sheetList .drow')].find(x => x.textContent.includes('高钾'));
    if (r) r.click();
  });
  await p.waitForTimeout(800);

  const name = await p.evaluate(() => window.__LIFE_GAME.S.cas.name);
  console.log('病例:', name);

  /* 标准治疗：钙 → 胰岛素+葡萄糖 → 透析 */
  await p.evaluate(() => {
    const E = window.__LIFE_GAME.E, S = window.__LIFE_GAME.S;
    E.give(S, 'calcium', 10);
    E.give(S, 'insulin', 10);
    E.give(S, 'dextrose50', 25);
  });
  await p.waitForTimeout(300);

  /* 直接在页面里推进引擎（等价于 16× 快进），最多 240 游戏分钟 */
  let state = await p.evaluate(() => {
    const E = window.__LIFE_GAME.E, S = window.__LIFE_GAME.S;
    for (let i = 0; i < 480; i++) {
      if (S.k > 5.5 && S.t > 300) { try { E.ACTIONS.dialysis.apply(S); } catch (e) {} }
      E.tick(S, 30);
      if (S.discharged || S.death) break;
    }
    return { t: S.t, discharged: !!S.discharged, dead: !!S.death, k: S.k };
  });

  /* 出院是手动按钮：打开"操作"，点"办理出院" */
  const chk = await p.evaluate(()=>{ const d=window.__LIFE_GAME.E.dischargeCheck(window.__LIFE_GAME.S); return {ok:d.ok, reasons:d.reasons}; });
  console.log('出院判定:', JSON.stringify(chk));
  await p.evaluate(()=>{document.getElementById('severePopup')?.remove();}); await p.click('#btnBody');
  await p.waitForTimeout(600);
  const clicked = await p.evaluate(() => {
    const r = [...document.querySelectorAll('#sheetList .drow')].find(x => x.textContent.includes('出院'));
    if (r) { r.click(); return true; }
    return false;
  });
  console.log('点击办理出院:', clicked);
  await p.waitForTimeout(2000);
  state = await p.evaluate(()=>({ t: window.__LIFE_GAME.S.t, discharged: !!window.__LIFE_GAME.S.discharged, dead: !!window.__LIFE_GAME.S.death }));
  const store = await p.evaluate(() => {
    const g = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
    const hb = g('life.handbook');
    const rec = g('life.records');
    const ach = g('life.ach');
    return {
      handbook: hb ? (hb.entries || []).map(e => `${e.name}(${e.cured || 0}愈/${e.died || 0}亡)`) : [],
      records: rec ? rec.length : 0,
      achievements: ach ? (Array.isArray(ach) ? ach.length : Object.keys(ach).length) : 0,
    };
  });

  console.log('结局:', state.discharged ? '出院' : (state.dead ? '死亡' : '未结束'), ' 游戏时间', Math.round(state.t / 60), 'min');
  console.log('手册:', JSON.stringify(store.handbook));
  console.log('病历:', store.records, '条　成就:', store.achievements);
  console.log(errs.length ? errs.join('\n') : '无脚本错误');

  const ok = state.discharged && store.handbook.length >= 1 && store.records >= 1;
  console.log(ok ? '结果: PASS' : '结果: FAIL');
  await b.close();
  process.exit(ok ? 0 : 1);
})();





