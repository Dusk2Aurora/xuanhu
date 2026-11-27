/* 导师规则自洽性审计
 * 目的：模型重构后，mentor.js 里按旧模型写的阈值可能与新数据脱节
 * （例：血氧 96% 还说"低氧"、MAP 85 还催"上不压药"）。
 * 做法：随机病例跑一遍，每 3 分钟抓一次提示，用"临床正确阈值"反查是否自洽。
 */
require('../prototype/substances.js');
require('../prototype/traits.js');
require('../prototype/generator.js');
const E = require('../prototype/engine.js');

/* 固定病人身份：对照与处置必须是同一个人，否则性别/年龄差异会污染结论 */
try { const _E = require('../prototype/engine.js'); _E.setIdentity && _E.setIdentity({ name:'测试患者', sex:'男', age:45, weight:70, height:172 }); } catch (e) {}
require('../prototype/mentor.js');
const M = globalThis.MENTOR;
const G = globalThis.CASEGEN;

/* 每条提示在临床上成立的前提；不满足即视为"与数据矛盾" */
const PREMISE = {
  o2:        S => S.spo2 < 95 || (S.coHb || 0) > 0.1,   /* CO 中毒：血氧读数正常但缺氧 */
  fluid:     S => S.vol < 4.45 || E.bp(S).map < 76,   /* 前负荷不足的临床阈值比休克宽 */
  pressor:   S => E.bp(S).map < 70 || E.bp(S).sys < 90,
  naloxone:  S => S.rr < 12 || S.gcs < 12,
  furo:      S => S.vol > 4.5 || S.spo2 < 94 || (S.lungWater || 0) > 0.3,
  ntg:       S => E.bp(S).sys > 100,
  bb:        S => S.hr > 110,
  ptu:       S => S.temp > 38.0,
  d50:       S => S.glu < 4.0,
  abx:       S => (S.infection || 0) > 0.4,
  atropine:  S => S.hr < 60 || ((S.tags || []).includes('op') && S.cholinergic > 0.5),
  dialysis:  S => S.k > 5.0,
  blood:     S => S.hb < 90,
  scope:     S => (S.tags || []).includes('bleed'),
  steroid:   S => (S.tags || []).includes('asthma') || (S.tags || []).includes('op') || (S.tags || []).includes('myxedema') || S.svr < 20,
  nac:       S => (S.tags || []).includes('apap'),
  hss:       S => S.na < 128,
  pra:       S => (S.tags || []).includes('op'),
  beta:      S => (S.tags || []).includes('asthma'),
  ppi:       S => (S.tags || []).includes('bleed'),
};

const violations = {};
let checks = 0, fired = 0;

for (let i = 0; i < 40; i++) {
  const diff = 1 + (i % 5);
  let spec;
  try { spec = G.generate(diff, 5000 + i * 37); } catch (e) { continue; }
  const S = E.create(spec);
  for (let t = 0; t < 20 && S.running && !S.death && !S.discharged; t++) {
    for (let k = 0; k < 6; k++) {
      E.tick(S, 30);
      G.step(S, 30, E);
    }
    let hs;
    try { hs = M.hints(S) || []; } catch (e) { hs = []; }
    for (const h of hs) {
      const id = h && h.id;
      if (!id) continue;
      fired++;
      const p = PREMISE[id];
      if (!p) continue;                                  // 没有定义前提的不判
      checks++;
      let ok = true;
      try { ok = !!p(S); } catch (e) { ok = true; }
      if (!ok) {
        if (!violations[id]) violations[id] = { count: 0, sample: null };
        violations[id].count++;
        if (!violations[id].sample) {
          const b = E.bp(S);
          violations[id].sample = {
            msg: (h.c || '') + '／' + (h.d || ''),
            state: `BP ${b.sys}/${b.dia}(MAP ${b.map}) HR ${Math.round(S.hr)} SpO2 ${Math.round(S.spo2)} `
                 + `K ${S.k.toFixed(1)} T ${S.temp.toFixed(1)} RR ${Math.round(S.rr)} vol ${S.vol.toFixed(2)}`,
          };
        }
      }
    }
  }
}

const ids = Object.keys(violations);
console.log(`检查 ${checks} 次提示（触发 ${fired} 次），矛盾 ${ids.length} 类`);
if (!ids.length) { console.log('✓ 导师提示与数据全部自洽'); process.exit(0); }
for (const id of ids) {
  const v = violations[id];
  console.log(`\n✗ ${id}  矛盾 ${v.count} 次`);
  console.log(`   文案: ${v.sample.msg}`);
  console.log(`   当时: ${v.sample.state}`);
}
process.exit(1);

