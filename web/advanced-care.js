(function (root) {
'use strict';

const FINANCE = root.LIFE_FINANCE || (typeof module !== 'undefined' && module.exports ? require('./finance.js') : null);
const DEVICES = Object.freeze({
  vaEcmo: Object.freeze({ name: 'VA-ECMO', startCost: 45000, hourlyCost: 2000, coverage: 'selfPay',
    trialDescription: '暂降循环与氧合支持',
    description: '体外维持循环及气体交换，为病因治疗争取时间。' }),
  vvEcmo: Object.freeze({ name: 'VV-ECMO', startCost: 45000, hourlyCost: 2000, coverage: 'selfPay',
    trialDescription: '暂降气体交换支持',
    description: '体外支持氧合和二氧化碳清除，依赖患者自身循环。' }),
  crrt: Object.freeze({ name: 'CRRT', startCost: 3500, hourlyCost: 450, coverage: 'partial',
    trialDescription: '暂停溶质清除和超滤',
    description: '连续肾脏替代治疗，逐步清除溶质并纠正高钾、代谢性酸中毒和容量过多。' }),
  eeg: Object.freeze({ name: '持续脑电监测', startCost: 600, hourlyCost: 120, coverage: 'partial',
    trialDescription: '暂停脑电采集',
    description: '连续观察脑电背景和发作样活动，为复评意识障碍和识别隐匿发作提供线索。' }),
  ttm: Object.freeze({ name: '亚低温治疗', startCost: 1800, hourlyCost: 250, coverage: 'partial',
    trialDescription: '暂缓控温，观察核心体温',
    description: '心脏骤停复苏后仍昏迷时，可进行设备控温。降温、维持和受控复温均由模拟时钟推进。' }),
  aorticBypass: Object.freeze({ name: '手术室体外循环与控温准备', startCost: 2400, hourlyCost: 450, coverage: 'partial',
    trialDescription: '暂缓术前控温，观察体温与灌注',
    description: '用于需要处理主动脉弓的 A 型夹层。手术团队准备体外循环和脑保护，待模拟术前温度及灌注稳定后开始修复，术后受控复温。' }),
});
const DEVICE_IDS = Object.keys(DEVICES);
const SUPPORT_IDS = ['vaEcmo', 'vvEcmo', 'crrt', 'ttm', 'aorticBypass'];
const EMPTY = Object.freeze({ active: false, startedAt: null, stoppedAt: null, seconds: 0, cost: 0 });
const ECMO_TRIAL_SUPPORT = 0.35;
const REWARM_TARGET = 36.5;
const AORTIC_PREP_STABILITY = 2 * 60;
// Rates and the aortic preoperative target use compressed game time. The aortic
// circuit is readied for the OR team, which handles intraoperative cerebral protection.
// AHA post-arrest guidance and EACTS/EACTAIC/EBCP 2024 CPB guidelines inform the two workflows.
const TEMPERATURE_PROFILES = {
  ttm: { target: 34, coolingRate: 0.24 / 60, warmingRate: 0.075 / 60 },
  aorticBypass: { target: 33.5, coolingRate: 0.48 / 60, warmingRate: 0.30 / 60 },
};
const EEG_READINGS = Object.freeze({
  collecting: '正在采集，约 1 个模拟分钟后提供首个监测片段。',
  seizure: '捕捉到发作样脑电活动，请复评意识、查体和发作诱因。',
  slowing: '背景活动弥漫性减慢，需结合用药、代谢和脑功能评估。',
  normal: '当前监测片段未见发作样活动。',
});

function active(S, id) {
  return S.advancedCare?.[id]?.active === true;
}

function temperatureDevice(S) {
  return active(S, 'aorticBypass') ? 'aorticBypass' : active(S, 'ttm') ? 'ttm' : null;
}

function status(S, id) {
  const session = Object.hasOwn(DEVICES, id) && S.advancedCare?.[id];
  if (!session) {
    return Object.hasOwn(TEMPERATURE_PROFILES, id) ? { ...EMPTY, phase: null, target: TEMPERATURE_PROFILES[id].target } : EMPTY;
  }
  const { active, startedAt, stoppedAt, seconds, cost } = session;
  return { active, startedAt, stoppedAt, seconds, cost,
    ...(session.trial ? { trial: { ...session.trial } } : {}),
    ...(Object.hasOwn(TEMPERATURE_PROFILES, id) ? { phase: session.phase, target: session.target } : {}) };
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
    const temperature = TEMPERATURE_PROFILES[id];
    const startedAt = Number.isFinite(previous.startedAt) && previous.startedAt >= 0 && previous.startedAt <= S.t
      ? previous.startedAt : null;
    if (startedAt == null) continue;
    const wasActive = previous.active === true;
    const inUse = wasActive && !(S.death || S.discharged || S.dischargeOutcome)
      && !(id === 'vvEcmo' && active(S, 'vaEcmo')) && !(id === 'crrt' && S.dialysisUntil > S.t)
      && !(temperature && temperatureDevice(S));
    const stoppedAt = inUse ? null : Number.isFinite(previous.stoppedAt) && previous.stoppedAt >= startedAt
      ? Math.min(S.t, previous.stoppedAt) : S.t;
    const session = { active: inUse, startedAt, stoppedAt, seconds: elapsedValue(previous.seconds), cost: elapsedValue(previous.cost) };
    const trial = previous.trial;
    const trialAllowed = inUse && previous.phase !== 'rewarming' && !(id === 'aorticBypass' && S.aorticSurgeryStartedAt != null);
    if (trialAllowed && Number.isFinite(trial?.startedAt) &&
        trial.startedAt >= startedAt && trial.startedAt <= S.t &&
        typeof trial.baseline === 'string' && trial.baseline.length > 0 && trial.baseline.length <= 240) {
      session.trial = { startedAt: trial.startedAt, baseline: trial.baseline };
    }
    if (id === 'eeg') {
      session.reading = Object.hasOwn(EEG_READINGS, previous.reading) ? previous.reading : 'collecting';
      session.pausedSeconds = Math.min(elapsedValue(previous.pausedSeconds), (session.trial?.startedAt ?? stoppedAt ?? S.t) - startedAt);
      if (Number.isFinite(previous.lastSeizureAt) && previous.lastSeizureAt >= startedAt && previous.lastSeizureAt <= S.t) {
        session.lastSeizureAt = previous.lastSeizureAt;
      }
    }
    if (temperature) {
      session.phase = inUse ? ['cooling', 'maintaining', 'rewarming'].find(phase => phase === previous.phase) || 'cooling'
        : previous.phase === 'complete' ? 'complete' : 'stopped';
      session.target = session.phase === 'rewarming' || session.phase === 'complete' ? REWARM_TARGET
        : id === 'ttm' && Number.isFinite(previous.target) ? Math.min(temperature.target, Math.max(32, previous.target)) : temperature.target;
      if (id === 'aorticBypass') {
        session.stableSince = !session.trial && session.phase === 'maintaining' && Number.isFinite(previous.stableSince)
          && previous.stableSince >= startedAt && previous.stableSince <= S.t ? previous.stableSince : null;
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
  const temperature = TEMPERATURE_PROFILES[id];
  if (enable && temperature && temperatureDevice(S)) return { ok: false, reason: '本床已有设备控温或正在复温' };

  const session = (S.advancedCare ??= {})[id] ??= { ...EMPTY };
  const trialStop = !enable && Boolean(session.trial);
  if (temperature && !enable) {
    if (session.phase === 'rewarming') return { ok: false, reason: '正在受控复温' };
    delete session.trial;
    session.target = REWARM_TARGET;
    if (id === 'aorticBypass') session.stableSince = null;
    if (S.temp >= REWARM_TARGET) {
      session.active = false;
      session.phase = 'complete';
      session.stoppedAt = S.t;
      if (!trialStop) S.log.push([fmt(S.t), `${name}已结束，继续观察体温`, 'info', S.t, null, true]);
      return { ok: true };
    }
    session.phase = 'rewarming';
    if (!trialStop) S.log.push([fmt(S.t), `${name} → 开始受控复温`, 'info', S.t, null, true]);
    return { ok: true };
  }
  session.active = enable;
  if (enable) {
    session.startedAt = S.t;
    session.stoppedAt = null;
    if (id === 'eeg') {
      session.reading = 'collecting';
      session.lastSeizureAt = null;
      session.pausedSeconds = 0;
    }
    if (temperature) {
      session.target = id === 'ttm' ? Math.min(temperature.target, Math.max(32, S.temp)) : temperature.target;
      session.phase = S.temp > session.target || (id === 'aorticBypass' && S.temp !== session.target) ? 'cooling' : 'maintaining';
      if (id === 'aorticBypass') session.stableSince = null;
      S.env.cooling = 0;
      S.env.warming = 0;
    }
    charge(S, id, startCost, 'setup');
  } else {
    if (id === 'eeg') updateEeg(S, session);
    session.stoppedAt = S.t;
  }
  delete session.trial;
  if (!trialStop) S.log.push([fmt(S.t), `${enable ? '启动' : '撤除'} ${name}`, 'good', S.t, null, true]);
  return { ok: true };
}

function trialAction(S, id, begin, baseline) {
  if (!Object.hasOwn(DEVICES, id)) return { ok: false, reason: '未知设备操作' };
  if (!S.running || S.death || S.discharged || S.dischargeOutcome) return { ok: false, reason: '本例已结束' };
  const { name } = DEVICES[id];
  if (!active(S, id)) return { ok: false, reason: `${name} 已停止` };
  const session = S.advancedCare[id];
  if (session.phase === 'rewarming') return { ok: false, reason: '正在受控复温' };
  if (Boolean(session.trial) === begin) return { ok: false, reason: begin ? `正在进行 ${name} 试撤` : `${name} 已在原运行状态` };
  if (begin) {
    session.trial = { startedAt: S.t, baseline };
    if (id === 'aorticBypass') session.stableSince = null;
  } else {
    if (id === 'eeg') session.pausedSeconds = (session.pausedSeconds || 0) + S.t - session.trial.startedAt;
    if (session.phase === 'maintaining' && S.temp !== session.target) session.phase = 'cooling';
    delete session.trial;
  }
  return { ok: true };
}

function ecmoSupportFraction(S, id) {
  return S.advancedCare?.[id]?.trial ? ECMO_TRIAL_SUPPORT : 1;
}

function updateEeg(S, session) {
  if (session.trial) return;
  const seizure = (S.seizure || 0) >= 0.08;
  if (seizure) session.lastSeizureAt = S.t;
  if (S.t - session.startedAt - (session.pausedSeconds || 0) < 60 - 1e-7) return;
  session.reading = seizure ? 'seizure' : S.gcs <= 12 ? 'slowing' : 'normal';
}

function eegReading(S) {
  const session = S.advancedCare?.eeg;
  const status = session?.trial ? 'paused' : session?.reading || 'off';
  let text = EEG_READINGS[status] ?? '持续脑电监测未启用。';
  if (status === 'paused') {
    text = session.reading === 'collecting' ? '试撤中，脑电采集已暂停。' : `试撤中，脑电采集已暂停。末次记录：${EEG_READINGS[session.reading]}`;
  } else if (session?.stoppedAt != null) {
    text = status === 'collecting' ? '已停止监测，采集时间不足以提供监测片段。' : `已停止监测。末次记录：${text}`;
  }
  return { status, text, lastSeizureAt: session?.lastSeizureAt ?? null };
}

function advance(S, seconds) {
  if (!(seconds > 0)) return;
  for (const id of DEVICE_IDS) {
    if (Object.hasOwn(TEMPERATURE_PROFILES, id) || !active(S, id)) continue;
    S.advancedCare[id].seconds += seconds;
    charge(S, id, DEVICES[id].hourlyCost * seconds / 3600, 'running');
  }
}

function regulateTemperature(S, id, seconds, fmt) {
  const session = S.advancedCare[id];
  if (!(seconds > 0)) return !session.trial;
  if (session.trial) {
    session.seconds += seconds;
    charge(S, id, DEVICES[id].hourlyCost * seconds / 3600, 'running');
    return false;
  }
  const { coolingRate, warmingRate } = TEMPERATURE_PROFILES[id];
  const difference = session.target - S.temp;
  const rate = difference < 0 ? coolingRate : warmingRate;
  const needed = Math.abs(difference) / rate;
  const elapsed = session.phase === 'rewarming' ? Math.min(seconds, needed) : seconds;
  S.temp += Math.sign(difference) * Math.min(Math.abs(difference), rate * elapsed);
  session.seconds += elapsed;
  charge(S, id, DEVICES[id].hourlyCost * elapsed / 3600, 'running');
  if (seconds + 1e-7 < needed) return true;
  S.temp = session.target;
  if (session.phase === 'cooling') {
    session.phase = 'maintaining';
    const reachedAt = S.t - seconds + Math.min(seconds, needed);
    S.log.push([fmt(reachedAt), `${DEVICES[id].name} → 已达控温目标，进入维持阶段`, 'good', reachedAt, null, true]);
  } else if (session.phase === 'rewarming') {
    const stoppedAt = S.t - (seconds - elapsed);
    session.active = false;
    session.phase = 'complete';
    session.stoppedAt = stoppedAt;
    S.log.push([fmt(stoppedAt), '受控复温完成，继续观察体温', 'good', stoppedAt, null, true]);
  }
  return true;
}

function trackAorticStability(S, perfusionStable) {
  if (!active(S, 'aorticBypass')) return;
  const session = S.advancedCare.aorticBypass;
  if (!session.trial && session.phase === 'maintaining' && S.temp === session.target && perfusionStable) session.stableSince ??= S.t;
  else session.stableSince = null;
}

function aorticStableSeconds(S, perfusionStable) {
  const session = S.advancedCare?.aorticBypass;
  if (!session?.active || session.trial || session.phase !== 'maintaining' || S.temp !== session.target || !perfusionStable ||
      session.stableSince == null) return 0;
  return Math.min(AORTIC_PREP_STABILITY, Math.max(0, S.t - session.stableSince));
}

function finish(S) {
  for (const id of DEVICE_IDS) {
    if (!active(S, id)) continue;
    const session = S.advancedCare[id];
    if (id === 'eeg') updateEeg(S, session);
    delete session.trial;
    if (Object.hasOwn(TEMPERATURE_PROFILES, id)) session.phase = 'stopped';
    if (id === 'aorticBypass') session.stableSince = null;
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

const API = { DEVICES, active, status, restore, action, advance, temperatureDevice, regulateTemperature,
  AORTIC_PREP_STABILITY, trackAorticStability, aorticStableSeconds, finish, dischargeBlockers, hadEcmo, hasEcmo, ecmoFlow,
  trialAction, ecmoSupportFraction,
  eegReading, monitor(S) {
    if (active(S, 'eeg')) updateEeg(S, S.advancedCare.eeg);
  } };
if (typeof module !== 'undefined' && module.exports) module.exports = API;
root.LIFE_ADVANCED_CARE = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
