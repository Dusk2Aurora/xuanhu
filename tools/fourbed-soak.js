const { launchBrowser, gameUrl, enterWard } = require('./browser');
(async()=>{
  const b = await launchBrowser();
  const p = await b.newPage({ viewport:{width:1600,height:1000} });
  const errs=[]; p.on('pageerror', e=>errs.push(e.message));
  await p.goto(gameUrl);
  await p.evaluate(()=>{try{localStorage.clear();}catch(e){}});
  await p.reload(); await enterWard(p); await p.waitForTimeout(1400);
  // 开满 4 张床
  for (let i=0;i<3;i++){
    await p.click('#btnMenu'); await p.waitForTimeout(200);
    await p.evaluate(()=>{ const r=[...document.querySelectorAll('.drow')].find(x=>x.textContent.includes('病房床位')); r&&r.click(); });
    await p.waitForTimeout(200);
    await p.evaluate(()=>{ const r=[...document.querySelectorAll('#sheetList .drow')].find(x=>x.textContent.includes('开一个新病例')); r&&r.click(); });
    await p.waitForTimeout(500);
  }
  const n = await p.evaluate(()=>window.__LIFE_GAME.beds.length);
  // 4 床同时推进 2 小时游戏时间
  const res = await p.evaluate(()=>{
    const G = window.__LIFE_GAME;
    for (let i=0;i<120;i++){
      for (const bd of G.beds){ if(!bd.S.running) continue; G.E.tick(bd.S,60); if(window.CASEGEN) CASEGEN.step(bd.S,60,G.E); }
    }
    return G.beds.map(bd=>({n:bd.S.cas.name, t:Math.round(bd.S.t), run:bd.S.running, k:+bd.S.k.toFixed(1), na:+bd.S.na.toFixed(0)}));
  });
  const bad = res.some(r=>!isFinite(r.k)||!isFinite(r.na));
  console.log('床位数:', n);
  console.log('各床:', JSON.stringify(res));
  console.log('数值异常:', bad ? '有 ✗' : '无 ✓');
  console.log('页面错误:', errs.length?errs.join('\n'):'无');
  await b.close();
})();
