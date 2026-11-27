/* 药物相互作用的 PK 时程回归测试 */
require('../prototype/substances.js');
require('../prototype/generator.js');
const E = require('../prototype/engine.js');

/* 固定病人身份：对照与处置必须是同一个人，否则性别/年龄差异会污染结论 */
try { const _E = require('../prototype/engine.js'); _E.setIdentity && _E.setIdentity({ name:'测试患者', sex:'男', age:45, weight:70, height:172 }); } catch (e) {}
let pass = 0, fail = 0;
const ok = (name, cond, detail) => { if (cond) { pass++; } else { fail++; console.log('  ✗', name, detail || ''); } };

/* ① 同时给药 → 效应出现（K 上升） */
{
  const S = E.create('hyperkalemia');
  E.give(S, 'captopril', 25);
  E.give(S, 'spironolactone', 25);
  const k0 = S.k;
  for (let i = 0; i < 24; i++) E.tick(S, 60);
  ok('同时给药 → 高钾相互作用出现', S.k - k0 > 0.15, `ΔK=${(S.k-k0).toFixed(2)}`);
}

/* ② 第一种药清除后才给第二种 → 不应出现相互作用 */
{
  const S = E.create('hyperkalemia');
  E.give(S, 'captopril', 25);
  for (let i = 0; i < 420; i++) E.tick(S, 60);
  const k0 = S.k;
  E.give(S, 'spironolactone', 25);
  for (let i = 0; i < 30; i++) E.tick(S, 60);
  ok('前药已清除 → 无相互作用', Math.abs(S.k - k0) < 0.05, `ΔK=${(S.k-k0).toFixed(2)}`);
}

/* ③ 相互作用效应随药物清除而停止累积（不应无限增长） */
{
  const S = E.create('hyperkalemia');
  E.give(S, 'captopril', 25);
  E.give(S, 'spironolactone', 25);
  for (let i = 0; i < 30; i++) E.tick(S, 60);
  const kMid = S.k;
  for (let i = 0; i < 360; i++) E.tick(S, 60);   // 药物已过疗程
  const kEnd = S.k;
  ok('清除后不再继续累积', Math.abs(kEnd - kMid) < 0.60, `Δ=${(kEnd-kMid).toFixed(2)}`);
}

/* ④ 日志只在两药同时存在时记录 */
{
  const S = E.create('hyperkalemia');
  E.give(S, 'captopril', 25);
  for (let i = 0; i < 420; i++) E.tick(S, 60);
  E.give(S, 'spironolactone', 25);
  const n = S.log.filter(l => String(l[1]).includes('相互作用')).length;
  ok('前药已清除 → 不记相互作用日志', n === 0, `记录 ${n} 条`);
}

/* ⑤ 同时给药时日志有记录 */
{
  const S = E.create('hyperkalemia');
  E.give(S, 'captopril', 25);
  E.give(S, 'spironolactone', 25);
  const n = S.log.filter(l => String(l[1]).includes('相互作用')).length;
  ok('同时给药 → 记一条相互作用', n === 1, `记录 ${n} 条`);
}

console.log(`相互作用 PK 测试：${pass}/${pass+fail} 通过`);
process.exit(fail ? 1 : 0);
