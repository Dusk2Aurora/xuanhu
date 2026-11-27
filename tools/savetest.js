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
  // 开第二张床
  await p.click('#btnMenu'); await p.waitForTimeout(250);
  await p.evaluate(()=>{ const r=[...document.querySelectorAll('.drow')].find(x=>x.textContent.includes('病房床位')); r&&r.click(); });
  await p.waitForTimeout(300);
  await p.evaluate(()=>{ const r=[...document.querySelectorAll('#sheetList .drow')].find(x=>x.textContent.includes('开一个新病例')); r&&r.click(); });
  await p.waitForTimeout(600);
  const before = await p.evaluate(()=>window.__LIFE_GAME.beds.map(b=>b.S.cas.name));
  // 触发保存
  await p.evaluate(()=>{ window.__LIFE_GAME.S && (window.__LIFE_GAME.save = true); });
  await p.waitForTimeout(9000);   // 等自动保存（每 8 秒）
  const saved = await p.evaluate(()=>{ const d=JSON.parse(localStorage.getItem('life.save')||'null'); return d?{v:d.v,n:d.beds.length,active:d.activeIdx}:null; });
  console.log('保存前床:', JSON.stringify(before), '存档:', JSON.stringify(saved));
  await p.reload(); await p.waitForTimeout(1500);
  const after = await p.evaluate(()=>window.__LIFE_GAME.beds.map(b=>b.S.cas.name));
  console.log('刷新后床:', JSON.stringify(after));
  console.log(errs.length?errs.join('\n'):'无脚本错误');
  await b.close();
})();
