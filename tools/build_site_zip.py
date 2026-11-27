"""Build and archive the public web release with portable entry names."""
import zipfile

from build_site import build
from site_assets import DEPLOY, DIST, SINGLE, web_files


if __name__ == "__main__":
    build()
    names = ["download.html", "privacy.html", "version.json", SINGLE]
    for _, name in web_files():
        names.extend([name, "web/" + name])
    if (DEPLOY / "xuanhu.apk").is_file():
        names.append("xuanhu.apk")
    archive = DIST / "悬壶-网站包.zip"
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as bundle:
        for name in sorted(names):
            bundle.write(DEPLOY / name, name)
    print(archive)
