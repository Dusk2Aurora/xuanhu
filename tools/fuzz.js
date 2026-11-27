/* 随机操作压力测试：模拟玩家乱点，检查崩溃 / NaN / 状态不一致
 * 用法：node tools/fuzz.js [轮数]
 */
require('../prototype/substances.js');
require('../prototype/traits.js');
require('../prototype/generator.js');
require('../prototype/mentor.js');
const E = require('../prototype/engine.js');

/* 固定病人身份：对照与处置必须是同一个人，否则性别/年龄差异会污染结论 */
try { const _E = require('../prototype/engine.js'); _E.setIdentity && _E.setIdentity({ name:'测试患者', sex:'男', age:45, weight:70, height:172 }); } catch (e) {}
const SUB = globalThis.SUBSTANCES;
const G = globalThis.CASEGEN;

const ROUNDS = +(process.argv[2] || 120);
let rngState = 12345;
function rnd() { rngState = (rngState * 1103515245 + 12345) & 0x7fffffff; return rngState / 0x7fffffff; }
function pick(a) { return a[Math.floor(rnd() * a.length)]; }

const NAMES = ['vol','k','na','cl','ca','hco3','lac','glu','hb','hr','sv','svr','rr','spo2','temp','gcs','cr','uo','ph','map','co','do2','sao2','svo2','pcwp','lungWater','interstitium','pco2a'];
const ACTIONS = ['defib', 'cpr', 'oxygen', 'oxygen_off', 'dialysis', 'endoscopy'];
const ENVS = ['heat', 'cold', 'exercise', 'sleep'];

const problems = [];
let ops = 0, cases = 0;

for (let r = 0; r < ROUNDS; r++) {
  let spec;
  try { spec = G.generate(1 + (r % 5), 70000 + r); } catch (e) { problems.push(`生成失败 r=${r}: ${e.message}`); continue; }
  let S;
  try { S = E.create(spec); } catch (e) { problems.push(`create 失败 r=${r}: ${e.message}`); continue; }
  cases++;

  for (let step = 0; step < 120 && S.running && !S.death; step++) {
    try {
      const roll = rnd();
      if (roll < 0.55) {
        const s = pick(SUB.ALL);
        const mult = pick([0.2, 0.5, 1, 2, 5, 10]);
        E.give(S, s.id, Math.max(0.01, +(s.dose * mult).toFixed(2)), s.route);
      } else if (roll < 0.70) {
        const a = E.ACTIONS[pick(ACTIONS)];
        if (a && a.apply) a.apply(S);
      } else if (roll < 0.85) {
        E.setEnv(S, pick(ENVS), rnd() < 0.5);
      } else if (roll < 0.95) {
        try { globalThis.MENTOR.hints(S); } catch (e) { problems.push(`导师异常: ${e.message}`); }
      }
      ops++;
      E.tick(S, 30);
    } catch (e) {
      problems.push(`step 失败 r=${r} step=${step}: ${e.message}`);
      break;
    }

    /* NaN / 越界检查 */
    for (const k of NAMES) {
      const v = S[k];
      if (typeof v === 'number' && (!isFinite(v) || Number.isNaN(v))) {
        problems.push(`NaN/Inf: ${k}=${v} r=${r} step=${step} case=${spec.name}`);
        S[k] = 0;
      }
    }
    const b = E.bp(S);
    if (!isFinite(b.sys) || !isFinite(b.dia) || !isFinite(b.map)) {
      problems.push(`血压 NaN r=${r} step=${step}`);
      break;
    }
    if (S.k < 0 || S.k > 15 || S.vol < 0 || S.vol > 12 || S.hb < 0 || S.hb > 300) {
      problems.push(`数值越界: k=${S.k?.toFixed(2)} vol=${S.vol?.toFixed(2)} hb=${S.hb?.toFixed(1)} r=${r}`);
    }
  }
}

console.log(`轮数 ${ROUNDS} · 病例 ${cases} · 操作 ${ops}`);
if (!problems.length) { console.log('✓ 无崩溃 / 无 NaN / 无越界'); process.exit(0); }
const uniq = [...new Set(problems)];
console.log(`⚠ 问题 ${problems.length} 条（去重 ${uniq.length}）：`);
uniq.slice(0, 20).forEach(p => console.log('  ' + p));
process.exit(1);
