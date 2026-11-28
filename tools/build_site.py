"""Build the static deployment or synchronize the checked-in web preview."""
import argparse
import json
import shutil
import sys

from build_download_page import build_download_page
from build_privacy import build_privacy
from build_singlefile import build_singlefile
from site_assets import DEPLOY, ROOT, SINGLE, latest_apk, version, web_files


def sync_web(check):
    version()
    web = ROOT / "web"
    differences = []
    for source, name in web_files():
        target = web / name
        if check:
            if not target.is_file() or source.read_bytes() != target.read_bytes():
                differences.append(name)
        else:
            web.mkdir(exist_ok=True)
            shutil.copyfile(source, target)
    if differences:
        sys.exit("web/ 与 prototype/ 不一致：" + ", ".join(differences))


def build(github_pages=False):
    release = version()
    single = build_singlefile()
    apk = latest_apk()
    download = build_download_page(release, apk, github_pages=github_pages)
    privacy = build_privacy()
    (DEPLOY / "web").mkdir(parents=True, exist_ok=True)
    for source, name in web_files():
        for directory, release_root in ((DEPLOY, "./"), (DEPLOY / "web", "../")):
            if name == "index.html":
                html = source.read_text(encoding="utf-8")
                meta = f'<meta name="xuanhu-release-root" content="{release_root}">'
                (directory / name).write_text(html.replace("</head>", meta + "\n</head>", 1), encoding="utf-8")
            else:
                shutil.copyfile(source, directory / name)
    for source in (single, download, privacy):
        shutil.copyfile(source, DEPLOY / source.name)
    shutil.copyfile(ROOT / "LICENSE", DEPLOY / "LICENSE")
    apk_target = DEPLOY / "xuanhu.apk"
    if apk:
        shutil.copyfile(apk, apk_target)
    elif apk_target.is_file():
        apk_target.unlink()
    # Older installed clients concatenate the root site's base URL and apk field.
    apk_path = "./xuanhu.apk" if github_pages else "/xuanhu.apk"
    manifest = {
        "version": release, "web": "./", "single": "./" + SINGLE,
        "download": "./download.html", "apk": apk_path if apk else None,
        "apkName": apk.name if apk else "", "apkSize": apk.stat().st_size if apk else 0,
        "at": "build",
    }
    (DEPLOY / "version.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"v{release}  {DEPLOY}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--sync-web", action="store_true", help="从 prototype/ 更新 web/")
    mode.add_argument("--check-web", action="store_true", help="校验 web/ 是否已同步")
    mode.add_argument("--github-pages", action="store_true", help="构建支持项目子目录和备用安卓下载入口的 Pages 站点")
    args = parser.parse_args()
    if args.sync_web or args.check_web:
        sync_web(check=args.check_web)
    else:
        build(github_pages=args.github_pages)
