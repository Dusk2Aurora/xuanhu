/* ==========================================================================
 * 特殊体质（Traits）
 *  - 每个病人随机带 0–2 种体质，改变基线或对特定药物产生特殊反应
 *  - 让"同一种病、同一套药"因体质不同而有不同后果
 * ========================================================================== */
(function (root) {
'use strict';
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

const TRAITS = [
  {
    id: 'pcn_allergy', n: 'β-内酰胺过敏', short: '青霉素过敏',
    desc: '对青霉素类/头孢类过敏，给药后可发生过敏性休克',
    init: {},
    onDrug(S, sub, dose) {
      if (sub.cls !== '抗菌药') return null;
      if (!['头孢曲松', '哌拉西林他唑巴坦', '美罗培南', '万古霉素'].includes(sub.n)) return null;
      S.anaphyl = clamp((S.anaphyl || 0) + 0.85, 0, 1);
      S.log.push([E_fmt(S.t), `过敏反应：${sub.n} 触发过敏性休克`, 'bad']);
      return 'anaphylaxis';
    },
  },
  {
    id: 'long_qt', n: '长 QT 综合征', short: '长 QT',
    desc: 'QT 间期延长，使用延长 QT 的药物易诱发尖端扭转型室速',
    init: {},
    onDrug(S, sub, dose) {
      if (!['胺碘酮', '氟哌啶醇', '氯扎平', '左氧氟沙星', '氟康唑', '伏立康唑', '昂丹司琼'].includes(sub.n)) return null;
      S.qtRisk = (S.qtRisk || 0) + 1;
      S.log.push([E_fmt(S.t), `长 QT 体质：${sub.n} 增加了致心律失常风险`, 'warn']);
      if (S.qtRisk >= 2) { S.rhythm = 'vf'; S.arrests = (S.arrests || 0) + 1; S._vfMin = 0;
        S.log.push([E_fmt(S.t), '尖端扭转型室速！立即除颤', 'bad']); }
      return 'qt';
    },
  },
  {
    id: 'asthma_hx', n: '哮喘史', short: '哮喘史',
    desc: '既往哮喘，非选择性 β 阻滞剂可诱发支气管痉挛',
    init: { spo2: -2 },
    onDrug(S, sub, dose) {
      if (!['普萘洛尔', '拉贝洛尔', '美托洛尔', '阿替洛尔'].includes(sub.n)) return null;
      S.bronchospasm = clamp((S.bronchospasm || 0) + 1, 0, 1);
      S.log.push([E_fmt(S.t), `哮喘史：${sub.n} 诱发支气管痉挛`, 'bad']);
      return 'bronchospasm';
    },
  },
  {
    id: 'ckd', n: '慢性肾病 3 期', short: 'CKD',
    desc: '肾小球滤过率下降，药物排泄变慢、血钾基线偏高',
    init: { cr: 95, k: 0.45, uo: -0.25 },
    pkScale: 1.7,
    onDrug() { return null; },
  },
  {
    id: 't2dm', n: '2 型糖尿病', short: '糖尿病',
    desc: '糖代谢异常，血糖基线偏高、对胰岛素反应迟钝',
    init: { glu: 3.2, insulinBase: -0.25 },
    onDrug() { return null; },
  },
  {
    id: 'g6pd', n: 'G6PD 缺乏', short: 'G6PD',
    desc: '红细胞缺乏葡萄糖-6-磷酸脱氢酶，氧化性药物可致溶血',
    init: {},
    onDrug(S, sub, dose) {
      if (!['阿司匹林', '呋塞米', '左氧氟沙星', '磺胺甲噁唑', '伯氨喹', '维生素 K1', '对乙酰氨基酚'].includes(sub.n)) return null;
      S.hemolysis = clamp((S.hemolysis || 0) + 0.6, 0, 1);
      S.log.push([E_fmt(S.t), `G6PD 缺乏：${sub.n} 诱发溶血`, 'bad']);
      return 'hemolysis';
    },
  },
  {
    id: 'slow_cyp', n: 'CYP2C19 慢代谢', short: '慢代谢',
    desc: '氯吡格雷需经 CYP2C19 活化，慢代谢者药效显著降低',
    init: {},
    onDrug(S, sub) {
      if (sub.n === '氯吡格雷') { S.clopidogrelResist = true; return 'resist'; }
      /* 慢代谢还会让部分药物蓄积 */
      if (['奥美拉唑', '地西泮', '苯妥英钠'].includes(sub.n)) { S.pkScaleUser = 1.8; }
      return null;
    },
  },
  {
    id: 'baseline_htn', n: '原发性高血压', short: '基线高血压',
    desc: '基线血管张力偏高，血压长期处于较高水平，出血耐受差',
    init: { svr: 2.6, vol: 0.1 },
    onDrug() { return null; },
  },
  {
    id: 'elderly_renal', n: '老年（肾功能生理性下降）', short: '老年',
    desc: '年龄相关清除率下降，药物半衰期延长',
    init: { cr: 25 },
    pkScale: 1.35,
    onDrug() { return null; },
  },
];

function E_fmt(s) {
  const m = Math.floor(s / 60), mm = m % 60, hh = Math.floor(m / 60);
  return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
}
const fmt = E_fmt;

/* 把体质作用到初始状态 */
function applyInit(S, traits) {
  S.traits = traits || [];
  for (const t of S.traits) {
    const d = t.init || {};
    for (const k in d) {
      const v = d[k];
      if (k === 'pkScaleUser') { S.pkScaleUser = v; continue; }
      if (['vol','k','na','glu','cr','hb','hr','svr','rr','spo2','temp','gcs','uo','insulinBase','lactProd'].includes(k)) {
        S[k] = (typeof S[k] === 'number') ? S[k] + v : v;
      }
    }
  }
  /* PK 延长系数：CKD/老年 → 药效更持久 */
  let scale = 1;
  for (const t of S.traits) if (t.pkScale) scale *= t.pkScale;
  S.pkScale = scale;
  return S;
}

/* 给药时的体质检查 */
function onDrug(S, sub, dose) {
  for (const t of (S.traits || [])) {
    try { const r = t.onDrug && t.onDrug(S, sub, dose); if (r) return r; } catch (e) {}
  }
  return null;
}

/* 每帧：体质带来的持续后果 */
function tick(S, dtMin) {
  if (!S.traits || !S.traits.length) return;
  /* 过敏性休克：血管扩张 + 气道痉挛，肾上腺素可逆转 */
  if (S.anaphyl > 0) {
    const epi = (S.pk || []).some(p => p.id === 'epi' && (S.t - p.t) < 20 * 60);
    if (epi) S.anaphyl = Math.max(0, S.anaphyl - 0.06 * dtMin);
    else S.anaphyl = Math.min(1, S.anaphyl + 0.002 * dtMin);
  }
  if (S.bronchospasm > 0) {
    const beta = (S.pk || []).some(p => ['salbutamol','epi','salmeterol'].includes(p.id) && (S.t - p.t) < 60 * 60);
    S.bronchospasm = Math.max(0, S.bronchospasm - (beta ? 0.02 : 0.002) * dtMin);
  }
  if (S.hemolysis > 0) {
    /* 溶血丢的是红细胞质量（v0.3：hb 是 rbcMass/vol 的导出量，不再直接写 hb） */
    S.rbcMass = Math.max(20, (S.rbcMass || 0) - S.hemolysis * 0.06 * S.vol * dtMin);
  }
}

/* 体质对生理量的影响，供引擎读取 */
function modifiers(S) {
  const m = { svr: 0, rr: 0, spo2: 0, hr: 0 };
  if (S.anaphyl > 0) { m.svr -= S.anaphyl * 9; m.rr += S.anaphyl * 8; m.spo2 -= S.anaphyl * 14; }
  if (S.bronchospasm > 0) { m.rr += S.bronchospasm * 6; m.spo2 -= S.bronchospasm * 10; }
  return m;
}

const API = { TRAITS, applyInit, onDrug, tick, modifiers, byId: id => TRAITS.find(t => t.id === id) };
if (typeof module !== 'undefined' && module.exports) module.exports = API;
root.TRAITS = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
