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
const SIGNS = require('../prototype/signs.js');

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

/* 9. 低钠纠正过度须继续留观 */
{
  const S = E.create(G.generate(1, 101, ['hyponatremia']));
  E.give(S, 'hypertonic_saline', 150);
  for (let i = 0; i < 40; i++) E.tick(S, 30);
  E.give(S, 'hypertonic_saline', 150);
  for (let i = 0; i < 40; i++) E.tick(S, 30);
  E.give(S, 'hypertonic_saline', 150);
  for (let i = 0; i < 40; i++) E.tick(S, 30);
  const rise = S.na - (S.na0 == null ? S.na : S.na0);
  const blocked = E.dischargeCheck(S).reasons.some(r => r.includes('血钠纠正过快'));
  check('纠正过度 → 留观', blocked && rise > 10, `升幅 ${rise.toFixed(1)}，拦截=${blocked}`);
}

/* 10. 去甲肾上腺素在感染性休克有效、在心衰可能反而降低 MAP */
{
  const se = E.create('sepsis');
  const m0 = E.bp(se).map;
  E.give(se, 'norepi', 8);
  for (let i = 0; i < 20; i++) E.tick(se, 30);
  check('去甲肾上腺素升压（脓毒症）', E.bp(se).map > m0 + 6, `${m0} → ${E.bp(se).map}`);
}

function advanceCase(S, minutes) {
  for (let i = 0; i < minutes * 6 && S.running; i++) {
    E.tick(S, 10);
    G.step(S, 10, E);
  }
}

/* 11. 甲减危象的低体温与血氧指标独立，甲状腺激素达到效应浓度后才改善病情。 */
{
  const C = G.generate(2, 101, ['myxedema']);
  const untreated = E.create(C), treated = E.create(C);
  E.ACTIONS.oxygen.apply(untreated);
  E.give(treated, 'hydrocortisone', 100);
  E.give(treated, 'levothyroxine', 200, '静推');
  advanceCase(untreated, 90);
  advanceCase(treated, 90);
  check('甲减低体温不虚增低氧损伤',
    !untreated.death && untreated.temp < 35 && untreated.spo2 > 98 && untreated.insult.hypox < 0.01,
    `体温=${untreated.temp.toFixed(2)}，SpO₂=${untreated.spo2.toFixed(2)}，低氧负荷=${untreated.insult.hypox.toFixed(3)}`);
  check('静脉替代治疗改善甲减危象',
    !treated.death && treated.myxedemaSeverity < 0.35 && treated.temp > 35.5
      && treated.paco2 < untreated.paco2 && treated.gcs > untreated.gcs,
    `病情负荷=${treated.myxedemaSeverity.toFixed(2)}，体温=${treated.temp.toFixed(2)}，GCS=${treated.gcs}`);
}

/* 12. 同一拍进入骤停，循环与自主呼吸归零，监护仪失去脉搏血氧信号。 */
{
  const S = E.create('hyperkalemia');
  S._vfRisk = 2;
  E.tick(S, 20);
  const s = E.snapshot(S);
  check('室颤即刻无自主循环和呼吸',
    s.rhythm === 'vf' && s.hr === 0 && s.co === 0 && s.map === 0 && s.do2 === 0 && s.rr === 0
      && s.gcs === 3 && s.spo2 === null && S.history.at(-1).spo2 === null
      && !SIGNS.detect(S).some(sign => sign.id === 'severe_hypoxemia'),
    `HR=${s.hr}，MAP=${s.map}，DO₂=${s.do2}，RR=${s.rr}，GCS=${s.gcs}，SpO₂=${s.spo2}`);
  E.ACTIONS.cpr.apply(S);
  E.tick(S, 10);
  check('按压提供部分循环但无自主脉搏',
    S.co > 0 && S.co < 3 && S.map > 0 && S.do2 > 0 && S.hr === 0 && S.gcs === 3,
    `CO=${S.co.toFixed(2)}，MAP=${S.map}，DO₂=${Math.round(S.do2)}`);
  const random = Math.random;
  try {
    Math.random = () => 0;
    E.ACTIONS.defib.apply(S);
  } finally {
    Math.random = random;
  }
  check('室颤除颤成功后恢复循环', S.rhythm === 'sinus' && S.co > 3 && E.snapshot(S).spo2 != null,
    `心律=${S.rhythm}，CO=${S.co.toFixed(2)}`);

  const A = E.create('hyperkalemia');
  A.rhythm = 'vf'; A._vfMin = 3.5;
  E.tick(A, 10);
  E.ACTIONS.intubate.apply(A);
  E.ACTIONS.defib.apply(A);
  check('心静止保留机械通气并维持无自主循环',
    A.rhythm === 'asystole' && A.rr === 14 && A.spontaneousRr === 0 && A.co === 0 && A.do2 === 0
      && E.snapshot(A).spo2 === null,
    `心律=${A.rhythm}，RR=${A.rr}，自主 RR=${A.spontaneousRr}，CO=${A.co}`);
}

/* 13. 张力性气胸减压可改善换气，引流可保持减压效果。 */
{
  const C = G.generate(2, 101, ['ptx']);
  const untreated = E.create(C), needle = E.create(C), drained = E.create(C);
  E.ACTIONS.needle.apply(needle);
  E.ACTIONS.needle.apply(drained);
  E.ACTIONS.chestTube.apply(drained);
  advanceCase(untreated, 6);
  advanceCase(needle, 6);
  advanceCase(drained, 6);
  check('张力性气胸未减压时氧合仍受损',
    untreated.tensionPTX > 0.8 && untreated.spo2 < 88 && untreated.rr > 28
      && needle.spo2 > untreated.spo2 + 8 && needle.do2 > untreated.do2,
    `未减压 SpO₂=${untreated.spo2.toFixed(1)}，RR=${untreated.rr.toFixed(1)}，针刺后 SpO₂=${needle.spo2.toFixed(1)}`);
  advanceCase(drained, 60);
  advanceCase(needle, 60);
  check('胸管维持减压与氧合',
    drained.tensionPTX === 0 && drained.spo2 > 94 && drained.rr < 22 && needle.tensionPTX > 0.2,
    `闭式引流压力=${drained.tensionPTX}，针刺后压力=${needle.tensionPTX.toFixed(2)}，SpO₂=${drained.spo2.toFixed(1)}`);
}

/* 14. 心静止可在按压、药物与可逆因素处理共同生效后恢复自主循环。 */
{
  function arrested() {
    const S = E.create('hyperkalemia');
    S.k = 7.9;
    S._vfRisk = 2;
    E.tick(S, 10);
    S._vfMin = 3.5;
    E.tick(S, 10);
    return S;
  }

  const untreated = arrested(), shockOnly = arrested();
  E.ACTIONS.defib.apply(shockOnly);
  advanceCase(untreated, 5);
  advanceCase(shockOnly, 5);
  check('心静止单独除颤无效',
    shockOnly.rhythm === 'asystole' && untreated.death?.reason === '心脏停搏，复苏失败'
      && shockOnly.death?.reason === untreated.death.reason && shockOnly.death.t === untreated.death.t,
    `单独除颤=${shockOnly.death?.reason}，无干预=${untreated.death?.reason}`);

  function resuscitate({ compressions = true, calcium = true, route = '静推' } = {}) {
    const S = arrested();
    E.ACTIONS.intubate.apply(S);
    if (compressions) E.ACTIONS.cpr.apply(S);
    E.give(S, 'epi', 1, route);
    if (calcium) E.give(S, 'calcium', 10);
    advanceCase(S, 0.5);
    const rhythmBeforeDrugEffect = S.rhythm;
    for (let i = 0; i < 27 && S.running && S.rhythm === 'asystole'; i++) {
      if (compressions && (S.t - S.asystoleAt) % 120 === 0) E.ACTIONS.cpr.apply(S);
      E.tick(S, 10);
    }
    return { S, rhythmBeforeDrugEffect };
  }

  const { S, rhythmBeforeDrugEffect } = resuscitate();
  check('有效复苏后恢复自主循环', rhythmBeforeDrugEffect === 'asystole' && S.rhythm === 'sinus'
      && S.co > 2 && S.hr > 0 && S.mapBoost === 0 && S.events.some(event => event.id === 'rosc'),
    `心律=${S.rhythm}，CO=${S.co.toFixed(2)}，有机械通气=${!!S.vent}`);
  const withoutCompressions = resuscitate({ compressions: false }).S;
  const wrongRoute = resuscitate({ route: '泵入' }).S;
  const unresolvedCause = resuscitate({ calcium: false }).S;
  check('复苏需按压、静推肾上腺素与可逆因素处理',
    [withoutCompressions, wrongRoute, unresolvedCause].every(state => state.rhythm === 'asystole')
      && withoutCompressions.death?.reason === '心脏停搏，复苏失败',
    `未按压=${withoutCompressions.rhythm}，给药途径不符=${wrongRoute.rhythm}，可逆因素未缓解=${unresolvedCause.rhythm}`);
}

const fails = out.filter(x => !x.ok);
const pad = s => s + ' '.repeat(Math.max(0, 26 - s.length));
console.log(pad('断言') + '结果   实测');
console.log('-'.repeat(70));
for (const r of out) console.log(pad(r.name) + (r.ok ? 'PASS  ' : 'FAIL  ') + r.detail);
console.log('-'.repeat(70));
console.log(`${out.length - fails.length}/${out.length} 通过` + (fails.length ? '　⚠ 有修复被改回' : '　✓ 全部保持'));
process.exit(fails.length ? 1 : 0);

