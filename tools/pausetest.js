const { chromium } = require('playwright-core');
const { pathToFileURL } = require('url');
const path = require('path');
(async()=>{
  const b = await chromium.launch({ executablePath:'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless:true });
  const p = await b.newPage({ viewport:{width:1600,height:1000} });
  const errs=[]; p.on('pageerror', e=>errs.push(e.message));
  await p.goto(pathToFileURL(path.resolve('prototype','ui-v4.html')).href);
  await p.evaluate(()=>{ try{localStorage.clear();}catch(e){} });
  await p.reload(); await p.waitForTimeout(1400);
  // 暂停
  await p.click('#btnMenu'); await p.waitForTimeout(250);
  await p.evaluate(()=>{ const r=[...document.querySelectorAll('.drow')].find(x=>x.textContent.trim().startsWith('暂停')); r&&r.click(); });
  await p.waitForTimeout(300);
  const t1 = await p.evaluate(()=>window.__LIFE_GAME.S.t);
  await p.waitForTimeout(2000);
  const t2 = await p.evaluate(()=>window.__LIFE_GAME.S.t);
  console.log('暂停后 2 秒游戏时间变化:', (t2-t1).toFixed(2), 's（应为 0）');
  // 恢复
  await p.click('#btnMenu'); await p.waitForTimeout(250);
  await p.evaluate(()=>{ const r=[...document.querySelectorAll('.drow')].find(x=>x.textContent.includes('继续')); r&&r.click(); });
  await p.waitForTimeout(1500);
  const t3 = await p.evaluate(()=>window.__LIFE_GAME.S.t);
  console.log('恢复后 1.5 秒:', (t3-t2).toFixed(2), 's（应 > 0）');
  console.log(errs.length?errs.join('\n'):'无脚本错误');
  await b.close();
})();
