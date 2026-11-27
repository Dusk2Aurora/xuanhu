/* 科学性审计：扫全部病例 × 全部药物，检查数值是否越出人体可能的范围
   目的不是"证明对"，而是把"不可能发生的数值"挑出来人工复核。 */
const path = require('path');
process.chdir(path.resolve(__dirname, '..'));
require('../prototype/substances.js');
require('../prototype/generator.js');
const E = require('../prototype/engine.js');
const G = globalThis.CASEGEN, SUB = globalThis.SUBSTANCES;

const LIMITS = {
  temp: [30, 43.5], hr: [20, 220], rr: [2, 70], spo2: [30, 100],
  k: [1.8, 9.5], na: [105, 185], cl: [70, 140], glu: [0.6, 60],
  hb: [30, 220], ph: [6.6, 7.8], paco2: [12, 120], pao2: [25, 500],
  lac: [0.2, 25], cr: [20, 900], plt: [5, 600], wbc: [0.2, 60],
  vol: [2.0, 8.0], svr: [6, 45], gcs: [3, 15], uo: [0, 8],
  map: [25, 220], sys: [40, 260],
};
const issues = [];
function check(tag, key, v) {
  const lim = LIMITS[key];
  if (lim == null || v == null || !isFinite(v)) return;
  if (v < lim[0] || v > lim[1]) issues.push(`${tag} ${key}=${(+v).toFixed(2)} 超出 [${lim[0]}, ${lim[1]}]`);
}

/* ① 每个模块：开局 + 前 8 小时（不处理/标准处理）全程抽检 */
let cases = 0, samples = 0;
for (const m of G.MODULES) {
  for (const seed of [11, 42, 99]) {
    const S = E.create(G.generate(2, seed, [m.id]));
    cases++;
    const snap = () => {
      const b = E.bp(S);
      /* 濒死/已死的读数不算"不可能"，跳过 */
      if (!S.running || S.death || S.hr < 20 || b.map < 25) return;
      samples++;
      for (const k of Object.keys(LIMITS)) {
        if (k === 'map') check(`${m.id}/${seed}`, 'map', b.map);
        else if (k === 'sys') check(`${m.id}/${seed}`, 'sys', b.sys);
        else check(`${m.id}/${seed}`, k, S[k]);
      }
    };
    snap();
    for (let i = 0; i < 120 && S.running && !S.death; i++) {
      for (let j = 0; j < 4; j++) { E.tick(S, 60); G.step(S, 60, E); }
      if (i % 6 === 0 && S.running && !S.death) snap();
    }
  }
}

/* ② 药物剂量合理性：单次剂量不得超过常见上限的 5 倍 */
const DOSE_MAX = { unit: 'mg', max: 2000 }, DOSE_MAX_U = { unit: 'U', max: 400 };
for (const d of SUB.DRUGS) {
  const r = (d.routes && d.routes[0]) || {};
  const dose = r.d;
  if (dose == null) continue;
  const u = r.u || d.unit || '';
  if (u === 'mg' && dose > 2000) issues.push(`药物 ${d.n} 单次 ${dose} mg 偏大`);
  if (u === 'U' && dose > 10000) issues.push(`药物 ${d.n} 单次 ${dose} U 偏大`);   /* 肝素 5000 U 冲击属常规 */
  if (u === 'mL' && dose > 2000) issues.push(`药物 ${d.n} 单次 ${dose} mL 偏大`);
  if (dose <= 0) issues.push(`药物 ${d.n} 剂量非正数`);
}

/* ③ 每个药物必须有单位与给药途径 */
for (const d of SUB.DRUGS) {
  if (!d.unit) issues.push(`药物 ${d.n} 缺单位`);
  if (!d.routes || !d.routes.length) issues.push(`药物 ${d.n} 缺给药途径`);
}

/* ④ 每个模块必须有主诉、目标、判据、提示 */
for (const m of G.MODULES) {
  if (!m.complaint) issues.push(`病例 ${m.id} 缺主诉`);
  if (!m.goal || !m.goal.length) issues.push(`病例 ${m.id} 缺目标`);
  if (typeof m.check !== 'function') issues.push(`病例 ${m.id} 缺出院判据`);
  if (!m.hint) issues.push(`病例 ${m.id} 缺提示`);
}

console.log(`科学性审计：${G.MODULES.length} 个病例 × 3 seed，采样 ${samples} 次，涉及 ${cases} 例`);
if (!issues.length) {
  console.log('✓ 未发现超出人体可能范围的数值');
} else {
  const uniq = [...new Set(issues)];
  console.log(`发现 ${uniq.length} 条待复核：`);
  uniq.slice(0, 40).forEach(x => console.log('  ·', x));
  if (uniq.length > 40) console.log(`  … 其余 ${uniq.length - 40} 条`);
}
process.exit(0);
