/* ==========================================================================
 * 病例生成器：按难度随机组合「病理模块」生成病人
 *  - 难度决定：几个病理、病情严重度、是否有基础病
 *  - 每个模块声明自己的「负荷驱动量」、病程推进、目标、出院判据
 *  - 同一种病每次生成都有差异（年龄/体重/严重度/合并症）
 *
 * v0.3 重构（科学审查后）：
 *   advance() 不再直接改体征（"S.spo2 = min(...,cap)"、"S.hr = max(...,floor)"），
 *   而是改**负荷量**（气道阻力 / 胆碱酯酶活性 / 肺血管阻力 / 钠与水 / NAPQI-GSH /
 *   血管张力驱动），体征由 engine.js 的生理方程自然产生。
 *   每个模块里都注明「替代了原来的什么」。
 * ========================================================================== */
(function (root) {
'use strict';
const clamp = (x,a,b)=>Math.min(b,Math.max(a,x));
const VERSION = 2;

/* 随机数（可复现） */
function mulberry32(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a);
  t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }

/* ---------- 病人身份 ---------- */
const SURNAMES = ['王','李','张','刘','陈','杨','赵','黄','周','吴','徐','孙','马','朱','胡','郭','何','高','林','罗','梁','宋','郑','谢','韩','唐','冯','于','董','萧'];
const MALE_GIVEN = ['建国','志强','伟','磊','军','洋','勇','杰','涛','鹏','浩','宇','斌','超','明','刚','辉','强','东','峰','立','建军','文博','嘉诚'];
const FEMALE_GIVEN = ['秀英','丽','敏','静','娟','芳','燕','娜','婷','雪','琳','悦','慧','倩','萍','梅','兰','霞','洁','颖','佳','思','若','诗'];
function makeName(sex, rnd) {
  const s = SURNAMES[Math.floor(rnd() * SURNAMES.length)];
  const pool = sex === '女' ? FEMALE_GIVEN : MALE_GIVEN;
  return s + pool[Math.floor(rnd() * pool.length)];
}
/* 身高体重：按性别与 BMI 抽样 */
function makeBody(sex, age, rnd) {
  const height = Math.round((sex === '男' ? 172 : 160) + (rnd() - 0.5) * 16 - Math.max(0, age - 50) * 0.06);
  const bmi = 19.5 + rnd() * 9;                 // 19.5–28.5
  const weight = Math.round(bmi * (height / 100) * (height / 100));
  return { height, weight };
}

/* 体内是否还有某物质的药效（pk 里 dur 未过） */
const active = (S, id) => !!(S && S.pk && S.pk.some(p => p.id === id));
const activeAny = (S, ids) => ids.some(id => active(S, id));

/* ---------- 基础健康人 ---------- */
const BASE = {
  vol:4.55, k:4.2, na:140, cl:103, ca:1.18, hco3:24, lac:0.9, glu:5.3,
  cr:78, bun:5.0, hb:132, wbc:7.0, plt:240,
  temp:36.7, gcs:15,
  hr:76, sv:64, svr:16.5, cvp:4,
  rr:14, pao2:94, paco2:39, spo2:98,
  uo:0.9, kProd:0.068, lactProd:0.015, insulinBase:0.9, contractility:0.92,
  ecfVd:12, infection:0, bleedRate:0, opioidTox:false, ketoneProd:0,
  interstitium:11, lungWater:0.12, renalFactor:1, waterClear:1,
  airwayResistance:0.05, acheActivity:1, pvr:1.8, freeWater:0,
};

/* ---------- 病理模块 ---------- */
const MODULES = [
  {
    id:'highK', name:'高钾血症', tag:'highK', weight:3, comorbidities:['慢性肾病'],
    init:{ k:6.8, cr:268, bun:18.2, contractility:0.74, vol:4.25, hco3:14, lac:3.4,
           hr:131, svr:13.6, rr:28, pao2:62, spo2:91, temp:37.8, gcs:13, uo:0.3,
           renalFactor:0.30 },
    drivers:{ kProd:0.16, lactProd:0.02, insulinBase:0.55 },
    complaint:'突发心悸、乏力 6 小时，进行性加重。慢性肾病，近 2 日尿量减少。',
    goal:['血钾降至 5.5 以下','收缩压维持 ≥90','避免心脏骤停'],
    /* 只留疾病特异判据；spo2/rr/temp/na/hr/sys 已由全局出院标准覆盖 */
    check:S=>[ S.k<3.5||S.k>5.5 ? `血钾 ${S.k.toFixed(1)}` : null ].filter(Boolean),
    hint:'高钾的心电图改变先于症状。先保护心肌，再想办法把钾挪走。',
  },
  {
    id:'dka', name:'糖尿病酮症酸中毒', tag:'dka', weight:2, comorbidities:['1 型糖尿病'],
    init:{ vol:3.6, k:4.9, na:130, hco3:8, lac:2.6, glu:28.5, cr:156, bun:14.5,
           hr:118, svr:11.4, rr:30, pao2:88, paco2:27, spo2:96, gcs:12, uo:1.6,
           contractility:0.80 },
    drivers:{ kProd:0.072, lactProd:0.03, insulinBase:0.12, ketoneProd:0.25, glucoseIn:0.32 },
    complaint:'多饮多尿 3 天，恶心呕吐 1 天，今晨嗜睡。1 型糖尿病，擅自停用胰岛素。',
    goal:['血糖降至 11 以下','pH 升至 7.30 以上','血钾维持 3.5–5.5'],
    check:S=>[ S.glu>12 ? `血糖 ${S.glu.toFixed(1)}` : null ].filter(Boolean),
    hint:'补液是第一位的。胰岛素要小剂量持续，补钾要跟得上。',
    /* 无 advance：酮体生成 → HCO₃ 消耗、渗透性利尿、胰岛素清除酮体，
       全部由引擎的机制方程表达（替代原来只覆盖 hco3Base 的做法） */
  },
  {
    id:'bleed', name:'上消化道大出血', tag:'bleed', weight:3, comorbidities:['消化性溃疡'],
    init:{ vol:3.9, hb:72, bun:24.5, hr:124, svr:9.6, lac:2.9, rr:26,
           pao2:78, paco2:37, spo2:94, gcs:14, uo:0.4, temp:36.6, contractility:0.85 },
    drivers:{ kProd:0.068, bleedRate:0.012 },
    complaint:'呕血 2 次、黑便 1 天，起身时晕厥。长期服用阿司匹林。',
    goal:['收缩压 ≥90 且心率 <120','血红蛋白 ≥80 g/L','止血'],
    check:S=>[ S.bleedingSites.bleed > 0 ? '消化道出血未止' : null, S.hb<80 ? `血红蛋白 ${Math.round(S.hb)}` : null ].filter(Boolean),
    hint:'先补容量再谈输血。升压药不能替代容量。',
    /* 失血只丢全血（容量+红细胞同比例），Hb 由 rbcMass/vol 导出，
       补液后自然稀释——替代原来 S.hb 每拍直接下降 */
  },
  {
    id:'sepsis', name:'感染性休克', tag:'sepsis', weight:2, comorbidities:['肺部感染'],
    init:{ vol:3.7, na:132, hco3:17, lac:5.8, glu:8.2, cr:186, bun:24, hb:108, wbc:19.5, plt:140,
           temp:39.2, hr:128, svr:9.2, rr:28, pao2:68, paco2:30, spo2:91, gcs:12, uo:0.25,
           contractility:0.80 },
    drivers:{ kProd:0.072, lactProd:0.06, insulinBase:0.8, infection:0.78 },
    complaint:'发热咳嗽 3 天，今日意识模糊、尿少，皮肤花斑。',
    goal:['平均动脉压 ≥65','乳酸下降','感染控制'],
    /* 去掉了 temp>38.0（全局出院标准已含 temp ≤37.8），只留感染控制 */
    check:S=>[ (S.infection||0)>0.25 ? '感染未控制' : null ].filter(Boolean),
    hint:'先补液，再上血管活性药；抗生素越早越好。',
  },
  {
    id:'opioid', name:'阿片类药物过量', tag:'opioid', weight:2,
    init:{ vol:4.3, hco3:26, glu:5.4, hb:128, temp:36.2, gcs:5, hr:58, svr:14,
           rr:8, pao2:45, paco2:64, spo2:78, uo:0.5, contractility:0.90 },
    drivers:{ kProd:0.068, lactProd:0.02 },
    preload:[['morphine',12]], opioidTox:true,
    complaint:'被发现倒在房间内，呼之不应，呼吸浅慢，针尖样瞳孔。',
    goal:['自主呼吸频率 ≥12','意识恢复','室内空气血氧 ≥94%','完成阿片暴露后的观察'],
    /* rr<12 是下限，与全局 rr≤22 不重复 */
    check:S=>[ S.rr<12 ? `呼吸 ${Math.round(S.rr)} 次/分` : null ].filter(Boolean),
    hint:'呼吸抑制是致命的。纳洛酮起效快但半衰期短。',
  },
  {
    id:'edema', name:'急性左心衰 / 肺水肿', tag:'edema', weight:2, comorbidities:['冠心病'],
    init:{ vol:5.1, hco3:22, lac:2.4, cr:120, hb:118, temp:36.6, gcs:13,
           hr:118, svr:22, rr:32, pao2:54, paco2:33, spo2:86, uo:0.35, contractility:0.50,
           lungWater:0.55, svrDrive:7.5, interstitium:12.2 },
    drivers:{ kProd:0.068, lactProd:0.03 },
    complaint:'夜间憋醒，端坐呼吸，咳粉红色泡沫痰。既往高血压、冠心病。',
    goal:['血氧 ≥94%','呼吸频率 ≤20','肺部湿啰音减轻'],
    /* spo2/rr 已由全局判据覆盖，这里只留"肺水"这一疾病特异证据 */
    check:S=>[ (S.lungWater||0) > 0.45 ? `肺部湿啰音未减轻（肺水 ${(S.lungWater||0).toFixed(2)}）` : null ].filter(Boolean),
    hint:'坐位、吸氧、利尿、扩血管。看血压决定用不用强心。',
    /* 神经体液血管收缩驱动：替代原来"只能靠 init.svr 一次性设定、随即被压力反射拉回"
       的写法。扩血管药（硝酸甘油/硝普钠/米力农）直接削减这个驱动 → 后负荷下降 →
       衰竭心肌每搏量上升（engine 的 afterloadF）→ CO 上升 → 心率回落。 */
    advance(S, dtMin) {
      const vaso = (active(S,'nitroglycerin') ? 0.55 : 0)
                 + (active(S,'nitroprusside') ? 0.95 : 0)
                 + (active(S,'hydralazine') ? 0.40 : 0)
                 + (active(S,'captopril') ? 0.25 : 0)
                 + (active(S,'milrinone') ? 0.45 : 0);
      S.svrDrive = clamp((S.svrDrive == null ? 7.5 : S.svrDrive) + (0.02 - vaso) * dtMin, 0, 13);
    },
  },
  {
    id:'thyroid', name:'甲状腺危象', tag:'thyroid', weight:1,
    init:{ vol:4.4, hco3:21, lac:2.2, glu:7.0, temp:39.8, gcs:12,
           hr:148, svr:12.5, rr:26, pao2:82, paco2:32, spo2:95, uo:1.2, contractility:0.90,
           thyroidHeatDrive:0.70, hrDrive:55 },
    drivers:{ kProd:0.072, lactProd:0.04 },
    complaint:'发热 39.8℃、心悸、烦躁 2 天。甲亢病史，近期自行停药。',
    goal:['心率 <120','体温 <38.5','意识恢复'],
    /* temp 已由全局判据覆盖；用"甲状腺毒症控制度"替代原来的体温重复判据 */
    check:S=>[ (S.thyroidHeatDrive ?? 0.70) > 0.26 ? '甲状腺毒症尚未控制' : null ].filter(Boolean),
    hint:'β 阻滞剂压心率，抗甲状腺药阻断合成，激素抑制转化。',
    advance(S, dtMin) {
      const therapy = S.thyroidTherapyActivity || {};
      const beta = therapy.propranolol || 0;
      const treatment = 0.045 * (therapy.propylthiouracil || 0)
                      + 0.030 * (therapy.methimazole || 0)
                      + 0.020 * (therapy.hydrocortisone || 0)
                      + 0.015 * (therapy.dexamethasone || 0)
                      + 0.012 * beta;
      S.thyroidHeatDrive = clamp((S.thyroidHeatDrive ?? 0.70) + (0.0012 - treatment) * dtMin, 0, 1.5);
      S.hrDrive = clamp((S.hrDrive ?? 55) + (0.010 - 0.060 * beta) * dtMin, 0, 90);
    },
  },
  {
    id:'hypogly', name:'严重低血糖', tag:'hypogly', weight:2,
    init:{ vol:4.4, glu:2.1, hco3:23, temp:36.3, gcs:6,
           hr:104, svr:15, rr:16, pao2:90, spo2:97, uo:0.8,
           insulinLoad:6.0 },
    drivers:{ kProd:0.068, lactProd:0.02 },
    complaint:'糖尿病患者，注射胰岛素后未进食，呼之不应、大汗。',
    goal:['血糖升至 4 以上','意识恢复'],
    /* glu 已由全局判据覆盖 */
    check:S=>[ S.gcs<13 ? `意识 ${S.gcs}` : null ].filter(Boolean),
    hint:'先推高浓度葡萄糖，再找原因。磺脲类过量要持续输注。',
    /* 不再硬把 glu 封在 2.8、gcs 封在 7：引擎用"胰岛素负荷高 → 摄取↑、肝糖输出被压制"
       的自然方程推进；低血糖损伤按剂量×时间积分判死（替代原来的 45 min 计时器） */
    advance(S, dtMin, E) {
      const sugar = activeAny(S, ['dextrose50','dextrose10','glucagon']);
      if (sugar) S.insulinLoad = Math.max(0, (S.insulinLoad || 0) - 0.12 * dtMin);
    },
  },

  /* ======================= 六个"改体征 → 改负荷"的模块 ======================= */

  /* 1) 急性哮喘 / COPD 加重：
     替代原来的 "spo2Cap / rrFloor 直接封顶" —— 现在只设气道阻力，
     低氧由 肺泡通气方程 + Hill + 分流 自然算出来 */
  {
    id:'asthma', name:'急性哮喘 / COPD 加重', tag:'asthma', weight:2,
    init:{ vol:4.35, k:4.0, na:139, hco3:26, lac:2.6, glu:7.1, cr:88, bun:5.6,
           hb:136, wbc:10.8, plt:250, temp:37.1, gcs:14,
           hr:124, svr:17.6, rr:32, pao2:56, paco2:38, spo2:86, uo:0.8,
           contractility:0.90,
           airwayResistance:0.85, vdvt:0.67 },
    drivers:{ kProd:0.068, lactProd:0.03 },
    complaint:'喘鸣、胸闷进行性加重 6 小时，不能平卧，说话只能两个字一顿。既往哮喘，近 2 日自行停用吸入剂。',
    goal:['血氧 ≥94%','呼吸频率 ≤22','哮鸣音明显缓解'],
    /* spo2/rr 由全局判据覆盖，只留气道痉挛这一特异判据 */
    check:S=>[ (S.airwayResistance||0)>0.30 ? `气道痉挛尚未缓解（${Math.round((S.airwayResistance||0)*100)}%）` : null ].filter(Boolean),
    hint:'支气管痉挛要靠解痉药打开，吸氧只能买时间。激素要早给。',
    advance(S, dtMin, E) {
      const beta = activeAny(S, ['salbutamol','salmeterol','epi','isoproterenol','theophylline']);
      const anti = active(S,'ipratropium');
      const steroid = activeAny(S, ['hydrocortisone','dexamethasone']);
      let rate = 0.004;                 // 未处理：气道痉挛持续加重
      if (beta) rate -= 0.055;          // β₂ 激动剂：解痉主力
      if (anti) rate -= 0.012;          // 抗胆碱能：协同
      if (steroid) rate -= 0.010;       // 激素：压基础炎症张力
      S.airwayResistance = clamp((S.airwayResistance == null ? 0.85 : S.airwayResistance) + rate * dtMin, 0.02, 1);
      S.obstruct = S.airwayResistance;  // 兼容 mentor.js / check() 的旧字段名
      /* 气道阻力 → 死腔↑（V/Q 失调）+ 分流↑（替代原来的 spo2 上限钳制） */
      S.vdvt = clamp(0.33 + 0.40 * S.airwayResistance, 0.33, 0.75);
      S.shuntSrc.airway = clamp(0.32 * S.airwayResistance, 0, 0.32);
    },
  },

  /* 2) 有机磷中毒：
     替代原来的 "hrCap / spo2Cap / rrFloor 三个封顶" —— 现在只设胆碱酯酶活性，
     乙酰胆碱堆积 → 心动过缓/分泌物/支气管痉挛由引擎从 acheActivity 算 */
  {
    id:'organophosphate', name:'有机磷中毒', tag:'op', weight:2,
    init:{ vol:4.35, k:4.1, na:136, hco3:22, lac:3.2, glu:6.8, cr:92, bun:6.0,
           hb:134, wbc:9.0, plt:230, temp:36.9, gcs:12,
           hr:48, svr:24.0, rr:24, pao2:58, paco2:44, spo2:85, uo:0.55,
           contractility:0.85, acheActivity:0.12, muscarinicBlock:0 },
    drivers:{ kProd:0.068, lactProd:0.035 },
    complaint:'喷洒农药后 2 小时出现大汗、流涎、恶心呕吐，呼之能应但反应迟钝，瞳孔针尖样，双肺满布湿啰音。',
    goal:['心率 ≥60','血氧 ≥94%','毒蕈碱样症状缓解'], minDischargeHR:60,
    check:S=>[ (1-(S.acheActivity==null?1:S.acheActivity))>0.25 ? '胆碱酯酶仍被抑制、分泌物多' : null ].filter(Boolean),
    hint:'阿托品对抗毒蕈碱样症状，碘解磷定复活胆碱酯酶。先给氧再解毒。',
    advance(S, dtMin, E) {
      const pra = active(S,'pralidoxime');
      const atro = active(S,'atropine');
      /* 胆碱酯酶活性：老化（不可逆）继续下降，解磷定复活；>6 h 后老化使复活效率大减 */
      const aging = S.t > 6 * 3600 ? 0.20 : 1;
      let react = (pra ? 0.030 * aging : 0) - 0.0016;
      S.acheActivity = clamp((S.acheActivity == null ? 0.12 : S.acheActivity) + react * dtMin, 0, 0.95);
      S.opTox = 1 - S.acheActivity;      // 兼容 mentor.js / check() 的旧字段名
      /* 阿托品只是阻断毒蕈碱受体，不恢复酶活性 */
      S.muscarinicBlock = clamp((S.muscarinicBlock || 0) + ((atro ? 0.22 : -0.020)) * dtMin, 0, 1);
      /* 堆积的 ACh 多少能作用到受体：由引擎换算成心率/分泌物/气道阻力 */
      S.cholinergic = clamp((1 - S.acheActivity) * (1 - S.muscarinicBlock), 0, 1);
      S.shuntSrc.op = clamp(0.30 * S.cholinergic, 0, 0.30);
    },
  },

  /* 3) 对乙酰氨基酚过量：
     替代原来的 "apapDamage 线性累积 + 直接写 cr/bun/coag" —— 现在只设 NAPQI 与 GSH
     的竞争消耗，肝损伤由 GSH 耗竭程度决定，肝肾/凝血/乳酸由引擎按肝损伤程度算 */
  {
    id:'apap', name:'对乙酰氨基酚过量', tag:'apap', weight:1,
    init:{ vol:4.45, k:4.0, na:140, hco3:24, lac:1.2, glu:5.6, cr:82, bun:5.0,
           hb:138, wbc:7.4, plt:245, temp:36.6, gcs:15,
           hr:82, svr:16.5, rr:15, pao2:95, paco2:39, spo2:98, uo:0.9,
           contractility:0.92, apapLoad:1.0, gsh:0.30, napqi:0.10, hepatotox:0 },
    drivers:{ kProd:0.068, lactProd:0.015 },
    complaint:'与家人争吵后吞服对乙酰氨基酚约 20 片，已过 4 小时。目前仅轻度恶心，查体无特殊。',
    goal:['尽早使用解毒剂','观察 2 小时无肝损证据','肌酐与乳酸正常'],
    check:S=>[ S.t<7200 ? '对乙酰氨基酚中毒需观察 2 小时（肝损窗口）' : null,
               S.cr>130 ? `肌酐 ${Math.round(S.cr)} µmol/L（肝肾综合征）` : null,
               (S.coag||1)<0.60 ? `凝血功能恶化（${(S.coag||1).toFixed(2)}）` : null,
               S.lac>3.0 ? `乳酸 ${S.lac.toFixed(1)} mmol/L` : null ].filter(Boolean),
    hint:'早期没有症状不等于安全。N-乙酰半胱氨酸越早给越有效，8 小时后疗效明显下降。',
    advance(S, dtMin, E) {
      const nac = active(S,'nacetylcysteine');
      /* NAPQI 生成（CYP 2E1）→ 与 GSH 结合解毒；GSH 耗竭后与肝细胞蛋白共价结合 */
      const form = 0.016 * (S.apapLoad == null ? 1 : S.apapLoad);
      const conj = 1.8 * (S.gsh || 0) * (S.napqi || 0) + (nac ? 0.8 : 0) * (S.napqi || 0);
      const hydr = 0.04 * (S.napqi || 0);
      S.napqi = clamp((S.napqi || 0) + (form - conj - hydr) * dtMin, 0, 3);
      const gshSyn = 0.0035 + (nac ? 0.020 : 0);         // NAC 是 GSH 前体
      S.gsh = clamp((S.gsh || 0) + (gshSyn - 2.4 * (S.gsh || 0) * (S.napqi || 0)) * dtMin, 0, 1.2);
      /* 只有 GSH 明显耗竭（<0.25）时 NAPQI 才造成肝细胞坏死 */
      const bind = 0.055 * (S.napqi || 0) * ((S.gsh || 0) < 0.25 ? (1 - (S.gsh || 0) / 0.25) : 0);
      S.hepatotox = clamp((S.hepatotox || 0) + bind * dtMin, 0, 1);
      S.apapDamage = S.hepatotox;   // 兼容旧字段名
    },
  },

  /* 4) 高血压急症：
     替代原来的 "svrFloor / hrFloor 直接钳制 S.svr、S.hr" —— 现在直接给
     血管张力驱动 S.svrDrive（引擎把它加进 SVR 目标），压力反射仍会与之对抗 */
  {
    id:'htnEmergency', name:'高血压急症', tag:'htn', weight:2,
    init:{ vol:4.6, k:3.7, na:141, hco3:24, lac:1.6, glu:6.2, cr:118, bun:7.2,
           hb:142, wbc:8.2, plt:250, temp:36.8, gcs:12,
           hr:104, svr:19.0, rr:18, pao2:90, paco2:38, spo2:96, uo:0.7,
           contractility:1.02, htn:1, svrDrive:7.0 },
    drivers:{ kProd:0.068, lactProd:0.02 },
    complaint:'剧烈头痛、视物模糊 3 小时，恶心呕吐，家属发现其反应变慢。既往高血压，自行停药 1 周。',
    goal:['收缩压降至 160 以下','意识恢复','避免脑出血'],
    /* sys>160 是上限（全局只有 sys≥90 的下限）；gcs 由全局覆盖 */
    check:S=>[ (S._sys||0)>160 ? `收缩压 ${Math.round(S._sys)} mmHg` : null,
               (S.svrDrive||0)>2.5 ? '血管张力仍未控制' : null ].filter(Boolean),
    hint:'高血压急症要平稳降压，不是越快越好。硝普钠/拉贝洛尔泵入，第一小时降幅不超过 25%。',
    advance(S, dtMin, E) {
      const potency = (active(S,'nitroprusside') ? 0.95 : 0)
                    + (active(S,'labetalol') ? 0.35 : 0)
                    + (active(S,'nitroglycerin') ? 0.25 : 0)
                    + (active(S,'nifedipine') ? 0.18 : 0)
                    + (active(S,'hydralazine') ? 0.35 : 0)
                    + (active(S,'captopril') ? 0.15 : 0)
                    + (active(S,'enalapril') ? 0.15 : 0);
      S.svrDrive = clamp((S.svrDrive == null ? 7 : S.svrDrive) + (0.020 - potency) * dtMin, 0, 13);
      S.htn = clamp(S.svrDrive / 7, 0, 1.2);   // 兼容旧字段名
      const b = E && E.bp ? E.bp(S) : { sys: 0, dia: 0, map: 0 };
      S._sys = b.sys; S._dia = b.dia; S._map = b.map;   // 供 check() 读取
    },
  },

  /* 5) 严重低钠血症：
     替代原来的 "S.gcs = 封顶" —— 现在只设钠质量/游离水，脑水肿由引擎按
     "绝对低渗 + dNa/dt" 推进（dICP/dt ∝ dNa/dt） */
  {
    id:'hyponatremia', name:'严重低钠血症', tag:'hypona', weight:1,
    init:{ vol:4.7, k:4.3, na:122, hco3:23, lac:1.3, glu:5.4, cr:74, bun:3.8,
           hb:128, wbc:6.8, plt:240, temp:36.4, gcs:10,
           hr:86, svr:15.8, rr:18, pao2:92, paco2:40, spo2:96, uo:0.9,
           contractility:0.90, freeWater:0, waterClear:0.02, freeWaterRate:0.0008,
           icp:0.30 },
    drivers:{ kProd:0.068, lactProd:0.02 },
    complaint:'乏力、嗜睡 2 天，今晨呕吐后呼之不应。长期服用氢氯噻嗪并大量饮水。',
    goal:['血钠逐步恢复至 130–145 mmol/L','意识恢复','避免血钠纠正过快'],
    check:S=>[ !S.hyponatremiaCauseControlled ? '需停止噻嗪并限制饮水' : null,
               S.na < 130 || S.na > 145 ? `血钠 ${S.na.toFixed(1)} mmol/L` : null,
               S.gcs < 15 && S.gcs >= 13 ? `意识尚未完全恢复（${S.gcs} 分）` : null,
               (S.seizure || 0) > 0.1 ? '仍有抽搐' : null ].filter(Boolean),
    hint:'低钠性脑病先用 3% 高渗盐水把血钠抬 4–6 mmol/L，再慢慢纠。抬得太快会脱髓鞘。',
    advance(S, dtMin, E) {
      /* SIADH 样持续游离水潴留（水多了 → 钠被稀释），钠由引擎 na = naMass/(ecfVd+freeWater) 导出 */
      S.freeWaterRate = S.hyponatremiaCauseControlled ? S.uo * 0.00035 : 0.0008;
      S.waterClear = 0.02;                 // 抗利尿 → 几乎不排自由水
    },
  },

  /* 6) 急性肺栓塞：
     替代原来的 "spo2Cap / svrCap / rrFloor" —— 现在只设肺血管阻力（由血栓负荷换算），
     右心后负荷 → 每搏量下降由引擎的 Frank-Starling + rvF 表达 */
  {
    id:'pe', name:'急性肺栓塞', tag:'pe', weight:2,
    init:{ vol:4.3, k:4.2, na:137, hco3:21, lac:3.6, glu:7.4, cr:96, bun:6.4,
           hb:131, wbc:11.0, plt:220, temp:36.7, gcs:13,
           hr:132, svr:15.0, rr:30, pao2:54, paco2:30, spo2:86, uo:0.5,
           contractility:0.85, clot:0.90, pvr:10.35, vdvt:0.65 },
    drivers:{ kProd:0.068, lactProd:0.045 },
    complaint:'长途飞行后突发胸痛、呼吸困难，起身时晕倒。心率 132，血压 82/58，右下肢略肿。',
    goal:['血氧 ≥94%','收缩压 ≥90','右心负荷减轻'],
    /* 血氧与心率由通用出院判据覆盖。 */
    check:S=>[ (S.clot||0)>0.25 ? '右心负荷仍未减轻（血栓未清除）' : null ].filter(Boolean),
    hint:'大面积肺栓塞先给氧、抗凝，血流动力学不稳时溶栓。补液要小心，右心已经撑不住了。',
    advance(S, dtMin, E) {
      const lysis = active(S,'alteplase') ? 0.050 : 0;
      const hep = active(S,'heparin') ? 0.012 : 0;
      S.clot = clamp((S.clot == null ? 0.90 : S.clot) + (0.003 - lysis - hep) * dtMin, 0, 1);
      /* 血栓负荷 → 肺血管阻力（替代原来的 svr 上限钳制） */
      S.pvr = 1.8 + 9.5 * S.clot;
      S.shuntSrc.clot = clamp(0.28 * S.clot, 0, 0.28);
      S.vdvt = clamp(0.33 + 0.35 * S.clot, 0.33, 0.68);   // 死腔↑ → 通气效率下降
    },
  },

  {
    id:'ptx', name:'张力性气胸', tag:'ptx', weight:2, comorbidities:['胸部外伤'],
    init:{ vol:4.30, k:4.0, na:138, hco3:23, lac:3.6, glu:7.4, cr:92, bun:5.2,
           hb:128, wbc:11.0, plt:230, temp:36.9, gcs:12,
           hr:138, sv:40, svr:19, rr:36, pao2:48, paco2:30, spo2:78,
           contractility:0.88, tensionPTX:0.85, pvr:7.5 },
    drivers:{ kProd:0.011, lactProd:0.035 },
    complaint:'车祸后突发左胸剧痛、极度呼吸困难。气管向右偏，左胸叩诊鼓音、呼吸音消失，颈静脉怒张。',
    goal:['血氧 ≥ 94%','收缩压 ≥ 90','呼吸频率 ≤ 22'],
    check:S=>[ (S.tensionPTX||0) > 0.20 ? `胸腔内压仍高（${Math.round((S.tensionPTX||0)*100)}%）` : null,
               (S.tensionPTX||0) > 0 && !S.chestTubePlaced ? '仍需胸腔闭式引流' : null ].filter(Boolean),
    hint:'张力性气胸是梗阻性休克：回心血量被压住，给升压药没用，必须先针刺减压。',
    advance(S, dtMin){
      const prev = S.tensionPTX == null ? 0 : S.tensionPTX;
      S.tensionPTX = S.chestTubePlaced ? 0 : Math.min(1, prev + 0.0018 * dtMin);
      /* 胸腔内压 → 肺血管阻力：减压后必须回落，否则右心后负荷永远高，血压升不上来 */
      S.pvr = 1.8 + 6.0 * S.tensionPTX;

      /* 复张性肺水肿：塌陷时间长 + 单次减压幅度大 → 肺毛细血管通透性骤增
         （真实多见于塌陷 > 数小时或快速大量引流；这里用 20 分钟 + 一次降 0.4 以上近似） */
      if (prev > 0.45) S._collapseSince = S._collapseSince || S.t;
      const dropped = prev - S.tensionPTX;
      if (dropped > 0) S._reDrop = (S._reDrop || 0) + dropped;
      if (S._collapseSince && S.t - S._collapseSince > 5400 && (S._reDrop || 0) > 0.35 && S.reExpand == null) {
        S.reExpand = 1;                       // 进入易感状态
        S.log.push(['体征', '肺复张后出现湿啰音——警惕复张性肺水肿', 'warn']);
      }
      if ((S.reExpand || 0) > 0) {
        S.lungWater = Math.min(1.6, (S.lungWater || 0.12) + 0.0022 * dtMin);
        const sh = S.shuntSrc = S.shuntSrc || { airway: 0, clot: 0, edema: 0, op: 0 };
        sh.edema = Math.min(0.30, (sh.edema || 0) + 0.00004 * dtMin);
      }
    },
  },
  {
    id:'trauma', name:'多发伤 / 失血性休克', tag:'trauma', weight:2, comorbidities:['骨盆骨折'],
    init:{ vol:3.20, k:4.6, na:136, hco3:19, lac:4.8, glu:9.5, cr:118, bun:7.5,
           hb:78, wbc:13.0, plt:150, temp:35.9, gcs:13,
           hr:142, sv:44, svr:15, rr:31, pao2:86, paco2:32, spo2:94,
           contractility:0.86, bleedRate:0.055, bleedPressDep:1, externalBleed:true, coag:0.85 },
    drivers:{ kProd:0.011, lactProd:0.05 },
    complaint:'摩托车事故，右大腿开放性畸形、活动性出血，面色苍白、四肢湿冷、意识模糊。',
    goal:['收缩压 ≥ 90','血红蛋白 ≥ 80','出血控制'],
    check:S=>[ S.bleedingSites.trauma > 0 ? '创伤出血未控制' : null,
               S.hb < 80 ? `血红蛋白 ${Math.round(S.hb)}` : null ].filter(Boolean),
    hint:'先压迫止血，同时补容量；升压药不能替代容量，也不能替代止血。',
  },

  {
    id:'pancreatitis', name:'急性胰腺炎', tag:'pancreatitis', weight:2, comorbidities:['胆石症'],
    init:{ vol:3.15, k:3.6, na:132, hco3:20, lac:4.2, glu:9.0, cr:130, bun:9.0,
           hb:140, wbc:15.5, plt:210, temp:38.6, gcs:14,
           hr:124, sv:54, svr:11.5, rr:26, pao2:82, paco2:32, spo2:94, uo:0.4,
           contractility:0.88, ca:1.05 },
    drivers:{ kProd:0.010, lactProd:0.055 },
    complaint:'上腹剧痛向背部放射 8 小时，频繁呕吐，弯腰抱膝可稍缓解。既往胆结石。',
    goal:['平均动脉压 ≥ 65','尿量 ≥ 0.5 mL/min','疼痛缓解'],
    check:S=>[ S.vol < 3.9 ? `有效循环血量不足（${S.vol.toFixed(1)} L）` : null,
               S.temp > 38.0 ? `仍发热 ${S.temp.toFixed(1)}℃` : null,
               S.uo<0.5 ? `尿量 ${S.uo.toFixed(1)} mL/min` : null ].filter(Boolean),
    hint:'胰腺炎的头 24 小时死于第三间隙丢失，不是死于疼痛——先补液，再谈镇痛。',
    advance(S, dtMin){
      /* 炎症导致毛细血管渗漏：液体持续进入第三间隙，不补就低容量 */
      S.vol = Math.max(2.2, S.vol - 0.0045 * dtMin);
      S.interstitium = Math.min(24, (S.interstitium || 11) + 0.0032 * dtMin * 0.7);
      S.lactProd = 0.070;
      /* 第三间隙丢失到一定程度即为失代偿性低容量：直接累积休克损伤 */
      /* 重症胰腺炎的两个标志性机制：低钙（脂肪皂化）与早期 ARDS */
      S.ca = Math.max(0.75, (S.ca == null ? 1.05 : S.ca) - 0.00004 * dtMin);
      S.lungWater = Math.min(1.5, (S.lungWater || 0.12) + 0.0006 * dtMin);
      S.contractility = Math.max(0.55, (S.contractility || 0.88) - 0.00002 * dtMin);
    },
  },
  {
    id:'hhs', name:'高渗高血糖状态', tag:'hhs', weight:1, comorbidities:['2 型糖尿病'],
    init:{ vol:2.95, k:4.6, na:155, hco3:22, lac:2.2, glu:42.0, cr:158, bun:20.0,
           hb:145, wbc:9.5, plt:250, temp:36.6, gcs:11,
           hr:108, sv:58, svr:14, rr:22, pao2:92, paco2:38, spo2:97, uo:1.2,
           contractility:0.90, insulinBase:0.55 },
    drivers:{ kProd:0.011, lactProd:0.02 },
    complaint:'老年糖尿病患者，多日饮水少、乏力嗜睡，家属发现叫不醒。血糖仪显示 HI。',
    goal:['血糖 4–12 mmol/L','血钠 ≤145 mmol/L','血清渗透压 <300 mOsm/kg','尿量 >0.5 mL/kg/h','意识恢复'],
    check(S) {
      const osmolality = 2 * S.na + S.glu + S.bun;
      const urinePerKg = S.uo * 60 / (S.weight || 70);
      return [S.na > 145 ? `血钠 ${S.na.toFixed(1)} mmol/L` : null,
              osmolality >= 300 ? `血清渗透压 ${osmolality.toFixed(1)} mOsm/kg` : null,
              urinePerKg <= 0.5 ? `尿量 ${urinePerKg.toFixed(2)} mL/kg/h` : null,
              S.gcs < 15 && S.gcs >= 13 ? `意识尚未完全恢复（${S.gcs} 分）` : null].filter(Boolean);
    },
    hint:'高渗状态先补液：血糖降太快会导致脑水肿，血钠也要慢慢降。',
    advance(S) {
      S.glucoseIn = 0.05;
      /* 意识与容量恢复后可恢复饮水，补足后续尿液自由水丢失。 */
      S.freeWaterRate = S.gcs >= 13 && S.vol >= 4.2 ? S.uo * 0.00035 : 0;
    },
  },
  {
    id:'co', name:'一氧化碳中毒', tag:'co', weight:1,
    init:{ vol:4.40, k:4.1, na:139, hco3:22, lac:3.4, glu:5.6, cr:88, bun:5.0,
           hb:140, wbc:8.0, plt:240, temp:36.5, gcs:12,
           hr:112, sv:62, svr:15, rr:20, pao2:95, paco2:36, spo2:98, uo:0.9,
           contractility:0.90, coHb:0.55 },
    drivers:{ kProd:0.010, lactProd:0.03 },
    complaint:'冬季密闭房间内使用燃气热水器，被发现时意识模糊、口唇呈樱桃红色。',
    goal:['意识恢复','血氧饱和度与氧输送改善'],
    check:S=>[ (S.coHb||0) > 0.10 ? `碳氧血红蛋白 ${Math.round((S.coHb||0)*100)}%` : null ].filter(Boolean),
    hint:'脉搏血氧仪会骗人——SpO₂ 看着正常，但携氧的血红蛋白被一氧化碳占住了。高流量氧是解药。',
  },

  {
    id:'aki', name:'急性肾损伤 / 尿毒症', tag:'aki', weight:2, comorbidities:['慢性肾病'],
    init:{ vol:4.55, k:6.15, na:130, hco3:13, lac:2.8, glu:7.2, cr:680, bun:42,
           hb:108, wbc:9.0, plt:180, temp:36.4, gcs:13,
           hr:98, sv:60, svr:20, rr:26, pao2:86, paco2:30, spo2:94, uo:0.15,
           contractility:0.86, renalFactor:0.08 },
    drivers:{ kProd:0.075, lactProd:0.03 },
    complaint:'恶心呕吐、尿量明显减少 3 天，既往慢性肾病。查体：眼睑水肿，双下肢凹陷性水肿，呼吸有尿味。',
    goal:['血钾降至 5.5 以下','肌酐下降','尿量恢复'],
    check:S=>[ S.k > 5.5 ? `血钾 ${S.k.toFixed(1)}` : null,
               (S.cr || 0) > 400 ? `肌酐 ${Math.round(S.cr)}` : null ].filter(Boolean),
    hint:'利尿药对这种肾衰是无效的——该透析了。先保护心肌，再安排血透。',
  },

  {
    id:'tamponade', name:'急性心包填塞', tag:'tamponade', weight:1, comorbidities:['胸部外伤'],
    init:{ vol:4.20, k:4.2, na:138, hco3:22, lac:3.2, glu:7.8, cr:96, bun:5.4,
           hb:118, wbc:11.0, plt:210, temp:36.6, gcs:13,
           hr:132, sv:44, svr:19, rr:28, pao2:84, paco2:32, spo2:93, uo:0.5,
           contractility:0.90, tamponade:0.80 },
    drivers:{ kProd:0.011, lactProd:0.04 },
    complaint:'胸部刀刺伤后 40 分钟，烦躁、面色苍白、颈静脉怒张，血压进行性下降，心音遥远。',
    goal:['收缩压 ≥ 90','心率 < 120','意识恢复'],
    check:S=>[ (S.tamponade||0) > 0.15 ? `心包内压仍高（${Math.round((S.tamponade||0)*100)}%）` : null ].filter(Boolean),
    hint:'三联征（低血压 + 颈静脉怒张 + 心音遥远）提示心包填塞：穿刺抽液，补液只是争取时间。',
    advance(S, dtMin){
      /* 凝血性心包积血会持续再填塞：约 1.5 h 回到压塞水平，除非留置引流 */
      if (!S.pericDrain) S.tamponade = Math.min(1, (S.tamponade == null ? 0 : S.tamponade) + 0.010 * dtMin);
      else S.tamponade = Math.max(0.05, (S.tamponade || 0) - 0.02 * dtMin);
    },
  },
  {
    id:'heatstroke', name:'热射病', tag:'heatstroke', weight:1,
    init:{ vol:3.85, k:4.4, na:146, hco3:19, lac:5.2, glu:7.5, cr:150, bun:9.5,
           hb:132, wbc:14.0, plt:190, temp:41.2, gcs:10,
           hr:138, sv:56, svr:9.5, rr:30, pao2:82, paco2:28, spo2:93, uo:0.4,
           contractility:0.84, heatstrokeDrive:1.30 },
    drivers:{ kProd:0.016, lactProd:0.08 },
    complaint:'高温车间连续作业 4 小时，突然晕倒，皮肤干热无汗，肛温 41.2℃。',
    goal:['核心体温 < 38.5','收缩压 ≥ 90','意识恢复'],
    check:S=>[ S.temp > 38.5 ? `体温 ${S.temp.toFixed(1)}℃` : null,
               S.gcs < 13 ? `意识 ${S.gcs}` : null ].filter(Boolean),
    hint:'热射病需尽快散热。在「环境 / 场景」开启物理降温，同时补液并监测血压。',
    advance(S, dtMin){
      const recovering = S.heatstrokeCooled && !S.env?.heat;
      const cooling = S.env?.cooling ? 0.05 : (recovering ? 0.04 : 0);
      if (cooling > 0) {
        S.heatstrokeDrive = Math.max(0, (S.heatstrokeDrive ?? 1.30) - cooling * dtMin);
      }
      /* 横纹肌溶解 → 高钾 + 凝血障碍（热射病的真实并发症） */
      if (S.temp > 40) { S.kProd = 0.020; S.coag = Math.max(0.35, (S.coag || 1) - 0.0015 * dtMin); }
      S.lactProd = 0.08;
    },
  },

  {
    id:'myxedema', name:'甲减危象', tag:'myxedema', weight:1, comorbidities:['甲状腺功能减退'],
    init:{ vol:4.20, k:3.9, na:128, hco3:22, lac:2.4, glu:3.6, cr:125, bun:8.5,
           hb:112, wbc:7.0, plt:180, temp:34.2, gcs:9,
           hr:46, sv:58, svr:21, rr:10, pao2:76, paco2:54, spo2:88, uo:0.6,
           contractility:0.76, myxedemaSeverity:1 },
    drivers:{ kProd:0.010, lactProd:0.03 },
    complaint:'老年女性，冬季被发现倒在没开暖气的房间里，反应迟钝、面部浮肿、皮肤干冷。既往甲减，已自行停药 2 个月。',
    goal:['体温 ≥ 36.0','心率 ≥ 55','意识恢复'], minDischargeHR:55,
    check:S=>[ (S.myxedemaSeverity ?? 1) > 0.35 ? '甲状腺激素替代治疗尚未充分生效' : null ].filter(Boolean),
    hint:'左甲状腺素 + 氢化可的松，同时在「环境 / 场景」开启被动保暖，避免大剂量升压药。',
    advance(S, dtMin){
      const replacement = clamp(S.thyroidReplacement || 0, 0, 1);
      S.myxedemaSeverity = clamp((S.myxedemaSeverity ?? 1) + (0.001 - 0.018 * replacement) * dtMin, 0, 1);
    },
  },
  {
    id:'liverFailure', name:'急性肝衰竭', tag:'liver', weight:1, comorbidities:['慢性乙肝'],
    init:{ vol:4.60, k:4.1, na:132, hco3:20, lac:3.4, glu:3.2, cr:110, bun:8.0,
           hb:112, wbc:9.0, plt:95, temp:37.6, gcs:10,
           hr:104, sv:60, svr:12.5, rr:20, pao2:88, paco2:32, spo2:96, uo:0.5,
           contractility:0.88, hepatotox:0.85, coag:0.55 },
    drivers:{ kProd:0.012, lactProd:0.05 },
    complaint:'乙肝病史，近一周黄疸加深、白天嗜睡夜间躁动，今晨呼之不应。查体：扑翼样震颤，皮肤黄染。',
    goal:['意识恢复','凝血功能改善','乳酸下降'],
    check:S=>[ S.gcs < 13 ? `意识 ${S.gcs}` : null,
               (S.coag || 1) < 0.70 ? `凝血功能 ${(S.coag || 1).toFixed(2)}` : null ].filter(Boolean),
    hint:'肝性脑病是"氨"的问题：乳果糖降氨，同时处理诱因（感染、出血、低钾）。别用镇静药。',
    advance(S, dtMin){
      /* 肝细胞坏死继续、凝血因子合成下降；乳果糖降氨可减缓损伤 */
      const lact = (S.given || []).some(g => g && g.id === 'lactulose' && (S.t - g.t) < 21600);
      const rate = lact ? -0.0035 : 0.0012;
      S.hepatotox = Math.max(0.25, Math.min(1, (S.hepatotox == null ? 0.85 : S.hepatotox) + rate * dtMin));
      /* 凝血因子由肝细胞合成：随肝损程度而定，肝损好转则回升 */
      S.coag = Math.max(0.15, 1 - 0.75 * S.hepatotox);
      S.insult.hyperosmol = 0;   // 非高渗
      /* 肝衰竭的死亡交给引擎的肝衰竭通路（hepatotox + coag），不额外注入颅压 */
    },
  },

  {
    id:'tca', name:'三环类抗抑郁药过量', tag:'tca', weight:1, comorbidities:['抑郁症'],
    init:{ vol:4.35, k:4.2, na:138, hco3:20, lac:2.6, glu:6.4, cr:92, bun:5.2,
           hb:132, wbc:8.5, plt:230, temp:36.8, gcs:10,
           hr:132, sv:52, svr:11.5, rr:22, pao2:88, paco2:36, spo2:95, uo:0.7,
           contractility:0.86, tca:0.78 },
    drivers:{ kProd:0.010, lactProd:0.035 },
    complaint:'与家人争吵后吞服阿米替林约 20 片（2 g），2 小时后被发现嗜睡、口干、心跳很快。心电图 QRS 150 ms。',
    goal:['QRS 变窄','意识恢复','心率 < 120'],
    check:S=>[ (S.tca||0) > 0.25 ? `三环类毒性仍高（QRS 增宽）` : null,
               S.gcs < 13 ? `意识 ${S.gcs}` : null ].filter(Boolean),
    hint:'三环类过量的解药不是"洗胃"，而是碳酸氢钠——碱化血液能窄化 QRS、止住室性心律失常。',
    advance(S, dtMin){
      S.tca = Math.max(0, (S.tca == null ? 0.78 : S.tca) - 0.0006 * dtMin);   // 自身清除极慢
      S.qrsWide = Math.max(S.qrsWide || 0, S.tca);
      if (S.tca > 0.55) S._vfRisk = (S._vfRisk || 0) + 0.030 * dtMin;   // 三环类：QRS 增宽 → 室性心律失常
    },
  },

  {
    id:'tbi', name:'颅脑外伤 / 硬膜外血肿', tag:'tbi', weight:2, comorbidities:['头部外伤'],
    init:{ vol:4.30, k:4.1, na:139, hco3:23, lac:2.4, glu:8.2, cr:98, bun:5.6,
           hb:128, wbc:12.0, plt:220, temp:36.7, gcs:11,
           hr:56, sv:62, svr:22, rr:13, pao2:92, paco2:40, spo2:97, uo:0.7,
           contractility:0.90, hematoma:0.55, icp:0.62 },
    drivers:{ kProd:0.010, lactProd:0.03 },
    complaint:'骑车摔倒，左颞部着地，当时清醒，1 小时后逐渐嗜睡、呕吐。查体：左颞头皮血肿，左侧瞳孔较右侧大。',
    goal:['意识恢复','颅内压下降','血压心率回稳'],
    check:S=>[ S.cranied && S.t - (S.craniotomyAt ?? 0) < 900 ? '开颅术后观察未满 15 分钟' : null,
               S.gcs < 13 ? `意识 ${S.gcs}` : null,
               (S.hematoma || 0) > 0.12 ? '颅内血肿未清除' : null ].filter(Boolean),
    hint:'硬膜外血肿有"中间清醒期"——意识变差就是再出血。甘露醇只是争取时间，必须开颅。',
    advance(S, dtMin){
      /* 动脉出血持续 → 血肿扩大；开颅后不再增长 */
      if (!S.cranied) S.hematoma = Math.min(1.2, (S.hematoma || 0) + 0.0014 * dtMin);
      /* Cushing 反应：颅压升高 → 血压升、心率降（脑疝前兆） */
      const icp = S.icp || 0;
      /* Cushing 反应已移入引擎的 hrTarget / toneTarget，模块里再改会被下一拍覆盖 */
    },
  },

  {
    id:'burn', name:'大面积烧伤 / 吸入性损伤', tag:'burn', weight:1, comorbidities:['密闭空间火灾'],
    init:{ vol:3.95, k:5.3, na:136, hco3:20, lac:4.0, glu:9.5, cr:120, bun:8.0,
           hb:158, wbc:16.0, plt:190, temp:36.3, gcs:13,
           hr:126, sv:54, svr:15, rr:26, pao2:76, paco2:36, spo2:91, uo:0.5,
           contractility:0.86, airwayResistance:0.75 },
    drivers:{ kProd:0.020, lactProd:0.055 },
    complaint:'密闭房间火灾中救出，面颈部焦痂、声音嘶哑、鼻毛烧焦，痰中有炭末。体表烧伤面积约 35%。',
    goal:['血氧回升','血压稳定','尿量 ≥ 0.5 mL/min'],
    check:S=>[ S.spo2 < 94 ? `血氧 ${S.spo2.toFixed(0)}%` : null,
               (S.map || 100) < 68 ? '平均动脉压不足' : null ].filter(Boolean),
    hint:'烧伤先看气道：声音嘶哑 + 炭末痰 = 吸入性损伤，气道会肿到堵死，宁可早插管。补液按体重×面积算。',
    advance(S, dtMin){
      /* 血浆渗漏到组织间隙（前 8 小时最快） */
      const rate = S.t < 8 * 3600 ? 0.0050 : 0.0014;
      S.vol = Math.max(2.4, S.vol - rate * dtMin);
      S.interstitium = Math.min(26, (S.interstitium || 11) + rate * dtMin * 0.8);
      /* 气道水肿充分消退后才进入恢复期，撤机不重启肿胀病程。 */
      if ((S.airwayResistance || 0) <= 0.12) S.burnAirwayResolved = true;
      if (S.vent || S.burnAirwayResolved) S.airwayResistance = Math.max(0.10, (S.airwayResistance || 0.45) - 0.0120 * dtMin);
      else S.airwayResistance = Math.min(2.4, (S.airwayResistance || 0.45) + 0.0090 * dtMin);
      /* 气道接近完全阻塞 → 低氧累积（这是吸入性损伤真正的死因） */
      if ((S.airwayResistance || 0) > 1.4) S.insult.hypox += 0.12 * dtMin;
      /* 肌红蛋白/溶血 → 血钾升高 */
      S.kProd = 0.020;
    },
  },

  {
    id:'stemi', name:'急性心肌梗死', tag:'stemi', weight:2, comorbidities:['高血压','吸烟'],
    init:{ vol:4.35, k:4.3, na:138, hco3:22, lac:2.6, glu:9.8, cr:105, bun:6.2,
           hb:138, wbc:12.5, plt:240, temp:36.9, gcs:14,
           hr:104, sv:54, svr:17, rr:22, pao2:90, paco2:33, spo2:96, uo:0.8,
           contractility:0.92, stemi:0.62 },
    drivers:{ kProd:0.011, lactProd:0.040 },
    complaint:'持续胸骨后压榨样疼痛 1 小时，向左肩放射，含服硝酸甘油不缓解。查体：面色苍白、出冷汗，心电图 II/III/aVF 导联 ST 段抬高。',
    goal:['胸痛缓解','血压心率稳定','ST 段回落'],
    check:S=>[ S.reperfused && S.t - (S.reperfusionAt ?? 0) < 900 ? 'PCI 后观察未满 15 分钟' : null,
               (S.stemi || 0) > 0.15 ? '冠脉未再通（ST 仍抬高）' : null,
               (S.map || 100) < 68 ? '平均动脉压不足' : null ].filter(Boolean),
    hint:'ST 段抬高型心梗：抗血小板 + 抗凝 + 尽快再通。硝酸甘油只能缓解症状，救不了濒死心肌。',
    advance(S, dtMin){
      /* 未再通则坏死面积扩大；再通后不再进展 */
      if (!S.reperfused) S.stemi = Math.min(1, (S.stemi || 0) + 0.0012 * dtMin);
      /* 心梗后心源性休克：血压下降、乳酸上升 */
      if ((S.stemi || 0) > 0.7) { S.contractility = Math.max(0.45, (S.contractility || 0.92) - 0.00004 * dtMin); }
    },
  },

  {
    id:'seizure', name:'癫痫持续状态', tag:'seizure', weight:2, comorbidities:['癫痫病史'],
    init:{ vol:4.20, k:4.2, na:137, hco3:17, lac:7.5, glu:6.5, cr:110, bun:7.0,
           hb:136, wbc:11.0, plt:230, temp:38.8, gcs:7,
           hr:142, sv:58, svr:14, rr:30, pao2:78, paco2:30, spo2:90, uo:0.5,
           contractility:0.88, seizure:0.90 },
    drivers:{ kProd:0.014, lactProd:0.095 },
    complaint:'癫痫病史，自行停药。今晨起持续抽搐 20 分钟未停，牙关紧闭、口吐白沫，面色发绀。',
    goal:['抽搐停止','意识恢复','乳酸下降'],
    check:S=>[ (S.seizure || 0) > 0.15 ? `仍在抽搐（活动度 ${Math.round((S.seizure || 0) * 100)}%）` : null,
               S.gcs < 13 ? `意识 ${S.gcs}` : null ].filter(Boolean),
    hint:'持续抽搐超过 5 分钟就要止惊：苯二氮卓是首选。止惊后意识不会立刻回来，别重复过量给药。',
    advance(S, dtMin){
      /* 未止惊则持续放电：乳酸飙升、体温上升、缺氧 */
      if ((S.seizure || 0) > 0.2) {
        S.lactProd = 0.150;   // 持续抽搐的乳酸生成（高于初始 7.5 的稳态，才会继续升）
        S.insult.hypox += 0.10 * (S.seizure || 0) * dtMin;
      } else {
        S.lactProd = 0.030;
      }
      /* 抽搐自行终止很慢（每 10 分钟衰减 4%） */
      S.seizure = Math.max(0, (S.seizure || 0) - 0.0015 * dtMin);
    },
  },

  {
    id:'spleen', name:'脾破裂 / 腹腔内出血', tag:'spleen', weight:2, comorbidities:['腹部钝性外伤'],
    init:{ vol:3.40, k:4.0, na:135, hco3:21, lac:4.6, glu:8.0, cr:105, bun:7.5,
           hb:96, wbc:12.5, plt:210, temp:36.3, gcs:13,
           hr:132, sv:48, svr:17, rr:28, pao2:92, paco2:32, spo2:97, uo:0.25,
           contractility:0.90, bleedRate:0.034 },
    drivers:{ kProd:0.012, lactProd:0.055 },
    complaint:'车祸后左上腹撞击方向盘，左肩牵涉痛，左上腹压痛、轻度肌紧张，面色苍白、出冷汗。',
    goal:['血压稳定','乳酸下降','尿量 ≥ 0.5 mL/min'],
    check:S=>[ S.bleedingSites.spleen > 0 ? '脾脏仍在出血' : null,
               S.bleedingSites.spleen === 0 && S.t - (S.surgicalHemostasisAt ?? 0) < 900 ? '止血术后观察未满 15 分钟' : null,
               (S.vol || 4) < 3.6 ? `有效循环血量 ${S.vol.toFixed(1)} L` : null,
               S.uo < 0.5 ? `尿量 ${S.uo.toFixed(1)} mL/min` : null,
               (S.map || 100) < 68 ? '平均动脉压不足' : null ].filter(Boolean),
    hint:'钝性腹部外伤 + 失血性休克，要考虑脾破裂：液体复苏是争取时间，腹腔内出血不会自己停——该手术。',
    advance(S, dtMin, E){
      /* 包膜下出血：不手术就持续渗血；血压越高出得越快（压力依赖性） */
      if (S.bleedingSites.spleen > 0) {
        E.setBleedingRate(S, 'spleen', 0.026 + 0.012 * Math.max(0, Math.min(1, ((S.map || 90) - 70) / 40)));
      }
    },
  },

  {
    id:'ectopic', name:'宫外孕破裂', tag:'ectopic', weight:2, sexReq:'女', ageRange:[18,44],
    comorbidities:['早孕'],
    init:{ vol:3.45, k:3.9, na:136, hco3:20, lac:5.0, glu:5.6, cr:88, bun:4.6,
           hb:88, wbc:11.5, plt:210, temp:36.5, gcs:13,
           hr:134, sv:48, svr:17, rr:28, pao2:94, paco2:30, spo2:98, uo:0.2,
           contractility:0.92, bleedRate:0.032 },
    drivers:{ kProd:0.011, lactProd:0.06 },
    complaint:'停经 7 周，突发下腹撕裂样疼痛伴肛门坠胀，晕厥一次。查体：面色苍白、下腹压痛反跳痛，宫颈举痛。',
    goal:['血压稳定','尿量 ≥ 0.5 mL/min','腹腔出血已控制'],
    check:S=>[ S.bleedingSites.ectopic > 0 ? '盆腔仍在出血' : null,
               S.bleedingSites.ectopic === 0 && S.t - (S.surgicalHemostasisAt ?? 0) < 900 ? '止血术后观察未满 15 分钟' : null,
               (S.vol || 4) < 3.6 ? `有效循环血量 ${S.vol.toFixed(1)} L` : null,
               S.uo < 0.5 ? `尿量 ${S.uo.toFixed(1)} mL/min` : null,
               (S.map || 100) < 68 ? '平均动脉压不足' : null ].filter(Boolean),
    hint:'育龄女性 + 停经 + 突发下腹痛 + 休克 = 宫外孕破裂。补液是争取时间，必须立刻手术。',
    advance(S, dtMin, E){
      if (S.bleedingSites.ectopic > 0) {
        E.setBleedingRate(S, 'ectopic', 0.030 + 0.010 * Math.max(0, Math.min(1, ((S.map || 90) - 70) / 40)));
      }
    },
  },
  {
    id:'preeclampsia', name:'子痫前期（重度）', tag:'preeclampsia', weight:2, sexReq:'女', ageRange:[20,42],
    comorbidities:['妊娠 34 周'],
    init:{ vol:4.70, k:4.3, na:134, hco3:22, lac:2.6, glu:5.2, cr:120, bun:6.8,
           hb:118, wbc:12.0, plt:78, temp:36.8, gcs:14,
           hr:96, sv:60, svr:26, rr:20, pao2:92, paco2:32, spo2:97, uo:0.35,
           contractility:0.90, coag:0.82 },
    drivers:{ kProd:0.011, lactProd:0.035 },
    complaint:'妊娠 34 周，头痛、视物模糊 2 天。血压 168/108，双下肢水肿，尿蛋白 +++，腱反射亢进。',
    goal:['血压下降','头痛缓解','尿量 ≥ 0.5 mL/min'],
    check:S=>[ !S.delivered ? '重度子痫前期的产科病因尚未解除' : null,
               S.delivered && S.t - (S.deliveryAt ?? 0) < 900 ? '产后观察未满 15 分钟' : null,
               (S.map || 100) > 118 ? `平均动脉压 ${Math.round(S.map)}` : null,
               (S.plt || 200) < 100 ? `血小板 ${Math.round(S.plt)}` : null,
               (S.coag || 1) < 0.65 ? '凝血功能恶化' : null ].filter(Boolean),
    hint:'重度子痫前期：解痉（硫酸镁）比降压更优先，血压别降太猛——胎盘灌注会掉。根治只有终止妊娠。',
    advance(S, dtMin){
      /* 病因在胎盘：不终止妊娠，血管痉挛与血小板消耗都只会加重。
         注意：不能直接写 S.svr —— 引擎每拍会用 toneTarget 覆盖它，
         必须用引擎提供的 svrDrive（血管收缩驱动）才能真正抬高外周阻力。 */
      if (S.delivered) {
        S.svrDrive = Math.max(0, (S.svrDrive || 8) - 0.02 * dtMin);
        S.plt = Math.min(150, (S.plt || 78) + 0.45 * dtMin);
        S.coag = Math.min(1, (S.coag || 0.82) + 0.0006 * dtMin);
        return;
      }
      S.svrDrive = Math.min(16, (S.svrDrive || 8) + 0.012 * dtMin);
      if ((S.map || 100) > 125) S.insult.icp += 0.10 * dtMin;   // 高血压脑病 → 脑水肿 → 子痫
      S.plt = Math.max(20, (S.plt || 78) - 0.06 * dtMin);
      S.coag = Math.max(0.35, (S.coag || 0.82) - 0.0004 * dtMin);
    },
  },
  {
    id:'bph', name:'前列腺增生伴急性尿潴留', tag:'bph', weight:2, sexReq:'男', ageRange:[60,88],
    comorbidities:['前列腺增生'],
    init:{ vol:5.35, k:5.9, na:131, hco3:19, lac:2.8, glu:7.0, cr:310, bun:22,
           hb:122, wbc:9.5, plt:210, temp:36.8, gcs:14,
           hr:98, sv:60, svr:20, rr:24, pao2:88, paco2:34, spo2:94, uo:0.08,
           contractility:0.88, renalFactor:0.35 },
    drivers:{ kProd:0.020, lactProd:0.03 },
    complaint:'72 岁男性，排尿困难 2 天、下腹胀痛，今晨完全排不出尿。查体：下腹膨隆、叩诊浊音，双下肢轻度水肿。',
    goal:['尿量恢复','血钾 < 5.5','肌酐下降'],
    check:S=>[ (S.cr || 0) > 180 ? `肌酐 ${Math.round(S.cr)}` : null,
               S.k > 5.5 ? `血钾 ${S.k.toFixed(1)}` : null,
               (S.vol || 5) > 5.7 ? '容量负荷过重' : null ].filter(Boolean),
    hint:'急性尿潴留先导尿——膀胱减压后肾后性肾损伤才有机会恢复；高钾要同时处理。',
    advance(S, dtMin){
      if (!S.urineDrained) {
        S.vol = Math.min(6.6, (S.vol || 5.35) + 0.0040 * dtMin);   // 排尿不出 → 容量负荷
        S.k = Math.min(8.6, (S.k || 5.9) + 0.0090 * dtMin);        // 排钾减少（不导尿会走到高钾）
      }
    },
  },
];

/* ---------- 组合 ---------- */
function pick(rnd, arr, n) {
  const pool = arr.slice();
  const out = [];
  for (let i = 0; i < n && pool.length; i++) {
    out.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  }
  return out;
}

/* 性别及年龄要求在同一患者身上必须有交集。 */
function demographicsFor(modules) {
  return {
    sexReq: modules.map(m => m.sexReq).find(Boolean),
    ageLo: modules.reduce((age, m) => m.ageRange ? Math.max(age, m.ageRange[0]) : age, 18),
    ageHi: modules.reduce((age, m) => m.ageRange ? Math.min(age, m.ageRange[1]) : age, 88),
  };
}

function fitsDemographics(module, { sexReq, ageLo, ageHi }) {
  if (sexReq && module.sexReq && sexReq !== module.sexReq) return false;
  return !module.ageRange || Math.max(ageLo, module.ageRange[0]) <= Math.min(ageHi, module.ageRange[1]);
}

/* 按权重抽病理：weight 越大越常见 */
function weightedIndex(rnd, pool) {
  const total = pool.reduce((s, m) => s + (m.weight || 1), 0);
  let r = rnd() * total, k = 0;
  for (; k < pool.length; k++) { r -= (pool[k].weight || 1); if (r <= 0) break; }
  return Math.min(k, pool.length - 1);
}

function pickWeighted(rnd, arr, n, legacy) {
  const pool = arr.slice();
  const out = [];
  for (let i = 0; i < n && pool.length; i++) {
    let index = weightedIndex(rnd, pool);
    if (!legacy) {
      const demographics = demographicsFor(out);
      /* 优先保留原抽样结果，保证有效旧种子的随机序列不变。 */
      if (!fitsDemographics(pool[index], demographics)) {
        const eligible = pool.filter(m => fitsDemographics(m, demographics));
        if (!eligible.length) throw new RangeError('缺少符合患者性别和年龄的病理模块');
        index = pool.indexOf(eligible[weightedIndex(rnd, eligible)]);
      }
    }
    out.push(pool.splice(index, 1)[0]);
  }
  return out;
}

function generate(difficulty, seed, only) {
  return generateCase(difficulty, seed, only, VERSION);
}

/* 旧存档与会诊码依赖原抽样序列。 */
function generateLegacy(difficulty, seed) {
  return generateCase(difficulty, seed, undefined, 1);
}

function generateCase(difficulty, seed, only, genVersion) {
  const legacy = genVersion === 1;
  const diff = clamp(difficulty || 2, 1, 5);
  const actualSeed = seed == null ? (Date.now() & 0x7fffffff) : seed;
  const rnd = mulberry32(actualSeed);

  /* 难度重排：
     1 普通（原 1–2 合并）  2 重症（原 3–5 合并）
     3 危重 / 4 极危 / 5 噩梦（新增，叠加更多病理、更快恶化、更多基础病） */
  const nMods = diff <= 2 ? 1 : (diff === 3 ? 2 : 3);
  const severity = 0.75 + diff * 0.06;        // 保留（模块已自带严重度）
  const primary = (only && only.length)
    ? only.map(id => MODULES.find(m => m.id === id)).filter(Boolean).slice(0, nMods)
    : pickWeighted(rnd, MODULES, nMods, legacy);

  if (!primary.length) throw new RangeError('缺少有效的病理模块');
  const demographics = demographicsFor(primary);
  if (!legacy && !primary.every(m => fitsDemographics(m, demographics))) {
    throw new RangeError('指定病理模块的性别或年龄要求冲突');
  }
  const { sexReq, ageLo, ageHi } = demographics;

  const init = Object.assign({}, BASE);
  let admissionTemp = BASE.temp;
  const bleedingSites = {};
  const drivers = {};
  const preload = [];
  let opioidTox = false;

  for (const m of primary) {
    const rate = m.drivers?.bleedRate ?? m.init?.bleedRate;
    if (rate > 0) bleedingSites[m.id] = rate;
    for (const [k, v] of Object.entries(m.init || {})) init[k] = v;
    const temp = m.init?.temp;
    if (Math.abs(temp - BASE.temp) > Math.abs(admissionTemp - BASE.temp)) admissionTemp = temp;
    Object.assign(drivers, m.drivers || {});
    if (m.preload) preload.push(...m.preload);
    if (m.opioidTox) opioidTox = true;
  }
  // 合并病例时，保留偏离基线最大的入院体温，避免后一个模块覆盖首诊异常。
  if (!legacy) init.temp = admissionTemp;
  init.mod = Object.assign({ hr:0, svr:0, sv:0, rr:0, spo2:0, temp:0, gcs:0 }, init.mod || {});
  Object.assign(init, drivers);
  const aki = primary.find(m => m.id === 'aki');
  if (aki) init.renalFactor = Math.min(init.renalFactor, aki.init.renalFactor);
  if (Object.keys(bleedingSites).length) init.bleedingSites = bleedingSites;
  if (preload.length) init.preload = preload;
  if (opioidTox) init.opioidTox = true;

  /* 个体差异 */
  const sex = sexReq || (rnd() < 0.5 ? '男' : '女');
  const age = ageLo + Math.floor(rnd() * Math.max(1, ageHi - ageLo + 1));
  const body = makeBody(sex, age, rnd);
  const weight = body.weight;
  const patient = { name: makeName(sex, rnd), sex, age, height: body.height, weight };
  /* 性别与年龄的基础生理差异（模块的 init 可覆盖） */
  if (sex === '女') {
    /* 只对"本来就正常"的血红蛋白做性别校正；病理性的低 Hb（失血/贫血）不再额外扣 */
    if ((init.hb || 132) >= 115) init.hb = clamp(init.hb - 12, 45, 175);
    init.ecfVd = (init.ecfVd || 12) * 0.94;            // 体脂比例高 → 总体水略少
  }
  if (age >= 65) { init.renalFactor = (init.renalFactor || 1) * 0.85; init.pao2 = clamp((init.pao2 || 94) - 3, 40, 96); }
  init.sex = sex; init.age = age; init.weight = weight; init.height = body.height;
  const hbJit = (rnd() - 0.5) * 14;
  init.hb = clamp(init.hb + hbJit, 45, 175);
  init.vol = clamp(init.vol + (rnd() - 0.5) * 0.25, 2.8, 6.0);
  init.creatJit = (rnd() - 0.5) * 30; init.cr = clamp(init.cr + init.creatJit, 40, 780);
  init.temp = +(init.temp + (rnd() - 0.5) * 0.4).toFixed(1);
  init.hr = Math.round(init.hr + (rnd() - 0.5) * 10);
  init.k = +(init.k + (rnd() - 0.5) * 0.2).toFixed(1);

  /* 难度=5 时加基础病 */
  if (!only && diff >= 2 && (diff >= 3 || rnd() < 0.5)) {
    const comorb = pick(rnd, ['ckd','copd','anemia'], 1)[0];
    if (comorb === 'ckd') {
      init.cr = clamp(init.cr * 1.5, 120, 700);
      init.k = +(init.k + 0.4).toFixed(1);
      init.renalFactor = aki ? Math.min(init.renalFactor, 0.55) : 0.55;
    }
    if (comorb === 'copd') { init.pao2 = clamp(init.pao2 - 8, 40, 90); init.paco2 = init.paco2 + 6; init.vdvt = 0.42; }
    if (comorb === 'anemia') init.hb = clamp(init.hb - 25, 55, 150);
  }

  let traits = [];
  if (root.TRAITS) {
    const pool = root.TRAITS.TRAITS.slice();
    const nT = only ? 0 : diff <= 1 ? 0 : (diff === 2 ? (rnd() < 0.7 ? 1 : 0) : (diff === 3 ? (rnd() < 0.5 ? 1 : 2) : 2));
    for (let i = 0; i < nT && pool.length; i++) {
      traits.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
    }
  }

  const comorbidities = Array.from(new Set(primary.flatMap(m => m.comorbidities || [])));
  const tags = primary.map(m => m.tag);
  const names = primary.map(m => m.name).join(' + ');
  const complaint = primary.map(m => m.complaint).join('　');

  /* 病程推进：按模块顺序执行各自的 advance()（只改负荷，不改体征） */
  const advance = function (S, dtMin, E) {
    for (const m of primary) if (m.advance) m.advance(S, dtMin, E);
  };

  init.seed = actualSeed;
  init.diff = diff;
  init.genVersion = genVersion;
  /* 整体上调：病例推进速度随难度提高（原来所有难度都是 1.0） */
  init.hardScale = diff <= 2 ? (1.05 + diff * 0.10) : (1.30 + (diff - 2) * 0.22);   /* 1.15 / 1.25 / 1.52 / 1.74 / 1.96 */

  return {
    id: 'gen', name: names, tags, diff, genVersion,
    age, sex, weight, patient, bloodType: ['A','B','O','AB'][Math.floor(rnd()*4)],
    complaint, traits,
    comorbidities,
    init,
    goals: Array.from(new Set(primary.flatMap(m => m.goal))),
    minDischargeHR: Math.max(...primary.map(m => m.minDischargeHR ?? 50)),
    hint: primary[0].hint,
    extra: S => primary.flatMap(m => (m.check ? m.check(S) : [])),
    advance,
    cases: primary.map(m => m.id),
    seed: actualSeed,
  };
}

/* 界面上每 tick 之后调用：让病程钩子与引擎同步推进 */
function step(S, dtSec, E) {
  if (!S || !S.running) return;
  const C = S.cas;
  if (C && typeof C.advance === 'function') {
    const k = S.hardScale || 1;
    C.advance(S, (dtSec / 60) * k, E || root.LIFE);
  }
}

const API = { generate, generateLegacy, step, MODULES, BASE, VERSION };
if (typeof module !== 'undefined' && module.exports) module.exports = API;
root.CASEGEN = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
