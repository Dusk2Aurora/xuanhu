/* 肺动脉导管取栓。造影证据来自已回报的本床检查，介入过程使用模拟时钟。 */
(function (root) {
'use strict';

const name = '肺动脉导管取栓';
const cost = 22000;
const duration = 20 * 60;
const baseRisk = 0.07;

function status(S) {
  if (S.peIntervention?.completedAt != null) return S.peIntervention.outcome === 'failed' ? '介入失败' : '已完成';
  if (S.peIntervention) return '介入中';
  return '未启动';
}

function start(S) {
  if (!S.running || !canRequest(S)) return { ok: false, reason: '当前无法重复启动取栓' };
  const report = (S.diagnosticReports || []).filter(item => item.type === 'ctpa').at(-1);
  if (!report?.rows.some(row => row.label === '肺动脉' && row.flag === '异常')) {
    return { ok: false, reason: '会诊尚缺本床肺动脉造影阳性报告，请复核检查。' };
  }
  if (!(S.clot > 0.25)) return { ok: false, reason: '介入会诊未发现仍需取栓的明显血栓负荷。' };
  const bleeding = Object.values(S.bleedingSites || {}).some(rate => rate > 0) || S.hematoma > 0.12;
  const reassessedAfterLysis = (S.given || []).some(order =>
    order.id === 'alteplase' && order.d > 0 && S.t - order.t >= 15 * 60);
  if (!root.LIFE?.allowsRiskyActions(S) && !bleeding && !reassessedAfterLysis && S.map >= 65 && !S.pumps?.norepi?.rate) {
    return { ok: false, reason: '循环稳定，会诊建议先评估抗凝、出血风险和治疗反应。' };
  }
  const blocked = root.LIFE?.procedureRetryBlock(S, 'peIntervention', baseRisk);
  if (blocked) return { ok: false, reason: blocked.reason, reportId: blocked.reportId };
  S.peInterventionCost = billedCost(S) + cost;
  S.peIntervention = { startedAt: S.t, dueAt: S.t + duration, completedAt: null, cost };
  S.cost += cost;
  S.log.push(['操作', name + '已启动，预计 20 个模拟分钟，费用 ¥' + cost, 'info', S.t, null, true]);
  return { ok: true };
}

function advance(S, resolveProcedure = root.LIFE?.resolveProcedure) {
  const order = S.peIntervention;
  if (!order || order.completedAt != null || S.death || S.t + 1e-7 < order.dueAt) return;
  order.completedAt = order.dueAt;
  if (resolveProcedure && !resolveProcedure(S, 'peIntervention', name, cost, baseRisk, { alreadyCharged: true }).ok) {
    order.outcome = 'failed';
    return;
  }
  order.outcome = 'completed';
  S.clot = Math.max(0, (S.clot || 0) * 0.18);
  S.log.push(['操作', name + '完成，复评血压、氧合及右心负荷', 'good', order.completedAt, null, true]);
}

function active(S) { return !!S.peIntervention && S.peIntervention.completedAt == null; }

function canRequest(S) { return !S.peIntervention || S.peIntervention.outcome === 'failed'; }

function billedCost(S) { return S.peInterventionCost ?? S.peIntervention?.cost ?? 0; }

const api = { name, cost, duration, start, active, status, advance, canRequest, billedCost };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
root.PE_INTERVENTION = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
