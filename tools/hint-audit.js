/* 提示可达性审计：上级医师的每条建议必须指向游戏里真实存在的操作/药物 */
require('../prototype/substances.js');
require('../prototype/generator.js');
require('../prototype/mentor.js');
const E = require('../prototype/engine.js');
const G = globalThis.CASEGEN, M = globalThis.MENTOR, SUB = globalThis.SUBSTANCES;

/* 未实现的医疗概念（若出现在提示里，说明玩家照做会找不到入口） */
const MISSING = ['高压氧', '交叉配血', '血库', '呼吸机参数', '体外循环', 'ECMO', 'CRRT', '血浆置换', '动脉穿刺', '中心静脉置管', '肺动脉导管', '胃管', '导尿管冲洗', '亚低温'];
/* 存在的操作名（用于正向核对） */
const ACT_NAMES = Object.values(E.ACTIONS).map(a => a.name);
const DRUG_NAMES = SUB.DRUGS.map(d => d.n);

let hits = [], checked = 0;
for (const m of G.MODULES) {
  const texts = [];
  if (m.hint) texts.push(['case-hint', m.hint]);
  const rules = M.RULES[m.tag] || [];
  for (const r of rules) texts.push(['mentor:' + r.id, [r.c, r.d, r.s].filter(Boolean).join(' ')]);
  for (const [tag, t] of texts) {
    checked++;
    for (const w of MISSING) if (t.includes(w)) hits.push(`${m.id}/${tag} → 提到未实现的「${w}」`);
  }
}
/* 提示里若写\"操作 → X\"，X 必须是真实操作名或药物名（给个大致校验） */
for (const m of G.MODULES) {
  const all = [m.hint || ''].concat((M.RULES[m.tag] || []).map(r => r.s || '')).join(' ');
  const mm = all.match(/操作\s*→\s*([^\s，。；、）)]+)/g) || [];
  for (const s of mm) {
    const name = s.replace(/操作\s*→\s*/, '').trim();
    const ok = ACT_NAMES.some(a => a.includes(name) || name.includes(a));
    if (!ok) hits.push(`${m.id} → 「操作 → ${name}」没有对应操作`);
  }
  const md = all.match(/给药\s*→\s*([^\s，。；、）)]+)/g) || [];
  for (const s of md) {
    const name = s.replace(/给药\s*→\s*/, '').trim();
    const ok = DRUG_NAMES.some(d => d.includes(name) || name.includes(d));
    if (!ok) hits.push(`${m.id} → 「给药 → ${name}」没有对应药物`);
  }
}
console.log(`提示审计：检查 ${checked} 条提示/规则`);
if (hits.length) { hits.forEach(h => console.log('  ✗', h)); process.exit(1); }
console.log('✓ 所有提示都指向可执行的操作或药物');
