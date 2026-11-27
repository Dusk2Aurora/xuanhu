const { chromium } = require('playwright-core');
const { pathToFileURL } = require('url');
const path = require('path');
(async()=>{
  const b = await chromium.launch({ executablePath:'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless:true });
  const ctx = await b.newContext({ viewport:{width:430,height:932}, hasTouch:true, isMobile:true });
  const p = await ctx.newPage();
  const errs=[]; p.on('pageerror', e=>errs.push(e.message));
  await p.goto(pathToFileURL(path.resolve('prototype','ui-v4.html')).href);
  await p.evaluate(()=>{try{localStorage.clear();}catch(e){}});
  await p.reload(); await p.waitForTimeout(1500);
  const before = await p.evaluate(()=>document.querySelector('#opan .title')?.textContent);
  // 在人体图上左滑
  const box = await p.evaluate(()=>{ const el=document.querySelector('.bodywrap')||document.getElementById('anat'); const r=el.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height}; });
  await p.touchscreen.tap(box.x, box.y).catch(()=>{});
  // 用 CDP 触发滑动更稳：直接派发 touch 事件
  await p.evaluate(({x,y})=>{
    const el = document.querySelector('.bodywrap') || document.getElementById('anat');
    const mk = (type, cx) => { const t = new Touch({identifier:1, target:el, clientX:cx, clientY:y});
      const ev = new TouchEvent(type, {touches:type==='touchend'?[]:[t], changedTouches:[t], bubbles:true, cancelable:true}); el.dispatchEvent(ev); };
    mk('touchstart', x+90); mk('touchmove', x+20); mk('touchend', x-20);
  }, box);
  await p.waitForTimeout(400);
  const after = await p.evaluate(()=>document.querySelector('#opan .title')?.textContent);
  // 心电图点击是否打开走势
  await p.evaluate(()=>{ const c=document.getElementById('miniEcg'); c && c.click(); });
  await p.waitForTimeout(400);
  const sheet = await p.evaluate(()=>document.querySelector('#sheetTitle')?.textContent||'(none)');
  console.log('滑动前器官:', before, '→ 滑动后:', after);
  console.log('点心电图打开:', sheet);
  console.log(errs.length?errs.join('\n'):'无脚本错误');
  await b.close();
})();
