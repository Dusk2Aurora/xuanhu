/* 每床费用与游戏医保规则。金额以元累计，结算时统一按分取整。 */
(function (root) {
'use strict';

const INSURANCE = [
  { t: '职工医保', rate: 0.78, ded: 800, cap: 30000 },
  { t: '居民医保', rate: 0.58, ded: 500, cap: 15000 },
  { t: '异地自费', rate: 0, ded: 0, cap: 0 },
];
const PARTIAL_SELF_PAY = 0.30;
const COVERAGE_LABELS = { selfPay: '全自费', partial: `部分支付（先自付 ${PARTIAL_SELF_PAY * 100}%）` };
const INCOME_BANDS = [
  { share: 0.15, min: 1800, max: 4200 },
  { share: 0.55, min: 4200, max: 23000 },
  { share: 0.22, min: 23000, max: 48000 },
  { share: 0.08, min: 48000, max: 100000 },
];

function seededFraction(key, salt) {
  let hash = 2166136261;
  const input = `${salt}:${key}`;
  for (let i = 0; i < input.length; i++) hash = Math.imul(hash ^ input.charCodeAt(i), 16777619);
  hash = Math.imul(hash ^ (hash >>> 16), 0x7feb352d);
  hash = Math.imul(hash ^ (hash >>> 15), 0x846ca68b);
  return ((hash ^ (hash >>> 16)) >>> 0) / (2 ** 32);
}

function familyIncome(percentile) {
  for (const { share, min, max } of INCOME_BANDS) {
    if (percentile < share) return Math.round((min + (max - min) * percentile / share) / 100) * 100;
    percentile -= share;
  }
  return INCOME_BANDS.at(-1).max;
}

function initInsurance(patient, type) {
  const previous = patient.ins;
  if (previous && type == null) return previous;
  const seed = patient.seed ?? patient.cas?.seed;
  const key = seed ?? JSON.stringify([patient.caseId, patient.patient?.name, patient.patient?.age,
    patient.patient?.sex, patient.patient?.weight, patient.patient?.height]);
  const randomSwitch = type === 'random';
  const choices = randomSwitch && previous ? INSURANCE.filter(plan => plan.t !== previous.t) : INSURANCE;
  const choice = randomSwitch ? Math.random() : seededFraction(key, 'insurance');
  const plan = choices.find(item => item.t === type) ?? choices[Math.floor(choice * choices.length)];
  const income = previous?.income ?? familyIncome(seededFraction(key, 'income'));
  patient.ins = { ...plan, income, oopCap: previous?.oopCap ?? income * 3 };
  return patient.ins;
}

function coverageLabel(coverage) {
  return Object.hasOwn(COVERAGE_LABELS, coverage) ? COVERAGE_LABELS[coverage] : '';
}

function recordCoverage(patient, coverage, amount) {
  if ((coverage !== 'selfPay' && coverage !== 'partial') || !(Number.isFinite(amount) && amount > 0)) return;
  const totals = patient.coverageCost ??= {};
  totals[coverage] = (totals[coverage] || 0) + amount;
}

function chargeDevice(patient, amount, coverage, phase) {
  if (!(Number.isFinite(amount) && amount > 0)) return;
  patient.cost = (patient.cost || 0) + amount;
  patient.deviceCost = (patient.deviceCost || 0) + amount;
  if (phase === 'setup') patient.deviceSetupCost = (patient.deviceSetupCost || 0) + amount;
  if (phase === 'running') patient.deviceRunningCost = (patient.deviceRunningCost || 0) + amount;
  recordCoverage(patient, coverage, amount);
}

function costSummary(patient, additionalCost = 0, additionalCoverage) {
  const { cost = 0, bedCost = 0, ins, coverageCost } = patient;
  const total = cost + bedCost + additionalCost;
  const totalFen = Math.round(total * 100);
  const selfPayOnly = (coverageCost?.selfPay || 0) + (additionalCoverage === 'selfPay' ? additionalCost : 0);
  const partial = (coverageCost?.partial || 0) + (additionalCoverage === 'partial' ? additionalCost : 0);
  const partialUpfront = partial * PARTIAL_SELF_PAY;
  // 先算出未经取整的医保基数，避免全自费项目的零星分差改变报销额。
  const eligibleFen = Math.round(Math.max(0, total - selfPayOnly - partialUpfront) * 100);
  const excludedFen = totalFen - eligibleFen;
  const partialUpfrontFen = selfPayOnly > 0 ? Math.min(excludedFen, Math.round(partialUpfront * 100)) : excludedFen;
  const selfPayOnlyFen = excludedFen - partialUpfrontFen;
  const reimbFen = ins ? Math.round(Math.min(ins.cap * 100, Math.max(0, eligibleFen - ins.ded * 100) * ins.rate)) : 0;
  return {
    total: totalFen / 100, reimb: reimbFen / 100, selfPay: (totalFen - reimbFen) / 100, cap: ins?.oopCap || 0,
    selfPayOnly: selfPayOnlyFen / 100, partialUpfront: partialUpfrontFen / 100, eligible: eligibleFen / 100,
  };
}

const api = { initInsurance, coverageLabel, recordCoverage, chargeDevice, costSummary, PARTIAL_SELF_PAY };
root.LIFE_FINANCE = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
