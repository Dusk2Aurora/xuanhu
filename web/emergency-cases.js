/* 主动脉急症与钝性多发伤。病程和术后观察时间均按模拟节奏压缩。 */
(function (root) {
'use strict';

const AORTIC_SURGERY = 'aortic_replacement';
const TEVAR = 'tevar';
const TEVAR_DURATION = 12 * 60;
const TEVAR_STABLE_TIME = 60;
const AORTIC_PERFUSION_GUIDE = '有效循环，MAP ≥65 mmHg，收缩压 90–160 mmHg，心率 50–110 次/分，SpO₂ ≥92%（模拟条件）';
const SPINE_PROTECTION = 'spinal_motion_restriction';
const TRAUMA_HEMOSTASIS = 'trauma_hemostasis';
const FALL_SITE = 'fallTrauma';
const SURGERY_TIME = 10 * 60;
const OBSERVATION_TIME = 20 * 60;
const AORTIC_PRESSURE_LIMIT = 120;
const AORTIC_HR_LIMIT = 80;

const hasTag = (S, tag) => S.tags?.includes(tag);
const hasEvidence = (S, type, field) =>
  S.diagnosticReports?.some(report => report.type === type && report.values?.[field] === 1);

function bilateralPressure(S, pressure) {
  const { sys, dia } = pressure;
  // 主监护为较高侧。分支灌注正常或轻度受累时，双臂压差仍可很小。
  const affected = S.aorticDissectionLoad > 0 ? S.aorticDissectionArm : 0;
  const drop = affected ? Math.round((S.aorticArmPressureBaseline ?? 12) + 15 * S.aorticDissectionLoad) : 3;
  const difference = Math.min(Math.max(0, sys), drop);
  const lower = { sys:sys - difference, dia:Math.max(0, dia - Math.round(difference * 0.5)) };
  const left = affected === 1 ? pressure : lower;
  const right = affected === 1 ? lower : pressure;
  return { rightSys:right.sys, rightDia:right.dia, leftSys:left.sys, leftDia:left.dia, armSysDifference:difference };
}

function aorticBypassIndicated(S) {
  return hasTag(S, 'aorticDissection') && S.aorticDissectionLoad > 0 && S.aorticArchInvolved === true &&
    S.diagnosticReports?.some(report => report.type === 'aorta_cta' &&
      report.values?.ascendingAortaDissection === 1 && report.values.aorticArchInvolvement === 1);
}

function aorticSurgeryStatus(S) {
  if (S.aorticSurgeryCompletedAt != null) return 'complete';
  if (S.aorticSurgeryStartedAt != null) return 'running';
  if (!hasTag(S, 'aorticDissection') || !(S.aorticDissectionLoad > 0)) return 'irrelevant';
  const requiresBypass = aorticBypassIndicated(S);
  const isolatedAscending = S.aorticArchInvolved === false && S.diagnosticReports?.some(report => report.type === 'aorta_cta' &&
    report.values?.ascendingAortaDissection === 1 && report.values.aorticArchInvolvement === 0);
  if (!requiresBypass && !isolatedAscending) return 'unconfirmed';
  return isolatedAscending || root.LIFE?.aorticBypassReady?.(S) ? 'ready' : 'preparation';
}

function tevarCirculation(S) {
  const pressure = root.LIFE.bp(S);
  const stable = root.LIFE.aorticPerfusionStable(S);
  const since = S.tevarStableSince ?? null;
  const elapsed = stable && since != null ? S.t - since : 0;
  const stableSeconds = Math.min(TEVAR_STABLE_TIME, Math.max(0, elapsed));
  return { stable, ready: stableSeconds >= TEVAR_STABLE_TIME - 1e-7, since, stableSeconds,
    stableSecondsRequired:TEVAR_STABLE_TIME, pressure, hr:S.hr, spo2:S.spo2 };
}

function tevarEvidence(S) {
  return S.diagnosticReports?.some(report => report.type === 'aorta_cta' &&
    report.values?.ascendingAortaDissection === 0 && report.values.descendingAortaDissection === 1 &&
    report.values.descendingAortaMalperfusion === 1);
}

function tevarStatus(S) {
  if (S.tevarCompletedAt != null) return 'complete';
  if (S.tevarStartedAt != null) return 'running';
  if (!hasTag(S, 'aorticDissectionB') || !(S.aorticDissectionLoad > 0)) return 'irrelevant';
  if (!tevarEvidence(S)) return 'unconfirmed';
  return tevarCirculation(S).ready ? 'ready' : 'stabilizing';
}

function procedureObservation(S, startedAt, completedAt, duration, name) {
  if (completedAt == null) {
    return startedAt == null ? null : { endsAt:startedAt + duration, reason:name + '进行中' };
  }
  const endsAt = completedAt + OBSERVATION_TIME;
  return S.t < endsAt - 1e-7 ? { endsAt, reason:name + '后观察' } : null;
}

function advanceDissectionLoad(S, minutes, pressure) {
  const impulse = Math.max(0, (pressure.sys - AORTIC_PRESSURE_LIMIT) / 45) +
    Math.max(0, (S.hr - AORTIC_HR_LIMIT) / 45);
  S.aorticDissectionLoad = Math.min(2, S.aorticDissectionLoad + (0.001 + 0.012 * impulse) * minutes);
}

const MEDICATION_HOLD = 'pause_admission_medication';
const SUPPORT_CHECKS = {
  warfarinBleed: ['coag', '需复查凝血功能'],
  dabigatranBleed: ['coag', '需复查凝血酶时间'],
  digoxinTox: ['digoxin_level', '需复查地高辛浓度及心律'],
};

const STANDARD_CARE = {
  warfarinBleed: {
    name:'华法林相关消化道出血', chief:'出现黑便约 1 天',
    history:[
      [1440, '患者自述', '解过少量黑便，未出现呕血或晕厥。'],
      [null, '既往病历与用药记录', '门诊记录长期使用华法林，近期调整过剂量。', 'medications'],
    ],
    init:{ vol:4.48, hb:108, hr:95, lac:1.4, warfarinLoad:0.48, coag:0.72 },
    bleedRate:0.004,
    hint:'暂缓院前华法林，评估出血和 INR，处理出血点。结合 INR 考虑维生素 K₁，出现危及生命的出血时评估紧急逆转。',
    goal:['暂停华法林并复查凝血','控制出血源','确认抗凝效应回落'],
  },
  dabigatranBleed: {
    name:'达比加群相关消化道出血', chief:'出现黑便约 12 小时',
    history:[
      [720, '患者自述', '到院前解过少量黑便，能自行站立，未出现呕血。'],
      [null, '既往病历与用药记录', '门诊处方记载达比加群酯，已超过平时服药间隔。', 'medications'],
    ],
    init:{ vol:4.47, hb:110, hr:92, lac:1.3, cr:94, renalFactor:0.92, dabigatranLoad:0.18, coag:0.89 },
    bleedRate:0.004,
    hint:'先暂缓院前达比加群，控制出血源，复查凝血酶时间及肾功能。若出血危及生命或无法控制，评估特异性逆转。',
    goal:['暂停达比加群并复查凝血','控制出血源','确认抗凝效应回落'],
  },
  digoxinTox: {
    name:'轻型地高辛毒性', chief:'食欲下降、恶心约 12 小时',
    history:[
      [720, '患者自述', '逐渐出现恶心、食欲差，未出现晕厥或心悸。'],
      [null, '既往病历与用药记录', '长期规律服用地高辛，最近进食饮水减少。', 'medications'],
    ],
    init:{ vol:4.30, hr:75, cr:111, bun:8, renalFactor:0.82, k:4.5, digoxinLoad:0.19, lac:1.4 },
    hint:'暂停院前地高辛，复查心电图、血钾、肾功能和血药浓度。出现危险心律失常、休克或严重高钾时评估免疫 Fab。',
    goal:['暂停地高辛并复查','保持心律及血钾稳定'],
  },
  mtxDelayed: {
    name:'甲氨蝶呤延迟清除（低风险）', chief:'恶心、饮水减少约 12 小时',
    history:[
      [2880, '既往病历与用药记录', '约 48 小时前开始高剂量甲氨蝶呤输注，已经开始亚叶酸钙救援。', 'medications'],
      [720, '患者自述', '开始恶心，饮水量较平时减少。'],
      [null, '既往病历与用药记录', '转诊时浓度仍高于预期，肌酐较输注前轻度升高。', 'medications'],
    ],
    init:{ vol:3.98, hr:94, hco3:21, cr:135, bun:8, renalFactor:0.79, k:4.3, lac:1.4,
      mtxLevel:2.0, mtxCellularStress:0.43, mtxHoursAtArrival:48 },
    hint:'继续亚叶酸钙和补液，评估碱化，复查浓度和肾功能。较轻延迟清除可先走标准支持路径。',
    goal:['补液并继续亚叶酸钙救援','复查血药浓度和肾功能'],
  },
  fibrinogenBleed: {},
};

// ACC 口服抗凝出血路径 https://doi.org/10.1016/j.jacc.2020.04.053
// 地高辛中毒共识 https://pmc.ncbi.nlm.nih.gov/articles/PMC10599802/
// HDMTX 延迟清除 https://doi.org/10.1634/theoncologist.2017-0243
function rescueCase(id) {
  return Object.hasOwn(STANDARD_CARE, id);
}

function standardCareVariant(module) {
  const variant = STANDARD_CARE[module.id];
  if (!variant?.init) return null;
  const support = SUPPORT_CHECKS[module.id];
  const chief = variant.chief ?? module.chief;
  return {
    ...module, ...variant, chief,
    init: { ...module.init, ...variant.init, standardRescueCare: true },
    drivers: variant.bleedRate ? { ...module.drivers, bleedRate:variant.bleedRate } : module.drivers,
    check(S, issue = reason => reason) {
      const reasons = module.check(S, issue);
      if (support) {
        if (S.admissionMedicationHeldAt == null) reasons.push('尚未记录暂停相关院前用药');
        if (!S.tests[support[0]]?.done) reasons.push(support[1]);
        if (module.id === 'digoxinTox' && !S.tests.ecg?.done) reasons.push('需复查心电图');
      } else {
        if (!S.tests.methotrexate_level?.done) reasons.push('需复查甲氨蝶呤浓度');
        if (!S.given?.some(order => order.id === 'leucovorin' &&
            (!order.infusionMinutes || root.LIFE?.infusionProgress(S, order)?.deliveredDose > 0))) {
          reasons.push('尚未继续亚叶酸钙救援');
        }
      }
      return reasons;
    },
  };
}

function actions({ setBleedingRate, resolveProcedure }) {
  const replacementName = '升主动脉置换';
  const replacementCost = 4300;
  const tevarName = '胸主动脉腔内修复（TEVAR）';
  const tevarCost = 5600;
  const hemostasisName = '创伤手术止血';
  const hemostasisCost = 1800;
  return {
    [MEDICATION_HOLD]: {
      name:'暂停相关院前用药', cost:0,
      desc:'核对药史后暂缓继续相关用药，并计划复查和后续恢复用药时机。',
      apply(S) {
        if (!S.standardRescueCare || !S.tags?.some(tag => Object.hasOwn(SUPPORT_CHECKS, tag))) {
          S.log.push(['操作', '当前病例无此院前用药暂停医嘱', 'info']);
          return;
        }
        if (S.admissionMedicationHeldAt != null) {
          S.log.push(['操作', '已暂缓相关院前用药', 'info']);
          return;
        }
        S.admissionMedicationHeldAt = S.t;
        S.log.push(['操作', '已暂缓相关院前用药，继续观察疗效与安全性', 'good']);
      },
    },
    [AORTIC_SURGERY]: {
      name: replacementName, cost: replacementCost,
      desc: '主动脉 CTA 证实升主动脉受累后开展急诊置换。本例累及弓部，需先由团队管理体温并维持灌注。',
      apply(S) {
        const status = aorticSurgeryStatus(S);
        if (status === 'complete' || status === 'running') {
          S.log.push(['操作', status === 'running' ? '升主动脉置换正在进行' : '升主动脉置换已完成', 'info']);
          return;
        }
        if (status !== 'ready') {
          const message = status === 'preparation' ? '置换暂缓。请等待团队控温及稳定灌注达标。'
            : '请先取得明确升主动脉及弓部受累情况的主动脉 CTA 报告。';
          S.log.push(['操作', message, 'warn']);
          return;
        }
        if (resolveProcedure && !resolveProcedure(S, AORTIC_SURGERY, replacementName, replacementCost, 0.10, { essential:true }).ok) return;
        S.aorticSurgeryStartedAt = S.t;
        S.log.push(['操作', '心外科已开始升主动脉置换，预计 10 分钟（模拟）', 'good']);
      },
    },
    [TEVAR]: {
      name:tevarName, cost:tevarCost,
      desc:'CTA 确认降主动脉夹层伴分支低灌注后，稳定循环并行胸主动脉腔内修复。',
      apply(S) {
        const status = tevarStatus(S);
        if (status === 'running' || status === 'complete') {
          S.log.push(['操作', status === 'running' ? 'TEVAR 进行中' : 'TEVAR 已完成', 'info']);
          return;
        }
        if (status !== 'ready') {
          const message = status === 'stabilizing' ? 'TEVAR 暂缓。请维持循环及氧合达标并复评。'
            : '请取得支持复杂 B 型夹层的主动脉 CTA 报告，复核介入指征。';
          S.log.push(['操作', message, 'warn']);
          return;
        }
        if (!resolveProcedure(S, TEVAR, tevarName, tevarCost, 0.08, { essential:true }).ok) return;
        S.tevarStartedAt = S.t;
        S.log.push(['操作', '血管团队已开始 TEVAR，预计 12 分钟（模拟）', 'good']);
      },
    },
    [SPINE_PROTECTION]: {
      name: '脊柱运动限制', cost: 40,
      desc: '疑有脊柱损伤时在搬移及复苏中限制异常活动，随后结合体征和影像评估。',
      apply(S) {
        if (S.fallTraumaSpineProtectedAt != null) {
          S.log.push(['操作', '已进行脊柱运动限制', 'info']);
          return;
        }
        S.fallTraumaSpineProtectedAt = S.t;
        S.log.push(['操作', '已进行脊柱运动限制，继续评估和复苏', 'good']);
      },
    },
    [TRAUMA_HEMOSTASIS]: {
      name: hemostasisName, cost: hemostasisCost,
      desc: '严重钝性创伤伴腹腔出血时，由创伤外科控制出血源。持续复苏并复查灌注。',
      apply(S) {
        if (S.fallTraumaHemostasisAt != null) {
          S.log.push(['操作', '创伤出血源已处理', 'info']);
          return;
        }
        if (!(S.bleedingSites?.[FALL_SITE] > 0)) {
          S.log.push(['操作', '未发现需要这项手术的创伤出血源', 'warn']);
          return;
        }
        if (resolveProcedure && !resolveProcedure(S, TRAUMA_HEMOSTASIS, hemostasisName, hemostasisCost, 0.06, { essential:true }).ok) return;
        setBleedingRate(S, FALL_SITE, 0);
        S.fallTraumaHemostasisAt = S.t;
        S.log.push(['操作', '创伤外科已控制腹腔出血，继续复苏及复查', 'good']);
      },
    },
  };
}

// ACC/AHA 2022 主动脉疾病指南，§7.2–7.4。影像、降冲击和手术的逻辑依循指南。
// https://doi.org/10.1161/CIR.0000000000001106
// EACTS/STS 2024 主动脉指南 https://doi.org/10.1093/ejcts/ezad426
const aorticDissection = {
  id:'aorticDissection', name:'急性 Stanford A 型主动脉夹层', tag:'aorticDissection',
  since:6, weight:0.50, minDifficulty:2, standalone:true, ageRange:[43, 79],
  comorbidities:['高血压'],
  init:{ vol:4.50, hr:103, sv:71, svr:23.5, svrDrive:8, hrDrive:20, lac:1.5, gcs:15,
    aorticDissectionLoad:0.62, aorticArchInvolved:true },
  personalize(init, rnd) {
    const branch = rnd();
    // -1 为左侧，1 为右侧，0 为没有明显上肢分支受累。
    init.aorticDissectionArm = branch < 0.24 ? 0 : branch < 0.62 ? -1 : 1;
    init.aorticArmPressureBaseline = Math.round(6 + 15 * rnd());
  },
  history:[
    [45, '患者自述', '胸痛突然发作，开始时已很剧烈，随后向两肩胛之间放射。'],
    [20, '院前交接', '转运中仍诉胸背痛，起病后疼痛持续。'],
    [null, '既往病历与用药记录', '既往有高血压，近期常漏服降压药。', 'medications'],
  ],
  goal:['确认升主动脉和弓部受累','团队控温并连续维持灌注后完成急诊置换','术后受控复温及监测（模拟 20 分钟）'],
  hint:'突发剧烈胸背痛需警惕夹层。复测双臂血压并尽快做主动脉 CTA。压差很小时也需结合症状评估。',
  check(S, issue = reason => reason) {
    if (S.aorticSurgeryCompletedAt == null) {
      return [issue(S.aorticSurgeryStartedAt == null ? '升主动脉夹层尚未修复' : '升主动脉置换进行中')];
    }
    return this.observation(S) ? ['升主动脉置换后观察未满 20 分钟（模拟）'] : [];
  },
  observation(S) {
    return procedureObservation(S, S.aorticSurgeryStartedAt, S.aorticSurgeryCompletedAt, SURGERY_TIME, '升主动脉置换');
  },
  advance(S, minutes, E) {
    if (S.aorticSurgeryCompletedAt != null) return;
    const endsAt = S.aorticSurgeryStartedAt == null ? null : S.aorticSurgeryStartedAt + SURGERY_TIME;
    if (endsAt != null && S.t >= endsAt - 1e-7) {
      S.aorticSurgeryCompletedAt = endsAt;
      S.aorticDissectionLoad = 0;
      S.svrDrive = 0;
      S.hrDrive = 0;
      S.tamponade = 0;
      S.contractility = 0.92;
      S.lactProd = 0.015;
      S.log.push([E.fmt(S.t), '升主动脉置换完成，进入术后观察', 'good', S.t]);
      return;
    }
    const pressure = E.bp(S);
    advanceDissectionLoad(S, minutes, pressure);
    S.tamponade = Math.min(1, Math.max(0, (S.aorticDissectionLoad - 0.93) * 1.50));
    if (S.aorticDissectionLoad > 1.1) {
      S.contractility = Math.max(0.32, 0.92 - 0.67 * (S.aorticDissectionLoad - 1.1));
    }
    S.lactProd = pressure.map < 65 ? 0.047 : 0.015;
  },
};

// ACC/AHA §7.4.2 与 EACTS/STS 2024 §8.2。模拟固定为伴下肢灌注不良且解剖适合介入的复杂 B 型。
const aorticDissectionB = {
  id:'aorticDissectionB', name:'复杂 Stanford B 型主动脉夹层', tag:'aorticDissectionB',
  since:6, weight:0.40, minDifficulty:2, standalone:true, ageRange:[43, 79],
  comorbidities:['高血压'],
  init:{ vol:4.47, hr:103, sv:68, svr:21, svrDrive:7, hrDrive:18, lac:2.9, hco3:22,
    aorticDissectionLoad:0.72, aorticLegMalperfusion:0.62 },
  history:[
    [60, '患者自述', '背部突然剧痛，之后右腿发凉、发麻。'],
    [20, '院前交接', '右足比左足凉。转运途中背痛持续。'],
    [null, '既往病历与用药记录', '既往诊断高血压，近期血压控制不理想。', 'medications'],
  ],
  goal:['明确降主动脉夹层伴远端低灌注','稳定循环后完成 TEVAR','介入后复查灌注并观察（模拟 20 分钟）'],
  hint:'突发背痛伴单侧下肢发凉时评估末梢灌注，尽快完成主动脉 CTA，复查血压和心率。',
  check(S, issue = reason => reason) {
    if (S.tevarCompletedAt == null) {
      return [issue(S.tevarStartedAt == null ? '降主动脉夹层伴低灌注尚未处理' : 'TEVAR 进行中')];
    }
    return this.observation(S) ? ['TEVAR 后观察未满 20 分钟（模拟）'] : [];
  },
  observation(S) {
    return procedureObservation(S, S.tevarStartedAt, S.tevarCompletedAt, TEVAR_DURATION, 'TEVAR');
  },
  advance(S, minutes, E) {
    if (S.tevarCompletedAt != null) return;
    if (S.tevarStartedAt != null && S.t >= S.tevarStartedAt + TEVAR_DURATION - 1e-7) {
      S.tevarCompletedAt = S.tevarStartedAt + TEVAR_DURATION;
      S.aorticDissectionLoad = 0;
      S.aorticLegMalperfusion = 0;
      S.svrDrive = 0;
      S.hrDrive = 0;
      S.lactProd = 0.015;
      S.contractility = 0.92;
      S.log.push([E.fmt(S.t), 'TEVAR 完成，复查下肢灌注并继续观察', 'good', S.t]);
      return;
    }
    S.tevarStableSince = E.aorticPerfusionStable(S) ? (S.tevarStableSince ?? S.t) : null;
    advanceDissectionLoad(S, minutes, E.bp(S));
    S.aorticLegMalperfusion = Math.min(1, 0.62 + 0.55 * (S.aorticDissectionLoad - 0.72));
    S.lactProd = 0.015 + S.aorticLegMalperfusion * 0.045;
    if (S.aorticDissectionLoad > 1.20) {
      S.contractility = Math.max(0.34, 0.92 - 0.76 * (S.aorticDissectionLoad - 1.20));
    }
  },
};

// NICE NG39，§1.4–1.6。先处理威胁生命的胸伤和出血，稳定后以 CT 评估多处损伤。
// https://www.nice.org.uk/guidance/ng39/chapter/Recommendations
const fallTrauma = {
  id:FALL_SITE, name:'高处坠落伤 / 胸腹多发伤', tag:FALL_SITE, bleedingSite:FALL_SITE,
  since:6, weight:0.9, minDifficulty:2, standalone:true, ageRange:[19, 75],
  init:{ vol:3.90, hb:88, hr:130, sv:54, svr:21, rr:31, pao2:60, paco2:33, spo2:86,
    gcs:13, lac:3.4, hco3:21, tensionPTX:0.55, pvr:5.1, coag:0.84 },
  drivers:{ bleedRate:0.029 },
  history:[
    [35, '现场人员转述', '目击患者从高处意外坠落，随后无法自行起身。'],
    [25, '院前交接', '转运前见左侧胸廓起伏较弱，患者气促、面色苍白，诉左胸和左上腹疼痛。'],
    [20, '院前交接', '患者诉颈背痛，意识尚可，搬运后持续观察呼吸和循环。'],
  ],
  goal:['稳定呼吸和循环，控制腹腔出血','评估多处损伤并记录脊柱保护','止血后观察（模拟 20 分钟）'],
  hint:'坠落后气促和循环恶化需先处理。维持脊柱保护，及时控制胸腹部的致命损伤，情况允许时再完成创伤 CT。',
  check(S, issue = reason => reason) {
    const reasons = [];
    if (S.tensionPTX > 0 || !S.chestTubePlaced) reasons.push(issue('创伤性气胸尚未完成胸腔闭式引流'));
    if (S.bleedingSites[FALL_SITE] > 0) reasons.push(issue('创伤性腹腔出血尚未控制'));
    if (S.hb < 80) reasons.push(issue('创伤失血后血红蛋白尚未恢复到游戏目标', S.hb < 60));
    if (S.fallTraumaSpineProtectedAt == null) reasons.push('创伤接诊尚未记录脊柱运动限制');
    if (!S.diagnosticReports?.some(report => report.type === 'trauma_ct')) reasons.push('需完成创伤 CT 评估其余损伤');
    if (this.observation(S)) reasons.push('创伤止血后观察未满 20 分钟（模拟）');
    return reasons;
  },
  observation(S) {
    if (S.fallTraumaHemostasisAt == null) return null;
    const endsAt = S.fallTraumaHemostasisAt + OBSERVATION_TIME;
    return S.t < endsAt - 1e-7 ? { endsAt, reason:'创伤止血后观察' } : null;
  },
  advance(S, minutes) {
    S.tensionPTX = S.chestTubePlaced ? 0 : Math.min(1, S.tensionPTX + 0.0035 * minutes);
    S.pvr = 1.8 + 6 * S.tensionPTX;
  },
};

const API = {
  modules:[aorticDissection, aorticDissectionB, fallTrauma], actions, bilateralPressure, hasEvidence, aorticSurgeryStatus,
  aorticBypassIndicated, tevarStatus, tevarCirculation, tevarEvidence, TEVAR, TEVAR_DURATION, AORTIC_PERFUSION_GUIDE,
  AORTIC_SURGERY, SPINE_PROTECTION, TRAUMA_HEMOSTASIS, FALL_SITE, AORTIC_PRESSURE_LIMIT, AORTIC_HR_LIMIT,
  MEDICATION_HOLD, rescueCase, standardCareVariant,
};
if (typeof module !== 'undefined' && module.exports) module.exports = API;
root.EMERGENCY_CASES = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
