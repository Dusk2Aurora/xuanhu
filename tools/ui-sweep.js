/* 全界面遍历：把所有可点的入口都点一遍，捕捉任何脚本错误
 * 用法：node tools/ui-sweep.js
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
  /* 重症弹窗会挡住点击：每次操作前先关掉 */
  const clearPopups = async () => { await p.evaluate(() => { document.getElementById('severePopup')?.remove(); }).catch(() => {}); };

  p.on('pageerror', e => errs.push('PAGEERR: ' + e.message));
  p.on('console', m => {
    if (m.type() !== 'error') return;
    const t = m.text();
    /* 更新检查会主动请求内网地址，离线环境下必然报 ERR_FAILED，不算脚本错误 */
    if (/ERR_FAILED|net::|Failed to load resource|CORS|Access-Control/i.test(t)) return;
    errs.push('CONSOLE: ' + t);
  });

  await p.goto(pathToFileURL(path.resolve('prototype', 'ui-v4.html')).href);
  await p.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await p.reload();
  await p.waitForTimeout(1500);

  const visited = [];
  async function closeAll() {
    await p.evaluate(() => {
      const m = document.querySelector('#mask');
      if (m) m.click();
      document.querySelector('#detail')?.classList.remove('on');
      /* 菜单里有返回大厅，遍历时会弹出来，这里再收掉，避免挡住后续点击 */
      if (window.__hideLobby) window.__hideLobby();
      const lb = document.getElementById('lobby');
      if (lb) { lb.style.display = 'none'; lb.classList.remove('on'); }
      /* 重症弹窗会挡住点击 */
      document.getElementById('severePopup')?.remove();
    });
    await p.waitForTimeout(150);
  }

  /* 1. 九个器官 */
  const organs = await p.evaluate(() => [...document.querySelectorAll('.org')].map(o => o.dataset.o));
  for (const o of organs) {
    await p.evaluate(id => { const el = document.querySelector('.org[data-o="' + id + '"]'); if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }, o);
    await p.waitForTimeout(120);
    visited.push('organ:' + o);
  }

  /* 2. 底部四个按钮 + 每个抽屉里的每一行 */
  for (const btn of ['btnDrug', 'btnOps', 'btnBody', 'btnBlood', 'btnMenu']) {
    await closeAll();
    await p.click('#' + btn);
    await p.waitForTimeout(350);
    const n = await p.evaluate(() => document.querySelectorAll('#sheetList .drow').length);
    visited.push(`${btn}(${n} 行)`);
    /* 只点"安全"的行：展开/查看类，不点会改变状态的（给药/操作） */
    if (btn === 'btnMenu') {
      for (let i = 0; i < n; i++) {
        await p.evaluate(idx => {
          const rows = [...document.querySelectorAll('#sheetList .drow')];
          if (rows[idx]) rows[idx].click();
        }, i);
        await p.waitForTimeout(250);
        visited.push(`menu#${i}`);
        await closeAll();
        await clearPopups(); await p.click('#btnMenu');
        await p.waitForTimeout(250);
      }
    }
  }
  await closeAll();

  /* 3. 教程 5 页 */
  await clearPopups(); await p.click('#btnMenu'); await p.waitForTimeout(250);
  await p.evaluate(() => { const r = [...document.querySelectorAll('.drow')].find(x => x.textContent.includes('教程')); r && r.click(); });
  await p.waitForTimeout(400);
  for (let i = 0; i < 6; i++) {
    await p.evaluate(() => { const r = [...document.querySelectorAll('[data-pg]')].find(x => x.textContent.includes('下一页')); if (r) r.click(); });
    await p.waitForTimeout(200);
  }
  visited.push('tutorial 5 页');
  await closeAll();

  /* 4. 病例切换（会触发未结建档） */
  await clearPopups(); await p.click('#btnMenu'); await p.waitForTimeout(250);
  await p.evaluate(() => { const r = [...document.querySelectorAll('.drow')].find(x => x.textContent.includes('切换病例')); r && r.click(); });
  await p.waitForTimeout(400);
  const cases = await p.evaluate(() => [...document.querySelectorAll('#sheetList .drow')].length);
  await p.evaluate(() => { const rows = [...document.querySelectorAll('#sheetList .drow')]; if (rows[1]) rows[1].click(); });
  await p.waitForTimeout(800);
  visited.push(`切换病例(${cases})`);
  await closeAll();

  /* 5. 跑一段游戏时间，看主循环是否报错 */
  await p.waitForTimeout(2500);

  /* 遍历过程中可能触发重开/刷新，这里兜底：没有句柄就重新加载一次 */
  let st = await p.evaluate(() => {
    const G = window.__LIFE_GAME;
    if (!G || !G.S) return null;
    const S = G.S;
    return { t: Math.round(S.t), name: S.cas.name, traits: (S.traits || []).length,
             tl: (S.tl || []).length, given: (S.given || []).length };
  });
  if (!st) {
    await p.reload();
    await p.waitForTimeout(1600);
    st = await p.evaluate(() => {
      const G = window.__LIFE_GAME;
      if (!G || !G.S) return { t: 0, name: '(无活动病例)', traits: 0, tl: 0, given: 0 };
      const S = G.S;
      return { t: Math.round(S.t), name: S.cas.name, traits: (S.traits || []).length,
               tl: (S.tl || []).length, given: (S.given || []).length };
    });
  }
  await p.waitForTimeout(300);

  console.log('遍历入口:', visited.length, '个');
  console.log(visited.join(' · '));
  console.log('当前病例:', st.name, `游戏时间 ${st.t}s`, `体质 ${st.traits}`);
  const uniq = [...new Set(errs)];
  console.log(uniq.length ? '⚠ 错误:\n' + uniq.slice(0, 10).join('\n') : '无脚本错误');
  await b.close();
  process.exit(uniq.length ? 1 : 0);
})();


