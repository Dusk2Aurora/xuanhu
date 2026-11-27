# -*- coding: utf-8 -*-
"""Generate download links for the artifacts included in the release."""
from site_assets import DIST, latest_apk, version


def build_download_page(ver, apk):
    android = f"""<div class="card">
    <h2>安卓安装包</h2>
    <a class="btn primary" href="./xuanhu.apk" download>下载 APK（{apk.stat().st_size / 1048576:.2f} MB）</a>
  </div>""" if apk else ""
    html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>悬壶 · 下载</title>
<style>
  :root{{--bg:#f4f2f1;--ink:#141414;--ink2:#6b6b6b;--card:#fff;--line:#e8e4e2;--red:#d33a3a}}
  *{{box-sizing:border-box}}
  body{{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;display:flex;justify-content:center;padding:28px 16px 60px}}
  .wrap{{width:min(560px,100%)}}
  h1{{font-size:26px;margin:8px 0 4px}}
  .sub{{color:var(--ink2);font-size:13px;margin-bottom:20px}}
  .card{{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:18px;margin-bottom:14px}}
  .card h2{{font-size:15px;margin:0 0 8px}}
  .card p{{margin:0 0 10px;color:var(--ink2);font-size:12.5px;line-height:1.7}}
  a.btn{{display:block;text-align:center;padding:13px;border-radius:12px;text-decoration:none;font-weight:700;font-size:14px}}
  .primary{{background:var(--red);color:#fff}}
  .ghost{{border:1px solid var(--line);color:var(--ink);margin-top:8px}}
  .meta{{font-size:11.5px;color:#9a9a9a;margin-top:10px;text-align:center}}
  .tag{{display:inline-block;font-size:11px;padding:2px 8px;border-radius:999px;background:rgba(211,58,58,.08);color:#a33;margin-left:6px}}
  ul{{margin:6px 0 0 18px;padding:0;color:var(--ink2);font-size:12.5px;line-height:1.8}}
</style>
</head>
<body>
<div class="wrap">
  <h1>悬壶<span class="tag">v{ver}</span></h1>
  <div class="sub">一间病房，四位患者，时间不会等你。</div>

  <div class="card">
    <h2>网页版</h2>
    <p>不用安装，手机或电脑浏览器打开就能玩，进度存在本机。发给朋友最省事的就是发这个链接。</p>
    <a class="btn primary" href="./web/">开始游戏</a>
    <a class="btn ghost" href="./xuanhu-single.html" download>下载离线 HTML</a>
  </div>

  {android}

  <div class="card">
    <h2>说明</h2>
    <ul>
      <li>本作是教学模拟，<b>不构成医疗建议</b></li>
      <li>存档在浏览器本地，换设备或清缓存会丢</li>
    </ul>
  </div>
</div>
</body>
</html>
"""
    DIST.mkdir(exist_ok=True)
    page = DIST / "download.html"
    page.write_text(html, encoding="utf-8")
    return page


if __name__ == "__main__":
    print(build_download_page(version(), latest_apk()))
