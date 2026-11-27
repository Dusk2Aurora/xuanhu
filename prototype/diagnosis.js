/* =========================================================================
 * 诊断分类器 · diagnosis.js
 * 用途：从当前生理状态反推临床诊断标签，供行医手册与界面提示使用。
 * 接口：window.DIAGNOSIS.classify(S) -> {
 *         primary, confidence, evidence[], differential[], severity, tags[]
 *       }
 * 原则：
 *   1) 以当前状态为准（LIFE.snapshot 的稳定字段），不读开局诊断标签；
 *   2) 判定基于指标组合，单一异常只给低置信度；
 *   3) 中毒类缺少化验字段时可用 S.tox / S.given / 可选的病程字段做辅助证据，
 *      字段缺失时自动降级，不抛错。
 * 只读：不修改 S，不修改引擎/生成器。
 * ========================================================================= */
(function (root) {
'use strict';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const num = v => (typeof v === 'number' && isFinite(v)) ? v : null;
const round2 = x => Math.round(x * 100) / 100;
const spo2Below = (s, threshold) => s.spo2 != null && s.spo2 < threshold;
const spo2Evidence = s => s.spo2 == null ? 'SpO₂ 无信号' : `SpO₂ ${s.spo2}%`;

/* ---------------- 状态读取 ---------------- */
function getSnapshot(S) {
  if (root.LIFE && typeof root.LIFE.snapshot === 'function') {
    try {
      const s = root.LIFE.snapshot(S);
      if (s && typeof s === 'object') return s;
    } catch (e) { /* 降级到手读 */ }
  }
  let sys = num(S.sys), dia = num(S.dia), map = num(S.map);
  if (root.LIFE && typeof root.LIFE.bp === 'function') {
    try { const b = root.LIFE.bp(S); sys = b.sys; dia = b.dia; map = b.map; } catch (e) {}
  }
  const hr = num(S.hr) || 0;
  const sv = num(S.sv) || 0;
  return {
    hr: Math.round(hr),
    sys: sys == null ? Math.round(S.sys || 0) : sys,
    dia: dia == null ? Math.round(S.dia || 0) : dia,
    map: map == null ? Math.round(S.map || 0) : map,
    rr: Math.round(num(S.rr) || 0),
    spo2: S.rhythm && S.rhythm !== 'sinus' ? null : num(S.spo2),
    temp: Math.round((num(S.temp) || 0) * 10) / 10,
    gcs: Math.round(num(S.gcs) || 0),
    k: Math.round((num(S.k) || 0) * 10) / 10,
    na: Math.round(num(S.na) || 0),
    cl: Math.round(num(S.cl) || 0),
    ca: Math.round((num(S.ca) || 0) * 100) / 100,
    ph: Math.round((S.ph != null ? num(S.ph) : 7.4) * 100) / 100,
    paco2: Math.round(num(S.paco2) || 0),
    pao2: Math.round(num(S.pao2) || 0),
    hco3: Math.round(num(S.hco3) || 0),
    lac: Math.round((num(S.lac) || 0) * 10) / 10,
    glu: Math.round((num(S.glu) || 0) * 10) / 10,
    cr: Math.round(num(S.cr) || 0),
    bun: Math.round((num(S.bun) || 0) * 10) / 10,
    hb: Math.round(num(S.hb) || 0),
    uo: Math.round((num(S.uo) || 0) * 10) / 10,
    rhythm: S.rhythm || 'sinus',
    ef: Math.round((num(S.cEff) != null ? num(S.cEff) : num(S.contractility) || 0) * 100),
  };
}

/* 从日志条目取文本（兼容 [时间,文本,色调] 与 [文本,色调]） */
function logText(l) {
  if (!l) return '';
  return String(l[1] != null ? l[1] : l[0] || '');
}
function givenAny(c, ids, names) {
  for (const g of c.given) {
    if (!g) continue;
    if (ids && ids.indexOf(g.id) >= 0) return true;
    if (names && names.some(n => String(g.n || '').indexOf(n) >= 0)) return true;
  }
  return false;
}

/* ---------------- 酸碱判读 ---------------- */
function acidBase(s) {
  const ph = s.ph, pco2 = s.paco2, hco3 = s.hco3;
  const ag = (s.na || 140) - (s.cl || 103) - hco3;
  const acidemia = ph < 7.35, alkalemia = ph > 7.45;
  let ma = 0, mk = 0, ra = 0, rk = 0;

  if (hco3 < 22) ma = clamp((22 - hco3) / 10, 0, 1) * (acidemia ? 1 : 0.30);
  if (hco3 > 26) mk = clamp((hco3 - 26) / 10, 0, 1) * (alkalemia ? 1 : 0.30);
  if (pco2 > 45) ra = clamp((pco2 - 45) / 20, 0, 1) * (acidemia ? 1 : 0.30);
  if (pco2 < 35) rk = clamp((35 - pco2) / 15, 0, 1) * (alkalemia ? 1 : 0.30);

  /* 代偿判读：把「代偿性改变」与「真正合并的第二种紊乱」分开 */
  if (hco3 < 22) {
    const exp = 1.5 * hco3 + 8;                      // Winter 公式
    if (pco2 > exp + 8) ra = Math.max(ra, 0.55);
    else if (pco2 < exp - 8) rk = Math.max(rk, 0.45);
  }
  if (pco2 > 45) {
    const exp = 24 + Math.max(0, pco2 - 40) * 0.12;  // 急性呼酸代偿
    if (hco3 < exp - 4) ma = Math.max(ma, 0.55);
    else if (hco3 > exp + 5) mk = Math.max(mk, 0.50);
  }
  if (hco3 > 26) {
    const exp = 0.7 * hco3 + 21;                     // 代碱预期 PaCO₂
    if (pco2 > exp + 8) ra = Math.max(ra, 0.50);
    else if (pco2 < exp - 8) rk = Math.max(rk, 0.45);
  }
  if (pco2 < 35) {
    const exp = 24 - Math.max(0, 40 - pco2) * 0.20;  // 急性呼碱代偿
    if (hco3 < exp - 4) ma = Math.max(ma, 0.50);
    else if (hco3 > exp + 5) mk = Math.max(mk, 0.45);
  }

  const items = [
    { key: 'metAcid', name: '代谢性酸中毒', score: ma, tag: 'metAcidosis',
      diff: ['糖尿病酮症酸中毒', '乳酸酸中毒', '急性肾损伤', '中毒'] },
    { key: 'metAlk', name: '代谢性碱中毒', score: mk, tag: 'metAlkalosis',
      diff: ['呕吐/胃液丢失', '利尿剂过量', '低钾血症'] },
    { key: 'respAcid', name: '呼吸性酸中毒', score: ra, tag: 'respAcidosis',
      diff: ['阿片类药物过量', 'COPD 急性加重', '呼吸肌疲劳'] },
    { key: 'respAlk', name: '呼吸性碱中毒', score: rk, tag: 'respAlkalosis',
      diff: ['焦虑性过度通气', '脓毒症早期', '急性肺栓塞'] },
  ].filter(x => x.score >= 0.35).sort((a, b) => b.score - a.score);

  return {
    ph, pco2, hco3, ag, acidemia, alkalemia,
    ma, mk, ra, rk,
    items,
    primary: items[0] || null,
    tags: items.map(x => x.tag),
  };
}

/* ---------------- 上下文 ---------------- */
function buildContext(S) {
  const s = getSnapshot(S);
  const ab = acidBase(s);
  const given = Array.isArray(S.given) ? S.given : [];
  const log = Array.isArray(S.log) ? S.log : [];
  const c = {
    S, s, ab, given, log,
    tox: (S.tox && typeof S.tox === 'object') ? S.tox : {},
    flag: k => {
      const v = S[k];
      return (typeof v === 'number' && isFinite(v)) ? v : null;
    },
    givenAny: (ids, names) => givenAny(c, ids, names),
    logHas: pat => log.some(l => pat.test(logText(l))),
  };
  return c;
}

/* ---------------- 诊断规则 ----------------
 * 每条规则返回 null 或 { score: 0..1, evidence: [] }。
 * priority 只在分数接近时用于排序，不改变分数本身。
 * ------------------------------------------ */
const RULES = [

  /* ===== 心律失常 / 骤停 ===== */
  {
    id: 'vf', name: '心室颤动', priority: 100,
    tags: ['vf', 'arrhythmia', 'arrest'],
    diff: ['室性心动过速', '尖端扭转型室速', '心电图伪差'],
    test(c) {
      if (c.s.rhythm !== 'vf') return null;
      return {
        score: 1,
        evidence: ['心电图：心室颤动，无有效心室射血',
                   `意识 GCS ${c.s.gcs}，可触及大动脉搏动消失（推演）`],
      };
    },
  },
  {
    id: 'asystole', name: '心静止', priority: 99,
    tags: ['asystole', 'arrhythmia', 'arrest'],
    diff: ['心室颤动', '严重心动过缓', '心电图导联脱落'],
    test(c) {
      if (c.s.rhythm !== 'asystole') return null;
      return {
        score: 1,
        evidence: ['心电图：心电活动消失（心静止）', `意识 GCS ${c.s.gcs}`],
      };
    },
  },

  /* ===== 电解质 ===== */
  {
    id: 'highK', name: '高钾血症', priority: 90,
    tags: ['highK', 'electrolyte', 'hyperkalemia'],
    diff: ['急性肾损伤', '横纹肌溶解', '代谢性酸中毒', '标本溶血'],
    test(c) {
      const k = c.s.k;
      if (k < 5.5) return null;
      let sc = k >= 7 ? 0.95 : k >= 6.5 ? 0.88 : k >= 6 ? 0.74 : 0.60;
      const ev = [`血钾 ${k} mmol/L（> 5.5）`];
      if (k >= 6.5) ev.push('心电图（推演）：T 波高尖、QRS 增宽');
      if (c.s.ph < 7.30) { sc += 0.03; ev.push(`pH ${c.s.ph}，酸中毒促进钾向细胞外转移`); }
      if (c.s.cr > 200 || c.s.uo < 0.5) {
        sc += 0.03;
        ev.push(`肌酐 ${c.s.cr} µmol/L，尿量 ${c.s.uo} mL/min，肾脏排钾减少`);
      }
      if (c.s.rhythm !== 'sinus' && k >= 6.5) {
        sc = Math.max(sc, 0.96);
        ev.push('已出现恶性心律失常，符合高钾的心肌毒性');
      }
      return { score: clamp(sc, 0, 0.97), evidence: ev.slice(0, 5) };
    },
  },
  {
    id: 'lowK', name: '低钾血症', priority: 64,
    tags: ['lowK', 'electrolyte', 'hypokalemia'],
    diff: ['低镁血症', '代谢性碱中毒', '胰岛素过量'],
    test(c) {
      const k = c.s.k;
      if (k >= 3.5) return null;
      let sc = k < 3.0 ? 0.80 : 0.55;
      const ev = [`血钾 ${k} mmol/L（< 3.5）`];
      if (c.s.ph > 7.45) { sc += 0.04; ev.push(`pH ${c.s.ph}，碱中毒促进钾内移`); }
      if (c.givenAny(['insulin', 'salbutamol'], ['胰岛素', '沙丁胺醇'])) {
        sc += 0.05; ev.push('近期使用胰岛素/β₂ 激动剂');
      }
      return { score: clamp(sc, 0, 0.9), evidence: ev };
    },
  },
  {
    id: 'highNa', name: '高钠血症', priority: 58,
    tags: ['highNa', 'electrolyte', 'sodium'],
    diff: ['尿崩症', '脱水', '高渗液输注过多'],
    test(c) {
      const na = c.s.na;
      if (na <= 145) return null;
      return {
        score: clamp(0.55 + (na - 145) * 0.02, 0.55, 0.88),
        evidence: [`血钠 ${na} mmol/L（> 145）`,
                   `意识 GCS ${c.s.gcs}，尿量 ${c.s.uo} mL/min`],
      };
    },
  },
  {
    id: 'lowNa', name: '低钠血症', priority: 72,
    tags: ['lowNa', 'electrolyte', 'sodium'],
    diff: ['抗利尿激素分泌异常', '心力衰竭稀释性低钠', '利尿剂相关低钠'],
    test(c) {
      const na = c.s.na;
      if (na >= 135) return null;
      let sc = na < 120 ? 0.90 : na < 125 ? 0.82 : na < 130 ? 0.68 : 0.52;
      const ev = [`血钠 ${na} mmol/L（< 135）`];
      if (na < 125) ev.push(`意识 GCS ${c.s.gcs}，提示低钠性脑病风险`);
      return { score: sc, evidence: ev };
    },
  },

  /* ===== 酸碱失衡（非特异，分数低于具体病因） ===== */
  {
    id: 'metAcid', name: '代谢性酸中毒', priority: 55,
    tags: ['metAcidosis', 'acidBase'],
    diff: ['糖尿病酮症酸中毒', '乳酸酸中毒', '急性肾损伤', '中毒'],
    test(c) {
      const ab = c.ab;
      if (!ab || ab.ma < 0.35) return null;
      const sc = clamp(0.40 + 0.42 * ab.ma, 0, 0.82);
      const ev = [`pH ${c.s.ph}（< 7.35）`, `HCO₃⁻ ${c.s.hco3} mmol/L（< 22）`];
      if (ab.ag > 16) ev.push(`阴离子间隙 ${ab.ag} mmol/L（> 16）`);
      if (c.s.lac > 2) ev.push(`乳酸 ${c.s.lac} mmol/L，提示组织低灌注或代谢紊乱`);
      return { score: sc, evidence: ev.slice(0, 5) };
    },
  },
  {
    id: 'metAlk', name: '代谢性碱中毒', priority: 50,
    tags: ['metAlkalosis', 'acidBase'],
    diff: ['呕吐/胃液丢失', '利尿剂过量', '低钾血症'],
    test(c) {
      const ab = c.ab;
      if (!ab || ab.mk < 0.35) return null;
      return {
        score: clamp(0.40 + 0.40 * ab.mk, 0, 0.80),
        evidence: [`pH ${c.s.ph}（> 7.45）`, `HCO₃⁻ ${c.s.hco3} mmol/L（> 26）`,
                   `PaCO₂ ${c.s.paco2} mmHg（代偿性升高）`],
      };
    },
  },
  {
    id: 'respAcid', name: '呼吸性酸中毒', priority: 52,
    tags: ['respAcidosis', 'acidBase'],
    diff: ['阿片类药物过量', 'COPD 急性加重', '呼吸肌疲劳', '气道梗阻'],
    test(c) {
      const ab = c.ab;
      if (!ab || ab.ra < 0.35) return null;
      return {
        score: clamp(0.40 + 0.42 * ab.ra, 0, 0.85),
        evidence: [`PaCO₂ ${c.s.paco2} mmHg（> 45）`, `pH ${c.s.ph}（< 7.35）`,
                   `呼吸 ${c.s.rr} 次/分，${spo2Evidence(c.s)}`],
      };
    },
  },
  {
    id: 'respAlk', name: '呼吸性碱中毒', priority: 48,
    tags: ['respAlkalosis', 'acidBase'],
    diff: ['焦虑性过度通气', '脓毒症早期', '急性肺栓塞', '高热'],
    test(c) {
      const ab = c.ab;
      if (!ab || ab.rk < 0.35) return null;
      return {
        score: clamp(0.38 + 0.40 * ab.rk, 0, 0.80),
        evidence: [`PaCO₂ ${c.s.paco2} mmHg（< 35）`, `pH ${c.s.ph}（> 7.45）`,
                   `呼吸 ${c.s.rr} 次/分`],
      };
    },
  },

  /* ===== 糖代谢 ===== */
  {
    id: 'dka', name: '糖尿病酮症酸中毒', priority: 93,
    tags: ['dka', 'hyperglycemia', 'metAcidosis', 'ketosis', 'acidBase'],
    diff: ['高渗高血糖状态', '乳酸酸中毒', '饥饿性酮症', '酒精性酮症酸中毒'],
    test(c) {
      const s = c.s;
      if (s.glu < 13) return null;
      const ketone = c.ab.ag > 16
        || (c.flag('ketoneProd') != null && c.flag('ketoneProd') > 0.02)
        || c.logHas(/酮体|酮症/);
      const n = (s.ph < 7.30 ? 1 : 0) + (s.hco3 < 18 ? 1 : 0) + (ketone ? 1 : 0);
      if (n < 2) return null;
      let sc = 0.62 + n * 0.10 + (s.glu >= 25 ? 0.05 : 0);
      const ev = [`血糖 ${s.glu} mmol/L（> 13）`, `pH ${s.ph}`, `HCO₃⁻ ${s.hco3} mmol/L`];
      if (ketone) ev.push(`阴离子间隙 ${c.ab.ag} mmol/L，提示酮体蓄积`);
      if (s.rr >= 24) ev.push(`呼吸 ${s.rr} 次/分，Kussmaul 样深大呼吸`);
      return { score: clamp(sc, 0, 0.96), evidence: ev.slice(0, 5) };
    },
  },
  {
    id: 'hypoglycemia', name: '低血糖', priority: 80,
    tags: ['hypoglycemia', 'glucose'],
    diff: ['胰岛素过量', '肾上腺皮质功能不全', '脓毒症', '肝衰竭'],
    test(c) {
      const glu = c.s.glu;
      if (glu >= 3.9) return null;
      let sc = glu < 2.2 ? 0.93 : glu < 3.0 ? 0.84 : 0.62;
      const ev = [`血糖 ${glu} mmol/L（< 3.9）`];
      if (c.s.gcs < 12) { sc += 0.04; ev.push(`意识 GCS ${c.s.gcs}，低血糖脑病可能`); }
      if (c.givenAny(['insulin'], ['胰岛素'])) ev.push('近期使用胰岛素');
      return { score: clamp(sc, 0, 0.97), evidence: ev };
    },
  },
  {
    id: 'hyperglycemia', name: '高血糖', priority: 45,
    tags: ['hyperglycemia', 'glucose'],
    diff: ['糖尿病酮症酸中毒', '高渗高血糖状态', '应激性高血糖'],
    test(c) {
      const glu = c.s.glu;
      if (glu <= 11.1) return null;
      return {
        score: clamp(0.50 + (glu - 11.1) * 0.01, 0.50, 0.72),
        evidence: [`血糖 ${glu} mmol/L（> 11.1）`, `pH ${c.s.ph}，HCO₃⁻ ${c.s.hco3} mmol/L`],
      };
    },
  },

  /* ===== 休克 / 循环 ===== */
  {
    id: 'septicShock', name: '感染性休克', priority: 88,
    tags: ['sepsis', 'shock', 'infection'],
    diff: ['失血性休克', '心源性休克', '肾上腺危象', '甲状腺危象'],
    test(c) {
      const s = c.s;
      const inf = c.flag('infection');
      const fever = s.temp >= 38.3;
      const hypoperf = s.sys < 95 || s.lac > 2.5;
      const tachy = s.hr > 100;
      if (!(fever || (inf != null && inf > 0.40)) || !hypoperf || !tachy) return null;
      let sc = 0.68 + (s.lac > 4 ? 0.10 : 0) + (s.temp >= 39 ? 0.06 : 0)
             + (inf != null && inf > 0.50 ? 0.05 : 0);
      const ev = [`体温 ${s.temp}℃`, `收缩压 ${s.sys} mmHg，心率 ${s.hr} 次/分`,
                 `乳酸 ${s.lac} mmol/L`];
      if (inf != null) ev.push(`感染负荷 ${Math.round(inf * 100)}%`);
      return { score: clamp(sc, 0, 0.95), evidence: ev.slice(0, 5) };
    },
  },
  {
    id: 'hemorrhagicShock', name: '失血性休克', priority: 86,
    tags: ['bleed', 'shock', 'hemorrhage', 'anemia'],
    diff: ['感染性休克', '心源性休克', '稀释性凝血病', '过敏性休克'],
    test(c) {
      const s = c.s;
      if (s.hb >= 95) return null;
      if (!(s.sys < 95 || s.hr > 110 || s.hb < 80)) return null;
      const activeBleeding = c.S.bleedRate > 0;
      const bleedingHistory = c.logHas(/呕血|黑便|内镜下止血成功|出血点已控制|外出血明显减少/);
      if (!activeBleeding && !bleedingHistory) return null;
      let sc = 0.62 + (s.hb < 80 ? 0.10 : 0) + (s.sys < 90 ? 0.08 : 0)
             + (s.lac > 2 ? 0.05 : 0);
      const ev = [`血红蛋白 ${s.hb} g/L（< 95）`, `收缩压 ${s.sys} mmHg，心率 ${s.hr} 次/分`,
                 `乳酸 ${s.lac} mmol/L`];
      ev.push(activeBleeding ? '存在持续失血' : '病史或处置记录有近期失血证据');
      return { score: clamp(sc, 0, 0.95), evidence: ev.slice(0, 5) };
    },
  },
  {
    id: 'tamponade', name: '急性心包填塞', priority: 88,
    tags: ['tamponade', 'shock'], diff: ['张力性气胸', '急性肺栓塞'],
    test(c) {
      const { s, S } = c;
      if (!(S.tamponade > 0.3 && S.cvp > 9 && (s.sys < 95 || s.sys - s.dia < 25))) return null;
      return { score: 0.90, evidence: ['心包内压升高', `中心静脉压 ${Math.round(S.cvp)} mmHg`,
        `收缩压 ${s.sys} mmHg，脉压 ${s.sys - s.dia} mmHg`] };
    },
  },
  {
    id: 'intracranialHematoma', name: '颅内血肿伴颅压升高', priority: 88,
    tags: ['tbi', 'icp'], diff: ['其他颅内占位', '弥漫性脑水肿'],
    test(c) {
      const { s, S } = c;
      if (!(S.hematoma > 0.25 && S.icp > 0.6 && s.gcs < 14)) return null;
      return { score: 0.90, evidence: ['存在颅内血肿，颅内压升高', `意识 GCS ${s.gcs}`] };
    },
  },
  {
    id: 'cardiogenicShock', name: '心源性休克', priority: 82,
    tags: ['cardiogenic', 'shock', 'heartFailure'],
    diff: ['急性心肌梗死', '心包填塞', '急性肺栓塞', '严重心律失常'],
    test(c) {
      const s = c.s;
      if (s.ef >= 45 || s.sys >= 90) return null;
      let sc = 0.68 + (s.ef < 35 ? 0.08 : 0) + (spo2Below(s, 90) ? 0.05 : 0);
      const ev = [`射血分数 ${s.ef}%（< 45%）`, `收缩压 ${s.sys} mmHg（< 90）`,
                 `意识 GCS ${s.gcs}，尿量 ${s.uo} mL/min`];
      return { score: clamp(sc, 0, 0.9), evidence: ev };
    },
  },
  {
    id: 'acuteLVF', name: '急性左心衰', priority: 84,
    tags: ['edema', 'heartFailure', 'dyspnea'],
    diff: ['COPD 急性加重', '急性肺栓塞', '肺炎', '急性呼吸窘迫综合征'],
    test(c) {
      const s = c.s;
      const lw = num(s.lungWater), inter = num(s.interstitium);
      const edema = (lw != null && lw > 0.30) || (inter != null && inter > 11.5);
      if (!edema && s.ef >= 48) return null;
      if (!(edema || spo2Below(s, 93) || s.rr > 26)) return null;
      let sc = (edema ? 0.78 : 0.72) + (spo2Below(s, 88) ? 0.08 : 0)
             + (s.rr > 30 ? 0.04 : 0) + (s.sys < 100 ? 0.03 : 0);
      const ev = [];
      if (edema) {
        if (lw != null) ev.push(`肺水 ${lw.toFixed(2)}（> 0.30），提示肺水肿`);
        if (inter != null) ev.push(`肺间质液体 ${inter.toFixed(1)} mL/kg`);
      }
      ev.push(`射血分数 ${s.ef}%`, `${spo2Evidence(s)}，呼吸 ${s.rr} 次/分`,
              `收缩压 ${s.sys} mmHg`);
      if (s.uo < 0.5) ev.push(`尿量 ${s.uo} mL/min，容量负荷可能过重`);
      return { score: clamp(sc, 0, 0.94), evidence: ev.slice(0, 5) };
    },
  },
  {
    id: 'pe', name: '急性肺栓塞', priority: 76,
    tags: ['pe', 'thrombosis', 'shock'],
    diff: ['急性左心衰', '肺炎', '气胸', '急性冠脉综合征'],
    test(c) {
      const s = c.s;
      const pvr = num(s.pvr);
      const src = (c.S && c.S.shuntSrc) || {};
      const clotShunt = num(src.clot) || 0;
      const direct = (pvr != null && pvr > 6) || clotShunt > 0.10;
      const pattern = spo2Below(s, 90) && s.hr > 115 && s.sys < 95
        && s.ef >= 45 && s.ef <= 68 && s.temp < 38 && s.rr > 24;
      if (!direct && !pattern) return null;
      let sc = direct ? 0.80 : 0.76;
      if (pvr != null && pvr > 8) sc += 0.05;
      if (pvr != null && pvr > 10) sc += 0.03;
      if (clotShunt > 0.15) sc += 0.04;
      if (!direct) sc += (s.ef <= 58 ? 0.05 : 0) + (s.lac > 2 ? 0.03 : 0);
      const ev = [`${spo2Evidence(s)}，呼吸 ${s.rr} 次/分`,
                  `心率 ${s.hr} 次/分，收缩压 ${s.sys} mmHg`];
      if (pvr != null) ev.push(`肺血管阻力 ${pvr}（> 6，提示肺循环梗阻）`);
      if (shunt != null && shunt > 0) ev.push(`肺内分流 ${(shunt * 100).toFixed(0)}%`);
      if (!direct) ev.push(`射血分数 ${s.ef}%，体温 ${s.temp}℃`);
      return { score: clamp(sc, 0, 0.94), evidence: ev.slice(0, 5) };
    },
  },
  {
    id: 'acuteRespFailure', name: '急性呼吸衰竭', priority: 70,
    tags: ['respFailure', 'hypoxia'],
    diff: ['急性肺栓塞', '气胸', '哮喘持续状态', '阿片类药物过量'],
    test(c) {
      const s = c.s;
      const hypox = spo2Below(s, 90) || s.pao2 < 60;
      if (!(hypox && (s.rr > 28 || s.pao2 < 60))) return null;
      let sc = 0.62 + (spo2Below(s, 85) ? 0.08 : 0) + (s.rr > 32 ? 0.05 : 0);
      return {
        score: clamp(sc, 0, 0.85),
        evidence: [`${spo2Evidence(s)}，PaO₂ ${s.pao2} mmHg`, `呼吸 ${s.rr} 次/分`,
                   `PaCO₂ ${s.paco2} mmHg，pH ${s.ph}`],
      };
    },
  },
  {
    id: 'asthma', name: '支气管哮喘急性发作', priority: 74,
    tags: ['asthma', 'bronchospasm', 'respFailure'],
    diff: ['急性左心衰', '急性肺栓塞', '异物吸入', 'COPD 急性加重'],
    test(c) {
      const s = c.s;
      if (!spo2Below(s, 92) || s.rr < 24) return null;
      if (s.ef < 65 || s.temp >= 38.5) return null;
      /* 肺循环梗阻或肺水肿时，喘鸣样表现不应误判为单纯气道痉挛 */
      if (num(s.pvr) != null && num(s.pvr) > 6) return null;
      if (num(s.shunt) != null && num(s.shunt) > 0.15) return null;
      if (num(s.lungWater) != null && num(s.lungWater) > 0.30) return null;
      const ob = c.flag('airwayResistance') != null ? c.flag('airwayResistance') : c.flag('obstruct');
      const vdvt = c.flag('vdvt');
      const airwayEvidence = (ob != null && ob > 0.25)
        || (vdvt != null && vdvt > 0.55)
        || c.logHas(/喘鸣|哮鸣|喘息|哮喘|COPD/);
      if (!airwayEvidence) return null;   // 没有气道痉挛证据时，归入急性呼吸衰竭而不是哮喘
      let sc = 0.65 + (s.rr >= 30 ? 0.08 : 0) + (spo2Below(s, 88) ? 0.08 : 0)
             + (ob != null && ob > 0.30 ? 0.10 : 0);
      const ev = [`${spo2Evidence(s)}，呼吸 ${s.rr} 次/分`, `射血分数 ${s.ef}%（心功能不支持肺水肿）`,
                 `体温 ${s.temp}℃`];
      if (ob != null) ev.push(`气道痉挛程度 ${Math.round(ob * 100)}%`);
      return { score: clamp(sc, 0, 0.93), evidence: ev.slice(0, 5) };
    },
  },
  {
    id: 'htnEmergency', name: '高血压急症', priority: 68,
    tags: ['htn', 'hypertensiveEmergency'],
    diff: ['脑出血', '蛛网膜下腔出血', '子痫', '焦虑性血压升高'],
    test(c) {
      const s = c.s;
      if (s.sys < 180 && s.map < 130) return null;
      let sc = 0.70 + (s.sys > 200 ? 0.08 : 0) + (s.map > 150 ? 0.06 : 0)
             + (s.gcs < 13 ? 0.05 : 0);
      const ev = [`收缩压 ${s.sys} mmHg，平均动脉压 ${s.map} mmHg`];
      if (s.gcs < 14) ev.push(`意识 GCS ${s.gcs}，提示高血压脑病`);
      return { score: clamp(sc, 0, 0.9), evidence: ev };
    },
  },

  /* ===== 中毒 / 内分泌 ===== */
  {
    id: 'opioidOD', name: '阿片类药物过量', priority: 91,
    tags: ['opioid', 'tox', 'respDepression'],
    diff: ['有机磷中毒', '苯二氮卓过量', '低血糖', '脑卒中'],
    test(c) {
      const s = c.s;
      const exp = c.givenAny(
        ['morphine', 'fentanyl', 'oxycodone', 'hydrocodone', 'codeine', 'tramadol', 'heroin', 'methadone'],
        ['吗啡', '芬太尼', '羟考酮', '可待因', '曲马多', '海洛因', '美沙酮'])
        || c.S.opioidTox === true;
      const sedated = root.LIFE?.benzodiazepineExposure?.(c.S).sedated;
      const pattern = s.rr <= 10 && s.gcs <= 9;
      if (!exp && !pattern) return null;
      /* 有苯二氮卓暴露、又没有阿片暴露时，不要把镇静引起的呼吸抑制算成阿片过量 */
      if (pattern && !exp && sedated) return null;
      let sc = 0.55 + (pattern ? 0.25 : 0) + (exp ? 0.08 : 0)
             + (spo2Below(s, 90) ? 0.05 : 0) + (s.rr < 6 ? 0.05 : 0);
      const ev = [`呼吸 ${s.rr} 次/分，意识 GCS ${s.gcs}`];
      if (exp) ev.push('用药/暴露记录提示阿片类物质');
      if (spo2Below(s, 92)) ev.push(`${spo2Evidence(s)}，存在低氧`);
      return { score: clamp(sc, 0, 0.97), evidence: ev };
    },
  },
  {
    id: 'organophosphate', name: '有机磷中毒', priority: 89,
    tags: ['organophosphate', 'tox', 'cholinergic'],
    diff: ['阿片类药物过量', '氨基甲酸酯中毒', '胆碱能危象', '急性胃肠炎'],
    test(c) {
      const s = c.s;
      const exp = c.givenAny(['organophosphate', 'parathion', 'malathion', 'dimethoate'],
                             ['有机磷', '敌敌畏', '乐果', '对硫磷'])
        || (num(c.tox.op) || 0) > 0
        || (c.flag('opTox') != null && c.flag('opTox') > 0.25);
      const cholinergic = s.hr < 62 && spo2Below(s, 93) && s.gcs < 15
        && s.rr >= 12 && s.temp < 38.5;
      if (!exp && !cholinergic) return null;
      let sc = exp ? 0.72 : 0.55;
      sc += (s.hr < 55 ? 0.08 : 0) + (spo2Below(s, 88) ? 0.06 : 0)
          + (c.flag('opTox') != null && c.flag('opTox') > 0.40 ? 0.08 : 0)
          + (cholinergic ? 0.06 : 0);
      const ev = [`心率 ${s.hr} 次/分，${spo2Evidence(s)}，意识 GCS ${s.gcs}`];
      if (exp) ev.push('暴露记录/毒物检测提示有机磷');
      ev.push('毒蕈碱样表现（推演）：分泌物增多、瞳孔缩小、支气管痉挛');
      return { score: clamp(sc, 0, 0.96), evidence: ev.slice(0, 5) };
    },
  },
  {
    id: 'benzoOD', name: '苯二氮卓过量', priority: 78,
    tags: ['benzo', 'tox', 'overdose'],
    diff: ['阿片类药物过量', '酒精中毒', '低血糖', '脑血管意外'],
    test(c) {
      const s = c.s;
      if (!root.LIFE?.benzodiazepineExposure?.(c.S).overdose) return null;
      const sc = 0.75 + (s.gcs < 10 ? 0.10 : 0) + (s.rr < 10 ? 0.05 : 0);
      const ev = ['当前苯二氮卓镇静负荷偏高', `意识 GCS ${s.gcs}，呼吸 ${s.rr} 次/分`];
      return { score: clamp(sc, 0, 0.94), evidence: ev };
    },
  },
  {
    id: 'apapOD', name: '对乙酰氨基酚中毒', priority: 77,
    tags: ['apap', 'tox', 'liver'],
    diff: ['病毒性肝炎', '酒精性肝病', '其他药物性肝损伤', '急性肾损伤'],
    test(c) {
      const s = c.s;
      const exposure = root.LIFE?.acetaminophenExposure?.(c.S);
      const dmg = c.flag('apapDamage');
      const gsh = num(s.gsh), napqi = num(s.napqi);
      const hepato = num(s.hepato) != null ? num(s.hepato) : num(s.hepatotox);
      const metabolic = (gsh != null && gsh < 0.60) || (napqi != null && napqi > 0.05)
        || (hepato != null && hepato > 0.01);
      const specificInjury = (dmg != null && dmg > 0.01) || (gsh != null && gsh < 0.60 && napqi != null && napqi > 0.05);
      if (!(exposure?.known || specificInjury || (exposure?.highRisk && metabolic))) return null;
      const sc = 0.65 + (exposure?.known || exposure?.highRisk ? 0.10 : 0) + clamp(dmg || 0, 0, 1) * 0.20
             + (metabolic ? 0.10 : 0);
      const ev = [];
      if (exposure?.known) ev.push('入院病史记录对乙酰氨基酚过量');
      if (exposure?.mg24h > 0) ev.push(`近 24 小时病房给药 ${Math.round(exposure.mg24h)} mg`);
      else if (metabolic) ev.push('毒物代谢指标提示对乙酰氨基酚肝毒性通路激活');
      if (dmg != null) ev.push(`肝毒性累积 ${Math.round(dmg * 100)}%`);
      if (gsh != null && gsh < 0.60) ev.push(`谷胱甘肽储备 ${gsh.toFixed(2)}（< 0.60，解毒能力耗竭）`);
      if (napqi != null && napqi > 0.05) ev.push(`NAPQI 蓄积 ${napqi.toFixed(2)}`);
      if (hepato != null && hepato > 0.01) ev.push(`肝细胞损伤 ${(hepato * 100).toFixed(0)}%`);
      if (s.cr > 130) ev.push(`肌酐 ${s.cr} µmol/L，出现肝肾联合损伤`);
      return { score: clamp(sc, 0, 0.94), evidence: ev.slice(0, 5) };
    },
  },
  {
    id: 'thyroidStorm', name: '甲状腺危象', priority: 83,
    tags: ['thyroid', 'endocrine', 'hyperthermia'],
    diff: ['感染性休克', '恶性高热', '抗胆碱能中毒', '嗜铬细胞瘤危象'],
    test(c) {
      const s = c.s;
      if (s.temp < 39.0 || s.hr < 125) return null;
      if (s.ef < 85) return null;
      const inf = c.flag('infection');
      if (inf != null && inf > 0.45) return null;
      let sc = 0.68 + (s.temp >= 39.5 ? 0.10 : 0) + (s.hr >= 140 ? 0.08 : 0)
             + (s.gcs < 14 ? 0.04 : 0);
      const ev = [`体温 ${s.temp}℃，心率 ${s.hr} 次/分`,
                 `射血分数 ${s.ef}%（高动力循环）`, `意识 GCS ${s.gcs}`];
      return { score: clamp(sc, 0, 0.95), evidence: ev };
    },
  },
  {
    id: 'anaphylaxis', name: '过敏反应', priority: 79,
    tags: ['anaphylaxis', 'shock', 'allergy'],
    diff: ['感染性休克', '血管迷走性晕厥', '哮喘急性发作'],
    test(c) {
      const a = c.flag('anaphyl');
      if (a == null || a <= 0.15) return null;
      const s = c.s;
      let sc = 0.66 + clamp(a, 0, 1) * 0.18
             + (s.sys < 90 ? 0.06 : 0) + (spo2Below(s, 92) ? 0.04 : 0);
      const ev = [`过敏反应程度 ${Math.round(a * 100)}%`,
                 `收缩压 ${s.sys} mmHg，${spo2Evidence(s)}`];
      return { score: clamp(sc, 0, 0.94), evidence: ev };
    },
  },

  /* ===== 肾脏 ===== */
  {
    id: 'aki', name: '急性肾损伤', priority: 60,
    tags: ['aki', 'renal'],
    diff: ['慢性肾脏病急性加重', '肾前性氮质血症', '尿路梗阻'],
    test(c) {
      const s = c.s;
      if (s.cr < 200) return null;
      let sc = 0.52 + (s.cr > 300 ? 0.10 : 0) + (s.uo < 0.5 ? 0.06 : 0);
      const ev = [`肌酐 ${s.cr} µmol/L（> 200）`, `尿量 ${s.uo} mL/min`];
      if (s.k > 5.0) ev.push(`血钾 ${s.k} mmol/L，排钾受影响`);
      return { score: clamp(sc, 0, 0.8), evidence: ev };
    },
  },
];

/* ---------------- 分级 ---------------- */
function severityOf(s) {
  if (s.rhythm !== 'sinus' || s.k > 7 || s.sys < 70 || spo2Below(s, 80)
      || s.gcs <= 6 || s.ph < 6.95) return 'critical';
  if (s.k > 6.0 || s.k < 2.8 || s.na < 120 || s.sys < 85 || spo2Below(s, 88)
      || s.gcs <= 9 || s.ph < 7.15 || s.hco3 < 10 || s.lac > 4 || s.temp >= 39.5
      || s.hb < 80 || s.cr > 350
      || (num(s.gsh) != null && num(s.gsh) < 0.25)
      || (num(s.napqi) != null && num(s.napqi) > 0.50)
      || (num(s.hepato) != null && num(s.hepato) > 0.40)) return 'severe';
  if (s.k > 5.5 || s.k < 3.2 || s.na > 148 || s.na < 130
      || s.ph < 7.32 || s.ph > 7.46 || s.hco3 < 20 || spo2Below(s, 94)
      || s.sys < 100 || s.gcs < 14 || s.glu < 3.9 || s.glu > 13
      || s.lac > 2.5 || s.temp > 38.5 || s.cr > 200 || s.hb < 100
      || s.uo < 0.5 || s.hr > 130 || s.hr < 50 || s.rr > 28 || s.rr < 10
      || (num(s.gsh) != null && num(s.gsh) < 0.60)
      || (num(s.napqi) != null && num(s.napqi) > 0.05)
      || (num(s.hepato) != null && num(s.hepato) > 0.01)) {
    return 'moderate';
  }
  return 'mild';
}

/* ---------------- 分类主函数 ---------------- */

/* 一次遭遇里同时成立的所有诊断（用于双病理建档）；minScore 默认 0.55 */
function classifyAll(S, minScore) {
  const min = (minScore == null) ? 0.55 : minScore;
  if (!S || typeof S !== 'object') return [];
  const c = buildContext(S);
  const hits = [];
  for (const r of RULES) {
    try {
      const out = r.test(c);
      if (out && out.score > 0) {
        hits.push({ rule: r, score: clamp(out.score, 0, 1),
                    evidence: Array.isArray(out.evidence) ? out.evidence.filter(Boolean) : [] });
      }
    } catch (e) { /* 单条失败不影响整体 */ }
  }
  hits.sort((a, b) => b.score - a.score || b.rule.priority - a.rule.priority);

  const sev = severityOf(c.s);
  const seen = new Set();
  const out = [];
  for (const h of hits) {
    if (h.score < min) continue;
    if (seen.has(h.rule.name)) continue;
    seen.add(h.rule.name);
    out.push({
      primary: h.rule.name,
      primaryId: h.rule.id,
      name: h.rule.name,
      confidence: Math.round(h.score * 100) / 100,
      evidence: h.evidence,
      differential: (h.rule.diff || []).slice(0, 3),
      severity: sev,
      tags: (h.rule.tags || []).slice(),
      acidBase: abSummary(c.ab),
    });
  }
  return out;
}

function classify(S) {
  if (!S || typeof S !== 'object') {
    return {
      primary: '无明确急性诊断', confidence: 0.2,
      evidence: ['无可用状态数据'], differential: [], severity: 'mild', tags: ['stable'],
    };
  }

  const c = buildContext(S);
  const hits = [];
  for (const r of RULES) {
    try {
      const out = r.test(c);
      if (out && out.score > 0) {
        hits.push({
          rule: r,
          score: clamp(out.score, 0, 1),
          evidence: Array.isArray(out.evidence) ? out.evidence.filter(Boolean) : [],
        });
      }
    } catch (e) { /* 单条规则失败不影响整体 */ }
  }
  hits.sort((a, b) => b.score - a.score || b.rule.priority - a.rule.priority);

  const top = hits[0];
  if (!top || top.score < 0.35) {
    const sev = severityOf(c.s);
    const abName = c.ab.primary ? c.ab.primary.name : null;
    return {
      primary: abName || '无明确急性诊断',
      confidence: abName ? 0.45 : 0.30,
      evidence: abName
        ? [`pH ${c.s.ph}，HCO₃⁻ ${c.s.hco3} mmol/L，PaCO₂ ${c.s.paco2} mmHg`]
        : ['现有体征与化验尚未匹配到具体诊断'],
      differential: abName ? (c.ab.primary.diff || []).slice(0, 3) : ['早期中毒', '代偿期电解质紊乱'],
      severity: sev,
      tags: abName ? (c.ab.tags || []).slice() : (sev === 'mild' ? ['stable'] : []),
      acidBase: abSummary(c.ab),
    };
  }

  const second = hits.find(h => h.rule.name !== top.rule.name && h.score >= 0.35);
  const margin = second ? top.score - second.score : top.score;

  let conf = 0.42 + 0.50 * top.score + 0.02 * Math.min(4, top.evidence.length);
  if (second && margin < 0.10) conf -= 0.08;
  if (top.score < 0.60) conf -= 0.08;
  conf = clamp(round2(conf), 0.30, 0.97);

  const diff = [];
  if (second && margin <= 0.15) diff.push(second.rule.name);
  for (const d of (top.rule.diff || [])) diff.push(d);
  const differential = [];
  for (const d of diff) {
    if (d !== top.rule.name && differential.indexOf(d) < 0) differential.push(d);
    if (differential.length >= 3) break;
  }

  const tags = [];
  for (const t of (top.rule.tags || [])) if (tags.indexOf(t) < 0) tags.push(t);
  for (const t of (c.ab.tags || [])) if (tags.indexOf(t) < 0) tags.push(t);
  const sev = severityOf(c.s);
  if (sev === 'critical' && tags.indexOf('critical') < 0) tags.push('critical');

  const evidence = top.evidence.slice(0, 5);
  if (c.ab.items.length > 1 && top.rule.id !== c.ab.items[1].key) {
    const secondAb = c.ab.items[1];
    if (secondAb && evidence.indexOf(secondAb.name) < 0) evidence.push(`合并${secondAb.name}`);
  }

  return {
    primary: top.rule.name,
    primaryId: top.rule.id,
    confidence: conf,
    evidence: evidence.slice(0, 5),
    differential,
    severity: sev,
    tags,
    acidBase: abSummary(c.ab),
  };
}

function abSummary(ab) {
  if (!ab) return null;
  return {
    ph: ab.ph, hco3: ab.hco3, paco2: ab.pco2, anionGap: ab.ag,
    state: ab.items.map(x => x.name),
  };
}

function catalog() {
  return RULES.map(r => ({ id: r.id, name: r.name, tags: (r.tags || []).slice() }));
}

const API = { classifyAll, classify, catalog, version: '1.0.0' };
if (typeof module !== 'undefined' && module.exports) module.exports = API;
root.DIAGNOSIS = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
