/* 药物相互作用的 PK 时程回归测试 */
require('../prototype/substances.js');
require('../prototype/mentor.js');
const CASEGEN = require('../prototype/generator.js');
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

/* 相互作用随浓度减弱，清除后再次合用会开始新一段累计暴露。 */
{
  const spec = { id: 'interaction-reexposure', init: { ...CASEGEN.BASE } };
  const both = E.create(spec), captoprilOnly = E.create(spec);
  const doseBoth = () => {
    E.give(both, 'captopril', 25);
    E.give(both, 'ibuprofen', 400);
  };
  const advance = minutes => {
    for (let i = 0; i < minutes; i++) {
      E.tick(both, 60);
      E.tick(captoprilOnly, 60);
    }
  };
  doseBoth();
  E.give(captoprilOnly, 'captopril', 25);
  const [{ onset, dur }] = both.pk;
  advance(100);
  const firstKidneyEffect = 1 - both.renalFactor;
  const fullToneEffect = both.mod.svr - captoprilOnly.mod.svr;
  const tailMinute = Math.ceil(onset * 0.35 + dur + 2 * dur / 4.5);
  advance(tailMinute - 100);
  const tailToneEffect = both.mod.svr - captoprilOnly.mod.svr;
  advance(Math.ceil(dur * 1.8) + 1 - tailMinute);
  const afterClearance = both.renalFactor;
  ok('合用体征效应跟随当前浓度，清除后归零', fullToneEffect > 0.3 &&
    tailToneEffect > 0.05 && tailToneEffect < 0.1 && both.mod.svr === captoprilOnly.mod.svr);
  doseBoth();
  advance(100);
  ok('持续共存时累积封顶，清除后重新合用可再次损伤肾清除',
    firstKidneyEffect > 0.08 && afterClearance > 1 - firstKidneyEffect - 0.02 &&
    Math.abs(1 - both.renalFactor / afterClearance - firstKidneyEffect) < 0.01);
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

// 开泵和普通给药共用相互作用提示；未输入即停泵不会产生暴露。
for (const [pump, other] of [['norepi', 'chlorpromazine'], ['heparin', 'aspirin']]) {
  for (const pumpFirst of [true, false]) {
    const S = E.create('hyperkalemia');
    const start = () => E.give(S, pump, undefined, '持续静脉泵入');
    if (pumpFirst) start();
    E.give(S, other);
    if (!pumpFirst) start();
    E.give(S, other);
    ok(pump + ' 两种开单顺序各提示一次', S.log.filter(l => l[1].includes('相互作用')).length === 1);
  }
  const S = E.create('hyperkalemia');
  E.give(S, pump, undefined, '持续静脉泵入');
  E.stopPump(S, pump);
  E.give(S, other);
  ok(pump + ' 未输入即停泵无提示', !S.log.some(l => l[1].includes('相互作用')));
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

/* 停掉同一时刻的其中一笔胰岛素医嘱，保存另一笔的完整输注。 */
{
  const spec = { id: 'infusion-stop-test', init: { ...CASEGEN.BASE } };
  const S = E.create(spec);
  E.give(S, 'insulin', 2, '泵入');
  E.give(S, 'insulin', 2, '泵入');
  const [first, second] = S.pk;
  const charges = [S.cost, S.drugCost, S.given[1].cost];
  for (let i = 0; i < 30; i++) E.tick(S, 60);
  const activity = E.insulinActivity(S);
  const otherBed = E.create(spec);
  E.give(otherBed, 'insulin', 2, '泵入');
  ok('只允许停当前床位的实际医嘱', !E.stopInfusion(otherBed, second) && !E.stopInfusion(S, { ...second }));
  ok('停泵即刻保留胰岛素药效和已计费用',
    E.stopInfusion(S, second) && !E.stopInfusion(S, second) &&
    E.insulinActivity(S) === activity && E.infusionProgress(S, first).running &&
    [S.cost, S.drugCost, S.given[1].cost].every((amount, i) => amount === charges[i]));
  const stop = S.log.filter(([, line]) => line.startsWith('停止泵入 胰岛素'));
  ok('同名医嘱按条停用并记录停泵时刻和已输量',
    S.given[0].stoppedAt == null && S.given[1].stoppedAt === 1800 &&
    stop.length === 1 && stop[0][1] === '停止泵入 胰岛素（医嘱 #2，已输 1 / 2 U）' &&
    stop[0][3] === 1800 && stop[0][5] === true);
  const restored = { ...JSON.parse(JSON.stringify(S)), cas: S.cas };
  for (let i = 0; i < 31; i++) E.tick(restored, 60);
  const completed = E.infusionProgress(restored, restored.given[0]);
  const stopped = E.infusionProgress(restored, restored.given[1]);
  const completeActivity = 0.2 * (90 / 60) * (1 - Math.exp(-60 / 90)) * Math.exp(-1 / 90);
  const stoppedActivity = activity / 2 * Math.exp(-31 / 90);
  ok('半程停泵存档重载后剂量维持在 1 U，只有另一条医嘱自动完成',
    !stopped.running && stopped.elapsedMinutes === 30 && stopped.remainingMinutes === 0 && stopped.deliveredDose === 1 &&
    !completed.running && completed.deliveredDose === 2 && !E.stopInfusion(restored, restored.pk[0]) &&
    restored.log.filter(([, line]) => line.includes('胰岛素 泵入完成')).length === 1 &&
    Math.abs(E.insulinActivity(restored) - completeActivity - stoppedActivity) < 1e-9);
}

/* 旧版相同时间、剂量的输注没有给药记录索引，也能单独停用。 */
{
  const S = E.create({ id: 'legacy-infusion-stop-test', init: { ...CASEGEN.BASE } });
  E.give(S, 'insulin', 2, '泵入');
  E.give(S, 'insulin', 2, '泵入');
  for (const order of S.pk) delete order.givenIndex;
  const [first, second] = S.pk;
  ok('开单即停的旧医嘱留下零剂量记录',
    E.stopInfusion(S, second) && S.given[0].stoppedAt == null && S.given[1].stoppedAt === 0 &&
    E.infusionProgress(S, second).deliveredDose === 0 && E.infusionProgress(S, first).running);
}

/* 普通补液和红细胞共享模拟时钟；停止其中一项不影响另一项或存档续输。 */
{
  const spec = { id: 'fluid-blood-infusion-test', init: { ...CASEGEN.BASE } };
  const S = E.create(spec);
  const [volume, redCells] = [S.vol, S.rbcMass];
  E.give(S, 'nacl', 500);
  E.give(S, 'c_rbc', 1);
  const [fluid, blood] = S.pk;
  ok('补液、输血开单时体液与红细胞质量未改变', S.vol === volume && S.rbcMass === redCells &&
    fluid.infusionMinutes === 15 && blood.infusionMinutes === 10);
  for (let minute = 0; minute < 5; minute++) E.tick(S, 60);
  const partialMass = S.rbcMass;
  ok('输注中分段进入体液和红细胞，红细胞只输了一半', S.vol > volume &&
    partialMass > redCells && partialMass < redCells + 10 * volume && E.infusionProgress(S, blood).deliveredDose === 0.5);
  E.stopInfusion(S, blood);
  const restored = JSON.parse(JSON.stringify({ ...S, cas: undefined }));
  restored.cas = spec;
  E.restorePatient(restored);
  for (let minute = 0; minute < 11; minute++) E.tick(restored, 60);
  ok('读档后的输液正常完成，已停红细胞不追加并保持已输量', restored.rbcMass === partialMass &&
    E.infusionProgress(restored, restored.given[0]).deliveredDose === 500 &&
    E.infusionProgress(restored, restored.given[1]).deliveredDose === 0.5 &&
    restored.log.filter(([, line]) => line.includes('静滴完成')).length === 1 &&
    !restored.log.some(([, line]) => line.includes('输血完成') || line.includes('输注完成')));
}

/* 无物质目录时，旧医嘱也会输到停止为止。已结算的旧存档不会重开医嘱。 */
{
  const catalog = globalThis.SUBSTANCES;
  const spec = { id: 'legacy-fluid-infusion-test', init: { ...CASEGEN.BASE } };
  try {
    delete globalThis.SUBSTANCES;
    const S = E.create(spec);
    const before = [S.vol, S.cl];
    E.give(S, 'saline', 500);
    const [order] = S.pk;
    ok('旧版补液也按容量登记输注且开单无瞬时效应', order.infusionMinutes === 15 &&
      S.vol === before[0] && S.cl === before[1]);
    E.tick(S, 60);
    ok('旧版补液推进后增加体液和氯，停用写入实际已输量',
      S.vol > before[0] && S.cl > before[1] && E.stopInfusion(S, order) &&
      E.infusionProgress(S, S.given[0]).deliveredDose === 500 / 15);
    const old = E.create(spec);
    old.rbcMass += 50;
    old.given.push({ id: 'prbc', n: '浓缩红细胞', d: 1, unit: 'U', route: '输血', t: 0 });
    const settledMass = old.rbcMass;
    E.restorePatient(old);
    E.tick(old, 60);
    ok('旧版已结算的输血读档后不重复输注', old.rbcMass === settledMass && old.pk.length === 0);
  } finally {
    globalThis.SUBSTANCES = catalog;
  }
}

/* 快速碱化按静推实际剂量起效，普通静滴由输注段推进。 */
{
  const spec = { id: 'bicarbonate-delivery-test', init: { ...CASEGEN.BASE, tca: 0.5 } };
  const slow = E.create(spec);
  const fast = E.create(spec);
  const start = slow.tca;
  E.give(slow, 'bicarb', 150, '静滴');
  E.give(fast, 'bicarb', 75, '静推');
  ok('碳酸氢钠静推按实际剂量立即起效，静滴等待送药', slow.tca === start &&
    Math.abs(start - fast.tca - 0.06) < 1e-9 && E.infusionProgress(slow, slow.pk[0]).running);
}

/* 解毒剂应用已输的实际剂量，以标准剂量为效应标尺。 */
{
  const spec = { id: 'nac-delivery-test', init: { ...CASEGEN.BASE } };
  const S = E.create(spec);
  S.tox.apap = 600;
  E.give(S, 'nacetylcysteine', 15);
  const [order] = S.pk;
  ok('小剂量解毒剂开单时药效仍为零', S.tox.apap === 600 && E.infusedDrugActivity(S, order.id) === 0);
  for (let minute = 0; minute < order.infusionMinutes; minute++) E.tick(S, 60);
  ok('十分之一参考量的解毒剂只清除小部分负荷',
    Math.abs(S.tox.apap - 540) < 1e-9 && E.infusedDrugActivity(S, order.id) < 0.2);
}

for (const [condition, drug, hint, standardRescueCare = false] of [
  ['apap', 'nacetylcysteine', 'nac'], ['organophosphate', 'pralidoxime', 'pra'], ['warfarinBleed', 'pcc4', 'reversal'],
  ['dabigatranBleed', 'idarucizumab', 'reversal'], ['digoxinTox', 'digoxinFab', 'fab'],
  ['mtxDelayed', 'glucarpidase', 'rescue'], ['mtxDelayed', 'leucovorin', 'support', true],
  ['fibrinogenBleed', 'cryoprecipitate', 'replace'], ['fibrinogenBleed', 'fibrinogenConcentrate', 'replace'],
  ['pe', 'alteplase', 'anti'],
]) {
  const S = E.create(CASEGEN.generate(2, 101, [condition]));
  S.standardRescueCare = standardRescueCare;
  const hasHint = () => MENTOR.hints(S).some(entry => entry.id === hint);
  const before = hasHint();
  E.give(S, drug);
  E.stopInfusion(S, S.pk.at(-1));
  E.tick(S, 1);
  const atZeroDose = hasHint();
  E.give(S, drug);
  E.tick(S, 1);
  ok(`${drug} 在取消零剂量医嘱后保留导师提示，实际输注后撤下提示`, before && atZeroDose && !hasHint());
}

/* 持续泵入沿模拟时钟生效，调速和停泵沿用当时的药物浓度。 */
for (const [id, rate, unit, halfLife] of [
  ['dobutamine', 5, 'μg/kg/min', 2], ['isoproterenol', 1, 'μg/min', 3],
  ['vasopressin', 0.03, 'U/min', 5],
]) {
  const S = E.create('dka');
  const otherBed = E.create('dka');
  const sub = globalThis.SUBSTANCES.byId(id);
  ok(`${sub.n} 默认持续静脉泵入，开泵时没有瞬时药效`,
    E.give(S, id, undefined, '静推') == null &&
    [0, -1, NaN, Infinity].every(invalid => E.give(S, id, invalid) == null) &&
    E.give(S, id) === rate && E.pumpEffect(S, id) === 0 &&
    S.given[0].route === '持续静脉泵入' &&
    S.log[0][1] === `开始持续静脉泵入 ${sub.n}（${rate} ${unit}）`);
  const cost = S.cost;
  ok(`${sub.n} 重复同速医嘱不叠加，也不影响其他床位`,
    E.give(S, id, rate) == null && E.pumpRate(S, id) === rate && E.pumpRate(otherBed, id) === 0 &&
    S.cost === cost && S.given.length === 1 && S.pk.length === 0 &&
    E.dischargeCheck(S).reasons.some(reason => reason.includes(`泵入${sub.n}`)));
  for (let i = 0; i < 40; i++) E.tick(S, 60);
  const effect = E.pumpEffect(S, id);
  const costBeforeAdjust = S.cost;
  ok(`${sub.n} 连续泵入超过既往单次疗程后仍生效`, S.t === 2400 &&
    effect > 0.99 && Object.entries(sub.eff).every(([key, value]) =>
      Math.abs(S.mod[key] - S.modBase[key] - value * effect) < 1e-9));

  const restored = { ...JSON.parse(JSON.stringify(S)), cas: S.cas };
  ok(`${sub.n} 存档续接原泵速和药效，调速没有瞬时跳变`,
    E.pumpRate(restored, id) === rate && E.pumpEffect(restored, id) === effect &&
    E.give(restored, id, rate / 2) === rate / 2 && E.pumpEffect(restored, id) === effect &&
    E.pumpRate(restored, id) === rate / 2 && restored.cost === costBeforeAdjust);
  E.tick(restored, halfLife * 60);
  const adjusted = E.pumpEffect(restored, id);
  ok(`${sub.n} 降低泵速后药效逐渐减弱`, adjusted < effect && adjusted > 0.57);
  ok(`${sub.n} 停泵记录实际速率，出院评估识别泵已停`,
    E.stopPump(restored, id) === rate / 2 && E.pumpRate(restored, id) === 0 &&
    E.stopPump(restored, id) == null && E.pumpEffect(restored, id) === adjusted &&
    !E.dischargeCheck(restored).reasons.some(reason => reason.includes(`泵入${sub.n}`)));
  E.tick(restored, halfLife * 60);
  const concentration = effect => 3 * effect / (4 - effect);
  ok(`${sub.n} 停泵一个半衰期后浓度减半`,
    Math.abs(concentration(E.pumpEffect(restored, id)) - concentration(adjusted) / 2) < 1e-9);
  const shared = SHARE.parse(SHARE.make(restored));
  const orders = shared.data?.a || [];
  ok(`${sub.n} 会诊码保留开始、改速与停泵`, shared.ok && orders.length === 3 &&
    orders.every((order, i) => order[4]?.pumpAction === ['start', 'adjust', 'stop'][i] && order[4].unit === unit) &&
    orders[2][3] === rate / 2);
  const residual = E.pumpEffect(restored, id);
  ok(`${sub.n} 重新开泵时延续停泵后的残余浓度`,
    E.give(restored, id) === rate && E.pumpEffect(restored, id) === residual);
}

{
  const spec = { id: 'dopamine-diuresis-test', init: { ...CASEGEN.BASE } };
  const S = E.create(spec);
  const control = E.create(spec);
  E.give(S, 'dopamine');
  ok('多巴胺持续泵纳入循环支持，并在开泵时没有瞬时利尿',
    E.activeCirculationSupport(S).running.includes('dopamine') && S.uo === control.uo);
  for (let minute = 0; minute < 5; minute++) {
    E.tick(S, 60);
    E.tick(control, 60);
  }
  const infusedDifference = S.uo - control.uo;
  E.stopPump(S, 'dopamine');
  for (let minute = 0; minute < 12; minute++) {
    E.tick(S, 60);
    E.tick(control, 60);
  }
  ok('多巴胺随泵入增加尿量，停泵后药效随残余浓度减弱',
    infusedDifference > 0.3 && S.uo - control.uo < infusedDifference / 2);
}

{
  const S = E.create({ id: 'finish-pumps-test', init: { ...CASEGEN.BASE } });
  for (const id of ['dopamine', 'nitroprusside', 'norepi']) E.give(S, id);
  E.give(S, 'heparin', 1200, '持续静脉泵入');
  E.tick(S, 5);
  E.stopPump(S, 'norepi');
  E.pausePump(S, 'heparin');
  const { cost, drugCost } = S;
  const heparin = E.pumpDelivery(S, 'heparin');
  E.endCase(S, 'death', '结案测试');
  E.finishPumps(S);
  const stops = S.given.filter(order => order.pumpAction === 'stop').map(order => order.id);
  ok('结案关闭运行和暂停的给药泵，已停的泵只记一次',
    !S.running && stops.length === 4 && new Set(stops).size === 4 &&
    Object.values(S.pumps).every(pump => !pump.rate && !pump.pausedRate));
  ok('结案保留已输时段，清理泵路不重复计费',
    S.cost === cost && S.drugCost === drugCost && E.pumpDelivery(S, 'heparin') === heparin && heparin.seconds === 5);
}

{
  const S = E.create({ id: 'nitroprusside-discharge-test', init: { ...CASEGEN.BASE } });
  E.give(S, 'nitroprusside');
  const running = E.dischargeCheck(S);
  E.stopPump(S, 'nitroprusside');
  const stopped = E.dischargeCheck(S);
  ok('硝普钠输注时需评估停泵后血压，不触发升压药留观', !running.ok &&
    running.majorReasons.some(reason => reason.includes('硝普钠')) && !running.circulationObservation && stopped.ok);
}

/* 血管加压素和其他循环支持泵共用撤除支持后的观察窗口。 */
{
  const S = E.create({ id: 'vasopressin-test', init: { ...CASEGEN.BASE } });
  const observe = () => E.dischargeCheck(S).circulationObservation;
  E.give(S, 'norepi');
  E.give(S, 'vasopressin', 0.03, '泵入');
  E.stopPump(S, 'norepi');
  ok('仅剩血管加压素仍不符合出院条件', !E.dischargeCheck(S).ok &&
    observe()?.phase === 'active' && observe().reason.includes('血管加压素'));
  E.stopPump(S, 'vasopressin');
  const justStopped = observe();
  for (let i = 0; i < 14; i++) E.tick(S, 60);
  E.tick(S, 59);
  const oneSecondLeft = !E.dischargeCheck(S).ok && observe()?.remainingSeconds === 1;
  E.tick(S, 1);
  ok('停完循环支持泵后稳定满 15 分钟方可出院', justStopped?.remainingSeconds === 900 &&
    oneSecondLeft && observe()?.phase === 'complete' && E.dischargeCheck(S).ok);
}

/* 尼卡地平走降压泵路径，并影响高血压病例的床旁血管张力。 */
{
  const spec = CASEGEN.generate(2, 101, ['htnEmergency']);
  const S = E.create(spec);
  const control = E.create(spec);
  const sub = SUBSTANCES.byId('nicardipine');
  const startMap = E.bp(S).map;
  ok('尼卡地平仅按合法静脉泵速开泵，带教识别高血压急症用药',
    E.give(S, sub.id, 5, '静推') == null && E.give(S, sub.id, 15.1) == null &&
    E.give(S, sub.id) === 5 && S.given[0].unit === 'mg/h' && E.pumpEffect(S, sub.id) === 0 &&
    MENTOR.evaluate(S, 'drug', sub.id).ok);
  for (let i = 0; i < 75; i++) {
    for (const state of [S, control]) {
      E.tick(state, 60);
      CASEGEN.step(state, 60, E);
    }
    if (i === 59) ok('尼卡地平起始泵速在第一小时逐步降压',
      E.bp(S).map < E.bp(control).map && E.bp(S).map >= startMap * 0.75 &&
      S.eff.norepi === 0 && S.mod.svr < 0);
  }
  const check = E.dischargeCheck(S);
  ok('尼卡地平持续控制血管张力，用泵时暂缓出院',
    CASEGEN.vascularTone(S).controlled && !CASEGEN.vascularTone(control).controlled &&
    check.reasons.some(reason => reason.includes('仍在持续静脉泵入尼卡地平')) &&
    !check.circulationObservation);
  ok('尼卡地平调速可到 15 mg/h，停泵后药效逐渐消退且无升压观察条件',
    E.give(S, sub.id, 15, sub.route) === 15 &&
    E.give(S, sub.id, 16, sub.route) == null && E.pumpRate(S, sub.id) === 15 &&
    E.stopPump(S, sub.id) === 15 && E.pumpEffect(S, sub.id) > 0 &&
    !E.dischargeCheck(S).circulationObservation);
}

/* 左乙拉西坦走定时静滴路径，止惊在输注过程中逐步起效。 */
{
  const spec = CASEGEN.generate(2, 101, ['seizure']);
  const S = E.create(spec);
  const control = E.create(spec);
  const id = 'levetiracetam';
  ok('左乙拉西坦仅按合法静滴剂量给药，带教优先提示一线止惊',
    E.give(S, id, 2000, '静推') == null && E.give(S, id, 3001) == null &&
    [0, -1, NaN].every(dose => E.give(S, id, dose) == null) && S.given.length === 0 &&
    !MENTOR.evaluate(S, 'drug', id).ok);
  for (const state of [S, control]) E.give(state, 'diazepam', 10);
  ok('一线止惊后仍抽搐，左乙拉西坦开始静滴且无瞬时止惊',
    MENTOR.hints(S).some(hint => hint.id === id) && MENTOR.evaluate(S, 'drug', id).ok &&
    E.give(S, id) === 2000 && S.seizure === control.seizure &&
    S.log[1][1] === '开始静滴 左乙拉西坦（总量 2000 mg，输注 15 分钟）');
  for (let i = 0; i < 14; i++) {
    for (const state of [S, control]) {
      E.tick(state, 60);
      CASEGEN.step(state, 60, E);
    }
    if (i === 0) ok('静滴初期仍可观察到抽搐', S.seizure < control.seizure &&
      E.convulsionSigns(S) && S.mod.gcs < control.mod.gcs);
  }
  const restored = { ...JSON.parse(JSON.stringify(S)), cas: S.cas };
  E.tick(restored, 60);
  CASEGEN.step(restored, 60, E);
  E.tick(restored, 60);
  const completion = restored.log.filter(([, line]) => line.includes('左乙拉西坦 静滴完成'));
  const order = SHARE.parse(SHARE.make(restored)).data?.a.find(([, , drug]) => drug === id);
  ok('左乙拉西坦静滴止惊，存档续接准确记录完成时点和会诊途径',
    !E.convulsionSigns(restored) && E.convulsionSigns(control) &&
    completion.length === 1 && completion[0][3] === 900 &&
    order?.[3] === 2000 && order[4]?.minutes === 15 && order[4]?.unit === 'mg' && order[4]?.route === '静滴');
}

/* 左乙拉西坦提前停用后，已输入的药量仍按延迟时间起效和衰减。 */
{
  const S = E.create({ id: 'seizure-infusion-stop-test', init: { ...CASEGEN.BASE, seizure: 0.9 } });
  E.give(S, 'levetiracetam');
  const [order] = S.pk;
  E.tick(S, 60);
  E.tick(S, 60);
  const seizureBeforeStop = S.seizure;
  ok('提前停止左乙拉西坦只记录部分剂量和需要显示的静滴途径',
    E.stopInfusion(S, order) && S.seizure === seizureBeforeStop &&
    S.log.at(-1)[1] === '停止静滴 左乙拉西坦（医嘱 #1，已输 266.667 / 2000 mg）');
  E.tick(S, 60);
  const gcsEffect = S.mod.gcs - S.modBase.gcs;
  const seizureAfterLag = S.seizure;
  for (let i = 0; i < 15; i++) E.tick(S, 60);
  ok('左乙拉西坦只应用已送达的止惊剂量，既有意识效应逐渐减退',
    seizureAfterLag < seizureBeforeStop && Math.abs(S.seizure - (0.9 - 0.65 * (2 / 15))) < 1e-9 &&
    gcsEffect < 0 && S.mod.gcs - S.modBase.gcs > gcsEffect &&
    !S.log.some(([, line]) => line.includes('静滴完成')));
}

/* 旧版血管加压素泵入医嘱仍按原定时程结束。 */
{
  const S = E.create({ id: 'vasopressin-test', init: { ...CASEGEN.BASE } });
  const order = { id: 'vasopressin', n: '血管加压素', route: '泵入', t: 187, onset: 2,
                  dur: 20, eff: { svr: 4, hr: 2 }, scale: 1 };
  const saved = { t: 187, pk: [order] };
  Object.assign(S, saved);
  E.restoreDischargeObservation(S, saved);
  for (let i = 0; i < 10; i++) E.tick(S, 60);
  const legacy = E.dischargeCheck(S).circulationObservation;
  const legacyEffect = S.mod.svr;
  for (let i = 0; i < 27; i++) E.tick(S, 60);
  ok('旧版血管加压素记录维持药效并自动结束，无需手动停泵',
    legacy?.phase === 'legacy' && legacy.remainingSeconds === 1560 && legacyEffect === 4 &&
    E.pumpRate(S, 'vasopressin') === 0 && S.pk.length === 0 && S.mod.svr === 0 &&
    E.dischargeCheck(S).circulationObservation?.phase === 'observing');
}

/* 既有静推存档走原 PK 时程，到期清除。 */
{
  const S = E.create('dka');
  const { id, n, eff } = globalThis.SUBSTANCES.byId('dobutamine');
  S.pk.push({ id, n, route: '静推', t: 0, dur: 20, onset: 3, eff, scale: 1 });
  delete S.pumps;
  for (let i = 0; i < 10; i++) E.tick(S, 60);
  const legacyEffect = S.mod.sv;
  for (let i = 0; i < 27; i++) E.tick(S, 60);
  ok('旧版多巴酚丁胺保留暂时药效，到期清除', legacyEffect === 16 &&
    E.pumpRate(S, id) === 0 && S.pk.length === 0 && S.mod.sv === 0);
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
