/* ==========================================================================
 * 物质库：药物 / 激素 / 电解质 / 食物 / 词条
 * 物质清单按临床常用药自行整理，覆盖急救、电解质、内分泌、抗感染与中毒解救。
 *
 * 数据结构：每项 = { id, n 名称, c 分类, r 给药途径, d 默认剂量, u 单位,
 *                   on 起效(min), du 持续(min), cost 模拟费用, e 效应, note 说明 }
 * e 里的数值是默认剂量在模型中的效应幅度。体征随浓度变化，其他效应随药代逐步送达。
 * adverse 记录有效浓度超过指定参考倍数时出现的附加不良效应。
 * ========================================================================== */
(function (root) {
'use strict';

/* ---------- 类别模板：同类药共用一套效应 ---------- */
const CLS = {
  '血管活性':   { r:'泵入', on:1,  du:8,   e:{ svr:+6.0, hr:+2 } },
  '强心':       { r:'静推', on:3,  du:20,  e:{ sv:+28, hr:+8 } },
  '抗心律失常': { r:'静推', on:5,  du:60,  e:{ hr:-14 } },
  'ACEI':       { r:'口服', on:30, du:240, e:{ svr:-1.6, k:+0.25 } },
  'ARB':        { r:'口服', on:30, du:240, e:{ svr:-1.4, k:+0.20 } },
  'β阻滞剂':    { r:'口服', on:20, du:180, e:{ hr:-16, svr:-0.5 } },
  '钙拮抗剂':   { r:'口服', on:20, du:180, e:{ svr:-1.3, hr:+4 } },
  '硝酸酯':     { r:'舌下', on:3,  du:40,  e:{ svr:-1.2 } },
  '袢利尿':     { r:'静推', on:5,  du:120, e:{ uo:+2.4, vol:-0.45, k:-0.45 } },
  '保钾利尿':   { r:'口服', on:60, du:300, e:{ uo:+1.0, vol:-0.2, k:+0.25 } },
  '电解质':     { r:'静滴', on:5,  du:60,  e:{} },
  '碱性药':     { r:'静滴', on:5,  du:60,  e:{ hco3:+4 } },
  '扩容':       { r:'静滴', on:5,  du:30,  e:{ vol:+0.5 } },
  '降糖':       { r:'静推', on:15, du:240, e:{ k:-0.8, glu:-4 } },
  '升糖':       { r:'静推', on:5,  du:60,  e:{ glu:+2.5 } },
  '糖皮质激素': { r:'静推', on:30, du:300, e:{ glu:+1.5, svr:+0.3, temp:-0.2 } },
  '甲状腺素':   { r:'口服', on:120,du:600, e:{ hr:+10, temp:+0.3 } },
  '阿片':       { r:'静推', on:2,  du:90,  e:{ rr:-5, gcs:-1.5 } },
  '阿片拮抗':   { r:'静推', on:1,  du:45,  e:{ rr:+5, gcs:+3 } },
  '镇静':       { r:'静推', on:3,  du:180, e:{ gcs:-4, rr:-3, hr:-6 } },
  '抗精神病':   { r:'静推', on:10, du:240, e:{ svr:-1.0, hr:+4, gcs:-1 } },
  '兴奋剂':     { r:'口服', on:15, du:180, e:{ hr:+18, svr:+0.9, gcs:+1 } },
  '致幻剂':     { r:'口服', on:30, du:240, e:{ gcs:-3, hr:+12, temp:+0.4 } },
  '大麻类':     { r:'口服', on:30, du:240, e:{} },
  'NSAID':      { r:'口服', on:30, du:240, e:{ temp:-0.3, coag:-0.025, cr:+8 },
                 adverse:{ threshold:2, eff:{ coag:-0.12, cr:+30 } } },
  '解热镇痛':   { r:'口服', on:30, du:240, e:{ temp:-0.3 } },
  '抗血小板':   { r:'口服', on:30, du:360, e:{} },
  '抗凝':       { r:'静推', on:10, du:240, e:{} },
  '抑酸':       { r:'静推', on:15, du:360, e:{} },
  '支气管扩张': { r:'吸入', on:3,  du:60,  e:{ spo2:+4, rr:-3, hr:+6 } },
  '抗组胺':     { r:'口服', on:30, du:240, e:{ gcs:-1 } },
  '呼吸兴奋':   { r:'静推', on:5,  du:60,  e:{ rr:+5, gcs:+1 } },
  '肌松':       { r:'静推', on:2,  du:30,  e:{ rr:-8 } },
  '解毒':       { r:'静推', on:5,  du:120, e:{} },
  '抗菌药':     { r:'静滴', on:20, du:1440, e:{ infection:-0.80 } },
  '酸化药':     { r:'静滴', on:10, du:120, e:{ hco3:-3.0 } },
  '高渗液':     { r:'静滴', on:10, du:120, e:{ vol:+0.35 } },
  '利尿脱水':   { r:'静推', on:10, du:180, e:{ uo:+1.2 } },
  '抗甲状腺':   { r:'口服', on:60, du:360, e:{ hr:-7, temp:-0.3 } },
  '止血药':     { r:'静推', on:10, du:180, e:{} },
  '溶栓':       { r:'静滴', on:10, du:90,  e:{} },
  '解毒与拮抗':  { r:'静滴', on:20, du:240, e:{} },
  '抗癫痫':     { r:'静推', on:5,  du:240, e:{ gcs:-1 } },
  '止吐':       { r:'静推', on:5,  du:120, e:{} },

  '抗抑郁药':   { r:'口服', on:60, du:480, e:{ gcs:-1 } },
  '心境稳定剂': { r:'口服', on:60, du:480, e:{} },
  '抗帕金森':   { r:'口服', on:45, du:300, e:{ gcs:+1 } },
  '抗精神病2':  { r:'口服', on:45, du:360, e:{ gcs:-2, svr:-0.6 } },
  '催眠药':     { r:'口服', on:30, du:240, e:{ gcs:-4, rr:-2 } },
  '抗胆碱能':   { r:'静推', on:5,  du:180, e:{ hr:+8, gcs:-1 } },
  '性激素':     { r:'口服', on:60, du:720, e:{} },
  '激素拮抗':   { r:'口服', on:60, du:600, e:{} },
  '抗病毒':     { r:'静滴', on:20, du:240, e:{ infection:-0.40 } },
  '抗真菌':     { r:'静滴', on:30, du:360, e:{ infection:-0.45 } },
};

/* ---------- 游戏费用基准（人民币元） ----------
 * 药品表的金额用于游戏内结算。常规给药按默认剂量计一次，持续泵入按默认泵速计一小时。
 * 按体重给药的金额以 70 kg 为基准。旧金额原为每次操作的固定费用，沿用其数值作为基准。
 * 普通口服药、注射药和特殊治疗沿用游戏既有费用层级。以下金额均为游戏设定。
 * 内源性物质和非治疗性精神活性物质统一计模拟物品消耗费。
 */
const SIMULATION_MATERIAL_COST = 8;

/* ---------- 药物清单（id, 名称, 类别, 剂量, 单位, 基准费用, 覆盖说明/效应） ---------- */
const DRUGS = [
  /* —— 心血管 —— */
  ['norepi',   '去甲肾上腺素', '血管活性', 8,  'μg/min', 60, { note:'收缩血管，维持休克时的血压。' }],
  ['epi',      '肾上腺素',     '血管活性', 1,  'mg',     55, { e:{svr:+2.0, hr:+28, glu:+2.2, lac:+1.2}, note:'过敏/心脏骤停一线；大剂量升压' }],
  ['dopamine', '多巴胺',       '血管活性', 5,  'μg/kg/min', 48, { e:{svr:+1.3, hr:+16, uo:+0.6}, note:'升压并加快心率。' }],
  ['dobutamine','多巴酚丁胺',  '强心',     5,  'μg/kg/min', 62, { e:{sv:+16, hr:+10}, note:'增强收缩力，用于低心排量。' }],
  ['isoproterenol','异丙肾上腺素','强心',   1,  'μg/min', 44, { e:{hr:+30, sv:+8}, note:'β 激动，用于心动过缓' }],
  ['amiodarone','胺碘酮',      '抗心律失常',150,'mg',     88, { e:{hr:-12, svr:-0.3}, note:'室性心律失常；留意低血压与心动过缓。' }],
  ['lidocaine','利多卡因',     '抗心律失常',100,'mg',     36, { e:{hr:-8}, note:'静脉给药用于部分室性心律失常。' }],
  ['adenosine','腺苷',         '抗心律失常',6,  'mg',     40, { on:1, du:2, e:{hr:-25}, note:'室上速终止；半衰期极短' }],
  ['atropine', '阿托品',       '抗心律失常',1,  'mg',     18, { on:2, du:40, e:{hr:+20}, note:'抗胆碱能，用于症状性心动过缓' }],
  ['digoxin',  '地高辛',       '强心',     0.25,'mg',     22, { e:{sv:+8, hr:-6}, note:'强心并减慢房室传导，留意低钾。' }],
  ['nifedipine','硝苯地平',    '钙拮抗剂', 10, 'mg',     16, { note:'扩张动脉，降低血压。' }],
  ['amlodipine','氨氯地平',    '钙拮抗剂', 5,  'mg',     18, { note:'用于高血压和稳定型心绞痛。' }],
  ['nicardipine','尼卡地平',   '钙拮抗剂', 5,  'mg/h',   42, { e:{svr:-2}, note:'高血压急症；监测低血压与反射性心动过速。', clinicalNote:'重度主动脉瓣狭窄禁用。' }],
  ['propranolol','普萘洛尔',   'β阻滞剂',  20, 'mg',     12, { note:'非选择性 β 阻滞，可减慢心率。' }],
  ['metoprolol','美托洛尔',    'β阻滞剂',  25, 'mg',     14, { note:'减慢心率，常用于心室率控制。' }],
  ['atenolol', '阿替洛尔',     'β阻滞剂',  25, 'mg',     12, { note:'减慢心率，用于高血压或心绞痛。' }],
  ['labetalol','拉贝洛尔',     'β阻滞剂',  10, 'mg',     20, { e:{hr:-14, svr:-1.2}, note:'兼有 α 与 β 阻滞作用，用于急性降压。' }],
  ['esmolol',  '艾司洛尔',     'β阻滞剂',  50, 'μg/kg/min', 48, { on:1, du:40, e:{hr:-24, sv:-6, svr:0},
    note:'超短效 β₁ 受体阻滞剂。急性主动脉综合征时可随心率、血压和灌注调节泵速。留意心动过缓、低血压和心排量降低。',
    clinicalNote:'严重窦性心动过缓、二度或三度房室传导阻滞、失代偿心衰及心源性休克禁用；反应性气道疾病谨慎。' }],
  ['captopril','卡托普利',     'ACEI',     12.5,'mg',     8,  { note:'短效 ACE 抑制剂；留意高血钾。' }],
  ['enalapril','依那普利',     'ACEI',     5,  'mg',     9,  { note:'用于高血压及部分心衰患者。' }],
  ['lisinopril','赖诺普利',    'ACEI',     5,  'mg',     9,  { note:'用于长期降压；随访血钾和肾功能。' }],
  ['losartan', '氯沙坦',       'ARB',      50, 'mg',     16, { note:'用于高血压或伴蛋白尿的糖尿病肾病。' }],
  ['valsartan','缬沙坦',       'ARB',      80, 'mg',     16, { note:'用于降压和部分心衰患者。' }],
  ['irbesartan','厄贝沙坦',    'ARB',      150,'mg',     16, { note:'用于高血压及部分糖尿病肾病。' }],
  ['olmesartan','奥美沙坦',    'ARB',      20, 'mg',     16, { note:'用于长期降压；留意高血钾。' }],
  ['nitroglycerin','硝酸甘油','硝酸酯',   0.5,'mg',     14, { note:'扩血管；留意低血压。' }],
  ['hydralazine','肼屈嗪',     '血管扩张', 10, 'mg',     15, { r:'静推', on:3, du:40, e:{svr:-1.8, hr:+10}, note:'扩张小动脉；可反射性加快心率。' }],
  ['furosemide','呋塞米',      '袢利尿',   20, 'mg',     9,  { note:'利尿；留意低血钾与容量不足。' }],
  ['spironolactone','螺内酯',  '保钾利尿', 20, 'mg',     11, { note:'保钾利尿；留意高血钾。' }],
  ['heparin',  '肝素',         '抗凝',     5000,'U',     45, { e:{coag:-0.35}, note:'普通肝素。持续静脉泵入期间可复查凝血功能中的 aPTT 和抗 Xa，留意出血。' }],
  ['warfarin', '华法林',       '抗凝',     5,  'mg',     10, { r:'口服', e:{coag:-0.40}, on:120, du:720, note:'口服抗凝，起效慢；留意出血和相互作用。' }],
  ['aspirin',  '阿司匹林',     '抗血小板', 300,'mg',     6,  { e:{coag:-0.06}, note:'抗血小板；留意消化道出血。' }],
  ['clopidogrel','氯吡格雷',   '抗血小板', 300,'mg',     28, { e:{coag:-0.06}, note:'抗血小板；奥美拉唑可减弱其效果。' }],
  ['ibuprofen','布洛芬',       'NSAID',    400,'mg',     8,  { note:'解热镇痛；留意出血与肾损伤。' }],
  ['naproxen', '萘普生',       'NSAID',    500,'mg',     9,  { note:'解热镇痛；留意出血与肾损伤。' }],
  ['acetaminophen','对乙酰氨基酚','解热镇痛', 500,'mg',   6,  { note:'解热镇痛；过量可致肝损伤。' }],

  /* —— 电解质 / 酸碱 / 容量 —— */
  ['kcl',      '氯化钾',       '电解质',   20, 'mmol',   12, { r:'静滴', e:{k:+0.95}, note:'禁止静推；外周浓度 ≤40 mmol/L' }],
  ['kcl_oral', '氯化钾（口服）','电解质',  20, 'mmol',   6,  { r:'口服', on:45, du:120, e:{k:+0.7} }],
  ['calcium',  '葡萄糖酸钙',   '电解质',   10, 'mL',     45, { r:'静推', on:2, du:45, e:{ca:+0.35}, note:'保护心肌，不降钾' }],
  ['calcium_cl','氯化钙',      '电解质',   10, 'mL',     38, { r:'静推', on:1, du:40, e:{ca:+0.5}, note:'补钙并保护心肌。本游戏使用中心静脉通路。', clinicalNote:'外渗可造成局部组织损伤。' }],
  ['magnesium','硫酸镁',       '电解质',   2,  'g',      26, { r:'静滴', e:{ca:-0.05}, adverse:{threshold:2.5, eff:{rr:-8, hr:-12}}, note:'用于子痫与尖端扭转型室速；蓄积可抑制呼吸。' }],
  ['nacl',     '生理盐水',     '扩容',     500,'mL',     26, { e:{vol:+0.5}, note:'等渗晶体液' }],
  ['half_saline', '0.45% 氯化钠', '扩容', 500, 'mL', 26, { r:'静滴', on:10, du:360, e:{halfSaline:+0.5}, note:'低渗补液；高渗高血糖状态下，容量恢复后仍需根据血钠和渗透压决定是否使用。' }],
  ['ringer',   '乳酸林格液',   '扩容',     500,'mL',     34, { e:{vol:+0.5, hco3:+0.5, ca:+0.05}, note:'平衡晶体液，用于补充循环容量。' }],
  ['colloid',  '羟乙基淀粉',   '扩容',     500,'mL',     120,{ e:{vol:+0.65, coag:-0.08, cr:+18}, note:'胶体扩容；留意出血和肾损伤。' }],
  ['prbc',     '浓缩红细胞',   '扩容',     2,  'U',      520,{ r:'输血', e:{vol:+0.3, hb:+20}, note:'1 U 约提升 Hb 10 g/L' }],
  ['ffp',      '新鲜冷冻血浆', '扩容',     2,  'U',      380,{ r:'输血', e:{vol:+0.5, coag:+0.3}, note:'补充凝血因子；留意容量负荷。' }],
  ['bicarb',   '碳酸氢钠',     '碱性药',   150,'mL',     22, { e:{hco3:+3.5}, note:'补充碱储备；亦用于三环类中毒的传导异常。' }],
  ['dextrose50','50% 葡萄糖',  '升糖',     25, 'mL',     18, { r:'静推', on:2, du:40, e:{glu:+6.5}, note:'迅速补充葡萄糖，纠正低血糖。' }],
  ['dextrose10','10% 葡萄糖',  '升糖',     500,'mL',     16, { r:'静滴', e:{glu:+4, vol:+0.5}, note:'静滴补充葡萄糖，可用于维持血糖。' }],
  ['insulin',  '胰岛素',       '降糖',     10, 'U',      28, { note:'降低血糖并促钾进入细胞；留意低血糖与低血钾。' }],
  ['glucagon', '胰高血糖素',   '升糖',     1,  'mg',     58, { r:'静推', e:{glu:+4}, note:'促进肝糖原分解，缓解严重低血糖。' }],
  ['hydrocortisone','氢化皮质酮','糖皮质激素',100,'mg',  36, { e:{glu:+2, svr:+0.6, temp:-0.2}, note:'用于肾上腺危象；可升高血糖。' }],
  ['dexamethasone','地塞米松',  '糖皮质激素',8, 'mg',     24, { e:{glu:+1.8}, note:'长效抗炎；可升高血糖。' }],
  ['methylprednisolone','甲泼尼龙','糖皮质激素',40, 'mg',  42, { e:{glu:+1.6, svr:+0.5, temp:-0.15}, note:'哮喘/COPD 急性加重常用' }],
  ['deslanoside','去乙酰毛花苷','强心苷',0.4,'mg',  46, { r:'静推', on:10, du:720, e:{sv:+0.12, hr:-6}, note:'西地兰；急性心衰伴快速房颤' }],
  ['propafenone','普罗帕酮',   '抗心律失常',70,'mg', 38, { r:'静推', on:5, du:180, e:{hr:-8, sv:-0.03}, note:'用于部分房性心律失常。' }],
  ['pethidine', '哌替啶',      '阿片',     50,'mg',  26, { r:'肌注', on:15, du:180, e:{rr:-3, gcs:-1, svr:-0.2}, note:'短效阿片镇痛；留意呼吸抑制。' }],
  ['etamsylate','酚磺乙胺',    '止血药',   0.5,'g',  32, { e:{coag:+0.06}, note:'用于部分出血的辅助止血。' }],
  ['amoxicillin','阿莫西林',   '抗菌药',   1, 'g',   14, { r:'口服', on:45, du:480, e:{infection:-0.45}, note:'用于敏感细菌感染。' }],
  ['prednisone','泼尼松',      '糖皮质激素',30, 'mg',  10, { r:'口服', on:60, du:720, e:{glu:+1.4}, note:'抗炎；可升高血糖。' }],
  ['ambroxol', '氨溴索',       '祛痰',     30, 'mg',   12, { r:'静推', on:15, du:240, note:'降低痰液黏稠度，帮助咳痰。' }],
  ['bromhexine','溴己新',      '祛痰',     8,  'mg',    8, { r:'口服', on:30, du:300, note:'口服化痰，用于痰液黏稠。' }],
  ['metoclopramide','甲氧氯普胺','止吐',   10, 'mg',    9, { e:{gcs:-0.5}, note:'止吐；可引起嗜睡。', clinicalNote:'可引起急性肌张力障碍等锥体外系反应。' }],
  ['domperidone','多潘立酮',   '止吐',     10, 'mg',    9, { r:'口服', on:30, du:240, note:'促进胃排空，缓解恶心呕吐。', clinicalNote:'可能延长 QT 间期。' }],
  ['smectite', '蒙脱石',       '止泻',     3,  'g',     8, { r:'口服', on:30, du:360, note:'吸附性止泻。', clinicalNote:'可影响其他口服药的吸收。' }],
  ['loperamide','洛哌丁胺',    '止泻',     2,  'mg',    7, { r:'口服', on:45, du:480, adverse:{threshold:5, eff:{hr:-16}}, note:'止泻；滥用可引起严重心脏毒性。' }],
  ['dyphylline','二羟丙茶碱',  '平喘',     0.25,'g',   11, { e:{spo2:+1, hr:+5}, note:'支气管扩张；可加快心率。' }],
  ['clonazepam','氯硝西泮',    '镇静',     1,  'mg',   12, { e:{gcs:-2, rr:-2}, note:'长效苯二氮卓；留意镇静和呼吸抑制。' }],
  ['hydrochlorothiazide','氢氯噻嗪','利尿', 25, 'mg',    8, { r:'口服', on:60, du:720, e:{uo:+0.65, vol:-0.35, k:-0.3}, note:'利尿降压；留意低血钾。' }],
  ['levothyroxine','左甲状腺素','甲状腺素', 100,'μg',    12, { r:'口服', on:240, du:1440, e:{hr:+8, temp:+0.2}, note:'补充甲状腺激素；过多可加快心率。' }],
  ['metformin','二甲双胍',     '降糖',     500,'mg',     10, { r:'口服', on:60, du:360, e:{k:0, glu:-2.2}, note:'减少肝糖输出，用于 2 型糖尿病。' }],
  ['octreotide','奥曲肽',      '抑酸',     50, 'μg',     120,{ note:'食管胃底静脉出血' }],
  ['omeprazole','奥美拉唑',    '抑酸',     80, 'mg',     35, { note:'质子泵抑制剂；可减弱氯吡格雷作用。' }],
  ['famotidine','法莫替丁',    '抑酸',     20, 'mg',     12, { note:'阻断 H₂ 受体，减少胃酸分泌。' }],
  ['proglumide','丙谷胺',      '抑酸',     200,'mg',     8,  { r:'口服', note:'经胃泌素受体减少胃酸分泌。' }],

  /* —— 呼吸 / 神经 —— */
  ['salbutamol','沙丁胺醇',    '支气管扩张',2.5,'mg',     14, { e:{k:-0.12}, note:'快速舒张支气管；可加快心率、降低血钾。' }],
  ['salmeterol','沙美特罗',    '支气管扩张',50, 'μg',     28, { on:20, du:720, note:'长效支气管扩张，用于维持治疗。' }],
  ['doxapram', '多沙普仑',     '呼吸兴奋', 100,'mg',     38, { note:'短时兴奋呼吸中枢。' }],
  ['suxamethonium','琥珀胆碱', '肌松',     100,'mg',     22, { e:{rr:-20, k:+0.35}, note:'去极化肌松；抑制自主呼吸并可升高血钾。' }],
  ['naloxone', '纳洛酮',       '阿片拮抗', 0.4,'mg',     42, { note:'阿片过量解毒，可诱发戒断' }],
  ['flumazenil','氟马西尼',    '解毒',     0.2,'mg',     55, { note:'苯二氮卓拮抗' }],

  /* —— 抗感染 —— */
  ['ceftriaxone','头孢曲松',   '抗菌药',   2,  'g',      86, { e:{infection:-0.85}, note:'第三代头孢，可用于部分重症细菌感染。' }],
  ['meropenem','美罗培南',     '抗菌药',   1,  'g',      220,{ e:{infection:-1.20}, note:'广谱碳青霉烯，可用于部分耐药感染。' }],
  ['vancomycin','万古霉素',    '抗菌药',   1,  'g',      160,{ e:{infection:-0.70, cr:+4}, adverse:{threshold:2, eff:{cr:+35}}, note:'抗菌；蓄积增加肾损伤风险。' }],
  ['levofloxacin','左氧氟沙星','抗菌药',   500,'mg',     48, { e:{infection:-0.60}, note:'喹诺酮类；与华法林合用需留意出血。' }],
  ['piperacillin','哌拉西林他唑巴坦','抗菌药',4.5,'g',   180,{ e:{infection:-1.00}, note:'广谱复方抗生素，覆盖部分铜绿假单胞菌。' }],

  /* —— 镇痛 / 镇静 / 精神 —— */
  ['morphine', '吗啡',         '阿片',     5,  'mg',     12, { note:'用于重度疼痛；留意呼吸抑制。' }],
  ['fentanyl', '芬太尼',       '阿片',     50, 'μg',     18, { note:'强效镇痛；与镇静药合用可加重呼吸抑制。' }],
  ['codeine',  '可待因',       '阿片',     30, 'mg',     8,  { r:'口服', note:'口服阿片，部分镇痛效应依赖代谢。' }],
  ['oxycodone','羟考酮',       '阿片',     5,  'mg',     14, { r:'口服', note:'口服阿片，用于中重度疼痛。' }],
  ['hydrocodone','氢可酮',     '阿片',     5,  'mg',     12, { r:'口服', note:'口服镇痛；可引起嗜睡。' }],
  ['endorphin','内啡肽',       '阿片',     1,  'U',      SIMULATION_MATERIAL_COST, { r:'静推', e:{rr:-2, gcs:-1}, note:'内源性镇痛物质' }],
  ['diazepam', '地西泮',       '镇静',     5,  'mg',     9,  { e:{gcs:-3, rr:-2, hr:-4}, note:'可用于急性止惊；留意呼吸抑制。' }],
  ['lorazepam', '劳拉西泮',    '镇静',     2,  'mg',     12, { e:{gcs:-3, rr:-2, hr:-4}, note:'苯二氮卓，兼有镇静和抗惊厥作用。' }],
  ['phenobarbital','苯巴比妥', '镇静',     100,'mg',     16, { e:{gcs:-5, rr:-4, hr:-8, seizure:-0.35}, note:'巴比妥类抗惊厥药；留意呼吸抑制。' }],
  ['dexmedetomidine','右美托咪定','镇静',  0.5,'μg/kg',  78, { e:{gcs:-3, hr:-10, rr:-1, svr:-0.3}, note:'用于可唤醒镇静；留意心动过缓。' }],
  ['chlorpromazine','氯丙嗪',  '抗精神病', 25, 'mg',     18, { note:'抗精神病；可致低血压，影响儿茶酚胺升压。' }],
  ['clozapine','氯扎平',       '抗精神病', 25, 'mg',     26, { r:'口服', on:45, du:360, note:'抗精神病；留意镇静。', clinicalNote:'可致中性粒细胞减少，用药期间需监测血象。' }],
  ['cyproheptadine','赛庚啶',  '抗组胺',   4,  'mg',     10, { note:'血清素拮抗，用于 5-HT 综合征' }],
  ['diphenhydramine','苯海拉明','抗组胺',  25, 'mg',     8,  { e:{gcs:-1.5}, note:'第一代抗组胺药；镇静较明显。' }],
  ['chlorpheniramine','氯苯那敏','抗组胺', 4,  'mg',     6,  { note:'缓解过敏性鼻炎；可引起嗜睡。' }],
  ['cetirizine','西替利嗪',    '抗组胺',   10, 'mg',     7,  { e:{gcs:-0.4}, note:'用于鼻炎和荨麻疹；少数人嗜睡。' }],
  ['loratadine','氯雷他定',    '抗组胺',   10, 'mg',     7,  { e:{gcs:-0.1}, note:'长效抗组胺药，镇静通常较轻。' }],
  ['dextromethorphan','右美沙芬','镇咳',   15, 'mg',     8,  { r:'口服', on:30, du:240, e:{gcs:-0.4}, adverse:{threshold:3, eff:{gcs:-3, hr:+10}}, note:'镇咳；与部分抗抑郁药合用可增加血清素毒性。' }],
  ['caffeine', '咖啡因',       '兴奋剂',   200,'mg',     4,  { e:{hr:+9, svr:+0.35, gcs:+0.5}, note:'提高警觉性；可加快心率。' }],
  ['ephedrine', '麻黄碱',      '兴奋剂',   25, 'mg',     8,  { note:'拟交感药，可升压并加快心率。' }],
  ['amphetamine','安非他命',   '兴奋剂',   10, 'mg',     SIMULATION_MATERIAL_COST, null],
  ['methamphetamine','甲基苯丙胺','兴奋剂',10,'mg',      SIMULATION_MATERIAL_COST, { e:{hr:+24, svr:+1.2, temp:+0.3} }],
  ['cocaine',  '可卡因',       '兴奋剂',   50, 'mg',     SIMULATION_MATERIAL_COST, { e:{hr:+26, svr:+1.6, temp:+0.6} }],
  ['nicotine', '尼古丁',       '兴奋剂',   2,  'mg',     SIMULATION_MATERIAL_COST, { e:{hr:+7, svr:+0.4, gcs:0}, note:'可短时加快心率、收缩血管。' }],
  ['psilocybin','裸盖菇素',    '致幻剂',   10, 'mg',     SIMULATION_MATERIAL_COST, null],
  ['psilocin', '脱磷酸裸盖菇素','致幻剂',  10, 'mg',     SIMULATION_MATERIAL_COST, null],
  ['mescaline','麦司卡林',     '致幻剂',   200,'mg',     SIMULATION_MATERIAL_COST, null],
  ['dmt',      '二甲基色胺',   '致幻剂',   20, 'mg',     SIMULATION_MATERIAL_COST, { on:2, du:20 }],
  ['thc',      '四氢大麻酚',   '大麻类',   10, 'mg',     SIMULATION_MATERIAL_COST, { e:{gcs:-2, hr:+10} }],
  ['cbd',      '大麻二酚',     '大麻类',   25, 'mg',     SIMULATION_MATERIAL_COST, { e:{gcs:-0.5}, note:'可能引起嗜睡。' }],
  ['heroin',   '海洛因',       '阿片',     10, 'mg',     SIMULATION_MATERIAL_COST, { e:{rr:-6, gcs:-4} }],
];

/* ---------- 补充：覆盖缺口（酸碱、升压选择、镇静、解毒、抗甲状腺…） ---------- */
const EXTRA = [
  /* 酸碱 */
  ['ammonium_chloride','氯化铵',       '酸化药',   500,'mg',     14, { note:'纠正代谢性碱中毒' }],
  ['arginine_hcl',     '盐酸精氨酸',   '酸化药',   20, 'g',      68, { e:{hco3:-4.0}, adverse:{threshold:1.5, eff:{k:+0.8}}, note:'纠正重症碱中毒；过量可升高血钾。' }],
  ['acetazolamide',    '乙酰唑胺',     '利尿脱水', 250,'mg',     18, { r:'口服', e:{hco3:-2.0, uo:+0.8, k:-0.2}, note:'用于碱中毒；留意酸中毒和低血钾。' }],
  ['hypertonic_saline','3% 高渗盐水',  '高渗液',   150,'mL',     42, { e:{vol:+0.35, na:+7}, note:'低钠血症纠正；速度过快致渗透性脱髓鞘' }],
  ['mannitol',         '甘露醇',       '利尿脱水', 250,'mL',     38, { e:{uo:+1.4, gcs:+1, icp:-0.30}, note:'降颅压，渗透性利尿' }],

  /* 血管活性 / 强心 */
  ['nitroprusside',    '硝普钠',       '血管活性', 0.5,'μg/kg/min', 72, { on:1, du:10, e:{svr:-4.0, hr:+4}, adverse:{threshold:4, eff:{lac:+4}}, note:'快速扩血管；监测低血压，高剂量可致氰化物毒性。' }],
  ['phenylephrine',    '去氧肾上腺素', '血管活性', 100,'μg',     34, { on:1, du:15, e:{svr:+5.0, hr:-3}, note:'纯 α 激动，心动过速时优选' }],
  ['vasopressin',      '血管加压素',   '血管活性', 0.03,'U/min', 88, { on:2, du:20, e:{svr:+4.0}, note:'难治性休克；不依赖肾上腺素能受体' }],
  ['milrinone',        '米力农',       '强心',     50, 'μg/kg',  96, { on:5, du:60, e:{sv:+30, svr:-1.2}, note:'磷酸二酯酶抑制剂，心衰伴肺高压' }],

  /* 抗心律失常（补齐室上速/房颤） */
  ['verapamil',        '维拉帕米',     '抗心律失常',5,'mg',      26, { on:2, du:60, e:{hr:-16, sv:-6}, note:'控制室上性心律失常；心衰慎用。' }],
  ['diltiazem',        '地尔硫卓',     '抗心律失常',10,'mg',     28, { on:3, du:90, e:{hr:-12, svr:-0.4}, note:'房颤率控；留意低血压。' }],
  ['procainamide',     '普鲁卡因胺',   '抗心律失常',500,'mg',    42, { on:5, du:90, e:{hr:-10, svr:-0.65}, note:'用于特定室性心律失常；留意低血压。' }],

  /* 镇静 / 精神 / 神经 */
  ['midazolam',        '咪达唑仑',     '镇静',     5,  'mg',     16, { on:1, du:90, e:{gcs:-5, rr:-3, hr:-4}, note:'镇静、止惊；留意呼吸抑制。' }],
  ['propofol',         '丙泊酚',       '镇静',     100,'mg',     46, { on:1, du:30, e:{gcs:-6, rr:-5, svr:-1.5}, note:'快速镇静；留意低血压与呼吸抑制。' }],
  ['ketamine',         '氯胺酮',       '镇静',       1,'mg/kg',  42, { r:'缓慢静注', on:1, du:8, e:{gcs:-8, rr:-1, hr:8, svr:1.2}, adverse:{threshold:1.5, eff:{rr:-7}}, note:'短效镇静镇痛，可用于疼痛操作或插管诱导。留意呼吸、心率和血压。' }],
  ['haloperidol',      '氟哌啶醇',     '抗精神病', 5,  'mg',     22, { e:{gcs:-2}, note:'治疗重度激越；留意镇静。', clinicalNote:'可延长 QT 间期。' }],
  ['phenytoin',        '苯妥英钠',     '抗癫痫',   500,'mg',     32, { e:{seizure:-0.40, svr:-0.4}, note:'抗癫痫；静脉给药留意低血压。' }],
  ['levetiracetam',    '左乙拉西坦',   '抗癫痫',   2000,'mg',    48, { on:2, du:120, e:{seizure:-0.65}, note:'惊厥性癫痫持续状态二线；留意嗜睡。' }],
  ['valproate',        '丙戊酸钠',     '抗癫痫',   800,'mg',     38, { e:{seizure:-0.45}, adverse:{threshold:2.5, eff:{gcs:-4, coag:-0.12}}, note:'抗癫痫；蓄积可加重嗜睡与凝血异常。' }],
  ['ondansetron',      '昂丹司琼',     '止吐',     4,  'mg',     24, { note:'5-HT3 受体拮抗剂。', clinicalNote:'可延长 QT 间期，低钾或低镁时需警惕。' }],
  ['neostigmine',      '新斯的明',     '解毒与拮抗',    2.5,'mg',     26, { r:'静推', on:3, du:60, e:{rr:+3, hr:-8}, note:'拮抗非去极化肌松；可致心动过缓。' }],
  ['dantrolene',       '丹曲林',       '解毒与拮抗',    2.5,'mg/kg',  260,{ r:'静推', on:2, du:180, e:{temp:-1.2, rr:-0.7}, note:'治疗恶性高热；留意肌力下降。' }],

  /* 止血 / 抗凝拮抗 / 溶栓 */
  ['tranexamic_acid',  '氨甲环酸',     '止血药',   1,  'g',      36, { e:{coag:+0.28}, note:'抗纤溶，创伤/产后出血' }],
  ['vitamin_k',        '维生素 K1',    '止血药',   10, 'mg',     12, { e:{vitaminK:+0.38}, note:'促进维生素 K 依赖的凝血因子再合成，华法林大出血时与四因子 PCC 配合。' }],
  ['protamine',        '鱼精蛋白',     '止血药',   50, 'mg',     44, { e:{coag:+0.42}, note:'拮抗肝素' }],
  ['alteplase',        '阿替普酶',     '溶栓',     100,'mg',     980,{ e:{coag:-0.60}, note:'急性缺血性卒中/肺栓塞溶栓；出血风险高' }],
  ['pcc4', '四因子凝血酶原复合物', '止血药', 40, 'IU/kg', 5200, { on:1, du:60, e:{warfarinFactors:1.4}, rescue:true, coverage:'partial', note:'4F-PCC 迅速补充Ⅱ、Ⅶ、Ⅸ、Ⅹ因子，用于华法林相关大出血。与维生素 K1 配合，并复查 INR。' }],
  ['fibrinogenConcentrate', '人纤维蛋白原浓缩物', '止血药', 4, 'g', 6400, { on:1, du:60, e:{fibrinogenReplacement:1.5}, rescue:true, coverage:'partial', note:'严重出血合并低纤维蛋白原时补足底物，复查纤维蛋白原浓度。' }],
  ['cryoprecipitate', '冷沉淀', '止血药', 10, 'U', 1800, { on:1, du:60, e:{fibrinogenReplacement:1.5, vol:0.18}, note:'提供纤维蛋白原，输注较慢。' }],

  /* 解毒 */
  ['nacetylcysteine',  'N-乙酰半胱氨酸','解毒与拮抗',  150,'mg/kg',  120,{ note:'对乙酰氨基酚中毒解药' }],
  ['pralidoxime',      '碘解磷定',     '解毒与拮抗',    1,  'g',      76, { note:'有机磷中毒，配合阿托品' }],
  ['fomepizole',       '甲吡唑',       '解毒与拮抗',    15, 'mg/kg',  420,{ note:'甲醇/乙二醇中毒' }],
  ['sodium_thiosulfate','硫代硫酸钠',  '解毒与拮抗',    12.5,'g',     58, { note:'氰化物中毒' }],
  ['lactulose',        '乳果糖',       '解毒与拮抗',    30, 'mL',     16, { r:'口服', note:'肝性脑病降血氨' }],
  ['idarucizumab', '依达赛珠单抗', '解毒与拮抗', 5, 'g', 18000, { on:1, du:60, e:{dabigatranBinding:1.25}, rescue:true, imported:true, coverage:'selfPay', note:'特异性结合达比加群，用于相关危及生命或不可控出血。' }],
  ['digoxinFab', '地高辛免疫 Fab', '解毒与拮抗', 4, '瓶', 32000, { on:1, du:60, e:{digoxinBinding:1.25}, rescue:true, imported:true, coverage:'selfPay', billingStep:1, note:'结合游离地高辛，减轻严重传导障碍与高钾。治疗后复查心电图和血钾。' }],
  ['glucarpidase', 'Glucarpidase（羧肽酶 G2）', '解毒与拮抗', 50, 'U/kg', 80000, { on:1, du:60, e:{mtxCleavage:5}, rescue:true, imported:true, coverage:'selfPay', note:'高剂量甲氨蝶呤因肾损伤延迟清除时，迅速降低血浆药物浓度。继续细胞保护及肾脏支持，采用色谱法复查。' }],
  ['leucovorin', '亚叶酸钙', '解毒与拮抗', 100, 'mg', 140, { on:1, du:60, e:{mtxCellProtection:0.65}, note:'用于甲氨蝶呤救援中的细胞保护。与 Glucarpidase 给药至少间隔 2 小时。' }],

  /* 呼吸 */
  ['ipratropium',      '异丙托溴铵',   '支气管扩张',0.5,'mg',     18, { e:{spo2:+3, rr:-2, hr:0}, note:'吸入抗胆碱能支气管扩张药。' }],
  ['theophylline',     '氨茶碱',       '支气管扩张',250,'mg',     16, { r:'静滴', e:{spo2:+2, hr:+8}, adverse:{threshold:2, eff:{hr:+14, seizure:+0.3}}, note:'治疗窗窄；蓄积可致心动过速和抽搐。' }],

  /* 抗甲状腺 */
  ['propylthiouracil', '丙硫氧嘧啶',   '抗甲状腺', 200,'mg',     24, { note:'甲亢危象；抑制外周 T4→T3' }],
  ['methimazole',      '甲巯咪唑',     '抗甲状腺', 20, 'mg',     18, { note:'甲亢长期治疗' }],


  /* —— 性激素与拮抗剂 —— */
  ['ocp',         '复方口服避孕药','性激素', 1, '片', 12, { e:{ estrogen:+0.42, coag:+0.06 }, note:'含雌激素；增加血栓风险，吸烟可进一步增加风险。' }],

  ['estradiol',   '雌二醇',     '性激素',   2,  'mg', 22, { e:{ estrogen:+0.60, coag:+0.035 }, note:'雌激素替代；留意血栓风险。' }],
  ['conjugated_estrogen','结合雌激素','性激素',1.25,'mg',26,{ e:{estrogen:+0.50, coag:+0.035}, note:'绝经期激素替代；留意血栓风险。' }],
  ['progesterone','黄体酮',     '性激素', 200, 'mg', 18, { e:{temp:+0.25, gcs:-0.4}, note:'孕激素；可升高基础体温，引起嗜睡。' }],
  ['testosterone', '睾酮',      '性激素',  50, 'mg', 30, { e:{ testosterone:+0.50 }, note:'雄激素替代。', clinicalNote:'长期用药可引起红细胞增多，需复查血红蛋白。' }],
  ['tamoxifen',   '他莫昔芬',   '激素拮抗', 20, 'mg', 28, { e:{ estrogen:-0.50, coag:+0.08 }, note:'SERM；拮抗雌激素，增加血栓风险' }],
  ['letrozole',   '来曲唑',     '激素拮抗',2.5, 'mg', 60, { e:{ estrogen:-0.45 }, note:'芳香化酶抑制剂，显著降低雌激素' }],
  ['bicalutamide','比卡鲁胺',   '激素拮抗', 50, 'mg', 55, { e:{ testosterone:-0.45 }, note:'抗雄激素。', clinicalNote:'可引起肝损伤，用药期间需监测肝功能。' }],
  ['leuprolide',  '亮丙瑞林',   '激素拮抗',3.75,'mg',180, { e:{ testosterone:-0.60, estrogen:-0.35 }, note:'GnRH 激动剂，药物性去势' }],

  /* —— 精神科 / 神经科 —— */
  ['fluoxetine',  '氟西汀',     '抗抑郁药', 20, 'mg', 14, { note:'SSRI；叠加血清素能药物可致血清素毒性。' }],
  ['sertraline',  '舍曲林',     '抗抑郁药', 50, 'mg', 16, { note:'SSRI；叠加血清素能药物可致血清素毒性。' }],
  ['amitriptyline','阿米替林',  '抗抑郁药', 25, 'mg', 10, { e:{hr:+8, gcs:-1.5, svr:-0.35}, adverse:{threshold:4, eff:{tca:+0.68, seizure:+0.42, svr:-1.15}}, note:'三环类抗抑郁药；过量可使 QRS 增宽并诱发抽搐。' }],
  ['lithium',     '碳酸锂',     '心境稳定剂',300,'mg', 12, { adverse:{threshold:2.5, eff:{gcs:-5, seizure:+0.2}}, note:'治疗窗窄；蓄积可引起意识障碍。' }],
  ['levodopa',    '左旋多巴',   '抗帕金森', 250,'mg', 18, { e:{gcs:0, svr:-0.3}, note:'用于帕金森病；留意低血压。', clinicalNote:'可出现异动症。' }],
  ['trihexyphenidyl','苯海索',  '抗帕金森', 2,  'mg', 8,  { e:{gcs:-0.5, hr:+3}, adverse:{threshold:2.5, eff:{gcs:-3}}, note:'中枢抗胆碱能药；过量可致意识障碍。', clinicalNote:'可引起尿潴留。' }],
  ['olanzapine',  '奥氮平',     '抗精神病2', 10, 'mg', 22, { e:{gcs:-3, svr:-0.9, temp:-0.2}, note:'留意镇静与低血压。', clinicalNote:'少数患者出现抗精神病药恶性综合征。' }],
  ['risperidone', '利培酮',     '抗精神病2', 2,  'mg', 20, { e:{svr:-0.7, gcs:-2}, note:'留意镇静与低血压。', clinicalNote:'可引起锥体外系反应。' }],
  ['zolpidem',    '唑吡坦',     '催眠药',   10, 'mg', 14, { note:'短效催眠；与阿片合用可加重呼吸抑制。' }],
  ['promethazine','异丙嗪',     '抗胆碱能', 25, 'mg', 8,  { e:{gcs:-2}, note:'抗组胺；镇静明显。' }],
  ['benztropine', '苯托品',     '抗胆碱能', 2,  'mg', 16, { note:'锥体外系反应的解药' }],
  ['donepezil',   '多奈哌齐',   '胆碱酯酶抑制剂', 5, 'mg', 18, { r:'口服', on:45, du:300, e:{hr:-4}, note:'用于阿尔茨海默病；可致心动过缓。' }],

  /* 抗病毒 / 抗真菌 */
  ['oseltamivir',      '奥司他韦',     '抗病毒',   75, 'mg',     46, { r:'口服', e:{infection:-0.45}, note:'流感；发病 48 小时内最佳' }],
  ['acyclovir',        '阿昔洛韦',     '抗病毒',   10, 'mg/kg',  32, { e:{infection:-0.40}, adverse:{threshold:2, eff:{cr:+25}}, note:'抗疱疹病毒；蓄积时留意肾损伤。' }],
  ['ganciclovir',      '更昔洛韦',     '抗病毒',   5,  'mg/kg',  68, { e:{infection:-0.45}, note:'巨细胞病毒' }],
  ['ribavirin',        '利巴韦林',     '抗病毒',   500,'mg',     28, { e:{infection:-0.30}, note:'用于特定病毒感染。', clinicalNote:'可引起溶血性贫血。' }],
  ['entecavir',        '恩替卡韦',     '抗病毒',   0.5,'mg',     58, { r:'口服', e:{infection:-0.35}, note:'乙肝' }],
  ['nirmatrelvir',     '奈玛特韦',     '抗病毒',   300,'mg',     280,{ r:'口服', e:{infection:-0.55}, note:'新冠；需与利托那韦联用' }],
  ['fluconazole',      '氟康唑',       '抗真菌',   200,'mg',     42, { e:{infection:-0.35}, note:'念珠菌' }],
  ['voriconazole',     '伏立康唑',     '抗真菌',   6,  'mg/kg',  168,{ e:{infection:-0.50}, note:'用于侵袭性曲霉感染。', clinicalNote:'可引起短暂视觉异常。' }],
  ['caspofungin',      '卡泊芬净',     '抗真菌',   70, 'mg',     320,{ e:{infection:-0.45}, note:'侵袭性真菌一线' }],
  ['amphotericin_b',   '两性霉素 B',   '抗真菌',   0.7,'mg/kg',  180,{ e:{infection:-0.55, k:-0.3, cr:+13}, adverse:{threshold:2, eff:{cr:+30}}, note:'广谱抗真菌；留意肾损伤和低血钾。' }],
];

/* ---------- 模拟感染暴露与血液成分 ---------- */
const VIRUS_CELL = [
  ['v_influenza', '流感病毒',   { infectionExposure:+0.40, temp:+0.25 }, { cls:'病毒', on:60, du:1440, note:'模拟流感相关发热。' }],
  ['v_rhino',     '鼻病毒',     { infectionExposure:+0.12 }, { cls:'病毒', on:60, du:720, note:'模拟普通感冒。' }],
  ['v_corona',    '冠状病毒',   { infectionExposure:+0.38, spo2:-4 }, { cls:'病毒', on:90, du:1440, note:'模拟伴低氧的呼吸道感染。' }],
  ['v_hib',       '乙肝病毒',   { infectionExposure:+0.09 }, { cls:'病毒', on:120, du:2880, note:'模拟感染状态。' }],
  ['v_hiv',       '人类免疫缺陷病毒', { infectionExposure:+0.09 }, { cls:'病毒', on:180, du:2880, note:'模拟感染状态。' }],
  ['v_noro',      '诺如病毒',   { infectionExposure:+0.18, vol:-0.4 }, { cls:'病毒', on:45, du:720, note:'模拟胃肠炎伴体液丢失。' }],
  ['v_rota',      '轮状病毒',   { infectionExposure:+0.18, vol:-0.5 }, { cls:'病毒', on:45, du:720, note:'模拟胃肠炎伴体液丢失。' }],
  ['v_ecoli',     '大肠杆菌',   { infectionExposure:+0.50, temp:+0.25 }, { cls:'细菌', on:60, du:1440, note:'模拟细菌感染所致发热。' }],
  /* 红细胞与血浆按现有 2 U 血制品费用折算。白细胞与血小板使用较高的游戏输注费用。 */
  ['c_rbc',       '红细胞',     { hb:+10, vol:+0.15 }, { cls:'血液成分', route:'输注', dose:1, unit:'U', on:10, du:120, cost:260, note:'提高血红蛋白与携氧能力。' }],
  ['c_wbc',       '白细胞',     { wbc:+0.8, infection:-0.15 }, { cls:'血液成分', route:'输注', dose:1, unit:'U', on:20, du:240, cost:680, note:'特定重症感染中的辅助粒细胞输注。' }],
  ['c_plt',       '血小板',     { plt:+35, coag:+0.35, vol:+0.18 }, { cls:'血液成分', route:'输注', dose:1, unit:'U', on:10, du:240, cost:950, note:'补充血小板，改善止血。' }],
  ['c_plasma',    '血浆',       { coag:+0.15, vol:+0.25 }, { cls:'血液成分', route:'输注', dose:1, unit:'U', on:15, du:240, cost:190, note:'补充凝血因子。' }],
];


/* ---------- 药物相互作用（只收高频、后果明确的）----------
 * a / b: 药名；eff: 叠加到状态上的效应；note: 给玩家看的提示
 * sev 标注相互作用的严重性，实际效应随共同暴露变化。
 */
const INTERACTIONS = [
  { a:'华法林', b:'左氧氟沙星', sev:'major', eff:{ coag:-0.14 }, note:'喹诺酮增强抗凝作用' },
  { a:'华法林', b:'对乙酰氨基酚', sev:'minor', eff:{ coag:-0.08 }, note:'长期大剂量对乙酰氨基酚可升高 INR' },
  { a:'地高辛', b:'维拉帕米', sev:'major', eff:{ hr:-10, k:0.15 }, note:'维拉帕米升高地高辛浓度，可致中毒' },
  { a:'地高辛', b:'呋塞米', sev:'major', eff:{ k:-0.35, hr:-8 }, note:'利尿致低钾，地高辛毒性增强' },
  { a:'氯吡格雷', b:'奥美拉唑', sev:'major', eff:{ coag:0.055 }, note:'奥美拉唑减少氯吡格雷活化' },
  { a:'卡托普利', b:'布洛芬', sev:'major', eff:{ cr:40, svr:+0.35 }, note:'NSAID 削弱降压效果，增加肾损伤风险' },
  { a:'卡托普利', b:'螺内酯', sev:'major', eff:{ k:0.45 }, note:'ACEI + 保钾利尿，高钾风险' },
  { a:'碳酸锂', b:'呋塞米', sev:'major', eff:{ gcs:-2 }, note:'利尿和容量不足可促使锂蓄积' },
  { a:'碳酸锂', b:'布洛芬', sev:'major', eff:{ gcs:-2 }, note:'NSAID 减少锂清除，可引起意识变化' },
  { a:'氯丙嗪', b:'肾上腺素', sev:'major', eff:{ svr:-3.5 }, note:'α 受体阻滞可使升压作用反转' },
  { a:'阿司匹林', b:'布洛芬', sev:'major', eff:{ coag:-0.1 }, note:'合用增加消化道出血风险' },
  { a:'阿司匹林', b:'肝素', sev:'minor', eff:{ coag:-0.1 }, note:'双重抗栓，注意出血' },
  { a:'地塞米松', b:'胰岛素', sev:'major', eff:{ glu:2 }, note:'糖皮质激素削弱降糖效果' },
  { a:'沙丁胺醇', b:'美托洛尔', sev:'minor', eff:{ rr:+2, spo2:-2 }, note:'β 阻滞可削弱支气管扩张' },
  { a:'沙丁胺醇', b:'普萘洛尔', sev:'major', eff:{ rr:+4, spo2:-5 }, note:'非选择性 β 阻滞可诱发支气管痉挛' },
  { a:'奥曲肽', b:'胰岛素', sev:'minor', eff:{ glu:-2.0 }, note:'奥曲肽抑制升糖激素，胰岛素需求下降' },
  { a:'硫酸镁', b:'维拉帕米', sev:'major', eff:{ hr:-12, sv:-6 }, note:'镁 + 钙拮抗剂，负性传导叠加' },
  { a:'胺碘酮', b:'美托洛尔', sev:'major', eff:{ hr:-14 }, note:'负性传导叠加，可致严重心动过缓' },
  { a:'万古霉素', b:'呋塞米', sev:'minor', eff:{ cr:35 }, note:'两者均耳肾毒性，合用加重肾损' },
  { a:'纳洛酮', b:'吗啡', sev:'major', eff:{ rr:4 }, note:'拮抗阿片，可诱发急性戒断与躁动' },
  { a:'氟马西尼', b:'咪达唑仑', sev:'major', eff:{}, note:'拮抗苯二氮卓，可能诱发癫痫' },
  { a:'头孢曲松', b:'华法林', sev:'minor', eff:{ coag:-0.08 }, note:'抗生素改变肠道菌群，维生素 K 合成减少' },
  { a:'去甲肾上腺素', b:'氯丙嗪', sev:'minor', eff:{ svr:-2 }, note:'α 阻滞削弱升压效果' },
  { a:'复方口服避孕药', b:'尼古丁', sev:'major', eff:{ coag:+0.06 }, note:'模拟雌激素与吸烟相关的血栓风险叠加' },

  { a:'胺碘酮', b:'华法林', sev:'major', eff:{ coag:-0.25 }, note:'胺碘酮抑制华法林代谢，出血风险显著升高' },
  { a:'氟康唑', b:'华法林', sev:'major', eff:{ coag:-0.22 }, note:'唑类抑制 CYP2C9，华法林作用增强' },
  { a:'阿司匹林', b:'华法林', sev:'major', eff:{ coag:-0.18 }, note:'抗血小板 + 抗凝，消化道出血风险叠加' },
  { a:'依那普利', b:'螺内酯', sev:'major', eff:{ k:+0.45 }, note:'ACEI + 保钾利尿，高钾风险' },
  { a:'缬沙坦', b:'螺内酯', sev:'major', eff:{ k:+0.40 }, note:'ARB + 保钾利尿，高钾风险' },
  { a:'美托洛尔', b:'维拉帕米', sev:'major', eff:{ hr:-16, sv:-8 }, note:'β 阻滞剂 + 非二氢吡啶类钙拮抗，负性传导叠加' },
  { a:'普萘洛尔', b:'维拉帕米', sev:'major', eff:{ hr:-18, sv:-8 }, note:'负性传导叠加，可致严重心动过缓' },
  { a:'吗啡', b:'地西泮', sev:'major', eff:{ rr:-7, gcs:-3 }, note:'阿片 + 苯二氮卓，呼吸抑制协同' },
  { a:'芬太尼', b:'咪达唑仑', sev:'major', eff:{ rr:-8, gcs:-4 }, note:'镇静镇痛联用，呼吸抑制协同' },
  { a:'胰岛素', b:'普萘洛尔', sev:'major', eff:{ glu:-0.50 }, note:'非选择性 β 阻滞可能延缓低血糖恢复' },
  { a:'麻黄碱', b:'普萘洛尔', sev:'major', eff:{ svr:+4.5 }, note:'未对抗的 α 作用，血压骤升' },
  { a:'氢化皮质酮', b:'布洛芬', sev:'major', eff:{ coag:-0.15 }, note:'激素 + NSAID，消化道出血风险叠加' },
  { a:'吗啡', b:'唑吡坦', sev:'major', eff:{ rr:-6, gcs:-2 }, note:'阿片与催眠药叠加呼吸抑制' },
  { a:'氟西汀', b:'右美沙芬', sev:'major', eff:{ hr:+10, temp:+0.55, gcs:-1 }, note:'叠加血清素毒性' },
  { a:'舍曲林', b:'右美沙芬', sev:'major', eff:{ hr:+8, temp:+0.45, gcs:-1 }, note:'叠加血清素毒性' },
  { a:'硫酸镁', b:'琥珀胆碱', sev:'major', eff:{ rr:-6 }, note:'神经肌肉阻滞增强，可加重呼吸抑制' },
];

/* ---------- 多途径：同一种药合并成一条，给药时再选途径 ---------- */
const ROUTE_MAP = {
  calcium_cl: [{ r:'静推', centralAccess:true }],
  norepi:     [{ r:'持续静脉泵入', on:1, pumpHalfLife:2 }],
  vasopressin: [{ r:'持续静脉泵入', pumpHalfLife:5, pumpStep:0.005 }],
  dobutamine: [{ r:'持续静脉泵入', on:2, pumpHalfLife:2 }],
  isoproterenol: [{ r:'持续静脉泵入', on:0, pumpHalfLife:3 }],
  nicardipine: [{ r:'持续静脉泵入', on:0, pumpHalfLife:30, pumpStep:2.5, maxDose:15 }],
  esmolol:    [{ r:'持续静脉泵入', pumpHalfLife:9, pumpStep:25, maxDose:200, pumpPause:true }],
  epi:         [{ r:'泵入', d:1, on:1, du:8 }, { r:'静推', d:1, on:1, du:5 }],
  levothyroxine: [{ r:'口服', d:100, on:240, du:1440 }, { r:'静推', d:100, on:60, du:1440 }],
  kcl:        [{ r:'静滴', d:20, on:5,  du:60  }, { r:'口服', d:20, on:45, du:120 }],
  kcl_oral:   null,
  furosemide: [{ r:'静推', d:20, on:5,  du:120 }, { r:'口服', d:40, on:60, du:300 }],
  morphine:   [{ r:'静推', d:5,  on:2,  du:90  }, { r:'肌注', d:10, on:15, du:120 }, { r:'口服', d:30, on:40, du:240 }],
  fentanyl:   [{ r:'静推', d:50, on:2,  du:60  }, { r:'贴剂', d:25, on:120, du:720 }],
  metoprolol: [{ r:'口服', d:25, on:30, du:240 }, { r:'静推', d:5,  on:3,  du:60 }],
  propranolol:[{ r:'口服', d:20, on:20, du:180 }, { r:'静推', d:1,  on:2,  du:40 }],
  lorazepam:  [{ r:'静推', d:2,  on:3,  du:120 }, { r:'口服', d:0.5,on:30, du:180 }],
  morphine_oral: null,
  nitroglycerin:[{ r:'舌下', d:0.5,on:2,  du:30  }, { r:'泵入', d:5,  on:2,  du:120 }],
  dexamethasone:[{ r:'静推', d:8,  on:30, du:300 }, { r:'口服', d:8,  on:45, du:360 }],
  omeprazole: [{ r:'静推', d:80, on:15, du:360 }, { r:'口服', d:40, on:60, du:480 }],
  ranitidine: null,
  acetaminophen:[{ r:'口服', d:500,on:30, du:240 }, { r:'栓剂', d:500,on:20, du:240 }],
  ceftriaxone:[{ r:'静滴', d:2,  on:20, du:120 }, { r:'肌注', d:1,  on:30, du:180 }],
  levofloxacin:[{ r:'静滴', d:500,on:20, du:120 }, { r:'口服', d:500,on:40, du:240 }],
  octreotide: [{ r:'静推', d:50, on:5,  du:120 }, { r:'泵入', d:25, on:5,  du:240 }],
  furosemide2: null,
  salbutamol: [{ r:'吸入', d:2.5,on:3,  du:60  }, { r:'静滴', d:5,  on:5,  du:60 }],
  insulin:    [{ r:'静推', d:10, on:15, du:240 }, { r:'泵入', d:2,  on:30, du:720, infusionMinutes:60 }],
  levetiracetam: [{ r:'静滴', infusionMinutes:15, maxDose:3000 }],
  pcc4: [{ r:'静滴', infusionMinutes:10, maxDose:50 }],
  fibrinogenConcentrate: [{ r:'静滴', infusionMinutes:10, maxDose:8 }],
  cryoprecipitate: [{ r:'输血', infusionMinutes:25, maxDose:20 }],
  idarucizumab: [{ r:'静滴', infusionMinutes:5, maxDose:5 }],
  digoxinFab: [{ r:'静滴', infusionMinutes:20, maxDose:20 }],
  glucarpidase: [{ r:'静滴', infusionMinutes:2, maxDose:50 }],
  leucovorin: [{ r:'静滴', infusionMinutes:10, maxDose:500 }],
  heparin:    [{ r:'静推', d:5000,on:0, du:180 }, { r:'皮下', d:5000,on:30,du:360 },
               { r:'持续静脉泵入', d:1200, unit:'U/h', pumpHalfLife:60, pumpStep:100, maxDose:5000, pumpPause:true }],
  naloxone:   [{ r:'静推', d:0.4,on:1,  du:45  }, { r:'肌注', d:0.8,on:5,  du:90 }],
};

/* ---------- 食物 / 饮料（末列为一份的模拟饮食费，单位为元） ---------- */
const FOODS = [
  ['water',       '水',         { freeWater:+0.24, vol:+0.06 },           2],
  ['cola',        '可乐',       { freeWater:+0.23, vol:+0.07, glu:+3.2, hr:+1.5 }, 5, { on:8, du:75 }],
  ['milk',        '牛奶',       { freeWater:+0.17, vol:+0.06, glu:+1.1, ca:+0.06, k:+0.05 }, 5],
  ['beer',        '啤酒',       { freeWater:+0.25, vol:+0.07, glu:+0.8, gcs:-0.6 }, 8],
  ['wine',        '红酒',       { freeWater:+0.10, vol:+0.03, glu:+0.2, gcs:-0.7 }, 18],
  ['vodka',       '伏特加',     { freeWater:+0.025, vol:+0.01, gcs:-0.7 }, 12],
  ['soup',        '汤',         { freeWater:+0.07, vol:+0.22, na:+0.5 },  5],
  ['chicken',     '鸡肉',       { k:+0.07 },                             12],
  ['pork',        '猪肉',       { k:+0.08 },                             12],
  ['rice',        '米饭',       { glu:+4.0 },                             3],
  ['drink',       '含糖饮料',   { freeWater:+0.23, vol:+0.07, glu:+2.8 }, 5, { on:8, du:75 }],
  ['meat',        '肉类',       { k:+0.08 },                             12],
  ['carb',        '碳水化合物', { glu:+4.8 },                             5, { on:10, du:90 }],
  ['coffee',      '咖啡',       { freeWater:+0.19, vol:+0.06, hr:+4 },    12],
  ['energy_drink','能量饮料',   { freeWater:+0.21, vol:+0.06, glu:+3.2, hr:+8 }, 8, { on:8, du:100 }],
  ['orange_juice','橙汁',       { freeWater:+0.22, vol:+0.07, glu:+2.9, k:+0.08 }, 6, { on:8, du:75 }],
  ['egg',         '鸡蛋',       { k:+0.025 },                             2],
  ['salmon',      '三文鱼',     { k:+0.09 },                             24],
  ['bread',       '面包',       { glu:+2.8 },                             5],
  ['apple',       '苹果',       { glu:+1.4, k:+0.045 },                   4],
  ['banana',      '香蕉',       { glu:+2.0, k:+0.09 },                    3],
  ['chocolate',   '巧克力',     { glu:+1.8, hr:+1.5 },                    6],
  ['nuts',        '坚果',       { glu:+0.4, k:+0.065 },                   7],
  ['fruit',       '水果',       { glu:+1.8, k:+0.05 },                    5],
  ['snack',       '零食',       { glu:+2.3, na:+0.45 },                   5],
];

/* ---------- 词条（不可给予，仅查询） ---------- */
const CODEX = {
  '激素': ['抗利尿素','胃素','生长抑素','腺苷','乙酰胆碱','促胰液素','胆囊收缩素','神经降压素','心房利尿肽',
           '胰岛素','胰升糖素','促皮质激素释放素','促皮质激素','皮质醇','醛固酮','促性腺激素释放素','促卵泡激素',
           '黄体生成素','雌酮','雌三醇','雌二醇','脱氢表雄酮','雄二烯酮','睾酮','孕酮','黄体制剂','催产素',
           '催乳素','促甲状腺激素','促甲状腺释放激素','副甲状腺素','骨化三醇','降钙素','组织胺','褪黑素',
           '血清素','花生四烯乙醇胺','肾素'],
  '血液成分': ['血浆','红血球','血栓','血小板','嗜酸性粒细胞','中性粒细胞','单核细胞','巨噬细胞','肥大细胞',
               '嗜碱性粒细胞','淋巴细胞','胆固醇','尿素','谷氨酸','氨','氨基酸','肌酸酐','胆红素','胆红',
               '胃蛋白酶原','胃脂肪酶','胰脂肪酶','胰蛋白酶原','胰淀粉酶','甘油三酸酯'],
  '病毒与细菌': ['大肠杆菌','鼻病毒','流感病毒','冠状病毒','甲肝病毒','乙肝病毒','丙肝病毒','丁肝病毒',
                 '人类乳病毒','艾滋病毒','诺如病毒','轮状病毒','人呼吸道合胞病毒','德国麻疹病毒','水痘带状孢疹病毒'],
  '电解质与元素': ['钠','钾','钙','氯','镁','磷','铁','碘','氧','氮','二氧化碳','一氧化氮','盐酸','碳酸氢盐',
                   '双氧水','醋酸','乳酸','乙醇','乙醛'],
  '受体与转运体': ['性腺分泌素受体','雌激素受体','促卵泡激素受体','黄体生成素受体','孕酮受体','前列腺素受体',
                   '血栓素受体','促皮泌素激素受体','皮质素分泌素受体','心房利尿肽受体','皮质醇受体',
                   '甲状腺素分泌素受体','促甲状腺素激素受体','胰岛素受体','甲状腺素受体','降钙素受体',
                   '副甲状腺素受体','缓激肽受体','δ阿片受体','κ阿片受体','μ阿片受体','多巴胺转运体',
                   '痕量胺相关受体','血清素回收体','血清素转运体'],
  '器官与结构': ['心脏','窦房结','房室结','腔静脉','大动脉','脑','大脑皮质','大脑','小脑','胼胝体','脑桥',
                 '丘脑','下丘脑','甲状腺','气管','左肺叶','右肺叶','肝脏','脾脏','胆囊','幽门','胃体','贲门',
                 '幽门括约肌','肾脏','输尿管','小肠','十二指肠','空肠','回肠','大肠','横结肠','盲肠','阑尾',
                 '直肠','生殖系统','阴道','宫颈','子宫','输卵管','膀胱','胰','肾上腺'],
  '感受与状态': ['惊吓','压力','炎热','焦虑','放松','兴奋','过敏','发炎','眩晕','触电','馋','疼痛','寒冷','疲劳','饥饿'],
  '药物类别': ['抗血栓药物','抗组胺药物','阿片类药物','阿片受体阻滞剂','呼吸系统兴奋剂','中枢神经兴奋剂',
               '致幻剂','大麻类药物','血管紧张素阻滞剂','钙离子通道阻滞剂','钾离子通道阻滞剂','钠离子通道阻滞剂',
               'β受体阻滞剂','质子泵抑制剂','袢利尿剂','保钾利尿剂','糖皮质激素','甲状腺素','抗胆碱能药','拟交感药'],
  '症状与病情': ['先天疾病','心肌梗死','心脏骤停','缺氧','高血钾','低血钾','心搏过速','血容量减少','心动过缓',
                 '急性高血压','急性低血压','心脏阻断','低血钠','高血钙','低血钙','高碳酸血','深静脉血栓','内出血',
                 '室上过速','室过速','房颤','室颤','低血糖','高血糖','晕厥','昏迷','窦性心律','酸中毒',
                 '甲状腺亢进','甲状腺低下','脑死亡','呼吸过缓','出血性中风','食欲减弱','呕吐','恶心','发烧',
                 '体温过高','体温过低','高温','大出血','呼吸中止','欣快','烦躁','昏沉','清醒','幻觉','抑郁',
                 '睡眠','哮喘','心包积血','肺栓塞'],
};

/* ---------- 展开 ---------- */
function build() {
  const out = [];
  for (const row of DRUGS.concat(EXTRA)) {
    const [id, n, clsKey, dose, unit, cost, opt] = row;
    if (ROUTE_MAP[id] === null) continue;                 // 已合并进别的条目
    const base = Object.assign({}, CLS[clsKey] || {});
    const o = opt || {};
    const e = Object.assign({}, base.e || {}, o.e || {});
    const adverse = o.adverse || base.adverse;
    const item = {
      id, n, cls: clsKey,
      route: o.r || base.r || '静推',
      dose: o.d || dose,
      unit: o.u || unit,
      onset: o.on != null ? o.on : (base.on || 5),
      dur: o.du != null ? o.du : (base.du || 60),
      cost: o.$ != null ? o.$ : cost,
      eff: e,
      ...(adverse ? { adverse } : {}),
      note: o.note || '',
      ...(o.clinicalNote ? { clinicalNote: o.clinicalNote } : {}),
      kind: 'drug',
      ...(o.rescue ? { rescue: true } : {}),
      ...(o.imported ? { imported: true } : {}),
      ...(o.coverage ? { coverage: o.coverage } : {}),
      ...(o.billingStep ? { billingStep: o.billingStep } : {}),
    };
    /* 多途径展开 */
    const rts = ROUTE_MAP[id];
    if (rts) {
      item.routes = rts.map(x => ({
        r: x.r,
        d: x.d != null ? x.d : item.dose,
        on: x.on != null ? x.on : item.onset,
        du: x.du != null ? x.du : item.dur,
        ...(x.infusionMinutes ? { infusionMinutes: x.infusionMinutes } : {}),
        ...(x.unit ? { unit: x.unit } : {}),
        ...(x.pumpHalfLife ? { pumpHalfLife: x.pumpHalfLife } : {}),
        ...(x.pumpStep ? { pumpStep: x.pumpStep } : {}),
        ...(x.pumpPause ? { pumpPause: true } : {}),
        ...(x.centralAccess ? { centralAccess: true } : {}),
        ...(x.maxDose ? { maxDose: x.maxDose } : {}),
      }));
      item.route = item.routes[0].r;
      item.dose = item.routes[0].d;
      item.onset = item.routes[0].on;
      item.dur = item.routes[0].du;
    } else {
      item.routes = [{ r: item.route, d: item.dose, on: item.onset, du: item.dur }];
    }
    /* 允许超量：给出安全区间供 UI 提示 */
    const d0 = item.dose || 1;
    item.doseRange = [Math.max(0.01, +(d0 * 0.2).toFixed(2)), +(d0 * 10).toFixed(2)];
    out.push(item);
  }
  for (const [id, n, eff, opt] of VIRUS_CELL) {
    // 病毒和细菌用于模拟暴露，费用为零。可输注的血液成分按默认剂量收费。
    const isCell = opt.cls === '血液成分';
    const route = opt.route || '模拟暴露';
    const dose = opt.dose || 1;
    out.push({ id, n, cls: opt.cls, route, dose, unit: opt.unit || '次', onset: opt.on, dur: opt.du,
               cost: isCell ? opt.cost : 0, eff, note: opt.note, kind: isCell ? 'cell' : 'virus',
               routes: [{ r: route, d: dose, on: opt.on, du: opt.du }],
               doseRange: [0.2, 10] });
  }
  for (const [id, n, eff, cost, opt] of FOODS) {
    out.push({ id, n, cls: '食物/饮料', route: '口服', dose: 1, unit: '份',
               onset: opt?.on ?? 20, dur: opt?.du ?? 120, cost, eff, note: '', kind: 'food' });
  }
  return out;
}


/* 别名：同一种药在不同教材/科室里的叫法不同，搜索时都要能命中 */
const ALIASES = {
  'ketamine':'氯胺酮',
  '艾滋病毒': '人类免疫缺陷病毒',
  '氢化可的松': '氢化皮质酮',
  '氢化考的松': '氢化皮质酮',
  '速尿': '呋塞米',
  '呋喃苯胺酸': '呋塞米',
  '小苏打': '碳酸氢钠',
  '副肾素': '肾上腺素',
  '正肾上腺素': '去甲肾上腺素',
  '解磷定': '碘解磷定',
  '纳络酮': '纳洛酮',
  '鲁米那': '苯巴比妥',
  '安定': '地西泮',
  '杜冷丁': '哌替啶',
  '吗啡注射液': '吗啡',
  '硝普钠针': '硝普钠',
  '盐酸尼卡地平': '尼卡地平',
  '盐酸艾司洛尔': '艾司洛尔',
  '左乙拉西坦注射液': '左乙拉西坦',
  '西地兰': '去乙酰毛花苷',
  '心律平': '普罗帕酮',
  '胺碘酮片': '胺碘酮',
  '阿托品针': '阿托品',
  '葡萄糖酸钙针': '葡萄糖酸钙',
  '氯化钾针': '氯化钾',
  '止血敏': '酚磺乙胺',
  '普通肝素': '肝素',
  '肝素钠': '肝素',
  '4F-PCC': '四因子凝血酶原复合物',
  'PCC': '四因子凝血酶原复合物',
  'Idarucizumab': '依达赛珠单抗',
  'DigiFab': '地高辛免疫 Fab',
  'Voraxaze': 'Glucarpidase（羧肽酶 G2）',
  'Leucovorin': '亚叶酸钙',
  '肾上腺素注射液': '肾上腺素',
  '去甲肾上腺素注射液': '去甲肾上腺素',
  '异丙肾': '异丙肾上腺素',
  '多巴胺针': '多巴胺',
  '硝酸甘油片': '硝酸甘油',
  '消心痛': '硝酸异山梨酯',
  '开搏通': '卡托普利',
  '洛赛克': '奥美拉唑',
  '泰胃美': '西咪替丁',
  '吗丁啉': '多潘立酮',
  '胃复安': '甲氧氯普胺',
  '思密达': '蒙脱石',
  '易蒙停': '洛哌丁胺',
  '必嗽平': '溴己新',
  '沐舒坦': '氨溴索',
  '喘定': '二羟丙茶碱',
  '舒喘灵': '沙丁胺醇',
  '氨茶碱针': '氨茶碱',
  '地塞米松磷酸钠': '地塞米松',
  '氟美松': '地塞米松',
  '强的松': '泼尼松',
  '地高辛片': '地高辛',
  '倍他乐克': '美托洛尔',
  '心得安': '普萘洛尔',
  '异搏定': '维拉帕米',
  '合心爽': '地尔硫卓',
  '甘露醇注射液': '甘露醇',
  '阿托品注射液': '阿托品',
  '碘解磷定注射液': '碘解磷定',
  '安定片': '地西泮',
  '氯硝安定': '氯硝西泮',
  '思诺思': '唑吡坦',
  '百忧解': '氟西汀',
  '奥氮平片': '奥氮平',
  '氟哌啶醇针': '氟哌啶醇',
  '芬太尼针': '芬太尼',
  '布洛芬缓释': '布洛芬',
  '泰诺': '对乙酰氨基酚',
  '扑热息痛': '对乙酰氨基酚',
  '先锋必': '头孢哌酮',
  '头孢哌酮钠': '头孢哌酮',
  '罗氏芬': '头孢曲松',
  '泰能': '亚胺培南/西司他丁',
  '亚胺培南西司他丁钠': '亚胺培南/西司他丁',
  '稳可信': '万古霉素',
  '大扶康': '氟康唑',
  '达菲': '奥司他韦',
  '阿昔洛韦片': '阿昔洛韦',
  '优甲乐': '左甲状腺素',
  '赛治': '甲巯咪唑',
  '他巴唑': '甲巯咪唑',
  '速尿针': '呋塞米',
  '安体舒通': '螺内酯',
  '双氢克尿噻': '氢氯噻嗪',
  '氯化钾缓释片': '氯化钾',
  '补达秀': '氯化钾',
  '葡萄糖注射液': '10% 葡萄糖',
  '高糖': '50% 葡萄糖',
  '生理盐水 0.9%': '生理盐水',
  '林格': '乳酸林格液',
  '去甲肾': '去甲肾上腺素',
  '地塞米松针': '地塞米松',
  '甲强龙': '甲泼尼龙',
  '甲泼尼龙': '甲泼尼龙',
};

const ALL = build();
const UNLISTED_DRUGS = ['头孢哌酮', '亚胺培南/西司他丁', '硝酸异山梨酯', '西咪替丁',
  '曲马多', '青霉素', '碘赛罗宁', '可的松', '垂体后叶素'];

function byId(id) { return ALL.find(x => x.id === (id === 'paracetamol' ? 'acetaminophen' : id)); }
function byClass() {
  const m = {};
  for (const s of ALL) (m[s.cls] = m[s.cls] || []).push(s);
  return m;
}
function aliasesFor(name) {
  return Object.keys(ALIASES).filter(alias => ALIASES[alias] === name);
}
function matchesName(name, q) {
  const query = q.toLowerCase();
  return name.toLowerCase().includes(query) || aliasesFor(name).some(alias => alias.toLowerCase().includes(query));
}
function search(q) {
  q = (q || '').trim().replace(/／/g, '/');
  if (!q) return ALL;
  if (UNLISTED_DRUGS.includes(ALIASES[q] || q)) return [];
  return ALL.filter(s =>
    s.cls.includes(q) || s.note.includes(q) || s.clinicalNote?.includes(q) || matchesName(s.n, q)
  );
}
function searchUnlistedDrugs(q) {
  q = (q || '').trim().replace(/／/g, '/');
  if (!q) return [];
  return UNLISTED_DRUGS.filter(name => matchesName(name, q));
}

const RESCUE_INFUSION_EFFECTS = new Set([
  'warfarinFactors', 'dabigatranBinding', 'digoxinBinding', 'mtxCleavage',
  'mtxCellProtection', 'fibrinogenReplacement',
]);

function isRescueInfusionEffect(key) {
  return RESCUE_INFUSION_EFFECTS.has(key);
}

function warfarinEffect(S) {
  return Math.max(0, (S.warfarinLoad || 0) - (S.warfarinFactors || 0));
}

function changeCoagulation(S, delta) {
  S.coag = Math.max(0.05, Math.min(2, (S.coag ?? 1) + delta));
}

function updateWarfarin(S, load, factors) {
  const previous = warfarinEffect(S);
  S.warfarinLoad = load;
  S.warfarinFactors = factors;
  changeCoagulation(S, 0.66 * (previous - warfarinEffect(S)));
}

function advanceWarfarin(S, minutes) {
  const load = S.warfarinLoad * Math.exp(-Math.LN2 * minutes / 760);
  const factors = (S.warfarinFactors || 0) * Math.exp(-Math.LN2 * minutes / 105);
  updateWarfarin(S, load, factors);
}

function applyRescueEffect(S, key, amount) {
  if (!(amount > 0 && Number.isFinite(amount))) return;
  // 按体重给药的救援效应用血浆浓度衡量，按体重折算已送入的总量。
  const perKg = amount * 70 / (S.weight || 70);
  switch (key) {
    case 'vitaminK':
      if (Number.isFinite(S.warfarinLoad)) {
        updateWarfarin(S, Math.max(0, S.warfarinLoad - 2.35 * amount), S.warfarinFactors || 0);
      } else {
        changeCoagulation(S, amount);
      }
      break;
    case 'warfarinFactors':
      if (S.warfarinLoad > 0) updateWarfarin(S, S.warfarinLoad, Math.min(1, (S.warfarinFactors || 0) + perKg));
      break;
    case 'dabigatranBinding':
      if (S.dabigatranLoad > 0) {
        const bound = Math.min(S.dabigatranLoad, amount);
        S.dabigatranLoad -= bound;
        changeCoagulation(S, 0.63 * bound);
      }
      break;
    case 'digoxinBinding':
      if (S.digoxinLoad > 0) {
        const bound = Math.min(S.digoxinLoad, amount);
        S.digoxinLoad -= bound;
        S.k = Math.max(1.2, S.k - 0.95 * bound);
      }
      break;
    case 'mtxCleavage':
      if (S.mtxLevel > 0 && S.renalFactor < 0.75) {
        S.mtxLevel *= Math.exp(-perKg);
        S.mtxFolinicReserve = 0;
      }
      break;
    case 'mtxCellProtection':
      if (S.mtxCellularStress > 0 && !S.given?.some(order => order.id === 'glucarpidase' && S.t - order.t < 2 * 3600)) {
        S.mtxFolinicReserve = Math.min(1, (S.mtxFolinicReserve || 0) + amount);
      }
      break;
    case 'fibrinogenReplacement':
      if (Number.isFinite(S.fibrinogen) && S.fibrinogen < 2.6) {
        const increment = Math.min(2.6 - S.fibrinogen, amount);
        S.fibrinogen += increment;
        changeCoagulation(S, 0.43 * increment);
      }
      break;
  }
}

const API = { ALL, INTERACTIONS, ALIASES, DRUGS: ALL.filter(x => x.kind === 'drug'), FOODS: ALL.filter(x => x.kind === 'food'),
              CODEX, byId, byClass, aliasesFor, search, searchUnlistedDrugs, CLS, applyRescueEffect,
              isRescueInfusionEffect, warfarinEffect, advanceWarfarin };
if (typeof module !== 'undefined' && module.exports) module.exports = API;
root.SUBSTANCES = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);









