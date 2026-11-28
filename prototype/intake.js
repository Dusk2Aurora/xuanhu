/* 入院问诊。病例描述是素材，病历只显示已取得的证据。 */
(function (root) {
'use strict';

const VERSION = 1;
const SOURCES = [
  { id: 'patient', label: '患者自述' },
  { id: 'family', label: '家属转述', absent: '目前没有可联系的家属。' },
  { id: 'witness', label: '现场目击者', absent: '目前没有可联系的目击者。' },
  { id: 'ems', label: '急救交接', absent: '本次就诊没有现场急救交接。' },
  { id: 'records', label: '既往病历与用药记录', absent: '目前没有可查阅的既往病历或用药记录。' },
];
const TOPICS = [
  { id: 'present', label: '现病史' },
  { id: 'history', label: '既往史' },
  { id: 'medications', label: '用药与暴露' },
  { id: 'allergies', label: '药物过敏' },
  { id: 'prehospital', label: '院前情况' },
];
const chiefSources = {
  opioid: 'ems', hypogly: 'family', organophosphate: 'witness',
  ptx: 'ems', trauma: 'ems', hhs: 'family', co: 'witness', tamponade: 'ems',
  heatstroke: 'witness', myxedema: 'ems', liverFailure: 'family', tca: 'ems',
  tbi: 'ems', burn: 'ems', seizure: 'ems',
};
const criticalChiefs = new Set(['opioid', 'hypogly', 'seizure']);
const arrestRhythms = new Set(['vf', 'pea', 'asystole']);
/* 可由急救人员亲见的转运情况。 */
const transportObservations = {
  highK: '接触患者时乏力明显，需搀扶转运。',
  dka: '急救人员到场后见患者仍有呕吐。',
  bleed: '急救人员在现场见到血性呕吐物。',
  edema: '转运时呼吸急促，有粉红色泡沫样痰。',
  thyroid: '转运时患者烦躁，皮肤温热。',
  asthma: '转运时可闻喘鸣，患者说话断续。',
  htnEmergency: '转运前曾呕吐，随后反应变慢。',
  hyponatremia: '转运前曾呕吐，随后反应明显变差。',
  pe: '急救人员在现场见患者呼吸困难。',
  pancreatitis: '转运前仍有反复呕吐。',
  aki: '急救人员见患者眼睑及下肢水肿。',
  stemi: '急救人员到场时见患者面色苍白、出冷汗。',
  ectopic: '急救人员到场时患者反应迟缓，面色苍白。',
  preeclampsia: '急救人员见双下肢水肿。',
  bph: '急救人员观察到下腹膨隆。',
};
const sourceByDescription = {
  '病史回顾': 'reported', '院前病史': 'reported',
  '急救交接': 'ems', '院前交接': 'ems',
  '家属转述': 'family', '现场人员转述': 'witness',
};
const acuteBackground = new Set(['肺部感染', '骨盆骨折', '胸部外伤', '头部外伤', '腹部钝性外伤', '密闭空间火灾']);
const pregnancyHistory = new Set(['早孕', '妊娠 34 周']);
const fixedCases = {
  hyperkalemia: {
    module: 'highK', chief: '心悸、乏力约 1 天', minutesBefore: 1440,
    history: [[2880, '病史回顾', '近两天尿量明显减少。'], [1440, '病史回顾', '心悸、乏力逐渐加重。']],
    background: ['慢性肾病 3 期'],
  },
  dka: {
    module: 'dka', chief: '恶心、呕吐约 1 天', minutesBefore: 1440,
    history: [[4320, '病史回顾', '三天前开始多饮、多尿。'], [null, '家属转述', '今晨开始嗜睡。']],
    background: ['1 型糖尿病'], medications: ['近期自行停用胰岛素。'],
  },
  bleed: {
    module: 'bleed', chief: '呕血约 1 天', minutesBefore: 1440,
    history: [[1440, '病史回顾', '一天前开始排黑便，至到院前已呕血两次。'], [null, '院前病史', '起身时曾晕厥一次。']],
    background: ['消化性溃疡'], medications: ['长期服用阿司匹林。'],
  },
  sepsis: {
    module: 'sepsis', chief: '发热、咳嗽约 3 天', minutesBefore: 4320,
    history: [[1440, '家属转述', '一天前开始反应变慢，尿量减少。'], [null, '院前交接', '送医时皮肤可见花斑。']],
  },
  opioid: {
    module: 'opioid', chief: '被发现呼之不应约 1 小时', minutesBefore: 60,
    history: [[60, '院前交接', '被发现倒在房间，呼吸浅慢。'], [null, '院前交接', '急救人员检查时见双侧瞳孔针尖样缩小。']],
  },
};

function formatTime(minutesBefore) {
  if (minutesBefore == null) return '到院前，时间未详';
  if (minutesBefore === 0) return '到院时';
  if (minutesBefore % 1440 === 0) return `到院前约 ${minutesBefore / 1440} 天`;
  if (minutesBefore % 60 === 0) return `到院前约 ${minutesBefore / 60} 小时`;
  return `到院前约 ${minutesBefore} 分钟`;
}

function moduleById(id) {
  const generator = root.CASEGEN || (typeof module !== 'undefined' && module.exports ? require('./generator.js') : null);
  return generator?.MODULES.find(m => m.id === id);
}

function subject(S) {
  const C = S.cas || {};
  const fixed = fixedCases[C.id];
  if (fixed) {
    return {
      ids: [fixed.module], chief: fixed.chief, chiefMinutes: fixed.minutesBefore,
      history: fixed.history.map(([minutesBefore, source, text]) => ({ moduleId: fixed.module, minutesBefore, source, text })),
      background: fixed.background || [], medications: fixed.medications || [],
    };
  }
  const ids = C.cases || [];
  const primary = moduleById(ids[0]);
  return {
    ids, chief: primary?.chief ?? '已送至急诊，来诊经过待核实。', chiefMinutes: primary?.chiefMinutesBefore ?? null,
    history: C.admission?.history || [], background: C.admission?.background || [],
    medications: C.admission?.medicationHistory || [],
  };
}

function hashText(key) {
  let hash = 2166136261;
  for (const character of key) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return hash >>> 0;
}

function seededContact(S, salt) {
  const key = String(S.cas?.seed ?? S.seed ?? S.caseId ?? S.cas?.id ?? 'fixed') + ':' + salt;
  return hashText(key) % 100;
}

function historyFacts({ ids, history, background, medications }, traits) {
  const facts = [];
  const add = (section, text, source, minutesBefore = null, moduleId = null) => {
    const clean = text?.trim();
    if (!clean) return;
    const id = `intake-${hashText(JSON.stringify([section, clean, source, minutesBefore, moduleId])).toString(36)}`;
    if (facts.some(fact => fact.id === id)) return;
    facts.push({ id, section, text: clean, source, minutesBefore, moduleId });
  };
  for (const { moduleId, minutesBefore, source: description, text } of history) {
    const source = sourceByDescription[description] || 'reported';
    if (moduleId === 'dka' && text.startsWith('近期停用胰岛素，')) {
      add('present', text.replace(/^近期停用胰岛素，(三天前)?/, ''), source, minutesBefore, moduleId);
      add('medications', '近期停用胰岛素。', source, null, moduleId);
    } else if (moduleId === 'hypogly') {
      add('medications', '到院前注射胰岛素后未进食。', 'reported', minutesBefore, moduleId);
    } else if (moduleId === 'stemi') {
      const [symptoms, prehospital] = text.split('。曾含服');
      add('present', symptoms + '。', source, minutesBefore, moduleId);
      add('prehospital', prehospital && '曾含服' + prehospital, 'reported', null, moduleId);
    } else if (moduleId === 'ectopic' && text.startsWith('停经七周，')) {
      add('present', '已停经约七周。', 'patient', null, moduleId);
      add('present', text.replace(/^停经七周，/, ''), source, minutesBefore, moduleId);
    } else if (moduleId === 'ptx' && source === 'ems') {
      add('present', '受伤后出现左胸剧痛。', 'reported', minutesBefore, moduleId);
      add('prehospital', '转运时见患者明显气促，左侧呼吸音减弱。', 'ems', minutesBefore, moduleId);
    } else if (moduleId === 'spleen' && source === 'ems') {
      add('present', '左上腹受撞击后疼痛，向左肩放射。', 'reported', minutesBefore, moduleId);
      add('prehospital', '急救人员见患者面色苍白、出冷汗。', 'ems', minutesBefore, moduleId);
    } else if (moduleId === 'apap' || moduleId === 'tca') {
      add('medications', text, source, minutesBefore, moduleId);
    } else {
      add(source === 'ems' ? 'prehospital' : 'present', text, source, minutesBefore, moduleId);
    }
  }
  if (ids.includes('opioid')) {
    add('medications', '急救人员在发现患者的现场见到吗啡药品，暴露时间与实际用量待核实。', 'ems', null, 'opioid');
    add('medications', '患者回忆失去意识前用过吗啡，具体剂量记不清。', 'patient', null, 'opioid');
  }
  if (ids.includes('tca')) {
    add('medications', '急救人员在现场发现打开的阿米替林药盒，实际吞服量待核实。', 'ems', null, 'tca');
  }
  if (ids.includes('apap')) {
    add('medications', '急救人员在现场发现打开的对乙酰氨基酚药盒，实际吞服量待核实。', 'ems', null, 'apap');
  }
  for (const text of medications) {
    add('medications', text, text.startsWith('长期服用') ? 'background' : 'reported');
  }
  for (const text of background) {
    if (medications.includes(text) || acuteBackground.has(text)) continue;
    const section = pregnancyHistory.has(text) ? 'present' : 'history';
    add(section, text, 'background');
  }
  for (const trait of traits) {
    if (trait.id === 'elderly_renal') continue;
    const section = trait.id === 'pcn_allergy' ? 'allergies' : 'history';
    const aliases = {
      ckd: ['慢性肾病', '慢性肾病 3 期'], asthma_hx: ['哮喘', '哮喘史'],
      baseline_htn: ['高血压', '原发性高血压'],
    };
    if (facts.some(f => (aliases[trait.id] || [trait.n]).includes(f.text))) continue;
    add(section, trait.n, 'background');
  }
  return facts;
}

function patientUnavailable(S) {
  if (S.death) return '患者已死亡。';
  if (S.vent) return '患者正在气管插管，暂时无法应答。';
  if (!Number.isFinite(S.gcs) || S.gcs < 13 || arrestRhythms.has(S.rhythm)) {
    return '当前意识状态无法完成问诊，待恢复后可补问。';
  }
  return '';
}

function availableSources(S, contacts) {
  return SOURCES.map(({ id, label, absent }) => {
    const reason = id === 'patient' ? patientUnavailable(S) : contacts[id] ? '' : absent;
    return { id, label, available: !reason, reason };
  });
}

function sourceOptions(fact) {
  if (fact.source === 'background') return ['records', 'patient', 'family'];
  if (fact.source === 'reported') return ['patient', 'family'];
  return [fact.source];
}

function evidence(fact, source, obtainedAt) {
  const label = SOURCES.find(item => item.id === source).label;
  return {
    id: fact.id, section: fact.section, text: fact.text, source,
    sourceLabel: label, minutesBefore: fact.minutesBefore, obtainedAt,
  };
}

function atAdmission(S) {
  const vitals = S.admissionVitals;
  return {
    gcs: vitals?.gcs ?? (S.t === 0 ? S.gcs : S.cas?.init?.gcs ?? S.gcs),
    vent: vitals?.vent ?? (S.t === 0 ? S.vent : null),
    rhythm: vitals?.rhythm ?? (S.t === 0 ? S.rhythm : null),
  };
}

function planFor(S) {
  const subjectData = subject(S);
  const traits = S.traits || S.cas?.traits || [];
  const facts = historyFacts(subjectData, traits);
  const lead = subjectData.ids[0];
  const observation = transportObservations[lead];
  if (observation) facts.push({
    id: 'transport-observation', moduleId: lead, section: 'prehospital',
    text: observation, source: 'ems', minutesBefore: null,
  });
  return { ...subjectData, facts };
}

function init(S, fixedDifficulty = 1) {
  if (S.intake?.version === VERSION) return S.intake;
  const plan = planFor(S);
  const difficulty = Math.max(1, Math.min(6, Math.trunc((S.diff ?? S.cas?.diff ?? fixedDifficulty) || 1)));
  const admission = atAdmission(S);
  const admissionCanSpeak = !patientUnavailable(admission);
  const criticalId = !admissionCanSpeak && admission.gcs <= 8 && plan.ids.find(id => criticalChiefs.has(id));
  const lead = criticalId || plan.ids[0];
  const expectedChiefSource = chiefSources[lead];
  const contacts = {
    family: plan.facts.some(f => f.source === 'family') || expectedChiefSource === 'family' || seededContact(S, 'family') < 45,
    witness: plan.facts.some(f => f.source === 'witness'),
    ems: !admissionCanSpeak || plan.facts.some(f => f.source === 'ems' && f.id !== 'transport-observation') ||
      expectedChiefSource === 'ems' || seededContact(S, 'ems') < 40,
    records: traitsHaveAllergy(S) || ((plan.background.length > 0 || plan.medications.length > 0) && seededContact(S, 'records') < 65),
  };
  const criticalModule = criticalId && criticalId !== plan.ids[0] ? moduleById(criticalId) : null;
  const chiefSource = expectedChiefSource && contacts[expectedChiefSource]
    ? expectedChiefSource : admissionCanSpeak ? 'patient' : contacts.family ? 'family' : 'ems';
  const observationOnly = chiefSource === 'ems' && !expectedChiefSource;
  const observedChief = arrestRhythms.has(admission.rhythm) ? '送诊时无有效自主循环。'
    : admission.vent ? '急救转运时已气管插管。' : '送诊时应答困难。';
  const chiefText = observationOnly ? observedChief : criticalModule?.chief ?? plan.chief;
  const chief = evidence({
    id: 'chief', section: 'chief',
    text: admissionCanSpeak ? chiefText : '患者暂无法自述。' + chiefText,
    minutesBefore: observationOnly ? null : criticalModule ? criticalModule.chiefMinutesBefore : plan.chiefMinutes,
  }, chiefSource, 0);
  const available = { ...contacts, patient: admissionCanSpeak };
  const ranked = plan.facts.map(fact => ({ fact, source: sourceOptions(fact).find(id => available[id]) }))
    .filter(item => item.source);
  ranked.sort((a, b) => {
    const rank = ({ fact }) => (fact.moduleId === lead ? 4 : 0) +
      (['present', 'prehospital'].includes(fact.section) ? 2 : 0) + (fact.section === 'allergies' ? 1 : 0);
    return rank(b) - rank(a);
  });
  const visibleFraction = [1, 0.75, 0.50, 0.30, 0.15, 0][difficulty - 1];
  const count = difficulty < 6 && ranked.length ? Math.max(1, Math.round(ranked.length * visibleFraction)) : 0;
  const known = ranked.slice(0, count).map(({ fact, source }) => evidence(fact, source, 0));
  S.intake = { version: VERSION, difficulty, contacts, chief, known };
  return S.intake;
}

function traitsHaveAllergy(S) {
  return (S.traits || S.cas?.traits || []).some(trait => trait.id === 'pcn_allergy');
}

function view(S) {
  const intake = init(S);
  return {
    chief: intake.chief, known: intake.known.slice(), inquiries: (intake.inquiries || []).slice(),
    sources: availableSources(S, intake.contacts), topics: TOPICS.slice(),
    difficulty: intake.difficulty,
  };
}

function ask(S, sourceId, topicId) {
  const intake = init(S);
  const source = availableSources(S, intake.contacts).find(item => item.id === sourceId);
  if (!source?.available) return { status: 'unavailable', evidence: [], message: source?.reason || '当前信息来源不可用。' };
  const facts = planFor(S).facts.filter(fact => fact.section === topicId && sourceOptions(fact).includes(sourceId));
  if (!facts.length) {
    intake.inquiries ??= [];
    if (!intake.inquiries.some(item => item.source === sourceId && item.section === topicId)) {
      intake.inquiries.push({ source: sourceId, sourceLabel: source.label, section: topicId, obtainedAt: S.t });
    }
    return { status: 'unknown', evidence: [], message: '已记录本次询查，该来源暂未提供这方面的信息。' };
  }
  const learned = [];
  const known = [];
  for (const fact of facts) {
    const previous = intake.known.find(item => item.id === fact.id);
    if (previous) known.push(previous);
    else learned.push(evidence(fact, sourceId, Number.isFinite(S.t) ? S.t : 0));
  }
  if (learned.length) {
    intake.known.push(...learned);
    return { status: 'learned', evidence: learned, message: '已将补充信息记入病历。' };
  }
  return { status: 'known', evidence: known, message: '这些信息已记入病历。' };
}

const API = { init, view, ask, formatTime };
if (typeof module !== 'undefined' && module.exports) module.exports = API;
root.INTAKE = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
