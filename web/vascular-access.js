(function (root) {
'use strict';

const DEFINITIONS = {
  piv: { name: '外周静脉置管', site: '前臂', seconds: 30, cost: 40, failureCost: 10, pumpCapacity: 1 },
  usPiv: { name: '超声引导外周静脉置管', site: '前臂', seconds: 60, cost: 120, failureCost: 30, pumpCapacity: 1 },
  io: { name: '骨内置管', site: '胫骨近端', seconds: 20, cost: 320, failureCost: 200, pumpCapacity: 1 },
  cvc: { name: '超声引导中心静脉置管', site: '颈内静脉', seconds: 180, cost: 600, failureCost: 200, pumpCapacity: 3 },
};
const SIDES = { left: '左侧', right: '右侧' };
const VEIN_GRADES = {
  good: { text: '血管良好', risk: { piv: 0.05, usPiv: 0.05 } },
  difficult: { text: '血管细弱难辨', risk: { piv: 0.25, usPiv: 0.10 } },
  collapsed: { text: '血管严重塌陷，仍可尝试', risk: { piv: 0.55, usPiv: 0.30 } },
};

function isSite(type, side) {
  return Object.hasOwn(DEFINITIONS, type) && Object.hasOwn(SIDES, side);
}

function siteName(type, side) {
  return SIDES[side] + DEFINITIONS[type].site;
}

function makeLine(id, type, side, origin, establishedAt) {
  const { name, pumpCapacity } = DEFINITIONS[type];
  return { id, type, side, name: origin === 'legacy' ? '既用通路（旧存档）' : name,
    site: side == null ? '旧存档未记录穿刺部位' : siteName(type, side), origin, establishedAt, pumpCapacity };
}

function createState({ seed = 0, prehospitalAccess } = {}) {
  const state = { lines: [], attempt: null, activeId: null, pumps: Object.create(null), seed: seed >>> 0, nextId: 1 };
  if (isSite(prehospitalAccess?.type, prehospitalAccess?.side)) {
    const { type, side } = prehospitalAccess;
    const line = makeLine('access-0', type, side, 'prehospital', 0);
    state.lines.push(line);
    state.activeId = line.id;
  }
  return state;
}

function getLine(state, id) {
  return state?.lines?.find(line => line.id === id) || null;
}

function getActive(state) {
  return getLine(state, state?.activeId);
}

function restoreState(saved, initial) {
  if (!Array.isArray(saved?.lines)) return createState(initial);
  const state = createState({ seed: saved.seed ?? initial?.seed });
  for (const line of saved.lines) {
    if (typeof line?.id !== 'string' || getLine(state, line.id)) continue;
    const legacy = line.origin === 'legacy' && Object.hasOwn(DEFINITIONS, line.type) && line.side == null;
    if (!legacy && !isSite(line.type, line.side)) continue;
    const origin = legacy || line.origin === 'prehospital' ? line.origin : 'placed';
    state.lines.push(makeLine(line.id, line.type, line.side, origin, line.establishedAt));
  }
  const attempt = saved.attempt;
  if (attempt && typeof attempt.id === 'string' && isSite(attempt.type, attempt.side) &&
      Number.isFinite(attempt.endsAt) && !getLine(state, attempt.id)) state.attempt = { ...attempt };
  state.activeId = (getLine(state, saved.activeId) || state.lines[0])?.id ?? null;
  for (const [id, lineId] of Object.entries(saved.pumps || {})) {
    if (getLine(state, lineId)) assignPump(state, id, lineId);
  }
  const issuedIds = [...state.lines, ...(state.attempt ? [state.attempt] : [])];
  const firstUnused = issuedIds.reduce((next, record) => {
    const sequence = Number(record.id.match(/^access-(\d+)$/)?.[1] ?? 0);
    return Math.max(next, sequence + 1);
  }, 1);
  state.nextId = Math.max(firstUnused, Number.isSafeInteger(saved.nextId) ? saved.nextId : 1);
  return state;
}

function addLegacyLine(state, type = 'piv') {
  if (!Object.hasOwn(DEFINITIONS, type)) return null;
  let index = 1;
  while (getLine(state, `legacy-${index}`)) index++;
  const line = makeLine(`legacy-${index}`, type, null, 'legacy', null);
  state.lines.push(line);
  state.activeId ??= line.id;
  return line;
}

function selectLine(state, id) {
  const line = getLine(state, id);
  if (!line) return { ok: false, reason: '该通路尚不可用' };
  state.activeId = id;
  return { ok: true, line };
}

function caseSite(patient, type, side) {
  const sites = patient?.vascularAccessSites;
  const sameForearm = type === 'usPiv' ? sites?.piv?.[side] : undefined;
  return { ...sameForearm, ...sites?.[type]?.[side] };
}

function hasCase(patient, id) {
  return patient?.id === id || patient?.cases?.includes(id);
}

function perfusionGrade(actual) {
  const { map, rhythm, do2, do2Crit } = actual;
  const oxygenDelivery = do2Crit > 0 ? do2 / do2Crit : 1;
  if ((rhythm && rhythm !== 'sinus') || map < 45 || oxygenDelivery < 0.5) return 'collapsed';
  if (map < 65 || oxygenDelivery < 1) return 'difficult';
  return 'good';
}

function peripheralCondition(type, details, actual) {
  const visibleOnUltrasound = type === 'usPiv' && details.ultrasoundVisible === true;
  if ((details.noVein && !visibleOnUltrasound) || (type === 'usPiv' && details.ultrasoundVisible === false)) {
    return { blocked: '该部位未找到可穿刺静脉' };
  }
  const grade = details.peripheral || (details.noVein ? 'collapsed' : perfusionGrade(actual));
  const { text, risk } = VEIN_GRADES[grade] || VEIN_GRADES.good;
  return { condition: details.noVein ? '超声可定位，血管条件差' : text, risk: risk[type] };
}

function boneCondition(side, details, patient) {
  if (details.targetFracture) return { blocked: '该侧拟穿刺胫骨已有骨折' };
  if (side === 'right' && hasCase(patient, 'trauma')) return { blocked: '右下肢有开放伤及明显畸形' };
  const swollen = side === 'right' && hasCase(patient, 'pe');
  if (details.difficult ?? swollen) {
    return { condition: swollen ? '右下肢肿胀，骨性标志难辨' : '骨性标志难辨', risk: 0.15 };
  }
  return { condition: '骨性标志清楚', risk: 0.05 };
}

function centralCondition(details, actual, patient, sedated) {
  const poorFilling = details.poorFilling ?? actual.poorFilling ??
    (actual.vol < 3.3 || (actual.map < 45 && !(actual.tamponade > 0.45)));
  // Admission histories describe restlessness in these two cases. Follow the active disease and level of consciousness.
  const restless = (actual.tamponade > 0.45 || actual.thyroidHeatDrive > 0.45) && actual.gcs >= 10 && actual.gcs < 15;
  const agitated = !sedated && !actual.vent && (details.agitated ?? actual.agitated ?? patient?.vascularAccessAgitated ?? restless);
  if (poorFilling && agitated) return { condition: '目标血管充盈差，患者明显躁动', risk: 0.25 };
  if (poorFilling) return { condition: '目标血管充盈差', risk: 0.15 };
  if (agitated) return { condition: '患者明显躁动', risk: 0.15 };
  return { condition: '目标血管条件可，超声引导', risk: 0.05 };
}

function isPeripheral(type) {
  return type === 'piv' || type === 'usPiv';
}

function optionAt(state, type, side, { patient, actual = {}, difficulty = 1, sedated = false }) {
  const details = caseSite(patient, type, side);
  const { blocked, condition, risk } = isPeripheral(type) ? peripheralCondition(type, details, actual)
    : type === 'io' ? boneCondition(side, details, patient) : centralCondition(details, actual, patient, sedated);
  const occupied = state?.lines?.some(line => line.side === side &&
    (line.type === type || (isPeripheral(line.type) && isPeripheral(type))));
  const reason = details.contraindication || blocked || (occupied ? '该部位已有通路' : '') ||
    (state?.attempt ? '已有置管正在进行' : '');
  return {
    ...DEFINITIONS[type], type, side, site: siteName(type, side), condition: condition || reason,
    enabled: !reason, reason, failureChance: difficulty >= 6 && !reason ? risk : 0,
  };
}

function getOptions(state, context = {}) {
  return Object.keys(DEFINITIONS).flatMap(type => Object.keys(SIDES).map(side => optionAt(state, type, side, context)));
}

function start(state, { type, side, patient, actual, difficulty, now, sedated }) {
  if (!state || !isSite(type, side) || !Number.isFinite(now)) return { ok: false, reason: '未选择有效的穿刺部位' };
  const option = optionAt(state, type, side, { patient, actual, difficulty, sedated });
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
  const { id, type, side, endsAt, failureChance, cost, failureCost } = attempt;
  if (attemptRoll(state.seed, id) < failureChance) return { ok: true, success: false, attempt, cost: failureCost };
  const line = makeLine(id, type, side, 'placed', endsAt);
  state.lines.push(line);
  state.activeId ??= line.id;
  return { ok: true, success: true, attempt, line, cost };
}

function getPumpLine(state, id) {
  return getLine(state, state?.pumps?.[id]);
}

function freePumpSlots(state, line) {
  return line.pumpCapacity - Object.values(state.pumps).filter(lineId => lineId === line.id).length;
}

function getAvailablePumpLine(state, pumpId, allowedTypes) {
  if (!state) return null;
  const allowed = line => !allowedTypes || allowedTypes.includes(line.type);
  const current = getPumpLine(state, pumpId);
  if (current) return allowed(current) ? current : null;
  const active = getActive(state);
  const available = line => line && allowed(line) && freePumpSlots(state, line) > 0;
  return (available(active) ? active : state.lines.find(available)) || null;
}

function assignPump(state, id, lineId) {
  const current = getPumpLine(state, id);
  if (current && lineId != null && current.id !== lineId) return { ok: false, reason: '该泵已接入其他通路' };
  const line = lineId == null ? getAvailablePumpLine(state, id) : getLine(state, lineId);
  if (!line) return { ok: false, reason: '暂无可接入此泵的通路' };
  if (!current && freePumpSlots(state, line) < 1) return { ok: false, reason: '该通路的独立泵位已满' };
  state.pumps[id] = line.id;
  return { ok: true, lineId: line.id };
}

function releasePump(state, id) {
  if (state) delete state.pumps[id];
}

function getMigration(state, toId, pumpIds) {
  const target = getLine(state, toId);
  if (target?.type !== 'cvc' || target.origin === 'legacy') return { ok: false, reason: '请先建立中心静脉通路' };
  const moved = [...new Set(pumpIds ?? Object.keys(state.pumps))].filter(id => {
    const source = getPumpLine(state, id);
    return source && source.id !== toId;
  });
  if (!moved.length) return { ok: false, reason: '没有可迁移的泵' };
  if (moved.length > freePumpSlots(state, target)) return { ok: false, reason: '中心静脉通路的剩余泵位不足' };
  const fromIds = [...new Set(moved.map(id => state.pumps[id]))];
  return { ok: true, toId, moved, fromId: fromIds[0], fromIds };
}

function migrate(state, toId, pumpIds) {
  const move = getMigration(state, toId, pumpIds);
  if (move.ok) {
    for (const id of move.moved) state.pumps[id] = toId;
    state.activeId = toId;
  }
  return move;
}

const API = { createState, restoreState, addLegacyLine, getOptions, getActive, getLine, selectLine, start, advance, getRemaining,
  getAvailablePumpLine, assignPump, releasePump, getPumpLine, getMigration, migrate };
if (typeof module !== 'undefined' && module.exports) module.exports = API;
root.VascularAccess = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
