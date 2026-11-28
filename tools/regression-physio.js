/* 生理回归测试：把两轮科学审查发现的每个具体缺陷固化成断言。
 * 任何一条失败，说明那次修复被改回去了。
 * 用法：node tools/regression-physio.js [--lactate]
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

{
  const makeBed = () => E.create({ id: 'oxygen-flow-test', init: { ...G.BASE } });
  const low = makeBed(), high = makeBed(), rapid = makeBed();
  rapid.rr = 35;
  const lowLogCount = low.log.length;
  const changed = E.setOxygenFlow(low, 5);
  const unchanged = !E.setOxygenFlow(low, 5) && !E.setOxygenFlow(low, NaN);
  E.setOxygenFlow(rapid, 5);
  E.ACTIONS.oxygen.apply(high);
  for (const bed of [low, high, rapid]) E.tick(bed, 10);
  const lowSettings = E.oxygenSettings(low);
  check('自主呼吸时供氧流量与吸气需求影响 FiO₂', changed && unchanged && lowSettings.flow === 5 &&
    low.log.length === lowLogCount + 1 && low.log.at(-1)[1].includes('5 L/min') &&
    high.oxygenFlow === lowSettings.maxFlow && high.fio2 === 1 && high.pao2 > low.pao2 &&
    lowSettings.fio2 > rapid.fio2 && rapid.fio2 > 0.21,
    `供氧 5 L/min，通常呼吸 ${Math.round(low.fio2 * 100)}%，快呼吸 ${Math.round(rapid.fio2 * 100)}%`);

  const legacy = { o2: 1, fio2: 0.60 };
  const restored = Object.assign(makeBed(), legacy);
  E.restoreCardiorespiratory(restored, legacy);
  const savedFlow = { oxygenFlow: 7, o2: 1, fio2: 0.60 };
  const restoredFlow = Object.assign(makeBed(), savedFlow);
  E.restoreCardiorespiratory(restoredFlow, savedFlow);
  check('恢复氧疗时兼容旧档并保留已存流量', restored.oxygenFlow > 0 && Math.abs(restored.fio2 - legacy.fio2) < 0.003 &&
    restoredFlow.oxygenFlow === 7 && restoredFlow.fio2 !== savedFlow.fio2,
    `旧 FiO₂ 60% → ${restored.oxygenFlow} L/min，当前档保持 7 L/min`);

  const ventilated = makeBed();
  E.setOxygenFlow(ventilated, 5);
  ventilated.gcs = 8;
  E.ACTIONS.intubate.apply(ventilated);
  E.setVentilatorFlow(ventilated, 35);
  const ventLogCount = ventilated.log.length;
  const rejected = !E.setOxygenFlow(ventilated, 10) && ventilated.log.length === ventLogCount;
  const fio2BeforeExtubation = ventilated.fio2;
  const suspended = ventilated.oxygenFlow === 0;
  Object.assign(ventilated, { gcs: 15, t: 10, respiratoryAssessmentAt: 10, spontaneousRr: 16, spontaneousCO2: 40 });
  E.ACTIONS.extubate.apply(ventilated);
  check('撤机按机控氧浓度衔接持续给氧', rejected && suspended && !ventilated.vent && ventilated.oxygenFlow > 5 &&
    ventilated.ventFlow === 35 && Math.abs(ventilated.fio2 - fio2BeforeExtubation) < 0.003 &&
    E.dischargeCheck(ventilated).reasons.some(reason => reason.includes('仍在吸氧')),
    `FiO₂ ${Math.round(fio2BeforeExtubation * 100)}% → ${ventilated.oxygenFlow} L/min`);

  const stopped = E.setOxygenFlow(low, 0);
  E.tick(low, 1);
  const stableAt = low.roomAirStableSince;
  const observationRemaining = () => E.dischargeCheck(low).reasons.some(reason => reason.includes('室内空气血氧需稳定'));
  const beganObservation = observationRemaining();
  for (let i = 0; i < 1499; i++) E.tick(low, 0.2);
  const stillObserving = observationRemaining();
  E.tick(low, 0.2);
  check('0 L/min 撤氧后需连续观察室内空气血氧五分钟', stopped && low.oxygenFlow === 0 &&
    !low.o2 && low.fio2 === 0.21 && stableAt != null && stableAt === low.roomAirStableSince &&
    beganObservation && stillObserving && !observationRemaining() && E.dischargeCheck(low).observationEndsAt === null,
    `室内空气稳定起点 ${stableAt} 秒，满 300 秒后结束留观`);

  const legacyRoomAir = { t: 240, log: [['操作', '停止吸氧，改室内空气（0 L/min）', 'info']] };
  const legacyBed = Object.assign(makeBed(), legacyRoomAir);
  E.restoreDischargeObservation(legacyBed, legacyRoomAir);
  const legacyDeadline = E.dischargeCheck(legacyBed).observationEndsAt;
  const currentRoomAir = { ...legacyRoomAir, t: 300, hadOxygenSupport: true, roomAirStableSince: 240 };
  const currentBed = Object.assign(makeBed(), currentRoomAir);
  E.restoreDischargeObservation(currentBed, currentRoomAir);
  const lowSaturation = { ...currentRoomAir, spo2: 93 };
  const lowSaturationBed = Object.assign(makeBed(), lowSaturation);
  E.restoreDischargeObservation(lowSaturationBed, lowSaturation);
  check('撤氧留观读档沿用已验证的进度，旧档从当前复评', legacyDeadline === 540 &&
    E.dischargeCheck(currentBed).observationEndsAt === legacyDeadline && lowSaturationBed.roomAirStableSince == null &&
    E.dischargeCheck(lowSaturationBed).observationEndsAt === null,
    '稳定旧档立即可等待五分钟；现行存档继续计时；仍低氧者待恢复再开始');
}

{
  const apap = E.create(G.generate(1, 123, ['apap']));
  const waiting = E.dischargeCheck(apap);
  apap.t = 2 * 3600;
  check('对乙酰氨基酚中毒的留观时限', waiting.observationEndsAt === apap.t &&
    waiting.reasons.some(reason => reason.includes('肝损窗口')) && E.dischargeCheck(apap).observationEndsAt === null,
    '提前等待，到满两小时结束');

  const stemi = E.create(G.generate(1, 123, ['stemi']));
  const beforePci = E.dischargeCheck(stemi).observationEndsAt;
  stemi.reperfused = true;
  stemi.reperfusionAt = stemi.t = 120;
  const afterPci = E.dischargeCheck(stemi).observationEndsAt;
  stemi.t = 1020;
  check('PCI 后的留观时限', beforePci === null && afterPci === 1020 && E.dischargeCheck(stemi).observationEndsAt === null,
    '从再通时起计十五分钟');
}

{
  const s = { arrests: 1, t: 3600, cost: 920, death: {}, penalties: 2, penaltyReasons: [{ label: '重复处置', count: 1 }] };
  const report = E.scoreBreakdown(s);
  check('结算分数可由明细逐项还原', report.score === 20 && E.finalScore(s) === 20 &&
    report.base + report.items.reduce((n, item) => n + item.delta, 0) === 20 &&
    report.items.some(item => item.label.includes('重复处置') && item.delta === -6),
    '骤停、死亡、费用、带教及旧记录');

  const patient = E.create('hyperkalemia');
  patient.t = E.orderTest(patient, 'cthead');
  E.pollTests(patient);
  E.ACTIONS.defib.apply(patient);
  E.ACTIONS.craniotomy.apply(patient);
  const { cas, ...state } = patient;
  const saved = JSON.parse(JSON.stringify(state));
  const restored = Object.assign(E.create(cas), saved);
  E.restorePatient(restored, saved);
  const actionScore = E.scoreBreakdown(restored);
  check('无指征的除颤和开颅各计一次处置扣分', actionScore.score === 92 &&
    actionScore.items.length === 2 && actionScore.items.every(item => item.label.includes('处置扣分')) &&
    restored.log.slice(-2).map(entry => entry[6]).join() === '3,5',
    '已取得无血肿的头颅 CT；结算与处置日志同为 -3 及 -5');

  const legacyED = { ...s, score: 77, intake: { difficulty: 6 } };
  check('旧急诊床位结算仅保留公开的结局和费用项', E.finalScore(legacyED) === 32 &&
    !E.scoreBreakdown(legacyED).items.some(item => item.label.includes('带教扣分')),
    '旧普通床位的已记带教扣分照常结算');
}

{
  require('../prototype/mentor.js');
  const M = globalThis.MENTOR;
  const bph = E.create(G.generate(1, 123, ['bph']));
  bph.k = 8.6;
  const nonRenal = E.create(G.generate(1, 123, ['dka']));
  nonRenal.k = 7;
  const supported = [bph, nonRenal].every(patient => M.evaluate(patient, 'action', 'dialysis').ok &&
    M.hints(patient).some(hint => hint.id === 'dialysis'));
  E.ACTIONS.dialysis.apply(bph);
  const stable = E.create({ id: 'dialysis-stable-test', init: { ...G.BASE } });
  check('透析点评按当前血钾及肾功能评估', supported && !M.hints(bph).some(hint => hint.id === 'dialysis') &&
    M.evaluate(stable, 'action', 'dialysis').ok === false,
    '前列腺增生及其他病因的重度高钾均支持评估，正在透析时不再重复提示');

  stable.vol = 5.6;
  check('常用晶体液按实际下单剂量评估补液风险', ['nacl', 'ringer'].every(id =>
    M.evaluate(stable, 'drug', id, { dose: 500 }).ok === false &&
    M.evaluate(stable, 'drug', id, { dose: 50 }).ok === null),
    '容量已足时区分成袋补液和小量给液；药物库的实际医嘱 ID 接入带教');
}

{
  const makeBed = () => E.create({ id: 'signed-discharge-test', init: { ...G.BASE } });
  const standard = makeBed();
  E.endCase(standard, 'discharge', '达到出院标准');
  const normal = makeBed();
  const normalOutcome = E.signDischarge(normal);
  const normalScore = E.scoreBreakdown(normal);
  check('达标签字沿用普通出院和计分', normalOutcome.status === 'normal' && normalOutcome.reasons.length === 0 &&
    normal.discharged && !normal.running && !normal.death && E.signDischarge(standard) === null &&
    normalScore.score === 100 && normalScore.score === E.finalScore(standard) &&
    normalScore.items.some(item => item.label === '出院用时奖励' && item.delta === 25), '符合全部原有条件');

  const observation = makeBed();
  Object.assign(observation, { t: 60, hadOxygenSupport: true, roomAirStableSince: 0 });
  const assessment = E.dischargeCheck(observation);
  const early = E.signDischarge(observation);
  const earlyScore = E.scoreBreakdown(observation);
  check('留观未满签字后扣分出院', !assessment.ok && early.status === 'penalized' &&
    early.reasons.join() === assessment.reasons.join() && early.majorReasons.length === 0 &&
    observation.discharged && !observation.running && !observation.death && earlyScore.score === 70 &&
    earlyScore.items.length === 1 && earlyScore.items[0].label === '出院条件未达标' && earlyScore.items[0].delta === -30,
    '撤氧后室内空气观察未满五分钟，无速度奖励');

  const critical = makeBed();
  Object.assign(critical, { k: 7.2, temp: 38.1, t: 120, realismBonusRules: ['insurance', 'signedDischarge', 'noPause'] });
  const before = critical.log.length;
  const failure = E.signDischarge(critical);
  E.tick(critical, 60);
  E.endCase(critical, 'death', '死亡结局不得覆盖已签字的失败结局');
  const criticalScore = E.scoreBreakdown(critical);
  check('重大问题签字后独立失败，重复签字仅结算一次', failure.status === 'failed' && failure.t === 120 &&
    failure.majorReasons.length === 1 && failure.majorReasons[0].startsWith('血钾') && failure.reasons.length === 2 &&
    E.signDischarge(critical) === failure && critical.log.length === before + 1 && critical.t === 120 &&
    !critical.discharged && !critical.running && !critical.death && criticalScore.score === 0 &&
    criticalScore.items.length === 1 && criticalScore.items[0].label === '出院存在重大问题', '严重高钾合并轻度发热');

  const support = makeBed();
  E.give(support, 'norepi', 8, '泵入');
  const ongoing = E.signDischarge(support);
  const stemi = makeBed();
  stemi.cas = G.generate(1, 123, ['stemi']);
  stemi.stemi = 0.4;
  const untreated = E.signDischarge(stemi);
  check('主动循环支持与未完成关键急症处置均为重大问题', ongoing.status === 'failed' &&
    ongoing.majorReasons.some(reason => reason.includes('仍在持续静脉泵入')) && untreated.status === 'failed' &&
    untreated.majorReasons.includes('冠脉未再通（ST 仍抬高）'), '使用同一套出院评估理由');

  const sufficientOxygen = makeBed(), dependentOxygen = makeBed();
  for (const bed of [sufficientOxygen, dependentOxygen]) E.ACTIONS.oxygen.apply(bed);
  dependentOxygen.shunt = 0.3;
  const dependent = E.signDischarge(dependentOxygen);
  check('给氧时读数正常仍识别室内空气低氧', dependentOxygen.spo2 >= 94 && E.roomAirSaturation(dependentOxygen) < 90 &&
    dependent.status === 'failed' && dependent.majorReasons.some(reason => reason.includes('仍在吸氧')) &&
    E.signDischarge(sufficientOxygen).status === 'penalized', '两床均在给氧，只有一床模拟撤氧后仍缺氧');

  const specialty = (id, patch) => Object.assign(makeBed(), { cas: G.generate(1, 123, [id]) }, patch);
  const co = specialty('co', { coHb: 0.55 });
  const ptx = E.signDischarge(specialty('ptx', { tensionPTX: 0.60 }));
  const tamponade = E.signDischarge(specialty('tamponade', { tamponade: 0.50 }));
  const coOutcome = E.signDischarge(co);
  check('专属病例的重大问题可独立触发失败', co.spo2 >= 94 && coOutcome.status === 'failed' &&
    coOutcome.majorReasons.includes('碳氧血红蛋白 55%') && ptx.status === 'failed' &&
    ptx.majorReasons.some(reason => reason.includes('胸腔内压')) && tamponade.status === 'failed' &&
    tamponade.majorReasons.some(reason => reason.includes('心包内压')) &&
    E.signDischarge(specialty('co', { coHb: 0.13 })).status === 'penalized' &&
    E.signDischarge(specialty('tamponade', { tamponade: 0.20 })).status === 'penalized', '同一病例也能区分较轻的残余异常');

  const deceased = makeBed();
  E.endCase(deceased, 'death', '测试死亡');
  check('已死亡病例保留原结局', E.signDischarge(deceased) === null && deceased.dischargeOutcome === null &&
    deceased.death.reason === '测试死亡' && E.finalScore(deceased) === 55, '签字与死亡结局独立');
}

{
  const makeBed = () => E.create({ id: 'coagulation-recovery', init: { ...G.BASE } });
  const advance = (bed, seconds) => {
    while (seconds > 0) {
      const step = Math.min(10, seconds);
      E.tick(bed, step);
      seconds -= step;
    }
  };
  const aspirin = makeBed(), treated = makeBed(), subcutaneous = makeBed(), lysis = makeBed();
  for (const bed of [aspirin, treated]) E.give(bed, 'aspirin');
  E.give(treated, 'heparin');
  E.give(subcutaneous, 'heparin', null, '皮下');
  E.give(lysis, 'alteplase');
  const afterSubcutaneousDose = E.heparinActivity(subcutaneous);
  for (const bed of [aspirin, treated, subcutaneous, lysis]) advance(bed, 40 * 60);
  const active = E.coagulation(treated) < E.coagulation(aspirin) - 0.20 &&
    afterSubcutaneousDose === 0 && E.heparinActivity(subcutaneous) > 0.1 && E.coagulation(subcutaneous) < 0.95 &&
    E.coagulation(lysis) < 0.6;
  for (const bed of [aspirin, treated, subcutaneous, lysis]) advance(bed, 11 * 3600);
  check('普通肝素和溶栓药作用消退后恢复凝血', active && E.heparinActivity(treated) === 0 &&
    E.coagulation(treated) === E.coagulation(aspirin) && E.coagulation(subcutaneous) === 1 && E.coagulation(lysis) === 1,
    '静推、皮下、溶栓和阿司匹林合用均在当前药效内改变凝血');

  const treatedPe = E.create(G.generate(2, 123, ['pe']));
  const reversedPe = E.create(G.generate(2, 123, ['pe']));
  for (const bed of [treatedPe, reversedPe]) E.give(bed, 'heparin');
  E.give(reversedPe, 'protamine');
  G.step(treatedPe, 30, E);
  G.step(reversedPe, 30, E);
  const reversedAtDose = E.heparinActivity(reversedPe) === 0 && reversedPe.clot > treatedPe.clot;
  E.give(reversedPe, 'heparin');
  const pumped = makeBed();
  E.give(pumped, 'heparin', 1200, '持续静脉泵入');
  advance(pumped, 60 * 60);
  E.give(pumped, 'protamine');
  const reversedPump = E.heparinActivity(pumped) === 0 && E.coagulation(pumped) === 1;
  advance(pumped, 60 * 60);
  check('鱼精蛋白只中和当前肝素，后续静推和泵入可继续起效', reversedAtDose && E.heparinActivity(reversedPe) === 1 &&
    reversedPump && E.pumpRate(pumped, 'heparin') === 1200 && E.heparinActivity(pumped) > 0.1 && pumped.coag === 1,
    '肺栓塞病程与化验读取同一肝素活性，既有药效中和后不会继续抵消后来给药');

  const legacy = { t: 6 * 3600, coag: 0.44, hepatotox: 0.10,
    given: [{ id: 'heparin', d: 5000, t: 0, route: '静推' }], _ixAcc: { '阿司匹林|肝素': 1 } };
  const restore = saved => {
    const restored = Object.assign(makeBed(), saved);
    E.restorePatient(restored, saved);
    return restored;
  };
  const migrated = restore(legacy);
  const migratedLysis = restore({ t: legacy.t, coag: 0.40, given: [{ id: 'alteplase', d: 100, t: 0, route: '静滴' }] });
  const oldBleed = restore({ ...legacy, bleedRate: 0.02 });
  const oldLiverDamage = restore({ ...legacy, hepatotox: 0.65 });
  const oldReversed = restore({ ...legacy, given: [...legacy.given, { id: 'protamine', d: 50, t: 100 }] });
  check('旧档只恢复可归因于临时用药的凝血基线', migrated.coag > 0.88 && migrated.coag < 0.90 &&
    restore(migrated).coag === migrated.coag && migratedLysis.coag > 0.99 &&
    oldBleed.coag === legacy.coag && oldReversed.coag === legacy.coag &&
    Math.abs(oldLiverDamage.coag - (1 - 0.78 * 0.65)) < 1e-7,
    '迁移只执行一次；保留正在出血、已逆转用药和肝损限制');
}

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
  const mid = E.benzodiazepineExposure(S).load;
  for (let i = 0; i < 30; i++) E.tick(S, 60);   /* 30 min = 半个半衰期 */
  const late = E.benzodiazepineExposure(S).load;
  check('苯二氮卓代谢', mid > 0 && late < mid * 0.8, `${mid.toFixed(1)} → ${late.toFixed(1)}`);
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

/* 9. 血钠纠正超限后的游戏内留观时限 */
{
  const makeBed = () => E.create({ id: 'sodium-observation-test', tags: ['hypona'], init: { ...G.BASE, na: 120 } });
  const deadline = S => E.dischargeCheck(S).observationEndsAt;
  const alerts = S => S.log.filter(([, message]) => message.startsWith('血钠 24 h 内升幅过大')).length;
  const setSodium = (S, sodium, seconds = 1) => {
    S.naMass = sodium * (S.ecfVd + S.freeWater);
    S._naPrev = sodium;
    E.tick(S, seconds);
  };
  const restore = S => {
    const { cas, ...saved } = S;
    const serialized = JSON.parse(JSON.stringify(saved));
    const restored = { ...E.create(cas), ...serialized };
    E.restoreDischargeObservation(restored, serialized);
    return restored;
  };
  const bed = makeBed();
  setSodium(bed, 130, 60);
  const atLimit = deadline(bed);
  setSodium(bed, 131, 60);
  const initial = E.dischargeCheck(bed);
  setSodium(bed, 131.2, 30);
  const plateau = E.dischargeCheck(bed);
  const restored = restore(bed);
  bed.t = 7319.6;
  setSodium(bed, 131, 0.2);
  const beforeDeadline = E.dischargeCheck(bed);
  setSodium(bed, 131, 0.2);
  const afterDeadline = E.dischargeCheck(bed);
  check('血钠稳定后按首次超限时间结束留观', atLimit === null && initial.observationEndsAt === 7320 &&
    initial.reasons.some(reason => reason.includes('纠正过快') && reason.includes('120 分钟')) &&
    plateau.observationEndsAt === 7320 && deadline(restored) === 7320 && beforeDeadline.observationEndsAt === 7320 &&
    afterDeadline.ok && bed.odsRisk > 1 && alerts(bed) === 1 && E.signDischarge(bed).status === 'normal',
    '120→131 mmol/L 后留观 2 个模拟小时，稳定平台和读档保持原截止时间');

  const supplemented = makeBed();
  E.give(supplemented, 'hypertonic_saline');
  supplemented.t = 120;
  E.give(supplemented, 'hypertonic_saline');
  supplemented.t = 1800;
  const recentDose = E.dischargeCheck(supplemented);
  const effectEnded = E.dischargeCheck({ ...supplemented, t: 1920 - 1e-9 });
  check('补钠后的复评时间从最近一次补钠起算', recentDose.observationEndsAt === 1920 &&
    recentDose.reasons.some(reason => reason.includes('补钠仍在起效')) && effectEnded.observationEndsAt === null &&
    !effectEnded.reasons.some(reason => reason.includes('补钠仍在起效')),
    '第一笔补钠已满 30 分钟，第二笔满 30 分钟时解除该项留观');

  const ongoing = makeBed();
  setSodium(ongoing, 131);
  setSodium(ongoing, 131.99);
  const smallRise = deadline(ongoing);
  setSodium(ongoing, 132);
  const newRise = deadline(ongoing);
  setSodium(ongoing, 119);
  setSodium(ongoing, 131);
  check('血钠继续明显上升或再次快速纠正会重新留观', smallRise === 7201 && newRise === 7203 &&
    deadline(ongoing) === 7205 && alerts(ongoing) === 3,
    '较上次警报多升 1 mmol/L 会重新起算；二次跌至 119 后升回 131 也会重开留观');

  const day = 24 * 60 * 60;
  const later = makeBed();
  later.t = day - 60;
  setSodium(later, 121);
  setSodium(later, 129, 59);
  const firstDay = deadline(later);
  setSodium(later, 129, 2);
  const nextDayAtLimit = deadline(later);
  setSodium(later, 130);
  const nextDayAboveLimit = deadline(later);
  later.t += day;
  setSodium(later, 130);
  check('血钠纠正沿用滚动 24 小时的 10/8 mmol/L 警戒', firstDay === null && nextDayAtLimit === null &&
    nextDayAboveLimit === day + 3 + 7200 && later.odsRisk === 0 && deadline(later) === null,
    '首日 10、后续 8，超过 24 小时的低点移出窗口');

  const oldTracker = { ...restored, naOvercorrectedAt: 150, naCorrection: { ...restored.naCorrection } };
  delete oldTracker.naCorrection.alertPeak;
  const migratedTracker = restore(oldTracker);
  setSodium(migratedTracker, 131.2, 60);
  const oldTrend = { ...restored, t: 3600, na: 131, history: [{ t: 120, na: 131 }, { t: 3600, na: 131 }] };
  delete oldTrend.naCorrection;
  delete oldTrend.naOvercorrectedAt;
  const migratedTrend = restore(oldTrend);
  const borderlineTrend = restore({ ...oldTrend, na: 130, history: [{ t: 120, na: 130 }] });
  check('旧血钠存档留观有界并可反复读取', deadline(migratedTracker) === 7350 &&
    deadline(restore(migratedTracker)) === 7350 && deadline(migratedTrend) === 7320 &&
    deadline(restore(migratedTrend)) === 7320 && deadline(borderlineTrend) === null,
    '沿用旧追踪时间或有证据的首次历史升幅，整数历史边界不额外触发');

  const neurologic = E.dischargeCheck({ ...restored, t: 7320, odsDamage: 1, gcs: 8, seizure: 0.4 });
  check('血钠留观到期仍核查神经症状', neurologic.observationEndsAt === null &&
    ['渗透性脱髓鞘', '意识 GCS', '仍有抽搐'].every(prefix => neurologic.majorReasons.some(reason => reason.startsWith(prefix))),
    '既往渗透性脱髓鞘、GCS 8 和抽搐均继续拦截正常出院');
}

/* 10. 去甲肾上腺素在感染性休克中的升压及撤除支持后的循环观察 */
{
  const se = E.create('sepsis');
  const m0 = E.bp(se).map;
  E.give(se, 'norepi', 8);
  for (let i = 0; i < 20; i++) E.tick(se, 30);
  check('去甲肾上腺素升压（脓毒症）', E.bp(se).map > m0 + 6, `${m0} → ${E.bp(se).map}`);
}

{
  const makeBed = () => E.create({ id: 'circulation-test', init: { ...G.BASE } });
  const observe = S => E.dischargeCheck(S).circulationObservation;
  const setPressure = (S, map) => {
    S.hr = 100;
    S.sv = 32;
    S.svr = (map - S.cvp) / (S.hr * S.sv / 1000);
  };
  const advance = (S, seconds) => {
    const until = S.t + seconds;
    while (S.running && S.t < until) E.tick(S, Math.min(10, until - S.t));
  };
  const bed = makeBed();
  const untreated = makeBed();
  check('未用过循环支持的病例沿用原出院条件', E.dischargeCheck(untreated).ok && !observe(untreated),
    '入院即稳定，无循环支持医嘱');

  bed.t = 158;
  setPressure(bed, 73);
  const firstPressure = E.bp(bed);
  E.give(bed, 'norepi', 8, '泵入');
  bed.t = 165;
  setPressure(bed, 70);
  const secondPressure = E.bp(bed);
  E.give(bed, 'dobutamine');
  bed.t = 170;
  setPressure(bed, 81);
  const thirdPressure = E.bp(bed);
  bed.t = 173;
  const supported = observe(bed);
  E.stopPump(bed, 'norepi');
  const onePump = observe(bed);
  E.stopPump(bed, 'dobutamine');
  const off = observe(bed);
  check('02:53 循环支持下血压回升仍需留观', firstPressure.sys === 83 && firstPressure.dia === 68 &&
    secondPressure.sys === 80 && secondPressure.dia === 65 && thirdPressure.sys === 91 && thirdPressure.dia === 76 &&
    supported?.phase === 'active' && supported.reason.includes('去甲肾上腺素、多巴酚丁胺') &&
    onePump?.phase === 'active' && onePump.reason.includes('多巴酚丁胺') &&
    off?.phase === 'observing' && off.remainingSeconds === 900 && !E.dischargeCheck(bed).ok,
    '83/68 → 80/65 → 91/76，两台泵全停才开始计时');

  advance(bed, 120);
  bed.running = false;
  E.tick(bed, 900);
  const paused = observe(bed);
  bed.running = true;
  E.give(bed, 'norepi', 8);
  E.give(bed, 'norepi', 12);
  const adjusted = E.pumpRate(bed, 'norepi') === 12 && bed.given.at(-1).pumpAction === 'adjust';
  advance(bed, 120);
  E.stopPump(bed, 'norepi');
  const restarted = observe(bed);
  check('循环观察按模拟时间推进，重新给药清空已观察时间', paused?.remainingSeconds === 780 && adjusted &&
    restarted?.remainingSeconds === 900 && E.pumpEffect(bed, 'norepi') > 0.02,
    '暂停后仍剩 13 分钟，新一轮停泵时即使有残效也从 15 分钟起计');

  advance(bed, 180);
  const relapseAt = bed.t;
  setPressure(bed, 70);
  const hypotensive = observe(bed);
  advance(bed, 20);
  for (let i = 0; i < 120 && observe(bed)?.phase === 'unstable'; i++) advance(bed, 1);
  const stableSince = bed.circulationStableSince;
  const checkpoint = observe(bed);
  advance(bed, 120);
  const { cas, ...snapshot } = bed;
  const saved = JSON.parse(JSON.stringify(snapshot));
  const restored = Object.assign(makeBed(), saved);
  E.restoreDischargeObservation(restored, saved);
  const restoredRemaining = observe(restored)?.remainingSeconds;
  advance(restored, stableSince + 899 - restored.t);
  const stillWaiting = !E.dischargeCheck(restored).ok && observe(restored)?.reason.includes('还需 1 秒');
  advance(restored, 1);
  check('低血压后重计，观察进度可存档并在满十五分钟时放行', hypotensive?.phase === 'unstable' &&
    stableSince > relapseAt && checkpoint?.remainingSeconds >= 880 && restored.circulationStableSince === stableSince &&
    restoredRemaining === checkpoint.remainingSeconds - 120 && stillWaiting && E.dischargeCheck(restored).ok &&
    observe(restored)?.phase === 'complete', '恢复血压后重计，重载继续观察，边界前一秒仍未达标');

  const oldOrder = { id: 'norepi', n: '去甲肾上腺素', route: '泵入', t: 0, onset: 1, dur: 8,
                     scale: 1, eff: { svr: 6, hr: 2 } };
  const oldSave = { t: 240, pk: [oldOrder] };
  const legacy = Object.assign(makeBed(), oldSave);
  E.restoreDischargeObservation(legacy, oldSave);
  const legacyDeadline = E.dischargeCheck(legacy).observationEndsAt;
  const legacyOn = observe(legacy);
  advance(legacy, 540);
  const effectPreserved = legacy.pk[0] === oldOrder && legacy.mod.svr > 0;
  advance(legacy, 100);
  check('旧去甲肾上腺素医嘱保留原药效并自动进入停药观察', legacyOn?.phase === 'legacy' &&
    legacyOn.remainingSeconds === 624 && legacyDeadline === 864 && !E.pumpRate(legacy, 'norepi') && effectPreserved &&
    legacy.pk.length === 0 && observe(legacy)?.phase === 'observing', '旧有限医嘱按原药代消退，无需为旧医嘱手动停泵');

  const phaseAfter = (drug, route) => {
    const patient = makeBed();
    E.give(patient, drug, undefined, route);
    return observe(patient)?.phase;
  };
  check('有限时程的升压强心药触发观察，常用降压和调心率药沿用原条件',
    phaseAfter('epi', '静推') === 'legacy' && phaseAfter('milrinone') === 'legacy' &&
    !phaseAfter('nitroprusside') && !phaseAfter('atropine'), '肾上腺素静推、米力农、硝普钠、阿托品');
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
{
  const dx = require('../prototype/diagnosis');
  const cas = E.CASES.hyperkalemia;
  const create = () => E.create({ ...cas, init: { ...cas.init, k: 4, gcs: 15, rr: 16 } });
  const minutes = (s, n) => { for (let i = 0; i < n * 6; i++) E.tick(s, 10); };
  const diagnosed = s => dx.classifyAll(s).some(d => d.primaryId === 'benzoOD');
  for (const [id, dose, route] of [
    ['diazepam', 5], ['midazolam', 5], ['clonazepam', 1],
    ['lorazepam', 0.5, '口服'], ['lorazepam', 2, '静推'],
  ]) {
    const s = create();
    E.give(s, id, dose, route);
    const initially = diagnosed(s);
    minutes(s, route === '口服' ? 35 : 5);
    const exposure = E.benzodiazepineExposure(s);
    check('常规镇静 ' + id + (route || ''), !initially && !diagnosed(s) && exposure.load > 0 &&
      !exposure.high && s.gcs < 15, dose + ' mg');
  }
  const seizure = create(); seizure.seizure = 0.9; seizure.gcs = 7;
  E.give(seizure, 'diazepam', 10); E.give(seizure, 'diazepam', 10);
  minutes(seizure, 5);
  check('游戏内两次止惊处置', !E.benzodiazepineExposure(seizure).high && !diagnosed(seizure), '保留止惊疗程');

  const excessive = create();
  for (let i = 0; i < 6; i++) E.give(excessive, 'midazolam', 5);
  minutes(excessive, 3);
  check('重复暴露伴意识抑制', E.benzodiazepineExposure(excessive).overdose && diagnosed(excessive), '风险标签与诊断一致');
  E.give(excessive, 'flumazenil', 0.2);
  minutes(excessive, 7);
  check('拮抗后效应减退', !diagnosed(excessive) && excessive.gcs > 8, '有效负荷减退');
  minutes(excessive, 180);
  check('既往镇静史不持续触发诊断', !E.benzodiazepineExposure(excessive).sedated && !diagnosed(excessive), '作用已消退');

  const barbiturate = create();
  E.give(barbiturate, 'phenobarbital', 100);
  barbiturate.tox.benzo = 100; // Old v3 recorded the barbiturate mg a second time.
  E.restoreBenzodiazepines(barbiturate, {});
  const matched = JSON.parse(JSON.stringify(barbiturate));
  E.give(barbiturate, 'flumazenil', 0.2);
  minutes(barbiturate, 7); minutes(matched, 7);
  check('旧存档的苯巴比妥独立起效', barbiturate.tox.benzo === 0 && !diagnosed(barbiturate) &&
    barbiturate.gcs < 15 && barbiturate.gcs === matched.gcs, '拮抗剂不清除苯巴比妥作用');
}
{
  const patient = (init = {}) => E.create({ id: 'thermal', init: { ...G.BASE, ...init } });
  function advance(s, minutes) {
    for (let i = 0; i < minutes * 6 && s.running; i++) {
      E.tick(s, 10);
      G.step(s, 10, E);
    }
  }

  const cold = patient({ temp: 34.2 });
  const matched = patient({ temp: 34.2 });
  E.give(cold, 'acetaminophen', 500);
  check('低体温监护与出院判定', E.temperatureStatus(cold.temp) === 'crit' &&
    E.dischargeCheck(cold).reasons.some(s => s.includes('体温')), '34.2℃ 需复温观察');
  advance(cold, 45); advance(matched, 45);
  check('退热药不加重低体温', Math.abs(cold.temp - matched.temp) < 0.01, '单次常规剂量，与对照比较');
  const fever = patient({ temp: 39, infection: 0.8 });
  const untreated = patient({ temp: 39, infection: 0.8 });
  E.give(fever, 'acetaminophen', 500);
  advance(fever, 45); advance(untreated, 45);
  check('感染发热对退热药有反应', fever.temp < untreated.temp - 0.1, '病因相同的配对病例');

  const hot = E.create(G.generate(1, 13, ['heatstroke']));
  const drugOnly = E.create(G.generate(1, 13, ['heatstroke']));
  const dx = require('../prototype/diagnosis');
  const ids = s => dx.classifyAll(s).map(d => d.primaryId);
  check('热射病识别并保留合并感染的可能', dx.classify(hot).primary === '热射病' &&
    !ids(hot).includes('septicShock') && ids({ ...hot, infection: 0.8 }).includes('septicShock'), '比较有无感染负荷');
  const myxedema = E.create(G.generate(1, 13, ['myxedema']));
  check('甲减危象识别并保留合并阿片中毒的可能', dx.classify(myxedema).primary.includes('甲减') &&
    !ids(myxedema).includes('opioidOD') && ids({ ...myxedema, opioidTox: true }).includes('opioidOD'), '比较有无阿片中毒证据');
  E.setEnv(hot, 'cooling', true);
  E.give(drugOnly, 'acetaminophen', 500);
  advance(hot, 45); advance(drugOnly, 45);
  check('物理降温达标后停止且继续恢复', hot.running && !hot.env.cooling && hot.heatstrokeCooled &&
    hot.temp < 38.5 && hot.temp >= 36 && hot.history.some(p => p.temp > 40), hot.temp.toFixed(1) + '℃');
  check('普通退热药不解除热射病负荷', drugOnly.heatstrokeDrive === 1.30 && !!drugOnly.death, '未启动物理降温');

  const thyroid = E.create(G.generate(1, 13, ['thyroid']));
  E.give(thyroid, 'propylthiouracil', 200);
  advance(thyroid, 5);
  const early = thyroid.thyroidHeatDrive;
  advance(thyroid, 45);
  check('甲亢治疗按药物起效延迟降温', early >= 0.70 && thyroid.thyroidHeatDrive < early, '比较 5 与 50 分钟');
  const combined = E.create(G.generate(3, 13, ['heatstroke', 'seizure']));
  const reversed = E.create(G.generate(3, 13, ['seizure', 'heatstroke']));
  const initial = Math.min(combined.temp, reversed.temp);
  combined.seizure = 0;
  advance(combined, 1);
  check('复合病例保留入院高温与独立热负荷', initial > 40 && combined.heatstrokeDrive === 1.3 &&
    !combined.tempDrive, '热射病合并癫痫，互换模块顺序');
  const legacy = { tempDrive: 0.38, env: { cold: 1 } };
  const restored = E.create(G.generate(1, 13, ['heatstroke']));
  E.restoreTemperature(restored, legacy);
  check('继承旧存档进行中的降温', restored.heatstrokeDrive === 0.38 && !restored.tempDrive &&
    restored.env.cooling && !restored.env.cold && legacy.env.cold, '已取得的治疗进度保留');

  const low = patient({ temp: 34.2 });
  E.setEnv(low, 'cold', true); E.setEnv(low, 'warming', true);
  advance(low, 45);
  check('保暖回到目标后自动停止', !low.env.warming && low.log.some(([, msg]) => msg.includes('停止被动保暖')),
    '在寒冷环境中开启被动保暖');
}
{
  const general = E.create({ id: 'stable', init: { ...G.BASE } });
  const blocked = (st, hr) => E.dischargeCheck({ ...st, hr }).reasons.some(r => r.includes('心率'));
  check('通用出院心率与监护读数一致', [50, 114, 115, 119, 119.49].every(hr => !blocked(general, hr)) &&
    [49, 119.5, 120, NaN].every(hr => blocked(general, hr)), '显示 50–119 次/分');
  const hypo = E.create(G.generate(1, 13, ['myxedema']));
  const both = E.create(G.generate(3, 13, ['myxedema', 'organophosphate']));
  check('合并病例取更严格的心率下限', blocked(hypo, 54) && !blocked(hypo, 55) &&
    blocked(both, 59) && !blocked(both, 60), '甲减危象 55，有机磷中毒 60');
}
{
  const glucoseReasons = (S, glu) => E.dischargeCheck({ ...S, glu }).reasons.filter(reason => reason.startsWith('血糖'));
  const dkaCases = [E.create('dka'), E.create(G.generate(1, 13, ['dka'])),
    E.create(G.generate(3, 13, ['dka', 'bleed'])), E.create(G.generateVersion(3, 13, 1, ['dka', 'bleed']))];
  check('DKA 病例的血糖目标与出院拦截一致', dkaCases.every(S =>
    S.cas.goals.includes('血糖 <11 mmol/L') && glucoseReasons(S, 10.9).length === 0 &&
    [11.0, 11.6, 12.1].every(glu => {
      const reasons = glucoseReasons(S, glu);
      return reasons.length === 1 && reasons[0].includes(`${glu.toFixed(1)} mmol/L`) && reasons[0].includes('<11 mmol/L');
    })), '固定、生成、合并与旧版生成病例各报告一次');
  const nearLimit = { ...dkaCases[0], glu: 10.96 };
  check('DKA 出院血糖使用监护快照精度', E.snapshot(nearLimit).glu === 11 && glucoseReasons(nearLimit, 10.96).length === 1 &&
    glucoseReasons(nearLimit, 10.94).length === 0, '10.96 显示为 11.0，10.94 显示为 10.9');
  const others = [E.create({ id: 'stable', init: { ...G.BASE } }), E.create(G.generate(1, 13, ['hhs']))];
  check('其他病例采用通用出院血糖范围', others.every(S =>
    [4.0, 10.9, 11.0, 11.6, 12.0].every(glu => glucoseReasons(S, glu).length === 0) &&
    [3.9, 12.1].every(glu => glucoseReasons(S, glu).length === 1)), '含高渗高血糖状态，范围 4–12 mmol/L');
  check('出院遇到缺失血糖时提示复测', [dkaCases[0], others[0]].every(S =>
    [NaN, undefined, null].every(glu => glucoseReasons(S, glu).some(reason => reason.includes('需复测')))),
    'DKA 与通用判据均要求已知血糖');
  const review = (S, glu, start) => E.glucoseReviewStatus({ ...S, glu }, start);
  const general = others[0];
  check('复查复用通用出院血糖边界', [3.96, 12.04].every(glu => {
    const status = review(general, glu, 13);
    return status.inTarget && status.reason === 'target' && status.target === '4–12 mmol/L';
  }) && [3.94, 12.06].every(glu => !review(general, glu).inTarget), '监护读数 4.0 与 12.0 含边界');
  check('DKA 复查复用出院血糖上限', dkaCases.every(S => {
    const below = review(S, 10.94, 14);
    const limit = review(S, 10.96, 14);
    return below.glucose === 10.9 && below.reason === 'target' && below.target === '≥4 且 <11 mmol/L' &&
      limit.glucose === 11 && !limit.inTarget && limit.reason === null;
  }), '监护读数 10.9 达标，11.0 继续复查');
  check('血糖复查识别反向恶化', [
    [14.2, 12.3, null], [14.3, 12.3, 'worse'], [1.8, 3.7, null], [1.7, 3.7, 'worse'],
    [3.9, 12.3, 'worse'], [12.1, 3.9, 'worse']
  ].every(([glu, start, reason]) => review(general, glu, start).reason === reason),
    '覆盖升降 1.9 与 2.0 mmol/L 以及跨过目标区间');
  check('血糖复查保留缺测状态', [NaN, undefined, null].every(glu => {
    const status = review(general, glu, 13);
    return status.glucose === null && !status.inTarget && status.reason === 'missing';
  }) && review(general, 13).reason === null, '缺少当前值时需复测，可单独评估当前读数');
}
{
  const bed = E.create({ id: 'stable', init: { ...G.BASE, hr: 80, rr: 16, temp: 37, gcs: 15, k: 4, glu: 7 } });
  bed.spo2 = 98;
  const changeHr = hr => ({ hr, sv: bed.sv * bed.hr / hr });
  const review = (start, change) => E.conditionReviewChange({ ...start, ...change }, E.conditionReviewBaseline(start));
  const changes = [
    ['心率', changeHr(94), changeHr(95), '80 → 95 次/分'],
    ['呼吸频率', { rr: 12 }, { rr: 11 }, '16 → 11 次/分'],
    ['收缩压', { cvp: bed.cvp + 14 }, { cvp: bed.cvp + 15 }, `${E.bp(bed).sys} → ${E.bp(bed).sys + 15} mmHg`],
    ['血氧 SpO₂', { spo2: 95 }, { spo2: 94 }, '98 → 94 %'],
    ['体温', { temp: 37.4 }, { temp: 37.5 }, '37.0 → 37.5 ℃'],
    ['GCS', { gcs: 14 }, { gcs: 13 }, '15 → 13 分'],
    ['血钾', { k: 4.4 }, { k: 4.5 }, '4.0 → 4.5 mmol/L'],
  ];
  check('病情复评识别显著体征变化并显示前后值', changes.every(([label, small, large, values]) =>
    review(bed, small) === null && review(bed, large) === `${label} ${values}`),
    '心率、呼吸、收缩压、血氧、体温、GCS、血钾');

  const lowOxygen = { ...bed, spo2: 91 };
  check('病情复评跨监护阈值需最小幅度', review(lowOxygen, { spo2: 92 }) === null &&
    review(lowOxygen, { spo2: 93 }) === '血氧 SpO₂ 91 → 93 %' &&
    review({ ...bed, rr: 23 }, { rr: 25 }) === '呼吸频率 23 → 25 次/分' &&
    review({ ...bed, gcs: 12 }, { gcs: 11 }) === 'GCS 12 → 11 分' &&
    review({ ...bed, k: 5.5 }, { k: 5.6 }) === null &&
    review({ ...bed, k: 5.5 }, { k: 5.7 }) === '血钾 5.5 → 5.7 mmol/L',
    '边界附近的小波动、跨阈值的改善和恶化');

  const baseline = E.conditionReviewBaseline(bed);
  check('病情复评从等待起点累计变化，重开后从新读数计', [81, 84, 94].every(hr =>
    E.conditionReviewChange({ ...bed, ...changeHr(hr) }, baseline) === null) &&
    E.conditionReviewChange({ ...bed, ...changeHr(95) }, baseline) === '心率 80 → 95 次/分' &&
    review({ ...bed, ...changeHr(95) }, {}) === null,
    '小变动累积达到门槛，原地重开继续等待');

  const dka = E.create(G.generate(1, 13, ['dka']));
  check('病情复评提示血糖达标、离开目标和双向明显变化', [
    [bed, 12.1, 12, /12\.1 mmol\/L → 12\.0 mmol\/L.*进入本病例目标范围/],
    [bed, 4, 3.9, /4\.0 mmol\/L → 3\.9 mmol\/L.*偏离本病例目标范围/],
    [dka, 11, 10.9, /进入本病例目标范围（≥4 且 <11 mmol\/L）/],
    [dka, 10.9, 11, /偏离本病例目标范围（≥4 且 <11 mmol\/L）/],
    [dka, 15, 13, /15\.0 mmol\/L → 13\.0 mmol\/L/],
    [dka, 13, 15, /13\.0 mmol\/L → 15\.0 mmol\/L/],
    [bed, 7, null, /7\.0 mmol\/L → 缺测/],
  ].every(([patient, start, glu, expected]) => expected.test(review({ ...patient, glu: start }, { glu }))) &&
    review({ ...dka, glu: 15 }, { glu: 13.1 }) === null && review({ ...bed, glu: 7 }, { glu: 7.1 }) === null &&
    review(bed, {}) === null, '通用与 DKA 目标边界，达标后重开、持续目标外、缺测和小幅波动');

  check('病情复评识别床旁抽搐和心律状态变化',
    review(bed, { seizure: 0.14 }) === null &&
    review(bed, { seizure: 0.2 }) === '抽搐征象 未见抽搐 → 间断可见肢体抽动' &&
    review({ ...bed, seizure: 0.65 }, { seizure: 0 }) === '抽搐征象 持续肢体抽搐 → 未见抽搐' &&
    review(bed, { rhythm: 'vf' }) === '心律 窦性心律 → 心室颤动' &&
    review({ ...bed, rhythm: 'asystole' }, { rhythm: 'sinus' }) === '心律 心静止 → 窦性心律',
    '隐匿活动、发作、停止、心律恶化和恢复');

  const bleeding = { ...bed, bleedingSites: { bleed: 0.01, spleen: 0.02 } };
  const baselineBleeding = E.conditionReviewBaseline(bleeding);
  E.setBleedingRate(bleeding, 'bleed', 0.005);
  const slowed = E.conditionReviewChange(bleeding, baselineBleeding);
  E.setBleedingRate(bleeding, 'bleed', 0);
  const stopped = E.conditionReviewChange(bleeding, baselineBleeding);
  const baselineStopped = E.conditionReviewBaseline(bleeding);
  E.setBleedingRate(bleeding, 'bleed', 0.005);
  check('病情复评按部位识别止血和再出血', slowed === null &&
    stopped === '上消化道出血 活动性出血 → 已止血' &&
    E.conditionReviewChange(bleeding, baselineStopped) === '上消化道出血 未见活动性出血 → 活动性出血',
    '脾脏持续出血，上消化道出血先减缓再停止，随后复发');
}
{
  const cases = [E.create('hyperkalemia'), ...[['highK'], ['aki'], ['bph'], ['highK', 'aki']].map(ids =>
    E.create(G.generate(3, 13, ids))), E.create(G.generateVersion(3, 13, 1, ['highK', 'aki']))];
  const potassiumReasons = (bed, k) => E.dischargeCheck({ ...bed, k }).reasons.filter(reason => reason.startsWith('血钾'));
  check('高低血钾各只提示一次并显示目标', cases.every(bed =>
    [3.4, 5.7, 7.1].every(k => {
      const reasons = potassiumReasons(bed, k);
      return reasons.length === 1 && reasons[0].includes(`${k} mmol/L`) && reasons[0].includes('3.5–5.5');
    }) && [3.5, 4.4, 5.5].every(k => potassiumReasons(bed, k).length === 0)),
    '覆盖固定、生成、复合和旧版病例，两个边界值都达标');
  const combined = E.create(G.generate(3, 13, ['highK', 'dka']));
  check('血钾和血糖同时异常时各提示一次', [5.7, 7.1].every(k => [10.9, 11, 11.6, 12.1].every(glu => {
    const { reasons } = E.dischargeCheck({ ...combined, k, glu });
    return reasons.filter(r => r.startsWith('血钾')).length === 1 &&
      reasons.filter(r => r.startsWith('血糖')).length === (glu >= 11 ? 1 : 0);
  })), '高钾合并 DKA');
}
{
  const make = (identity) => E.create(G.generate(2, 101, ['aki']), identity);
  const advance = (bed, seconds, step = 20) => {
    for (let elapsed = 0; elapsed < seconds; elapsed += step) {
      const dt = Math.min(step, seconds - elapsed);
      E.tick(bed, dt);
      G.step(bed, dt, E);
    }
  };
  const serialize = ({ cas, ...state }) => JSON.parse(JSON.stringify(state));
  const restore = saved => {
    const bed = Object.assign(make(), saved);
    E.restoreDischargeObservation(bed, saved);
    return bed;
  };
  const furo = make({ weight: 56 });
  Object.assign(furo, { k: 4.9, hco3: 16, cr: 280, renalFactor: 0.062, diuresis: 7.2 });
  advance(furo, 9 * 60);
  const inducedUrine = furo.uo * 60;
  // 复放反馈中的床旁读数，56 kg 病例的总尿量也已越过 0.5 mL/kg/h。
  furo.uo = 30.04 / 60;
  const furoCheck = E.dischargeCheck(furo);
  check('短暂利尿达到 30.04 mL/h 仍会拦截 AKI 签字', inducedUrine >= 28 && Math.round(furo.gfr) === 8 &&
    furo.cr < 400 && furo.cr > 285 && furoCheck.majorReasons.some(reason => /30\.04 mL\/h.*利尿.*自身尿量/.test(reason)) &&
    furoCheck.reasons.some(reason => reason.includes('肌酐回升')) && E.signDischarge(furo).status === 'failed',
    '模拟 GFR 约 8，肌酐低于 400 但仍在回升，总尿量达标时还需评估自身尿量');

  const startDialysis = bed => {
    E.give(bed, 'calcium', 10);
    E.give(bed, 'insulin', 10);
    E.give(bed, 'dextrose50', 25);
    advance(bed, 310);
    E.ACTIONS.dialysis.apply(bed);
  };
  const bed = make();
  startDialysis(bed);
  advance(bed, 180 * 60 - 20);
  const whileDialyzing = E.dischargeCheck(bed);
  const endAt = bed.dialysisUntil;
  const noDialysis = restore({ ...serialize(bed), dialysisUntil: -1 });
  E.tick(noDialysis, 30);
  advance(bed, 30, 30);
  const firstAfterDialysis = E.dischargeCheck(bed);
  check('透析中和快进跨过透析结束时需重新评估', whileDialyzing.majorReasons.some(reason => reason.includes('透析仍在进行')) &&
    whileDialyzing.observationEndsAt === endAt && bed.cr < noDialysis.cr && !firstAfterDialysis.ok &&
    firstAfterDialysis.observationEndsAt === bed.t + 30 * 60,
    '跨越透析结束的 30 秒中按其中 20 秒清除肌酐，留观从首个透析间期样本开始');

  advance(bed, 10 * 60);
  const progress = E.dischargeCheck(bed);
  const saved = serialize(bed);
  const legacy = { ...saved };
  delete legacy.akiObservation;
  const existing = E.dischargeCheck(restore(saved));
  const legacyBed = restore(legacy);
  const legacyCheck = E.dischargeCheck(legacyBed);
  check('读档保留已验证的 AKI 留观，旧档从当前建立基线', !progress.ok &&
    progress.reasons.some(reason => reason.includes('还需 20 分钟')) &&
    existing.observationEndsAt === progress.observationEndsAt && legacyCheck.reasons.some(reason => reason.includes('还需 30 分钟')) &&
    legacyCheck.observationEndsAt === legacy.t + 30 * 60,
    '旧档缺少自主尿量和肌酐连续趋势，重读后重新观察');

  const dip = restore(serialize(bed));
  const beforeDip = dip.akiObservation.urineStableSince;
  const beforeDipState = { renalFactor: dip.renalFactor, diuresis: dip.diuresis };
  Object.assign(dip, { renalFactor: 0.08, diuresis: 6.4 });
  advance(dip, 20);
  const afterDip = dip.akiObservation.urineStableSince;
  Object.assign(dip, beforeDipState);
  advance(dip, 20);
  check('自身尿量中断会重新开始 AKI 留观', beforeDip != null && afterDip == null &&
    dip.akiObservation.urineStableSince === dip.t && E.dischargeCheck(dip).observationEndsAt === dip.t + 30 * 60,
    '一拍自身尿量跌落时，即使总尿量受利尿影响，仍需重新累计连续留观');

  advance(bed, 20 * 60);
  const rebound = E.dischargeCheck({ ...bed, cr: bed.cr + 30 });
  check('AKI 停透期间肌酐反弹会单独阻止出院', !rebound.ok && rebound.reasons.length === 1 &&
    rebound.reasons[0].includes('肌酐回升'),
    '已完成留观，尿量达标，肌酐反弹且仍低于病例绝对上限');
  advance(legacyBed, 30 * 60);
  check('稳定的 AKI 和由旧档恢复的患者均可在留观后正常签字', bed.cr < 400 && bed.renalFactor > 0.5 &&
    E.signDischarge(bed).status === 'normal' && E.signDischarge(legacyBed).status === 'normal',
    '常规处置后自身尿量达标，离透析稳定满 30 个模拟分钟');

  const mild = make({ weight: 100 });
  const urineRate = bed => bed.uo * 60 / bed.patient.weight;
  startDialysis(mild);
  advance(mild, 180 * 60);
  const endOfDialysisUrine = urineRate(mild);
  advance(mild, 15 * 60);
  const mildProgress = E.dischargeCheck(mild);
  const mildDip = restore(serialize(mild));
  const mildRebound = restore(serialize(mild));
  const factorBeforeDip = mildDip.renalFactor;
  const crBeforeRebound = mildRebound.cr;
  mildDip.renalFactor *= 0.88;
  mildRebound.cr += 6;
  for (const changed of [mildDip, mildRebound]) advance(changed, 20);
  const dippedUrine = urineRate(mildDip);
  const dipped = E.dischargeCheck(mildDip);
  const rebounded = E.dischargeCheck(mildRebound);
  mildDip.renalFactor = factorBeforeDip;
  mildRebound.cr = crBeforeRebound;
  for (const changed of [mildDip, mildRebound]) advance(changed, 15 * 60 - 20);
  check('仍高于安全下限的尿量下降或肌酐反弹会重开留观', dippedUrine >= 0.3 &&
    dipped.observationEndsAt > mildProgress.observationEndsAt &&
    rebounded.reasons.some(reason => reason.includes('肌酐回升')) &&
    !E.dischargeCheck(mildDip).ok && !E.dischargeCheck(mildRebound).ok,
    '回落时自身尿量仍在轻度少尿区间，恢复后需要补足连续观察');

  const restoredMild = restore(serialize(mild));
  advance(restoredMild, 15 * 60 - 0.2);
  const beforeDeadline = E.dischargeCheck(restoredMild);
  advance(restoredMild, 0.2);
  const overLimit = E.dischargeCheck({ ...restoredMild, cr: 401 });
  const highPotassium = E.dischargeCheck({ ...restoredMild, k: 6.7 });
  const mixed = E.create(G.generate(4, 101, ['aki', 'hhs']), { weight: 100 });
  const mixedCheck = E.dischargeCheck({ ...restoredMild, tags: mixed.tags, cas: mixed.cas });
  check('稳定轻度少尿的 AKI 留观满 30 分钟可正常签字', !mildProgress.ok &&
    endOfDialysisUrine >= 0.3 && urineRate(restoredMild) < 0.5 &&
    beforeDeadline.reasons.length === 1 && beforeDeadline.observationEndsAt === mildProgress.observationEndsAt &&
    E.signDischarge(restoredMild).status === 'normal',
    `透析结束时自身尿量 ${endOfDialysisUrine.toFixed(2)}，签字时 ${urineRate(restoredMild).toFixed(2)} mL/kg/h`);
  check('轻度少尿仍受肌酐上限、高钾和合并病种尿量目标约束',
    !overLimit.ok && overLimit.reasons.some(reason => reason.includes('≤400 µmol/L')) &&
    highPotassium.majorReasons.some(reason => reason.startsWith('血钾')) &&
    !mixedCheck.ok && mixedCheck.reasons.some(reason => reason.includes('>0.5 mL/kg/h')),
    '保留 AKI 肌酐上限、通用高钾拦截和高渗高血糖状态的独立尿量目标');
}
{
  const assess = (ids, patch) => E.dischargeCheck(Object.assign(E.create(G.generate(4, 13, ids)), patch)).reasons;
  const count = (rows, prefix) => rows.filter(row => row.startsWith(prefix)).length;
  const seizure = assess(['seizure', 'highK'], { gcs: 3, k: 6.9, seizure: 0.79 });
  check('癫痫合并高钾的出院评估分列三项', count(seizure, '意识') === 1 && count(seizure, '血钾') === 1 &&
    count(seizure, '仍有抽搐') === 1, 'GCS 3、血钾 6.9 和床旁抽搐各提示一次');
  const mixed = assess(['opioid', 'hyponatremia'], { gcs: 14, rr: 11, na: 125 });
  check('合并病例保留较严的意识、呼吸和血钠门槛', ['意识', '呼吸', '血钠'].every(prefix => count(mixed, prefix) === 1) &&
    mixed.some(r => r.startsWith('意识') && r.includes('15 分（本病例要求意识完全恢复）')) &&
    !assess(['opioid', 'hyponatremia'], { gcs: 15, rr: 12, na: 130 }).some(r => /^(意识|呼吸 |血钠 )/.test(r)),
    'GCS 14、呼吸 11、血钠 125 仍拦截，达到各项目标后消除');
  const renal = cr => assess(['apap', 'aki', 'bph'], { cr }).filter(r => r.startsWith('肌酐'));
  check('肌酐读数合并并注明各病种的阈值', renal(450).length === 1 &&
    ['≤140', '≤180', '≤400'].every(target => renal(450)[0].includes(target)) &&
    renal(150).length === 1 && renal(150)[0].includes('≤140') && !renal(140).length &&
    assess(['apap'], { cr: 131 }).some(reason => reason.startsWith('肌酐') && reason.includes('≤130')),
  '对乙酰氨基酚中毒合并慢性肾病背景下的急性肾损伤及尿潴留');
  const bleeding = assess(['bleed', 'trauma'], { hb: 70, bleedingSites: { bleed: 1, trauma: 1 } });
  check('重复血红蛋白合并，两个出血部位分别保留', count(bleeding, '血红蛋白') === 1 &&
    bleeding.includes('消化道出血未止') && bleeding.includes('创伤出血未控制'), '不同处置原因仍逐项可见');
  const urine = assess(['pancreatitis', 'hhs'], { uo: 0.3, weight: 70 }).filter(r => r.startsWith('尿量'));
  check('合并病例可区分两种尿量要求', urine.length === 1 && urine[0].includes('18 mL/h') && urine[0].includes('≥30 mL/h') &&
    urine[0].includes('>0.5 mL/kg/h'), '尿量和按体重折算的尿量各保留单位与目标');
  const bed = E.create(G.generate(3, 13, ['seizure', 'hyponatremia']));
  check('床旁抽搐征象与出院拦截同步', [0.79, 0.54, 0.15, 0.11, 0.10, 0].every(seizure => {
    const sample = { ...bed, seizure };
    return Boolean(E.convulsionSigns(sample)) === (seizure > 0.10) &&
      count(E.dischargeCheck(sample).reasons, '仍有抽搐') === Number(seizure > 0.10);
  }), '合并低钠时保留更严格的发作观察条件');
}
{
  const edema = E.create(G.generate(2, 101, ['edema']));
  E.ACTIONS.oxygen.apply(edema);
  const samplingAt = E.TESTS.abg.min * 60;
  let consistent = true;
  for (let sec = 0; sec < 18 * 60; sec += 2) {
    E.tick(edema, 2);
    G.step(edema, 2, E);
    if (edema.t === samplingAt) E.orderTest(edema, 'abg');
    E.pollTests(edema);
    consistent &&= Math.abs(edema.spo2 - E.hill(edema.pao2) * 100) < 0.01;
  }
  const abg = E.testValue(edema, 'abg');
  const report = edema.labSnap.abg;
  const latest = E.snapshot(edema);
  check('高浓度吸氧时动脉血气与监护血氧一致', consistent && report?.t === samplingAt &&
    report.reportedAt === samplingAt + E.TESTS.abg.min * 60 && abg?.oxygenModelVersion === 2 &&
    Math.abs(abg.sao2 - E.hill(abg.pao2) * 100) < 1 && abg.spo2 === abg.sao2 &&
    edema.endCapillaryPo2 > 600 && latest.pao2 < abg.pao2 && latest.spo2 < abg.spo2 &&
    latest.pao2 < edema.endCapillaryPo2 && latest.spo2 < 97,
    `首份血气 ${abg?.pao2} mmHg / ${abg?.sao2}%，后续 ${latest.pao2} mmHg / ${latest.spo2}%`);

  const support = E.create({ id: 'oxygen-test', init: { ...G.BASE } });
  Object.assign(support, { shunt: 0.35, t: 300, spontaneousRr: 16, spontaneousCO2: 40, respiratoryAssessmentAt: 300 });
  E.ACTIONS.oxygen.apply(support);
  support.vent = 1;
  const low = E.roomAirSaturation(support, support.spontaneousCO2);
  E.ACTIONS.extubate.apply(support);
  const refused = support.vent;
  E.ACTIONS.oxygen_off.apply(support);
  check('机械通气中降低氧浓度只改变 FiO₂', support.vent && support.fio2 === 0.21 &&
    support.log.at(-1)[1].includes('继续机械通气') && E.dischargeCheck(support).reasons.includes('仍需机械通气'),
    support.log.at(-1)[1]);
  support.shunt = 0;
  E.ACTIONS.extubate.apply(support);
  E.ACTIONS.oxygen_off.apply(support);
  const onRoomAir = support.log.at(-1)[1].includes('改室内空气');
  E.tick(support, 1);
  check('撤机与撤氧使用室内空气估算和观察', low < 92 && refused && !support.vent && onRoomAir &&
    support.fio2 === 0.21 && E.roomAirSaturation(support) >= 94 &&
    E.dischargeCheck(support).reasons.some(reason => reason.includes('室内空气血氧需稳定')),
    `高分流室气估计 ${low.toFixed(1)}%，解除分流后允许撤机`);

  const healthy = E.create({ id: 'oxygen-test', init: { ...G.BASE } });
  const co = E.create({ id: 'oxygen-test', init: { ...G.BASE, coHb: 0.4 } });
  check('碳氧血红蛋白降低氧输送，血氧仪可维持假正常', Math.abs(healthy.pao2 - co.pao2) < 0.1 &&
    Math.abs(healthy.spo2 - co.spo2) < 0.1 && co.spo2 >= 94 && co.do2 < healthy.do2 * 0.7,
    `SpO₂ ${co.spo2.toFixed(1)}%，氧输送 ${Math.round(healthy.do2)} → ${Math.round(co.do2)} mL/min`);

  const oldSample = { s: { pao2: 631, spo2: 90 } };
  const saved = { pao2: 631, spo2: 90, shunt: 0.25, svo2: 0.50, labSnap: { abg: oldSample } };
  const restored = Object.assign(E.create({ id: 'oxygen-test', init: { ...G.BASE } }), saved);
  E.restoreCardiorespiratory(restored, saved);
  check('恢复旧档时重算现时氧合并保留原血气', restored.endCapillaryPo2 === 631 &&
    restored.pao2 < 200 && Math.abs(restored.spo2 - E.hill(restored.pao2) * 100) < 0.01 &&
    restored.labSnap.abg === oldSample && oldSample.s.pao2 === 631 && !oldSample.s.oxygenModelVersion,
    `实时 PaO₂ ${Math.round(restored.pao2)} mmHg，旧报告 631 mmHg`);
}

{
  const makeBed = () => E.create({ id: 'ventilator-test', init: { ...G.BASE } });
  const intubate = (init = {}) => {
    const bed = makeBed();
    Object.assign(bed, init);
    bed.gcs = 8;
    E.ACTIONS.intubate.apply(bed);
    return bed;
  };
  const settle = (...beds) => {
    for (let elapsed = 0; elapsed < 10 * 60; elapsed += 2) {
      for (const bed of beds) E.tick(bed, 2);
    }
  };
  const low = intubate();
  const baseline = intubate();
  const high = intubate();
  const roomAir = makeBed();
  const initial = E.ventilatorSettings(baseline);
  const before = low.log.length;
  const fio2 = low.fio2;
  const limited = E.setVentilatorFlow(low, 1);
  const minimum = E.ventilatorSettings(low);
  const redundant = E.setVentilatorFlow(low, -1);
  const invalid = [NaN, Infinity, '30', null].every(flow => !E.setVentilatorFlow(low, flow));
  const off = E.setVentilatorFlow(roomAir, 60);
  check('呼吸机流量限幅，仅有效变更记录，其他床独立', limited && !redundant && invalid && !off &&
    low.log.length === before + 1 && low.log.at(-1)[1].endsWith('10 L/min') && low.fio2 === fio2 &&
    minimum.flow === initial.minFlow && minimum.deliveredTidalVolume === 200 && minimum.deliveryTime === 1.2 &&
    initial.active && initial.rate === 14 && initial.fio2 === 0.6 && initial.flow === 45 &&
    initial.targetTidalVolume === 450 &&
    E.ventilatorSettings(baseline).flow === initial.flow && E.ventilatorSettings(roomAir).flow === initial.flow,
    '有效范围 10–120 L/min，新床默认 45 L/min');

  E.setVentilatorFlow(low, 15);
  E.setVentilatorFlow(high, 1e4);
  const maximum = E.ventilatorSettings(high);
  settle(low, baseline, high);
  check('低吸气流量限制送气，高流量延长呼气并维持目标潮气量', E.ventilatorSettings(low).deliveredTidalVolume === 300 &&
    maximum.flow === initial.maxFlow && maximum.deliveredTidalVolume === initial.deliveredTidalVolume &&
    maximum.deliveryTime < initial.deliveryTime && maximum.expiratoryTime > initial.expiratoryTime &&
    low.rr === 14 && baseline.rr === 14 && high.rr === 14 &&
    low.paco2 - baseline.paco2 > 15 && Math.abs(high.paco2 - baseline.paco2) < 1,
    `PaCO₂：15 L/min ${low.paco2.toFixed(1)}、45 L/min ${baseline.paco2.toFixed(1)}、120 L/min ${high.paco2.toFixed(1)} mmHg`);

  const obstruction = { airwayResistance: 0.75, vdvt: 0.53 };
  const obstructed = intubate(obstruction);
  const longerExhalation = intubate(obstruction);
  E.setVentilatorSettings(obstructed, { rate: 20 });
  E.setVentilatorSettings(longerExhalation, { rate: 20, flow: 120 });
  settle(obstructed, longerExhalation);
  check('阻塞气道时缩短吸气可以改善有效通气', obstructed.paco2 - longerExhalation.paco2 > 2 &&
    E.ventilatorSettings(obstructed).deliveredTidalVolume === E.ventilatorSettings(longerExhalation).deliveredTidalVolume,
    `同为 450 mL，PaCO₂ ${obstructed.paco2.toFixed(1)} → ${longerExhalation.paco2.toFixed(1)} mmHg`);

  const slowRate = intubate(), fastRate = intubate(), higherOxygen = intubate();
  const rejected = !E.setVentilatorSettings(slowRate, { rate: 20, fio2: NaN }) && slowRate.rr === 14;
  E.setVentilatorSettings(slowRate, { rate: 6, fio2: 0.21 });
  E.setVentilatorSettings(fastRate, { rate: 22, fio2: 0.21 });
  E.setVentilatorSettings(higherOxygen, { rate: 6, fio2: 0.42 });
  settle(slowRate, fastRate, higherOxygen);
  check('机控频率更新床旁 RR，低氧时固定所设 FiO₂', rejected && slowRate.rr === 6 && fastRate.rr === 22 &&
    slowRate.paco2 - fastRate.paco2 > 20 && slowRate.spo2 < 92 && slowRate.fio2 === 0.21 &&
    higherOxygen.rr === 6 && higherOxygen.fio2 === 0.42 && higherOxygen.pao2 - slowRate.pao2 > 25 &&
    high.rr === 14 && high.fio2 === 0.6,
    `RR 6 时 SpO₂ ${slowRate.spo2.toFixed(1)}%，FiO₂ 保持 21%；调高浓度时 PaO₂ ${slowRate.pao2.toFixed(1)} → ${higherOxygen.pao2.toFixed(1)} mmHg`);

  const samplePaCO2 = Math.round(low.paco2);
  const samplePaO2 = Math.round(low.pao2);
  const ready = E.orderTest(low, 'abg');
  E.setVentilatorSettings(low, { rate: 12, fio2: 0.30 });
  const saved = JSON.parse(JSON.stringify(low));
  const legacySaved = JSON.parse(JSON.stringify(saved));
  delete legacySaved.ventFlow;
  delete legacySaved.ventRate;
  delete legacySaved.ventFio2;
  const restored = Object.assign(makeBed(), saved);
  E.restoreCardiorespiratory(restored, saved);
  const savedSetting = E.ventilatorSettings(restored);
  E.setVentilatorFlow(restored, 45);
  for (let elapsed = low.t; elapsed < ready; elapsed += 2) E.tick(restored, 2);
  E.pollTests(restored);
  const sample = E.testValue(restored, 'abg');
  const legacy = Object.assign(makeBed(), legacySaved);
  E.restoreCardiorespiratory(legacy, legacySaved);
  const legacySettings = E.ventilatorSettings(legacy);
  check('恢复逐床呼吸机设置及待出血气，旧档保留吸入氧浓度', savedSetting.active && savedSetting.flow === 15 &&
    savedSetting.rate === 12 && savedSetting.fio2 === 0.30 &&
    sample?.paco2 === samplePaCO2 && sample.pao2 === samplePaO2 &&
    Math.round(restored.paco2) < samplePaCO2 && legacySettings.flow === initial.flow &&
    legacySettings.rate === initial.rate && legacySettings.fio2 === 0.30 &&
    E.ventilatorSettings(low).flow === 15 && !E.testValue(low, 'abg'),
    '设置分床保留，已取样血气仍显示原 PaCO₂、PaO₂');

  const readyToWean = { gcs: 15, map: 85, spontaneousRr: 16, spontaneousCO2: 40 };
  for (const bed of [low, baseline]) {
    Object.assign(bed, readyToWean, { respiratoryAssessmentAt: bed.t });
    E.ACTIONS.extubate.apply(bed);
  }
  const stopped = E.ventilatorSettings(low);
  const control = Object.assign(makeBed(), JSON.parse(JSON.stringify(low)), { ventFlow: maximum.flow });
  E.tick(low, 2);
  E.tick(control, 2);
  check('撤机后回到自主呼吸，保留本床参数供再次插管', !stopped.active && !baseline.vent &&
    stopped.flow === 15 && stopped.rate === 12 && stopped.fio2 === 0.30 &&
    stopped.deliveredTidalVolume === null && stopped.deliveryTime === null &&
    low.paco2 === control.paco2 && low.rr === control.rr,
    '停机时不同机控流量设定的自主通气结果一致');
}

{
  const chronic = G.generate(3, 17);
  const compensated = E.create(chronic);
  const acute = E.create({ ...chronic, init: { ...chronic.init, chronicPaco2: undefined } });
  check('合并慢性高碳酸时只按既往 PaCO₂ 补足肾代偿', compensated.chronicPaco2 === 46 &&
    Math.abs(compensated.hco3 - acute.hco3 - 2.1) < 0.02 &&
    compensated.ph > acute.ph && compensated.paco2 > 60 && compensated.ph < 7.25,
    `急性 PaCO₂ ${compensated.paco2.toFixed(1)} mmHg，既往 46 mmHg，HCO₃⁻ ${acute.hco3.toFixed(1)} → ${compensated.hco3.toFixed(1)} mmol/L`);
}

{
  const makeBed = () => E.create({ id: 'blood-test', init: { ...G.BASE } });
  const bed = makeBed();
  const other = makeBed();
  Object.assign(bed, { t: 33, hb: 125, wbc: 9.24, plt: 233.4 });
  const firstReady = E.orderTest(bed, 'cbc');
  Object.assign(bed, { t: firstReady - 1, hb: 109, wbc: 18.4, plt: 175 });
  E.pollTests(bed);
  const waiting = E.testValue(bed, 'cbc') === null;
  bed.t++;
  E.pollTests(bed);
  const first = bed.labSnap.cbc;
  check('血常规按开单时取样并延迟显示', waiting && first?.t === 33 && first?.reportedAt === firstReady &&
    first.s.hb === 125 && first.s.wbc === 9.2 && first.s.plt === 233,
    '等待期间改变血红蛋白、白细胞和血小板');

  const secondAt = bed.t + 12;
  bed.t = secondAt;
  const secondReady = E.orderTest(bed, 'cbc');
  Object.assign(bed, { t: secondAt + 3, hb: 95, wbc: 23, plt: 120 });
  const reusedReady = E.orderTest(bed, 'cbc');
  const waitingOnSecond = E.testValue(bed, 'cbc') === first.s;
  const restored = Object.assign(makeBed(), JSON.parse(JSON.stringify(bed)));
  restored.t = secondReady;
  E.pollTests(restored);
  const second = restored.labSnap.cbc;
  check('血常规复查保留原样本，待出时不重复下单', reusedReady === secondReady && waitingOnSecond &&
    restored.cost === 2 * E.TESTS.cbc.cost && second?.t === secondAt && second?.reportedAt === secondReady &&
    second.s.hb === 109 && second.s.wbc === 18.4 && second.s.plt === 175 &&
    restored.labPrevious.cbc?.t === 33 && restored.labPrevious.cbc.s.hb === 125 && !other.labSnap.cbc,
    '等待复查时存档重载，并检查另一床的报告');

  const legacy = makeBed();
  legacy.t = 2000;
  legacy.tests.cbc = { readyAt: 2000, done: false };
  legacy.labSnap.cbc = { t: 100, s: { hb: 130 } };
  E.pollTests(legacy);
  check('旧档待出报告保留原回报规则和旧结果', legacy.labSnap.cbc?.sampledAtKnown === false &&
    legacy.labSnap.cbc.reportedAt === 2000 && legacy.labPrevious.cbc?.s.hb === 130,
    '旧档缺少开单时样本');
}

{
  const ptx = E.create(G.generate(2, 101, ['ptx']));
  const asthma = E.create(G.generate(2, 101, ['asthma']));
  const edema = E.create(G.generate(2, 101, ['edema']));
  const isolated = !asthma.lungExam.latest;
  const before = E.auscultate(ptx);
  E.ACTIONS.chestTube.apply(ptx);
  ptx.t = 35;
  const after = E.auscultate(ptx);
  const obstructed = E.auscultate(asthma);
  const wet = E.auscultate(edema);
  check('双肺听诊反映病情机制并分床保存复查', isolated && before.left.includes('消失') &&
    before.left !== before.right && after.left === after.right && after.t === 35 &&
    ptx.lungExam.previous === before && ptx.lungExam.latest === after && !asthma.lungExam.previous &&
    obstructed.left.includes('哮鸣音') && obstructed.left === obstructed.right &&
    wet.left.includes('湿啰音') && wet.left === wet.right,
    '气胸引流前后、哮喘、肺水肿');
}

{
  const makeBed = () => E.create(G.generate(2, 101, ['ptx']));
  const bed = makeBed();
  Object.assign(bed, { t: 33, lungWater: 0.70 });
  const firstReady = E.orderTest(bed, 'cxr');
  E.ACTIONS.chestTube.apply(bed);
  Object.assign(bed, { t: firstReady - 1, lungWater: 0.12 });
  const duplicateReady = E.orderTest(bed, 'cxr');
  E.pollTests(bed);
  const waiting = !E.chestXrayReports(bed).length;
  const restored = Object.assign(makeBed(), JSON.parse(JSON.stringify(bed)));
  E.restoreChestXrayReports(restored);
  restored.t = firstReady + 7;
  E.pollTests(restored);
  const [first] = E.chestXrayReports(restored);
  const secondAt = restored.t + 20;
  restored.t = secondAt;
  const secondReady = E.orderTest(restored, 'cxr');
  restored.t = secondReady + 5;
  E.pollTests(restored);
  const [prior, second] = E.chestXrayReports(restored);
  const receipts = restored.log.filter(([, message]) => message === '床旁胸片 结果已出');
  check('胸片按申请时病情生成，回报可逐份追溯', waiting && duplicateReady === firstReady &&
    first?.sampledAt === 33 && first.reportedAt === firstReady + 7 && first.findings.includes('片状模糊影') &&
    first.findings.includes('左肺明显受压') && prior === first && Object.isFrozen(first) &&
    second?.sampledAt === secondAt && second.reportedAt === secondReady + 5 && second.findings.includes('未见胸腔积气') &&
    second.findings.includes('未见明显肺水肿') && receipts.length === 2 &&
    receipts[0][3] === first.reportedAt && receipts[0][4] === first.id && receipts[1][4] === second.id &&
    first.id !== second.id && restored.cost === 2 * E.TESTS.cxr.cost && !E.chestXrayReports(makeBed()).length,
    '引流后等候首份回报、带待出报告重载、复查和床位隔离');

  const legacy = makeBed();
  legacy.t = 3000;
  legacy.lungWater = 0.12;
  legacy.tests.cxr = { readyAt: 3000, done: false };
  legacy.labSnap.cxr = { t: 1210, s: { lungWater: 0.70 } };
  legacy.log.push(['00:16', '床旁胸片 结果已出', 'good'], ['00:20', '床旁胸片 结果已出', 'good']);
  E.restoreChestXrayReports(legacy);
  E.pollTests(legacy);
  E.restoreChestXrayReports(legacy);
  const [lost, archived, pending] = E.chestXrayReports(legacy);
  const oldReceipts = legacy.log.filter(([, message]) => message === '床旁胸片 结果已出');
  check('旧档胸片保留真实快照和资料缺失标记', lost?.reportedAt === null && lost.findings.includes('未保留') &&
    archived?.sampledAt === null && archived.reportedAt === 1210 && archived.findings.includes('片状模糊影') &&
    archived.findings.includes('未记录胸腔积气') && oldReceipts[0][4] === lost.id && oldReceipts[1][4] === archived.id &&
    pending?.sampledAt === null && pending.reportedAt === 3000 && pending.findings.includes('未保留') &&
    E.chestXrayReports(legacy).length === 3,
    '旧版先前回执、已保存的最后一次快照、缺少采集资料的待出报告');

  const ambiguous = makeBed();
  ambiguous.labSnap.cxr = { t: 1210, s: { lungWater: 0.70 } };
  ambiguous.log.push(['00:20', '床旁胸片 结果已出', 'good'], ['00:20', '床旁胸片 结果已出', 'good']);
  E.restoreChestXrayReports(ambiguous);
  const [oldFirst, oldSecond, oldSnapshot] = E.chestXrayReports(ambiguous);
  check('同分钟旧回执的胸片快照单独保留', oldFirst?.reportedAt === null && oldSecond?.reportedAt === null &&
    oldFirst.findings.includes('未保留') && oldSecond.findings.includes('未保留') &&
    oldSnapshot?.reportedAt === 1210 && oldSnapshot.findings.includes('片状模糊影'),
    '两个旧回执只有相同的分钟时间戳');
}

{
  const makeBed = () => E.create(G.generate(2, 101, ['preeclampsia']));
  const action = E.ACTIONS.delivery;
  const attempt = bed => {
    action.apply(bed);
    const status = bed.log.at(-1)[2];
    if (status === 'good') bed.cost += action.cost;
    return status;
  };
  const advance = (bed, seconds) => {
    E.tick(bed, seconds);
    G.step(bed, seconds, E);
  };
  const bed = makeBed();
  const noIndication = E.create({ id: 'stable', init: { ...G.BASE } });
  const { svr, plt } = bed;
  const beforeStart = E.dischargeCheck(bed);
  const accepted = attempt(bed) === 'good';
  const afterStart = E.dischargeCheck(bed);
  const duplicate = attempt(bed) === 'warn';
  const rejected = attempt(noIndication) === 'warn';
  check('分娩启动保留病因，重复和无指征申请不计费', accepted && duplicate && rejected &&
    bed.deliveryStartedAt === 0 && !bed.delivered && bed.deliveryAt === null && bed.svr === svr &&
    bed.cost === action.cost && noIndication.deliveryStartedAt === null && noIndication.cost === 0,
    '常规操作入口按开始时的成功日志计费');

  bed.running = false;
  advance(bed, E.DELIVERY_DURATION);
  const stayedPaused = bed.t === 0 && !bed.delivered;
  bed.running = true;
  const steps = E.DELIVERY_DURATION / 0.2;
  for (let step = 1; step < steps; step++) advance(bed, 0.2);
  const stillPending = !bed.delivered && bed.deliveryAt === null && bed.plt < plt;
  const { cas, ...stored } = bed;
  const restored = Object.assign(makeBed(), JSON.parse(JSON.stringify(stored)));
  const control = Object.assign(makeBed(), JSON.parse(JSON.stringify(stored)), { deliveryStartedAt: null });
  const beforeDelivery = E.conditionReviewBaseline(restored);
  advance(restored, 0.2);
  advance(control, 0.2);
  const completion = /胎盘已娩出/;
  const afterBirth = E.dischargeCheck(restored);
  const atBoundary = restored.deliveryAt === E.DELIVERY_DURATION && restored.delivered &&
    restored.svr === Math.max(18, control.svr - 3) && restored.plt > bed.plt &&
    restored.deliveryRecord?.maternal.includes('SpO₂') && restored.deliveryRecord.newborn.includes('新生儿科') &&
    afterBirth.reasons.some(reason => reason.includes('产后观察'));
  attempt(restored);
  advance(restored, 0.2);
  check('分娩按模拟时间完成一次并开始产后观察', stayedPaused && stillPending && atBoundary &&
    restored.cost === action.cost && restored.log.filter(([, msg]) => completion.test(msg)).length === 1,
    '暂停期间冻结，临界点前重载，完成后再次执行');
  const afterObservation = E.dischargeCheck({ ...restored, t: E.DELIVERY_DURATION + 900 });
  check('分娩和产后观察各有独立的复评时点', beforeStart.observationEndsAt === null &&
    afterStart.majorReasons.some(reason => reason.includes('产科病因')) && afterStart.observationEndsAt === E.DELIVERY_DURATION &&
    afterBirth.observationEndsAt === E.DELIVERY_DURATION + 900 && afterObservation.observationEndsAt === null &&
    !afterObservation.reasons.some(reason => reason.includes('产后观察')),
    '启动后先等分娩完成，产后留观满 15 分钟再复评其余指标');
  check('病情复评在分娩完成时触发', E.conditionReviewChange(bed, beforeDelivery) === null &&
    E.conditionReviewChange(restored, beforeDelivery) === '分娩已完成，胎盘已娩出，进入产后观察' &&
    E.conditionReviewChange(restored, E.conditionReviewBaseline(restored)) === null,
    '临界点前继续等待，分娩完成触发一次');

  const legacy = Object.assign(makeBed(), { t: 700, delivered: true, deliveryAt: 90, cost: action.cost });
  const legacyPlt = legacy.plt;
  const alreadyDelivered = attempt(legacy) === 'warn';
  advance(legacy, 1);
  check('旧档已娩出保留完成时刻和产后病程', alreadyDelivered && legacy.deliveryAt === 90 &&
    legacy.deliveryStartedAt === null && legacy.plt > legacyPlt && legacy.cost === action.cost &&
    !legacy.deliveryRecord && !legacy.log.some(([, msg]) => completion.test(msg)), '兼容即时完成的旧版本');
}

{
  const makeBed = () => E.create({ id: 'lactate-test', init: { ...G.BASE } });
  const healthy = makeBed(), damaged = makeBed(), recovering = makeBed();
  const beds = [healthy, damaged, recovering];
  damaged.hepatotox = recovering.hepatotox = 0.85;
  for (const bed of beds) E.tick(bed, 60);
  recovering.hepatotox = 0.25;
  for (const bed of beds) bed.lac = 10.1;
  for (let elapsed = 0; elapsed < 2 * 3600; elapsed += 10) {
    for (const bed of beds) E.tick(bed, 10);
  }
  const cases = [['正常肝功能', healthy], ['肝损持续', damaged], ['肝损改善', recovering]];
  const samples = cases.map(([label, bed]) => [label, E.lactateReadings(bed)]);
  const readings = samples.map(([, sample]) => sample.displayed);
  if (process.argv.includes('--lactate')) {
    console.log('乳酸模型两小时对照。生成与清除量为 mmol/L/min，清除系数为 1/min，乳酸浓度为 mmol/L。');
    console.table(Object.fromEntries(samples.map(([label, sample]) => {
      const { production, hepaticClearance, totalClearance, hepaticClearanceRate, clearanceRate, raw, displayed } = sample;
      return [label, {
        总生成: production.toFixed(6),
        肝清除量: hepaticClearance.toFixed(6),
        总清除量: totalClearance.toFixed(6),
        肝清除系数: hepaticClearanceRate.toFixed(6),
        总清除系数: clearanceRate.toFixed(6),
        原始乳酸: raw.toFixed(6),
        显示乳酸: displayed.toFixed(1),
      }];
    })));
  }
  check('乳酸清除随肝功能恢复，早期损伤不锁住后续生成', readings[0] < readings[2] && readings[2] <= 2.5 &&
    readings[1] > readings[2] && recovering.lactProd === G.BASE.lactProd,
    `两小时后正常肝功能 ${readings[0]}，肝损持续 ${readings[1]}，肝损改善 ${readings[2]} mmol/L`);

  const legacy = { lactProd: 0.185, lac: 10.1, hepatotox: 0.25 };
  const restored = Object.assign(makeBed(), legacy);
  E.restorePatient(restored, legacy);
  const current = { lactProd: 0.07, lactateKineticsVersion: 1 };
  const preserved = Object.assign(makeBed(), current);
  E.restorePatient(preserved, current);
  check('旧档移除锁存的乳酸生成量并保留实测浓度', restored.lactProd === G.BASE.lactProd &&
    restored.lac === 10.1 && preserved.lactProd === current.lactProd, '当前版本保留病例实时生成驱动');

  const critical = makeBed(), elevated = makeBed(), acceptable = makeBed();
  critical.lac = 1.5;
  critical.t = E.orderTest(critical, 'poct_abg');
  E.pollTests(critical);
  critical.lac = 10.1;
  elevated.lac = 3.9;
  acceptable.lac = 2.5;
  const ordinary = E.dischargeCheck(critical);
  const signed = E.signDischarge(critical);
  check('普通和签字出院评估乳酸，早先正常血气仍保留采样值',
    E.knownResults(critical).lac?.value === 1.5 && !ordinary.ok &&
    ordinary.majorReasons.some(reason => reason.includes('乳酸 10.1')) && signed.status === 'failed' &&
    !critical.discharged && !E.dischargeCheck(elevated).ok && E.signDischarge(elevated).status === 'penalized' &&
    E.dischargeCheck(acceptable).ok && E.signDischarge(acceptable).status === 'normal',
    '10.1 判重大问题，3.9 扣分，2.5 达到游戏目标');

  const recent = makeBed();
  recent.t = (10 * 60 + 51) * 60;
  recent.lac = 10;
  const sampledAt = recent.t;
  E.orderTest(recent, 'poct_abg');
  recent.t += 9 * 60;
  E.pollTests(recent);
  const lab = E.reports(recent).find(report => report.sampledAt === sampledAt);
  const decision = E.signDischarge(recent);
  check('10:51 血气乳酸 10.0，11:00 仍高时签字失败',
    lab?.rows.some(row => row.label.includes('乳酸') && parseFloat(row.value) === 10) &&
    decision.status === 'failed' && decision.majorReasons.some(reason => reason.includes('乳酸 10.0')),
    '采样后九分钟仍为重大异常');
}

// 单病种开局即给药无法覆盖的康复路径。
{
  const patient = E.create('opioid');
  const respiratoryReasons = rate => {
    patient.rr = rate;
    return E.dischargeCheck(patient).reasons.filter(reason => reason.startsWith('呼吸 '));
  };
  check('固定病例按床旁呼吸读数检查上下界', !respiratoryReasons(11.99).length &&
    !respiratoryReasons(22.01).length && respiratoryReasons(11.4).length === 1 && respiratoryReasons(22.6).length === 1,
    '12、22 达标，11、23 各提示一次');
}
{
  const apap = E.create(G.generate(2, 101, ['apap']));
  let injuryBeforeTreatment;
  while (apap.running && apap.t < 6 * 3600) {
    if (apap.t === 3600) injuryBeforeTreatment = apap.hepatotox;
    if (apap.t >= 3600 && !apap.pk.some(order => order.id === 'nacetylcysteine')) E.give(apap, 'nacetylcysteine', 150);
    E.tick(apap, 10);
    G.step(apap, 10, E);
  }
  check('延迟解毒后，肝损可消退且凝血能力可恢复', apap.running && injuryBeforeTreatment > 0.5 &&
    apap.hepatotox < injuryBeforeTreatment / 2 && E.dischargeCheck(apap).ok,
    `6 小时凝血 ${apap.coag.toFixed(2)}，GCS ${apap.gcs}`);

  for (const cases of [['heatstroke', 'liverFailure'], ['liverFailure', 'heatstroke']]) {
    const bed = E.create(G.generate(3, 101, cases));
    E.give(bed, 'nacl', 1000);
    E.give(bed, 'lactulose', 30);
    E.setEnv(bed, 'cooling', true);
    while (bed.running && bed.t < 6 * 3600) {
      if (bed.glu < 4 && !bed.pk.some(order => order.id === 'dextrose10')) E.give(bed, 'dextrose10', 500);
      E.tick(bed, 10);
      G.step(bed, 10, E);
    }
    check('热射病合并肝衰控制后乳酸可达标（' + cases.join(' / ') + '）',
      bed.running && bed.heatstrokeCooled && bed.hepatotox >= 0.25 && E.dischargeCheck(bed).ok,
      `6 小时乳酸 ${bed.lac.toFixed(1)} mmol/L`);
  }
}

{
  const makeBed = (init = {}) => E.create({ id: 'critical-course-test', init: { ...G.BASE, ...init } });
  const advance = (bed, seconds, updateCase = false) => {
    for (let elapsed = 0; elapsed < seconds && bed.running; elapsed += 10) {
      const step = Math.min(10, seconds - elapsed);
      E.tick(bed, step);
      if (updateCase) G.step(bed, step, E);
    }
  };

  const mildPressure = makeBed({ icp: 0.3 });
  const higherPressure = makeBed({ icp: 0.8 });
  const mixedCauses = makeBed({ icp: 0.8, glu: 2.4 });
  check('颅压仅计一次，合并低血糖仍会加重意识障碍', mildPressure.gcs === 15 && higherPressure.gcs === 9 && mixedCauses.gcs === 6,
    `轻度颅压、高颅压和合并低血糖 GCS ${mildPressure.gcs}/${higherPressure.gcs}/${mixedCauses.gcs}`);

  const highPotassium = makeBed();
  highPotassium.k = 7.42;
  advance(highPotassium, 3 * 60);
  const riskBeforeCorrection = highPotassium._vfRisk;
  highPotassium.k = 4.5;
  advance(highPotassium, 15 * 60);
  check('高钾纠正后，已积累的室颤风险逐渐降低', riskBeforeCorrection > 0.5 && highPotassium.rhythm === 'sinus' &&
    Math.abs(highPotassium._vfRisk / riskBeforeCorrection - 0.5) < 0.01,
    `风险 ${riskBeforeCorrection.toFixed(2)} → ${highPotassium._vfRisk.toFixed(2)}`);

  const toxic = makeBed({ tca: 0.8 });
  advance(toxic, 60);
  const firstVF = toxic.events.filter(event => event.id === 'vf').length;
  const random = Math.random;
  try {
    Math.random = () => 0;
    E.ACTIONS.defib.apply(toxic);
  } finally {
    Math.random = random;
  }
  const restoredSinus = toxic.rhythm === 'sinus' && toxic._vfRisk === 0;
  advance(toxic, 60);
  check('持续致颤因素可再次触发室颤，每次发作各有一次报警', firstVF === 1 && restoredSinus &&
    toxic.rhythm === 'vf' && toxic.arrests === 2 && toxic.events.filter(event => event.id === 'vf').length === 2,
    `重复发作 ${toxic.arrests} 次，风险在复律时重置`);

  const untreated = E.create(G.generate(2, 43, ['stemi']));
  const revascularized = E.create(untreated.cas);
  for (const bed of [untreated, revascularized]) advance(bed, 60 * 60, true);
  const riskAtHour = untreated._vfRisk;
  E.ACTIONS.pci.apply(revascularized);
  for (const bed of [untreated, revascularized]) advance(bed, 10 * 60, true);
  const stillRising = untreated._vfRisk > riskAtHour && revascularized._vfRisk < riskAtHour;
  for (let minutes = 70; minutes < 150 && untreated.rhythm === 'sinus' && untreated.running; minutes++) advance(untreated, 60, true);
  check('超过一小时的活动性 STEMI 仍能诱发室颤，PCI 后风险回落', stillRising && untreated.rhythm === 'vf' &&
    untreated.t > 60 * 60 && revascularized.rhythm === 'sinus', `首次室颤在第 ${Math.round(untreated.t / 60)} 分钟`);

  const circulation = makeBed();
  circulation.t = 120;
  const volume = circulation.vol;
  circulation.vol = 1;
  E.tick(circulation, 1);
  const firstTransient = circulation.map < 30 && !circulation.death;
  advance(circulation, 30);
  circulation.vol = volume;
  E.tick(circulation, 1);
  const timerCleared = circulation.severeHypotensionSince == null && !circulation.death;
  circulation.vol = 1;
  E.tick(circulation, 1);
  advance(circulation, 59);
  const secondWindow = !circulation.death;
  E.tick(circulation, 1.1);
  check('极低血压从实际发生时计时，恢复后重新计时', firstTransient && timerCleared && secondWindow &&
    circulation.death?.reason === '低血容量性休克失代偿', `复发并持续符合时间条件后的结局 ${circulation.death?.reason}`);
}

{
  const edema = E.create(G.generate(1, 112, ['edema']));
  edema.lungWater = 0.95;
  E.tick(edema, 1);
  const wetDeadSpace = E.effectiveDeadSpace(edema);
  const wetRoomAir = E.roomAirSaturation(edema);
  edema.lungWater = 0.12;
  E.tick(edema, 1);
  const dryDeadSpace = E.effectiveDeadSpace(edema);
  check('肺水消退后死腔回落并改善室内空气氧合', wetDeadSpace > 0.45 && dryDeadSpace === 0.33 &&
    E.roomAirSaturation(edema) > wetRoomAir + 5,
    `Vd/VT ${wetDeadSpace.toFixed(2)} → ${dryDeadSpace.toFixed(2)}`);

  const comorbidity = G.generate(3, 2);
  const mixed = E.create(comorbidity);
  mixed.tags = [...mixed.tags, 'pe'];
  Object.assign(mixed, { lungWater: 0.12, asthmaResistance: 0.85, clot: 0.9 });
  const asthmaLimit = E.effectiveDeadSpace(mixed);
  mixed.asthmaResistance = 0.1;
  const embolismLimit = E.effectiveDeadSpace(mixed);
  mixed.clot = 0.1;
  const chronicLimit = E.effectiveDeadSpace(mixed);
  const legacy = { ...mixed, vdvt: 0.72 };
  delete legacy.deadSpaceModelVersion;
  const restored = Object.assign(E.create(comorbidity), legacy);
  E.restoreCardiorespiratory(restored, legacy);
  const legacyLimit = E.effectiveDeadSpace(restored);
  const current = { ...restored, vdvt: 0.45 };
  const reopened = Object.assign(E.create(comorbidity), current);
  E.restoreCardiorespiratory(reopened, current);
  check('哮喘和肺栓塞改善后保留 COPD 底值，旧档清除肺水峰值', comorbidity.init.vdvt === 0.42 &&
    Math.abs(asthmaLimit - 0.67) < 0.002 && Math.abs(embolismLimit - 0.645) < 0.002 && chronicLimit === 0.42 &&
    legacyLimit === 0.42 && restored.deadSpaceModelVersion === 1 && E.effectiveDeadSpace(reopened) === 0.45,
    `哮喘 ${asthmaLimit.toFixed(2)}，肺栓塞 ${embolismLimit.toFixed(3)}，COPD ${chronicLimit.toFixed(2)}`);
}

const fails = out.filter(x => !x.ok);
const pad = s => s + ' '.repeat(Math.max(0, 26 - s.length));
console.log(pad('断言') + '结果   实测');
console.log('-'.repeat(70));
for (const r of out) console.log(pad(r.name) + (r.ok ? 'PASS  ' : 'FAIL  ') + r.detail);
console.log('-'.repeat(70));
console.log(`${out.length - fails.length}/${out.length} 通过` + (fails.length ? '　⚠ 有修复被改回' : '　✓ 全部保持'));
process.exit(fails.length ? 1 : 0);

