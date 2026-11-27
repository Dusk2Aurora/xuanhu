const { launchBrowser, gameUrl, enterWard } = require('./browser');
(async()=>{
  const b = await launchBrowser();
  const p = await b.newPage({ viewport:{width:1600,height:1000} });
  const errs=[]; p.on('pageerror', e=>errs.push(e.message));
  await p.goto(gameUrl);
  await p.evaluate(()=>{try{localStorage.clear();}catch(e){}});
  await p.reload(); await enterWard(p); await p.waitForTimeout(1400);
  await p.click('#btnDrug'); await p.waitForTimeout(400);
  const tabs = await p.evaluate(()=>[...document.querySelectorAll('#drugTabs [data-tab]')].map(x=>x.textContent.trim()));
  const firstRows = await p.evaluate(()=>[...document.querySelectorAll('#drugList .drow')].slice(0,3).map(x=>x.textContent.replace(/\s+/g,' ').trim().slice(0,26)));
  // 切到食物
  await p.evaluate(()=>{ const el=[...document.querySelectorAll('#drugTabs [data-tab]')].find(x=>x.textContent.includes('食物')); el&&el.click(); });
  await p.waitForTimeout(300);
  const foodSecs = await p.evaluate(()=>[...document.querySelectorAll('#drugList .sec')].map(x=>x.textContent.trim()).slice(0,4));
  const foodRows = await p.evaluate(()=>[...document.querySelectorAll('#drugList .drow')].length);
  // 切到病毒
  await p.evaluate(()=>{ const el=[...document.querySelectorAll('#drugTabs [data-tab]')].find(x=>x.textContent.includes('病毒')); el&&el.click(); });
  await p.waitForTimeout(300);
  const germRows = await p.evaluate(()=>[...document.querySelectorAll('#drugList .drow')].length);
  // 搜索应跨标签
  await p.fill('#drugSearch','葡萄糖'); await p.waitForTimeout(300);
  const searchRows = await p.evaluate(()=>[...document.querySelectorAll('#drugList .drow')].length);
  console.log('标签:', JSON.stringify(tabs));
  console.log('首屏行数示例:', JSON.stringify(firstRows));
  console.log('食物分类:', JSON.stringify(foodSecs), '行数', foodRows);
  console.log('病毒·细菌行数:', germRows);
  console.log('搜索“葡萄糖”行数（应跨标签）:', searchRows);
  console.log(errs.length?errs.join('\n'):'无脚本错误');
  await b.close();
})();
