(function (root) {
'use strict';

const DEFINITIONS = {
  piv: { name: '外周静脉置管', site: '前臂', seconds: 30, cost: 40, failureCost: 10 },
  usPiv: { name: '超声引导外周静脉置管', site: '前臂', seconds: 60, cost: 120, failureCost: 30 },
  io: { name: '骨内置管', site: '胫骨近端', seconds: 20, cost: 320, failureCost: 200 },
  cvc: { name: '超声引导中心静脉置管', site: '颈内静脉', seconds: 180, cost: 600, failureCost: 200 },
};
const TRAUMA_CASES = ['ptx', 'trauma', 'tamponade', 'spleen', 'tbi', 'fallTrauma', 'burn'];
const TRAUMA_RISK = 0.10;
const PERIPHERAL_RISKS = {
  good: { piv: 0.05, usPiv: 0.05 },
  difficult: { piv: 0.25, usPiv: 0.10 },
  collapsed: { piv: 0.55, usPiv: 0.30 },
};

function makeLine(id, type, origin, establishedAt) {
  const { name, site } = DEFINITIONS[type];
  return { id, type, name: origin === 'legacy' ? '既用通路（旧存档）' : name,
    site: origin === 'legacy' ? '旧存档未记录穿刺部位' : site, origin, establishedAt };
}

function createState({ seed = 0, prehospitalAccess } = {}) {
  const state = { lines: [], attempt: null, seed: seed >>> 0, nextId: 1 };
  if (Object.hasOwn(DEFINITIONS, prehospitalAccess?.type)) {
    state.lines.push(makeLine('access-0', prehospitalAccess.type, 'prehospital', 0));
  }
  return state;
}

function getLine(state, id) {
  return state?.lines?.find(line => line.id === id) || null;
}

function hasAccess(state) {
  return Boolean(state?.lines?.length);
}

function restoreState(saved, initial) {
  if (!Array.isArray(saved?.lines)) return createState(initial);
  const state = createState({ seed: saved.seed ?? initial?.seed });
  const issuedIds = new Set();
  let activeLine;
  let latestLine;
  let latestTime = -Infinity;
  for (const line of saved.lines) {
    if (typeof line?.id !== 'string' || !Object.hasOwn(DEFINITIONS, line.type) || issuedIds.has(line.id)) continue;
    issuedIds.add(line.id);
    if (line.id === saved.activeId) activeLine = line;
    const time = Number.isFinite(line.establishedAt) ? line.establishedAt : -Infinity;
    if (time >= latestTime) {
      latestLine = line;
      latestTime = time;
    }
  }
  const current = activeLine ?? latestLine;
  if (current) {
    const { id, type, establishedAt } = current;
    const origin = current.origin === 'legacy' || current.origin === 'prehospital' ? current.origin : 'placed';
    state.lines.push(makeLine(id, type, origin, establishedAt));
  }
  const attempt = saved.attempt;
  if (attempt && typeof attempt.id === 'string' && Object.hasOwn(DEFINITIONS, attempt.type) &&
      Number.isFinite(attempt.endsAt) && !issuedIds.has(attempt.id)) {
    issuedIds.add(attempt.id);
    const { id, type, startedAt, endsAt, failureChance } = attempt;
    if (type !== current?.type) {
      state.attempt = { ...DEFINITIONS[type], type, enabled: true, reason: '', failureChance, id, startedAt, endsAt };
    }
  }
  if (Number.isSafeInteger(saved.nextId) && saved.nextId > 0) state.nextId = saved.nextId;
  for (const id of issuedIds) {
    const sequence = Number(id.match(/^access-(\d+)$/)?.[1] ?? 0);
    if (Number.isSafeInteger(sequence + 1)) state.nextId = Math.max(state.nextId, sequence + 1);
  }
  return state;
}

function addLegacyLine(state, type = 'piv') {
  if (hasAccess(state) || state.attempt || !Object.hasOwn(DEFINITIONS, type)) return null;
  const line = makeLine('legacy-1', type, 'legacy', null);
  state.lines.push(line);
  return line;
}

function hasCase(patient, id) {
  return patient?.id === id || patient?.cases?.includes(id) || patient?.tags?.includes(id);
}

function perfusionGrade(actual) {
  const { map, rhythm, do2, do2Crit } = actual;
  const oxygenDelivery = do2Crit > 0 ? do2 / do2Crit : 1;
  if ((rhythm && rhythm !== 'sinus') || map < 45 || oxygenDelivery < 0.5) return 'collapsed';
  if (map < 65 || oxygenDelivery < 1) return 'difficult';
  return 'good';
}

function centralRisk(actual, patient, sedated) {
  const poorFilling = actual.poorFilling ??
    (actual.vol < 3.3 || (actual.map < 45 && !(actual.tamponade > 0.45)));
  // Admission histories describe restlessness in these two cases. Follow the active disease and level of consciousness.
  const restless = (actual.tamponade > 0.45 || actual.thyroidHeatDrive > 0.45) && actual.gcs >= 10 && actual.gcs < 15;
  const agitated = !sedated && !actual.vent && (actual.agitated ?? patient?.vascularAccessAgitated ?? restless);
  if (poorFilling && agitated) return 0.25;
  return poorFilling || agitated ? 0.15 : 0.05;
}

function isPeripheral(type) {
  return type === 'piv' || type === 'usPiv';
}

function optionFor(state, type, { patient, actual = {}, difficulty = 1, sedated = false }) {
  let reason = '';
  if (state?.lines?.[0]?.type === type) reason = '当前已有同类通路';
  else if (state?.attempt) reason = '已有置管正在进行';
  let failureChance = 0;
  if (difficulty >= 6 && !reason) {
    const risk = isPeripheral(type) ? PERIPHERAL_RISKS[perfusionGrade(actual)][type]
      : type === 'io' ? (hasCase(patient, 'pe') ? 0.15 : 0.05) : centralRisk(actual, patient, sedated);
    const traumaRisk = TRAUMA_CASES.some(id => hasCase(patient, id)) ? TRAUMA_RISK : 0;
    failureChance = Math.min(1, risk + traumaRisk);
  }
  return { ...DEFINITIONS[type], type, enabled: !reason, reason, failureChance };
}

function getOptions(state, context = {}) {
  return Object.keys(DEFINITIONS).map(type => optionFor(state, type, context));
}

function start(state, { type, patient, actual, difficulty, now, sedated }) {
  if (!state || !Object.hasOwn(DEFINITIONS, type) || !Number.isFinite(now)) return { ok: false, reason: '未选择有效的置管方式' };
  const option = optionFor(state, type, { patient, actual, difficulty, sedated });
  if (!option.enabled) return { ok: false, reason: option.reason };
  const attempt = { ...option, id: `access-${state.nextId++}`, startedAt: now, endsAt: now + option.seconds };
  state.attempt = attempt;
  return { ok: true, attempt };
}

function getRemaining(state, now) {
  return state?.attempt ? Math.max(0, state.attempt.endsAt - now) : 0;
}

function attemptRoll(seed, id) {
  // Each accepted attempt has a saved sequence number, independent of render and tick frequency.
  let mixed = (seed + Math.imul(Number(id.slice(7)), 0x6D2B79F5)) | 0;
  mixed = Math.imul(mixed ^ mixed >>> 15, mixed | 1);
  mixed ^= mixed + Math.imul(mixed ^ mixed >>> 7, mixed | 61);
  return ((mixed ^ mixed >>> 14) >>> 0) / 4294967296;
}

function advance(state, now) {
  const attempt = state?.attempt;
  if (!attempt || !Number.isFinite(now) || getRemaining(state, now) > 1e-7) return null;
  state.attempt = null;
  const { id, type, endsAt, failureChance, cost, failureCost } = attempt;
  if (attemptRoll(state.seed, id) < failureChance) return { ok: true, success: false, attempt, cost: failureCost };
  const line = makeLine(id, type, 'placed', endsAt);
  state.lines.splice(0, state.lines.length, line);
  return { ok: true, success: true, attempt, line, cost };
}

const API = { createState, restoreState, addLegacyLine, getOptions, hasAccess, getLine, start, advance, getRemaining };
if (typeof module !== 'undefined' && module.exports) module.exports = API;
root.VascularAccess = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
