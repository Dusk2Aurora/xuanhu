/* 生理回归测试：把两轮科学审查发现的每个具体缺陷固化成断言。
 * 任何一条失败，说明那次修复被改回去了。
 * 用法：node tools/regression-physio.js
 */
require('../prototype/substances.js');
require('../prototype/traits.js');
require('../prototype/generator.js');
const E = require('../prototype/engine.js');

/* 固定病人身份：对照与处置必须是同一个人，否则性别/年龄差异会污染结论 */
try { const _E = require('../prototype/engine.js'); _E.setIdentity && _E.setIdentity({ name:'测试患者', sex:'男', age:45, weight:70, height:172 }); } catch (e) {}
const G = globalThis.CASEGEN;

const out = [];
function check(name, ok, detail) { out.push({ name, ok, detail }); }

/* 1. 首帧自洽：create 后与第一个 tick 的血压差 < 3 mmHg */
for (const id of ['hyperkalemia', 'dka', 'bleed', 'sepsis', 'opioid']) {
  const S = E.create(id);
  const a = E.bp(S).sys;
  E.tick(S, 1);
  const b = E.bp(S).sys;
  check(`首帧跳变 ${id}`, Math.abs(b - a) < 3, `${a} → ${b}`);
}

/* 2. 高钾 → 心动过缓（不是心动过速） */
{
  const hr = {};
  for (const k of [4.5, 7.5]) {
    const S = E.create('hyperkalemia');
    S.k = k; S.hr = 80;
    for (let i = 0; i < 8; i++) E.tick(S, 30);
    hr[k] = S.hr;
  }
  check('高钾致心动过缓', hr[7.5] < hr[4.5], `K4.5→${Math.round(hr[4.5])}, K7.5→${Math.round(hr[7.5])}`);
}

/* 3. 常规剂量吗啡不应致死 */
{
  const S = E.create('sepsis');
  E.give(S, 'morphine', 10);
  let died = false;
  for (let i = 0; i < 90 && S.running; i++) { E.tick(S, 30); if (S.death) died = true; }
  check('10 mg 吗啡不致死', !died || !String(S.death.reason).includes('昏迷'), S.death ? S.death.reason : '存活');
}

/* 4. 苯二氮卓会代谢（3 h 后药物负担显著下降） */
{
  const S = E.create('hyperkalemia');   /* 会自然死亡的病例会让 tick 停摆 */
  E.give(S, 'diazepam', 5);
  for (let i = 0; i < 30; i++) E.tick(S, 30);
  const mid = S.tox.benzo;
  for (let i = 0; i < 30; i++) E.tick(S, 60);   /* 30 min = 半个半衰期 */
  check('苯二氮卓代谢', S.tox.benzo < mid * 0.8, `${mid.toFixed(1)} → ${S.tox.benzo.toFixed(1)}`);
}

/* 5. 等渗盐水不显著改变血钠 */
{
  const S = E.create('sepsis');
  const na0 = S.na;
  E.give(S, 'nacl', 2000);
  for (let i = 0; i < 150; i++) E.tick(S, 30);
  check('等渗盐水不改变血钠', Math.abs(S.na - na0) < 4, `${na0.toFixed(1)} → ${S.na.toFixed(1)}`);
}

/* 6. 健康人 6 h 血糖不漂移 */
{
  const S = E.create('sepsis');
  const g0 = S.glu;
  for (let i = 0; i < 360; i++) E.tick(S, 60);
  check('血糖不漂移', Math.abs(S.glu - g0) < 2.5, `${g0.toFixed(1)} → ${S.glu.toFixed(1)}`);
}

/* 7. 血钾 6 h 不因无摄入而流失 */
{
  const S = E.create('sepsis');
  const k0 = S.k;
  for (let i = 0; i < 360; i++) E.tick(S, 60);
  check('血钾不流失', Math.abs(S.k - k0) < 0.6, `${k0.toFixed(1)} → ${S.k.toFixed(1)}`);
}

/* 8. CPR 的血压支持会消退 */
{
  const S = E.create('sepsis');
  S.mapBoost = 25;
  E.tick(S, 60);
  check('CPR 支持消退', S.mapBoost < 24, `25 → ${S.mapBoost.toFixed(1)}`);
}

/* 9. 低钠纠正过度会被判脱髓鞘（不可出院） */
{
  const S = E.create(G.generate(1, 101, ['hyponatremia']));
  E.give(S, 'hypertonic_saline', 150);
  for (let i = 0; i < 40; i++) E.tick(S, 30);
  E.give(S, 'hypertonic_saline', 150);
  for (let i = 0; i < 40; i++) E.tick(S, 30);
  E.give(S, 'hypertonic_saline', 150);
  for (let i = 0; i < 40; i++) E.tick(S, 30);
  const rise = S.na - (S.na0 == null ? S.na : S.na0);
  const blocked = E.dischargeCheck(S).reasons.some(r => r.includes('脱髓鞘'));
  check('纠正过度 → 脱髓鞘且不能出院', !blocked || rise > 16, `升幅 ${rise.toFixed(1)}，拦截=${blocked}`);
}

/* 10. 去甲肾上腺素在感染性休克有效、在心衰可能反而降低 MAP */
{
  const se = E.create('sepsis');
  const m0 = E.bp(se).map;
  E.give(se, 'norepi', 8);
  for (let i = 0; i < 20; i++) E.tick(se, 30);
  check('去甲肾上腺素升压（脓毒症）', E.bp(se).map > m0 + 6, `${m0} → ${E.bp(se).map}`);
}

{
  const dx = require('../prototype/diagnosis');
  const S = E.create('hyperkalemia');
  const hasPoisoning = () => dx.classifyAll(S).some(d => d.primaryId === 'apapOD');
  const dose = E.give(S, 'acetaminophen');
  check('常规对乙酰氨基酚不触发中毒', dose === 500 && !E.acetaminophenExposure(S).aboveLimit && !hasPoisoning(), dose + ' mg');
  S.hepatotox = 0.85;
  check('常规剂量与非特异性肝损分开', !hasPoisoning(), '其他病因的肝损');
  S.hepatotox = 0;
  for (let i = 1; i < 8; i++) E.give(S, 'paracetamol', 500, '栓剂');
  check('不同途径合并用量', E.acetaminophenExposure(S).mg24h === 4000 && !E.acetaminophenExposure(S).aboveLimit, '4000 mg');
  E.give(S, 'acetaminophen', 500);
  check('超出累计上限仅提示用量', E.acetaminophenExposure(S).aboveLimit && !hasPoisoning(), '4500 mg');
  E.give(S, 'acetaminophen', 5500);
  check('高风险暴露提示', E.acetaminophenExposure(S).highRisk, '高风险');
  S.t += 86400;
  check('旧剂量不计入当天', E.acetaminophenExposure(S).mg24h === 0 && !hasPoisoning(), '已过 24 小时');
  S.tags = ['apap'];
  check('入院过量病例仍识别', E.acetaminophenExposure(S).known && hasPoisoning(), '有入院病史');
}
const fails = out.filter(x => !x.ok);
const pad = s => s + ' '.repeat(Math.max(0, 26 - s.length));
console.log(pad('断言') + '结果   实测');
console.log('-'.repeat(70));
for (const r of out) console.log(pad(r.name) + (r.ok ? 'PASS  ' : 'FAIL  ') + r.detail);
console.log('-'.repeat(70));
console.log(`${out.length - fails.length}/${out.length} 通过` + (fails.length ? '　⚠ 有修复被改回' : '　✓ 全部保持'));
process.exit(fails.length ? 1 : 0);

