const { launchBrowser, gameUrl, enterWard } = require('./browser');
(async()=>{
  const b = await launchBrowser();
  const p = await b.newPage({ viewport:{width:1600,height:1000} });
  const errs=[]; p.on('pageerror', e=>errs.push(e.message));
  await p.goto(gameUrl);
  await p.evaluate(()=>{ try{localStorage.clear();}catch(e){} });
  await p.reload(); await enterWard(p); await p.waitForTimeout(1400);
  const g = () => p.evaluate(()=>{
    const G = window.__LIFE_GAME;
    return { beds: G.beds ? G.beds.length : -1, active: G.S.cas.name, name: G.S.cas.name };
  });
  console.log('初始:', JSON.stringify(await g()));
  // 打开床位菜单
  await p.click('#btnMenu'); await p.waitForTimeout(300);
  const rows = await p.evaluate(()=>[...document.querySelectorAll('.drow')].map(x=>x.textContent.trim().split('\n')[0]));
  console.log('菜单含床位:', rows.some(r=>r.includes('病房床位')), '| 菜单:', JSON.stringify(rows.slice(0,4)));
  await p.evaluate(()=>{ const r=[...document.querySelectorAll('.drow')].find(x=>x.textContent.includes('病房床位')); r&&r.click(); });
  await p.waitForTimeout(400);
  const bedRows = await p.evaluate(()=>[...document.querySelectorAll('#sheetList .drow')].map(x=>x.textContent.trim().split('\n')[0]));
  console.log('床位抽屉:', JSON.stringify(bedRows));
  // 新开一个
  await p.evaluate(()=>{ const r=[...document.querySelectorAll('#sheetList .drow')].find(x=>x.textContent.includes('开一个新病例')); r&&r.click(); });
  await p.waitForTimeout(800);
  console.log('新开后:', JSON.stringify(await g()));
  // 时间推进：等 3 秒看两个床是否都在走
  await p.waitForTimeout(3000);
  const times = await p.evaluate(()=> window.__LIFE_GAME.beds.map(b=>Math.round(b.S.t)));
  console.log('各床时间:', JSON.stringify(times));
  console.log(errs.length?errs.join('\n'):'无脚本错误');
  await b.close();
})();
