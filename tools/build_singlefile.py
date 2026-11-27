"""Bundle local scripts and styles into dist/xuanhu-single.html."""
import re

from site_assets import DIST, ENTRY, PROTO, SINGLE


def build_singlefile():
    html = ENTRY.read_text(encoding="utf-8")

    def script(match):
        js = (PROTO / match[1]).read_text(encoding="utf-8-sig")
        return "<script>\n" + re.sub(r"</script", r"<\\/script", js, flags=re.I) + "\n</script>"

    def stylesheet(match):
        css = (PROTO / match[1]).read_text(encoding="utf-8")
        return "<style>\n" + css + "\n</style>"

    html = re.sub(r'<script\s+src="([^"]+)"\s*>\s*</script>', script, html, flags=re.I)
    html = re.sub(r'<link\s+rel="stylesheet"\s+href="([^"]+)"\s*/?>', stylesheet, html, flags=re.I)
    if re.search(r'<script\b[^>]*\bsrc\s*=|<link\b[^>]*\brel=["\']stylesheet', html, re.I):
        raise ValueError("单文件版仍引用外部脚本或样式")
    DIST.mkdir(exist_ok=True)
    out = DIST / SINGLE
    out.write_bytes(html.encode("utf-8"))
    return out


if __name__ == "__main__":
    print(build_singlefile())
