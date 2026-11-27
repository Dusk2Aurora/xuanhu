/* 药物齐全性核查：把提示、病例、教程里提到的药名，逐一对照药库
   只要提示里让用的药在"给药"里搜不到，就是硬伤。 */
const path = require('path');
process.chdir(path.resolve(__dirname, '..'));
require('../prototype/substances.js');
require('../prototype/generator.js');
require('../prototype/mentor.js');
require('../prototype/glossary.js');

const SUB = globalThis.SUBSTANCES;
const G = globalThis.CASEGEN;
const M = globalThis.MENTOR;

const names = new Set(SUB.DRUGS.map(d => d.n));
const ALIAS = SUB.ALIASES || {};
/* 常见药物后缀，用来从中文句子里抠出药名 */
const SUFFIX = ['松', '龙', '醇', '霉素', '西林', '沙星', '头孢', '培南', '环素',
  '地平', '洛尔', '普利', '沙坦', '唑', '胺', '苷', '糖', '液', '酸', '碱',
  '定', '酮', '肽', '酶', '蛋白', '球蛋白', '血浆', '红细胞', '血小板', '胰岛素',
  '肝素', '华法林', '阿司匹林', '氯吡格雷', '硝酸甘油', '呋塞米', '甘露醇',
  '纳洛酮', '氟马西尼', '亚甲蓝', '乙酰半胱氨酸', '碳酸氢钠', '硫酸镁'];


/* 这些是短语不是药名，排除 */
const STOP = ['先补液','先推高浓度葡萄糖','高渗状态先补液','穿刺抽液','抗血小板','补液','吸氧','插管','透析','手术','留观','复温','降温','促排','导泻','洗胃','灌流','输血','抗凝','扩容','升压','利尿','镇静','镇痛','抗感染','抗休克','抗过敏','拮抗','解毒','支持','监护','观察'];

function extract(text) {
  if (!text) return [];
  const found = [];
  /* 按标点和空格切 */
  const parts = String(text).split(/[\s，。；、：（）()\[\]·,.;:+\/→]+/);
  for (const p of parts) {
    /* 去掉前面的剂量描述，保留中文药名 */
    const m = p.match(/[\u4e00-\u9fa5A-Za-z0-9]{2,14}/g);
    if (!m) continue;
    for (const w of m) {
      if (w.length < 2) continue;
      if (STOP.includes(w)) continue;
      if (SUFFIX.some(s => w.endsWith(s))) found.push(w);
    }
  }
  return found;
}

const sources = [];
for (const mod of G.MODULES) {
  sources.push([`病例:${mod.id}`, mod.hint || '']);
  for (const r of (M.RULES && M.RULES[mod.tag]) || []) {
    sources.push([`导师:${mod.id}/${r.id}`, [r.c, r.d, r.s].join(' ')]);
  }
}

const missing = new Map();
for (const [src, text] of sources) {
  for (const w of extract(text)) {
    /* 已在药库 → 跳过；模糊匹配（药名包含关系）也算存在 */
    if ([...names].some(n => n === w || n.includes(w) || w.includes(n))) continue;
    if (ALIAS[w] && names.has(ALIAS[w])) continue;   /* 别名能搜到也算齐全 */
    if (!missing.has(w)) missing.set(w, new Set());
    missing.get(w).add(src);
  }
}

console.log(`药库共 ${names.size} 种；扫描 ${sources.length} 条提示/说明`);
if (!missing.size) {
  console.log('✓ 提示里提到的药，药库都有');
} else {
  console.log(`发现 ${missing.size} 个"提示里有、药库没有"的药名：`);
  for (const [w, srcs] of missing) {
    console.log(`  · ${w}   ← ${[...srcs].slice(0, 3).join(' / ')}`);
  }
}
console.log('\n--- 药库现有名称（供比对）---');
console.log([...names].sort().join('、'));
