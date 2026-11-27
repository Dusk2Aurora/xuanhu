# 悬壶 · 临床病房模拟

> 一间病房，四位患者，时间不会等你。

一个**机制驱动**的医学临床思维模拟游戏。你不是在选选项，你是在算剂量。

<p align="center">
  <i>纯前端实现 · 无框架 · 9700 行代码 · 33 个病例 · 215 种物质</i>
</p>

---

## 这是什么

你是病房值班医生，同时管四张床。血钾 7.2 的病人还没处理，隔壁床血压已经掉到 80/50——
你得决定先救谁、用什么、给多少。

与常见的"医学问答游戏"不同，这一作的核心是一个**生理引擎**：

- 病理模块只写「负荷」（出血速率、气道阻力、分流比例）
- 引擎根据负荷推导生命体征（血压 = 心输出量 × 外周阻力）
- 于是**同一个操作在不同病情下后果不同**，这是机制自然产生的，不是特判

## 特性

| | |
|---|---|
| **生理引擎** | 血流动力学、氧合分流、酸碱、电解质、体温、肾功能的微分方程模型 |
| **33 个病例** | 高钾血症、DKA、STEMI、感染性休克、有机磷中毒、肺栓塞、张力性气胸…… |
| **215 种物质** | 药物、血制品、病毒、食物；88 条别名；42 对药物相互作用 |
| **多床位** | 四张床同步流逝，可随时切换 |
| **难度体系** | 五档难度 × 昼夜模式 × 现实模式（医保结算） |
| **辅助系统** | 行医手册、病例档案、指标走势、会诊分享（分享码）、成就 |

## 技术要点

### 机制驱动而非规则驱动

```js
// ❌ 规则驱动：同一个操作在任何病情下结果一样
if (给了胰岛素) 血钾 -= 1.2;

// ✅ 机制驱动：模块只写驱动，引擎统一推导
S.svrDrive = Math.min(16, (S.svrDrive || 8) + 0.012 * dtMin);
const toneTarget = clamp(17.5 * baro * (0.45 + 0.55 * reserve) * pressorGain
    - (S.infection || 0) * 11.0
    + (S.svrDrive || 0)
    + clamp(((S.icp || 0) - 0.60) * 45, 0, 18), 4, 42);
```

### 氧合：分流方程

```js
// SaO₂ = (1−Qs/Qt)·Hill(PaO₂) + Qs/Qt·SvO₂
// SvO₂ 不是常数，由 Fick 方程推出：SvO₂ = 1 − VO₂/DO₂
S.sao2 = clamp((1 - S.shunt) * hill(S.pao2) + S.shunt * svo2Prev, 0.15, 1);
```

这带来一个免费的真实现象：**同样的分流，循环越差血氧越低**。

### 测试：配对差分

```js
// 同一个操作，在不同病理下必须有相反的后果
const ed = diff('edema', S => give(S, 'nacl', 1500), 22);   // 肺水肿：SpO₂ 必须↓
const bl = diff('bleed', S => give(S, 'nacl', 1500), 40);   // 失血：MAP 必须↑
```

完整技术剖析见 [docs/技术剖析.md](docs/技术剖析.md)。

## 运行

### 网页版

```bash
# 任意静态服务器
python -m http.server 8000
# 打开 http://localhost:8000/prototype/ui-v4.html
```

也可以保留整个 `web/` 目录，双击其中的 `index.html`。进度保存在当前浏览器，继续游戏时请使用相同的入口。

### 构建与分发

使用 Python 3.8 或更新版本，在仓库根目录运行：

```bash
python tools/build_singlefile.py       # dist/xuanhu-single.html，可单独发送、离线打开
python tools/build_site.py             # dist/部署包/，可直接作为静态站点根目录
python tools/build_site_zip.py         # 重新构建并压缩为 dist/悬壶-网站包.zip
```

部署包包含游戏、离线 HTML、下载页、隐私页和版本清单。若另有已构建的安卓安装包，可先将 APK 放入 `dist/`，构建时会选用最近修改的一份。

开发时编辑 `prototype/`，运行 `python tools/build_site.py --sync-web` 更新仓库内的 `web/` 预览，再用 `--check-web` 检查两份内容是否一致。

### 测试

```bash
node tools/monotonic.js        # 单调性：剂量越大效应越强
node tools/mechanism-test.js   # 机制：同一操作不同病理后果不同
node tools/content-test.js     # 内容：每个病例能治愈、放任会恶化
node tools/science-audit.js    # 数值合理性：有没有超出生理范围
node tools/drug-audit.js       # 药物齐全性：提示里的药是否都存在
```

## 项目结构

```
prototype/
  engine.js       生理引擎（无依赖，浏览器/Node 双跑）
  generator.js    33 个病理模块 + 随机病例生成
  substances.js   215 种物质、别名、相互作用
  game.js         UI 与交互
  diagnosis.js    诊断推理
  handbook.js     病例档案
  mentor.js       上级医师规则
  ...
tools/            测试与构建脚本
docs/             设计文档
web/              构建好的网页版
```

## 免责声明

本作是**医学教学模拟**。所有病例、数值、处置均为教学演示，
**不构成任何医疗建议**，不能用于真实诊疗。如有健康问题请及时就医。

建议 16 岁以上玩家使用。

## 许可

代码采用 MIT 许可证。游戏内的医学内容仅作教学用途。

---

<p align="center"><i>Built with a lot of iteration, and quite a few bugs that taught me things.</i></p>
