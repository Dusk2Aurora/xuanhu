const { launchBrowser, gameUrl, enterWard } = require('./browser');
(async()=>{
  const b = await launchBrowser();
  const p = await b.newPage({ viewport:{width:1600,height:1000} });
  const errs=[]; p.on('pageerror', e=>errs.push(e.message));
  await p.goto(gameUrl);
  await p.evaluate(()=>{ try{localStorage.clear();}catch(e){}
    localStorage.setItem('life.records', JSON.stringify([
      {病例名:'高钾血症', 结局:'出院', 耗时:30, 费用:520, 评分:95},
      {病例名:'感染性休克', 结局:'死亡', 耗时:60, 费用:800, 评分:40},
      {病例名:'上消化道大出血', 结局:'出院', 耗时:25, 费用:1200, 评分:88}
    ]));
  });
  await p.reload(); await enterWard(p); await p.waitForTimeout(1400);
  await p.click('#btnMenu'); await p.waitForTimeout(300);
  const hasStats = await p.evaluate(()=>[...document.querySelectorAll('.drow')].some(x=>x.textContent.includes('统计')));
  await p.evaluate(()=>{ const r=[...document.querySelectorAll('.drow')].find(x=>x.textContent.includes('统计')); r&&r.click(); });
  await p.waitForTimeout(500);
  const txt = await p.evaluate(()=>document.querySelector('#sheetList')?.textContent.replace(/\s+/g,' ').slice(0,220));
  console.log('有统计入口:', hasStats);
  console.log('内容:', txt);
  console.log(errs.length?errs.join('\n'):'无脚本错误');
  await b.close();
})();
