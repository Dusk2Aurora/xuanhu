(function (root) {
'use strict';

const FINANCE = root.LIFE_FINANCE || (typeof module !== 'undefined' && module.exports ? require('./finance.js') : null);
const DEVICES = Object.freeze({
  vaEcmo: Object.freeze({ name: 'VA-ECMO', startCost: 45000, hourlyCost: 2000, coverage: 'selfPay',
    description: '体外维持循环及气体交换，为病因治疗争取时间。' }),
  vvEcmo: Object.freeze({ name: 'VV-ECMO', startCost: 45000, hourlyCost: 2000, coverage: 'selfPay',
    description: '体外支持氧合和二氧化碳清除，依赖患者自身循环。' }),
  crrt: Object.freeze({ name: 'CRRT', startCost: 3500, hourlyCost: 450, coverage: 'partial',
    description: '连续肾脏替代治疗，逐步清除溶质并纠正高钾、代谢性酸中毒和容量过多。' }),
  eeg: Object.freeze({ name: '持续脑电监测', startCost: 600, hourlyCost: 120, coverage: 'partial',
    description: '连续观察脑电背景和发作样活动，为复评意识障碍和识别隐匿发作提供线索。' }),
});
const DEVICE_IDS = Object.keys(DEVICES);
const SUPPORT_IDS = ['vaEcmo', 'vvEcmo', 'crrt'];
const EMPTY = Object.freeze({ active: false, startedAt: null, stoppedAt: null, seconds: 0, cost: 0 });
const EEG_READINGS = Object.freeze({
  collecting: '正在采集，约 1 个模拟分钟后提供首个监测片段。',
  seizure: '捕捉到发作样脑电活动，请复评意识、查体和发作诱因。',
  slowing: '背景活动弥漫性减慢，需结合用药、代谢和脑功能评估。',
  normal: '当前监测片段未见发作样活动。',
});

function active(S, id) {
  return S.advancedCare?.[id]?.active === true;
}

function status(S, id) {
  const session = Object.hasOwn(DEVICES, id) && S.advancedCare?.[id];
  if (!session) return EMPTY;
  const { active, startedAt, stoppedAt, seconds, cost } = session;
  return { active, startedAt, stoppedAt, seconds, cost };
}

function elapsedValue(value) {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function restore(S) {
  const saved = S.advancedCare;
  S.advancedCare = {};
  for (const id of DEVICE_IDS) {
    const previous = saved?.[id];
    if (!previous || typeof previous !== 'object') continue;
    const startedAt = Number.isFinite(previous.startedAt) && previous.startedAt >= 0 && previous.startedAt <= S.t
      ? previous.startedAt : null;
    if (startedAt == null) continue;
    const wasActive = previous.active === true;
    const inUse = wasActive && !(S.death || S.discharged || S.dischargeOutcome)
      && !(id === 'vvEcmo' && active(S, 'vaEcmo')) && !(id === 'crrt' && S.dialysisUntil > S.t);
    const stoppedAt = inUse ? null : Number.isFinite(previous.stoppedAt) && previous.stoppedAt >= startedAt
      ? Math.min(S.t, previous.stoppedAt) : S.t;
    const session = { active: inUse, startedAt, stoppedAt, seconds: elapsedValue(previous.seconds), cost: elapsedValue(previous.cost) };
    if (id === 'eeg') {
      session.reading = Object.hasOwn(EEG_READINGS, previous.reading) ? previous.reading : 'collecting';
      if (Number.isFinite(previous.lastSeizureAt) && previous.lastSeizureAt >= startedAt && previous.lastSeizureAt <= S.t) {
        session.lastSeizureAt = previous.lastSeizureAt;
      }
    }
    S.advancedCare[id] = session;
  }
}

function charge(S, id, amount, phase) {
  S.advancedCare[id].cost += amount;
  FINANCE.chargeDevice(S, amount, DEVICES[id].coverage, phase);
}

function action(S, id, enable, fmt) {
  if (!Object.hasOwn(DEVICES, id) || typeof enable !== 'boolean') return { ok: false, reason: '未知设备操作' };
  const { name, startCost } = DEVICES[id];
  if (!S.running || S.death || S.discharged || S.dischargeOutcome) return { ok: false, reason: '本例已结束' };
  if (active(S, id) === enable) return { ok: false, reason: enable ? `${name} 已启用` : `${name} 已停止` };
  const otherEcmo = { vaEcmo: 'vvEcmo', vvEcmo: 'vaEcmo' }[id];
  if (enable && otherEcmo && active(S, otherEcmo)) return { ok: false, reason: `请先停止 ${DEVICES[otherEcmo].name}` };
  if (enable && id === 'crrt' && S.dialysisUntil > S.t) return { ok: false, reason: '本床血液透析仍在进行' };

  const session = (S.advancedCare ??= {})[id] ??= { ...EMPTY };
  session.active = enable;
  if (enable) {
    session.startedAt = S.t;
    session.stoppedAt = null;
    if (id === 'eeg') {
      session.reading = 'collecting';
      session.lastSeizureAt = null;
    }
    charge(S, id, startCost, 'setup');
  } else {
    if (id === 'eeg') updateEeg(S, session);
    session.stoppedAt = S.t;
  }
  S.log.push([fmt(S.t), `${enable ? '启动' : '撤除'} ${name}`, 'good', S.t, null, true]);
  return { ok: true };
}

function updateEeg(S, session) {
  const seizure = (S.seizure || 0) >= 0.08;
  if (seizure) session.lastSeizureAt = S.t;
  if (S.t - session.startedAt < 60 - 1e-7) return;
  session.reading = seizure ? 'seizure' : S.gcs <= 12 ? 'slowing' : 'normal';
}

function eegReading(S) {
  const session = S.advancedCare?.eeg;
  const status = session?.reading || 'off';
  let text = EEG_READINGS[status] ?? '持续脑电监测未启用。';
  if (session?.stoppedAt != null) {
    text = status === 'collecting' ? '已停止监测，采集时间不足以提供监测片段。' : `已停止监测。末次记录：${text}`;
  }
  return { status, text, lastSeizureAt: session?.lastSeizureAt ?? null };
}

function advance(S, seconds) {
  if (!(seconds > 0)) return;
  for (const id of DEVICE_IDS) {
    if (!active(S, id)) continue;
    S.advancedCare[id].seconds += seconds;
    charge(S, id, DEVICES[id].hourlyCost * seconds / 3600, 'running');
  }
}

function finish(S) {
  for (const id of DEVICE_IDS) {
    if (!active(S, id)) continue;
    const session = S.advancedCare[id];
    if (id === 'eeg') updateEeg(S, session);
    session.active = false;
    session.stoppedAt = S.t;
  }
}

function dischargeBlockers(S) {
  return SUPPORT_IDS.filter(id => active(S, id)).map(id => `仍在使用 ${DEVICES[id].name}，撤除后需重新评估`);
}

function hadEcmo(S) {
  return S.advancedCare?.vaEcmo?.startedAt != null || S.advancedCare?.vvEcmo?.startedAt != null;
}

function hasEcmo(S) {
  return active(S, 'vaEcmo') || active(S, 'vvEcmo');
}

function ecmoFlow(S) {
  // 回路可用流量受静脉回流约束，严重低容量时下降。
  const drainage = Math.min(1, Math.max(0.12, (S.vol - 1.6) / 2.4));
  return 3.8 * drainage;
}

const API = { DEVICES, active, status, restore, action, advance, finish, dischargeBlockers, hadEcmo, hasEcmo, ecmoFlow,
  eegReading, monitor(S) {
    if (active(S, 'eeg')) updateEeg(S, S.advancedCare.eeg);
  } };
if (typeof module !== 'undefined' && module.exports) module.exports = API;
root.LIFE_ADVANCED_CARE = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
