"""Download the extra photos used by the story page (site/story/).

Reads source/story_images.json. For each entry it downloads the image (from a
Wikimedia Commons file name or a direct URL), writes
site/img/story/<key>-600.webp and <key>-1200.webp, and records author/license
back into the JSON for Commons files.

Usage (from the repo root):
    uv run scripts/fetch_story_images.py            # fetch new or changed entries only
    uv run scripts/fetch_story_images.py --force    # re-download everything
    uv run scripts/fetch_story_images.py d9-ginza   # only these keys
"""

from __future__ import annotations

import argparse
import html
import io
import json
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "source" / "story_images.json"
OUT_DIR = ROOT / "site" / "img" / "story"
SIZES = (600, 1200)
QUALITY = 80
# Wikimedia asks every client to identify itself.
USER_AGENT = "japan-2026-story/1.0 (personal trip site; https://github.com/boytheerapol/japan-2026)"
# Blogs and CDNs often refuse unknown clients, so direct URLs are fetched like a normal browser would.
BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36"


def http_get(url: str, browser: bool = False) -> bytes:
    headers = {"User-Agent": USER_AGENT}
    if browser:
        origin = "{0.scheme}://{0.netloc}/".format(urllib.parse.urlsplit(url))
        headers = {"User-Agent": BROWSER_UA, "Referer": origin,
                   "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8"}
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=60) as res:
        return res.read()


def strip_tags(s: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", s or "")).strip()


def commons_lookup(filename: str) -> tuple[str, dict]:
    """Return (download URL of a ~1600px rendition, credit info) for a Commons file."""
    params = urllib.parse.urlencode({
        "action": "query", "format": "json", "prop": "imageinfo",
        "titles": f"File:{filename}", "iiprop": "url|extmetadata", "iiurlwidth": 1600,
    })
    data = json.loads(http_get(f"https://commons.wikimedia.org/w/api.php?{params}"))
    page = next(iter(data["query"]["pages"].values()))
    if "imageinfo" not in page:
        raise ValueError(f"Commons file not found: {filename}")
    info = page["imageinfo"][0]
    meta = info.get("extmetadata", {})
    credit = {
        "author": strip_tags(meta.get("Artist", {}).get("value", "")),
        "license": strip_tags(meta.get("LicenseShortName", {}).get("value", "")),
        "source": info.get("descriptionurl", ""),
    }
    return info.get("thumburl") or info["url"], credit


def save_webp(raw: bytes, key: str) -> list[Path]:
    img = ImageOps.exif_transpose(Image.open(io.BytesIO(raw))).convert("RGB")
    written = []
    for width in SIZES:
        copy = img.copy()
        copy.thumbnail((width, width * 2), Image.LANCZOS)
        path = OUT_DIR / f"{key}-{width}.webp"
        copy.save(path, "WEBP", quality=QUALITY, method=6)
        written.append(path)
    return written


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("keys", nargs="*", help="only fetch these keys")
    ap.add_argument("--force", action="store_true", help="re-download even if the webp files exist")
    args = ap.parse_args()

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    ok = failed = skipped = 0

    for entry in manifest["images"]:
        key = entry["key"]
        if args.keys and key not in args.keys:
            continue
        wanted = entry.get("url") or entry.get("commons")
        have_files = all((OUT_DIR / f"{key}-{w}.webp").exists() for w in SIZES)
        if not args.force and have_files and entry.get("fetched") == wanted:
            skipped += 1
            continue
        try:
            if entry.get("url"):
                url, credit = entry["url"], {"source": entry["url"]}
                raw = http_get(url, browser=True)
            else:
                url, credit = commons_lookup(entry["commons"])
                raw = http_get(url)
            save_webp(raw, key)
            for stale in ("author", "license", "source"):   # the old photo's credit no longer applies
                entry.pop(stale, None)
            entry.update({k: v for k, v in credit.items() if v})
            entry["fetched"] = wanted
            ok += 1
            print(f"  ✓ {key:<16} {credit.get('license', '')}")
        except Exception as err:  # keep going; one bad link should not stop the rest
            failed += 1
            print(f"  ✗ {key:<16} {err}", file=sys.stderr)

    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"\ndone: {ok} downloaded, {skipped} already there, {failed} failed → {OUT_DIR.relative_to(ROOT)}")
    if failed:
        print("For a failed entry, replace 'commons' with a direct 'url' in source/story_images.json and run again.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
