# 悬壶 · 临床病房模拟

在一间最多容纳四位患者的病房里值班。你可以查看体征、开检查、给药和实施处置，再从监护仪和化验结果中观察病情变化。切换床位后，其余患者的病程仍会推进。

## 开始游戏

电脑上可以直接打开 `web/index.html`，它需要同目录中的 JavaScript 文件。也可以在仓库根目录启动本地网页服务，再访问 [本地游戏](http://localhost:8000/)。

```sh
python -m http.server 8000 --directory web
```

进入病房大厅后选择床位，或点「接诊新患者」。点击人体图上的器官可以查看对应指标。遇到陌生病例时，可使用上级医师提示和行医手册。进度保存在当前浏览器，续玩时请使用同一浏览器和入口。

## 病房与监护

- 生理引擎根据出血、气道阻力、循环和代谢等因素推演病情。同一种处置在不同患者身上可以产生不同结果。
- 病例涵盖电解质紊乱、中毒、感染及创伤等场景。诊疗记录、趋势图和会诊分享码可用于复盘。
- 平稳时只播放当前床的心搏音，快进时仍按患者心率实时播放。各床位独立报警，室颤响三短声，心静止响较轻的持续音。音效默认音量为 20%，可调节或静音。

## 构建与发布

在仓库根目录使用 Python 3.8 或更高版本。网页构建只使用 Python 标准库。

| 用途 | 命令 | 结果 |
| --- | --- | --- |
| 发送给玩家离线游玩 | `python tools/build_singlefile.py` | `dist/xuanhu-single.html`，可单独打开 |
| 部署静态网站 | `python tools/build_site.py` | 将 `dist/部署包/` 的内容放到站点目录 |
| 上传网站压缩包 | `python tools/build_site_zip.py` | `dist/悬壶-网站包.zip`，解压后根目录即为站点入口 |

网站首页直接进入游戏，`download.html` 提供下载，`privacy.html` 展示隐私政策，`version.json` 列出本次构建包含的产物。

### Android APK

原版的发布脚本引用过 `app/android/`。公开仓库缺少 Android 工程、Gradle Wrapper 和 Capacitor 配置，因此从这份源码可直接构建网页版和离线 HTML；复现原版 APK 需要原作者的 Android 封装工程。发布同一应用的更新还需要沿用原有的签名流程。

如果已有与本次网页版本匹配的 APK，将它放在 `dist/` 后运行 `python tools/build_site_zip.py`。脚本会取最近修改的 `.apk`，以 `xuanhu.apk` 加入站点和网站 ZIP。没有 APK 时，下载页只提供网页和离线版入口。

## 源码与文档

游戏源码在 `prototype/`，页面入口是 `ui-v4.html`。`web/` 是可直接打开的同步副本。修改源码后，按顺序运行以下两条命令更新并核对网页版。

```sh
python tools/build_site.py --sync-web
python tools/build_site.py --check-web
```

`tools/` 包含构建脚本和独立的软著材料生成工具，`docs/` 保存玩法、模型设计及历次版本资料。模型设计和数据处理说明见[技术剖析](docs/技术剖析.md)和[隐私政策](docs/隐私政策.md)。

本作为医学教学模拟，建议 16 岁以上玩家使用。病例、数值及处置效果仅供模拟学习，请勿用于真实诊疗。代码采用 [MIT 许可证](LICENSE)。
