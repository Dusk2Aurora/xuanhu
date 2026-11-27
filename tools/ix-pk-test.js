/* 药物相互作用的 PK 时程回归测试 */
require('../prototype/substances.js');
require('../prototype/generator.js');
const E = require('../prototype/engine.js');
const SHARE = require('../prototype/share.js');

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
  // 直接取药物清除后的时间，避免未处置的高钾病例提前结束。
  S.t = (S.pk[0].dur * 1.8 + 1) * 60;
  E.give(S, 'spironolactone', 25);
  const n = S.log.filter(l => String(l[1]).includes('相互作用')).length;
  ok('前药已清除 → 不记相互作用日志', n === 0, `记录 ${n} 条`);
}

/* ⑤ 同时给药时日志有记录 */
{
  const S = E.create('hyperkalemia');
  E.give(S, 'captopril', 25);
  S.t = 10 * 60;
  E.give(S, 'spironolactone', 25);
  const n = S.log.filter(l => String(l[1]).includes('相互作用')).length;
  ok('同时给药 → 记一条相互作用', n === 1, `记录 ${n} 条`);
}

/* 固定总量的胰岛素泵入：开始、逐步给药、存档续接与结束 */
{
  const S = E.create('dka');
  const dose = E.give(S, 'insulin', undefined, '泵入');
  const order = S.given[0];
  ok('默认泵入使用所选途径的总量和时长', dose === 2 && order.d === 2 &&
    order.infusionMinutes === 60 && S.log[0][1] === '开始泵入 胰岛素（总量 2 U，输注 60 分钟）');
  ok('开泵时尚未送入胰岛素', E.insulinActivity(S) === 0);
  for (let i = 0; i < 5; i++) E.tick(S, 0.2);
  ok('小步长输入也会累积', E.insulinActivity(S) > 0 && E.insulinActivity(S) < 0.001);
  for (let i = 0; i < 30; i++) E.tick(S, 60);
  const mid = E.insulinActivity(S);
  ok('输注中生效且尚未完成', mid > 0.05 && mid < 0.1 &&
    !S.log.some(([, line]) => line.includes('泵入完成')));

  const restored = { ...JSON.parse(JSON.stringify(S)), cas: S.cas };
  ok('中途恢复存档时保持当前胰岛素效应', E.insulinActivity(restored) === mid);
  while (restored.running && restored.t + 60 < 3600) E.tick(restored, 60);
  E.tick(restored, 3600 - restored.t + 0.2);
  const atEnd = E.insulinActivity(restored);
  E.tick(restored, 60);
  const completions = restored.log.filter(([, line]) => line.includes('泵入完成'));
  ok('跨过终点时只记录一次完成与医嘱时长', completions.length === 1 &&
    completions[0][1] === '胰岛素 泵入完成（总量 2 U，输注 60 分钟）' && completions[0][3] === 3600);
  const expectedAtEnd = 0.2 * (90 / 60) * (1 - Math.exp(-60 / 90)) * Math.exp(-0.2 / 60 / 90);
  ok('累计输注满 2 U 后只余药效衰减', Math.abs(atEnd - expectedAtEnd) < 1e-9 &&
    Math.abs(E.insulinActivity(restored) - atEnd * Math.exp(-1 / 90)) < 1e-9);

  const shared = SHARE.parse(SHARE.make(restored));
  const [action] = shared.data?.a || [];
  ok('会诊码保留新泵入的总量和时长', shared.ok && action?.[3] === 2 &&
    action?.[4]?.minutes === 60 && action[4].unit === 'U');
}

/* 静推仍即时生效，旧泵入记录缺少时长时不会重新启动泵。 */
{
  const S = E.create('sepsis');
  E.give(S, 'insulin', 2, '静推');
  ok('静推的已给剂量与即时效应保持一致', E.insulinActivity(S) === 0.2 &&
    S.log[0][1] === '给予 胰岛素 2U（静推）');
  S.pk[0].route = S.given[0].route = '泵入';
  E.tick(S, 60);
  const shared = SHARE.parse(SHARE.make(S));
  ok('旧泵入记录保持原有药效且会诊编码兼容', E.insulinActivity(S) < 0.2 &&
    !S.log.some(([, line]) => line.includes('泵入完成')) && shared.data?.a[0].length === 4);
}

console.log(`相互作用与输注 PK 测试：${pass}/${pass+fail} 通过`);
process.exit(fail ? 1 : 0);
