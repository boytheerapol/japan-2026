"""Generate the narrator voice for the story pages with Gemini TTS.

--page story (default): site/story/, a documentary-style narrator.
--page roadtrip:        site/roadtrip/, told by Shiro the rental car.

Reads site/<page>/script.json and site/data/trip.json, fills the placeholders the
same way the page's JS does ({km}, {d1.sunset}, ...), and writes one MP3 per
subtitle line to site/audio/<page>/<hash>.mp3 plus an index at
site/<page>/voice.json that the page uses to play the clips and time the scenes.

Clips are named by a hash of voice + style + spoken text, so a re-run only calls
the API for lines that changed. Pronunciation fixes go in
site/<page>/voice-lexicon.json (written form -> spoken form); they change the
audio only, never the on-screen subtitle.

Needs GEMINI_API_KEY in the environment or in .env at the repo root.

Usage (from the repo root):
    uv run scripts/build_story_voice.py                          # generate new/changed lines
    uv run scripts/build_story_voice.py --dry-run                # list what would be generated
    uv run scripts/build_story_voice.py --audition --voices Kore,Charon,Aoede
    uv run scripts/build_story_voice.py --page roadtrip
"""

from __future__ import annotations

import argparse
import array
import base64
import hashlib
import http.client
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
import wave
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import lameenc

ROOT = Path(__file__).resolve().parent.parent
TRIP = ROOT / "site" / "data" / "trip.json"
AUDITION_DIR = ROOT / ".voice-audition"

MODEL = "gemini-3.8-flash-tts"
VOICE = "Kore"
STYLES = {
    "story": (
        "ผู้บรรยายสารคดีท่องเที่ยวภาษาไทย น้ำเสียงอบอุ่น เป็นกันเอง ตื่นเต้นเล็กน้อย "
        "พูดชัด จังหวะสบายๆ ไม่เร่ง อ่านชื่อภาษาอังกฤษและญี่ปุ่นแบบคนไทยพูด"
    ),
    "roadtrip": (
        "ชิโระ รถเช่าคันเล็กสีขาวที่เล่าเรื่องทริปด้วยตัวเอง น้ำเสียงสดใส ร่าเริง ขี้เล่น "
        "เหมือนตัวการ์ตูนใจดี พูดเป็นกันเอง จังหวะกระชับมีชีวิตชีวา ช่วงบอกลาให้ซึ้งขึ้นนิดหน่อย "
        "อ่านชื่อภาษาอังกฤษและญี่ปุ่นแบบคนไทยพูด"
    ),
}


class Page:
    def __init__(self, name: str):
        self.name = name
        self.script = ROOT / "site" / name / "script.json"
        self.lexicon = ROOT / "site" / name / "voice-lexicon.json"
        self.index = ROOT / "site" / name / "voice.json"
        self.out_dir = ROOT / "site" / "audio" / name
        self.style = STYLES[name]


PAGE = Page("story")
ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions"
RATE = 24000
BITRATE = 48          # kbps, mono speech
WORKERS = 4


# --------------------------------------------------------------------------- #
# Lines (mirrors fill() / dayKm() in site/story/story.js)                      #
# --------------------------------------------------------------------------- #
def day_km(day: dict) -> int:
    m = re.search(r"([\d,]+)\s*กม", str(day.get("drive") or ""))
    return int(m.group(1).replace(",", "")) if m else 0


def collect_lines(script: dict, trip: dict) -> list[str]:
    if PAGE.name == "roadtrip":
        return collect_roadtrip(script, trip)
    days = {d["n"]: d for d in trip["days"]}
    km_total = sum(day_km(days.get(d["n"], {})) for d in script["days"])

    def fill(s: str) -> str:
        s = s.replace("{km}", f"{km_total:,}")
        return re.sub(r"\{d(\d+)\.(\w+)\}", lambda m: str(days.get(int(m.group(1)), {}).get(m.group(2)) or ""), s)

    raw: list[str] = [*script["intro"], *script["overview"]]
    for d in script["days"]:
        raw.append(d["open"])
        for s in d["spots"]:
            raw.extend(s["lines"])
        raw.extend(d.get("split") or [])
        for s in d.get("spotsAfter") or []:
            raw.extend(s["lines"])
        if d.get("close"):
            raw.append(d["close"])
    raw.extend(script["outro"])

    seen, out = set(), []
    for line in map(fill, raw):
        if line and line not in seen:
            seen.add(line)
            out.append(line)
    return out


def collect_roadtrip(script: dict, trip: dict) -> list[str]:
    """Mirrors fill() / parse() in site/roadtrip/roadtrip.js: the key is the plain text,
    with [[place]] and {{time}} markers unwrapped."""
    days = {d["n"]: d for d in trip["days"]}
    km_total = sum(day_km(d) for d in trip["days"])

    def plain(s: str) -> str:
        s = s.replace("{km}", f"{km_total:,}")
        s = re.sub(r"\{d(\d+)\.(\w+)\}", lambda m: str(days.get(int(m.group(1)), {}).get(m.group(2)) or ""), s)
        return re.sub(r"\[\[(.+?)\]\]|\{\{(.+?)\}\}", lambda m: m.group(1) or m.group(2), s)

    seen, out = set(), []
    for sc in script["scenes"]:
        for line in map(plain, sc.get("lines") or []):
            if line and line not in seen:
                seen.add(line)
                out.append(line)
    return out


def load_lexicon() -> dict[str, str]:
    if not PAGE.lexicon.exists():
        return {}
    return json.loads(PAGE.lexicon.read_text("utf-8")).get("words", {})


def spoken(text: str, lexicon: dict[str, str]) -> str:
    # Longest first so "Kawaguchiko Station" wins over "Kawaguchiko".
    for k in sorted(lexicon, key=len, reverse=True):
        text = text.replace(k, lexicon[k])
    return text


def clip_key(voice: str, say: str) -> str:
    return hashlib.sha1(f"{MODEL}\n{voice}\n{PAGE.style}\n{say}".encode()).hexdigest()[:12]


# --------------------------------------------------------------------------- #
# Gemini                                                                       #
# --------------------------------------------------------------------------- #
def api_key() -> str:
    key = os.environ.get("GEMINI_API_KEY")
    env = ROOT / ".env"
    if not key and env.exists():
        for line in env.read_text().splitlines():
            k, _, v = line.partition("=")
            if k.strip() == "GEMINI_API_KEY":
                key = v.strip().strip("'\"")
    if not key:
        sys.exit("GEMINI_API_KEY is not set (export it or put GEMINI_API_KEY=... in .env)")
    return key


class QuotaExhausted(RuntimeError):
    """The daily request cap is used up; retrying today won't help."""


def tts(text: str, voice: str, key: str) -> bytes:
    """Return 16-bit mono PCM at RATE Hz."""
    body = {
        "model": MODEL,
        "input": [{
            "type": "user_input",
            "content": [{
                "type": "text",
                "text": text,
                "annotations": [{"type": "speech_metadata", "style": PAGE.style}],
            }],
        }],
        "response_format": {"type": "audio"},
        "generation_config": {"speech_config": [{"voice": voice}]},
    }
    req = urllib.request.Request(
        ENDPOINT,
        data=json.dumps(body).encode(),
        headers={"x-goog-api-key": key, "Content-Type": "application/json"},
    )
    for attempt in range(6):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                res = json.load(r)
            break
        except urllib.error.HTTPError as e:
            msg = e.read().decode(errors="replace")
            if e.code == 429 and "per day" in msg:
                raise QuotaExhausted(json.loads(msg).get("error", {}).get("message", msg)) from None
            if e.code in (429, 500, 502, 503, 504) and attempt < 5:
                time.sleep(2 ** attempt * 2)
                continue
            raise RuntimeError(f"HTTP {e.code}: {msg[:500]}") from None
        except (http.client.IncompleteRead, urllib.error.URLError, TimeoutError, ConnectionError):
            if attempt == 5:
                raise
            time.sleep(2 ** attempt)
    if os.environ.get("VOICE_DEBUG"):
        print("usage:", json.dumps(res.get("usage") or res.get("usage_metadata") or {k: v for k, v in res.items() if k != "steps"}), file=sys.stderr)
    audio = [c for s in res.get("steps", []) if s.get("type") == "model_output"
             for c in s.get("content", []) if c.get("type") == "audio"]
    if not audio:
        raise RuntimeError(f"no audio in response: {json.dumps(res)[:500]}")
    data = base64.b64decode(audio[-1]["data"])
    if data[:4] == b"RIFF":
        with wave.open(io.BytesIO(data)) as w:
            if w.getsampwidth() != 2 or w.getnchannels() != 1:
                raise RuntimeError("expected 16-bit mono audio")
            if w.getframerate() != RATE:
                raise RuntimeError(f"expected {RATE} Hz, got {w.getframerate()}")
            return w.readframes(w.getnframes())
    return data  # headerless audio/l16


# --------------------------------------------------------------------------- #
# Audio                                                                        #
# --------------------------------------------------------------------------- #
def trim(pcm: bytes, threshold: int = 500, pad: float = 0.06) -> bytes:
    s = array.array("h", pcm)
    loud = [i for i in range(0, len(s), 64) if abs(s[i]) > threshold]
    if not loud:
        return pcm
    p = int(pad * RATE)
    a, b = max(0, loud[0] - p), min(len(s), loud[-1] + 64 + p)
    return s[a:b].tobytes()


def to_mp3(pcm: bytes) -> bytes:
    enc = lameenc.Encoder()
    enc.set_bit_rate(BITRATE)
    enc.set_in_sample_rate(RATE)
    enc.set_channels(1)
    enc.set_quality(2)
    return enc.encode(pcm) + enc.flush()


# --------------------------------------------------------------------------- #
# Main                                                                         #
# --------------------------------------------------------------------------- #
def audition(voices: list[str], text: str) -> None:
    key = api_key()
    AUDITION_DIR.mkdir(exist_ok=True)
    for v in voices:
        path = AUDITION_DIR / f"{PAGE.name}-{v}.mp3"
        if path.exists():
            print(f"{v}: already rendered")
            continue
        try:
            pcm = trim(tts(spoken(text, load_lexicon()), v, key))
        except QuotaExhausted as e:
            sys.exit(f"stopped at {v}: {e}")
        path.write_bytes(to_mp3(pcm))
        print(f"{path.relative_to(ROOT)}  {len(pcm) / 2 / RATE:.1f}s")


def build(voice: str, dry_run: bool) -> None:
    script = json.loads(PAGE.script.read_text("utf-8"))
    trip = json.loads(TRIP.read_text("utf-8"))
    lexicon = load_lexicon()
    OUT_DIR, INDEX = PAGE.out_dir, PAGE.index
    lines = collect_lines(script, trip)

    old = json.loads(INDEX.read_text("utf-8")).get("cues", {}) if INDEX.exists() else {}
    known = {Path(c["src"]).stem: c["dur"] for c in old.values()}

    plan = []
    for text in lines:
        say = spoken(text, lexicon)
        k = clip_key(voice, say)
        have = (OUT_DIR / f"{k}.mp3").exists() and k in known
        plan.append((text, say, k, have))
    todo = [p for p in plan if not p[3]]
    print(f"{len(lines)} lines, {len(todo)} to generate ({sum(len(p[1]) for p in todo)} chars)")
    if dry_run:
        for _, say, k, _ in todo:
            print(f"  {k}  {say}")
        return

    key = api_key() if todo else ""
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    durs = dict(known)

    quota = []

    def run(item):
        text, say, k, _ = item
        if quota:
            raise quota[0]
        try:
            pcm = trim(tts(say, voice, key))
        except QuotaExhausted as e:
            quota.append(e)
            raise
        (OUT_DIR / f"{k}.mp3").write_bytes(to_mp3(pcm))
        return k, round(len(pcm) / 2 / RATE, 3), text

    failed = 0
    with ThreadPoolExecutor(WORKERS) as pool:
        futs = [pool.submit(run, p) for p in todo]
        for i, f in enumerate(futs, 1):
            try:
                k, dur, text = f.result()
                durs[k] = dur
                print(f"[{i}/{len(todo)}] {k} {dur:5.2f}s  {text[:50]}")
            except QuotaExhausted:
                failed += 1
            except Exception as e:  # keep going; the page falls back to subtitles for this line
                failed += 1
                print(f"[{i}/{len(todo)}] FAILED {todo[i - 1][0][:50]}: {e}", file=sys.stderr)

    cues = {text: {"src": f"audio/{PAGE.name}/{k}.mp3", "dur": durs[k]}
            for text, _, k, _ in plan if k in durs and (OUT_DIR / f"{k}.mp3").exists()}
    for text, c in old.items():       # not regenerated yet (quota/failure): keep the previous clip rather than lose narration
        if text not in cues and text in lines and (ROOT / "site" / c["src"]).exists():
            cues[text] = c
    INDEX.write_text(json.dumps({"model": MODEL, "voice": voice, "cues": cues}, ensure_ascii=False, indent=1) + "\n", "utf-8")

    used = {Path(c["src"]).name for c in cues.values()}
    stale = [p for p in OUT_DIR.glob("*.mp3") if p.name not in used]
    for p in stale:
        p.unlink()
    total = sum(c["dur"] for c in cues.values())
    print(f"wrote {INDEX.relative_to(ROOT)}: {len(cues)}/{len(lines)} lines, {total / 60:.1f} min; removed {len(stale)} stale clips")
    if quota:
        sys.exit(f"daily quota used up ({quota[0]}); {failed} lines left, re-run tomorrow to continue")
    if failed:
        sys.exit(f"{failed} lines failed; re-run to retry them")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--page", choices=sorted(STYLES), default="story")
    ap.add_argument("--voice", default=VOICE)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--audition", action="store_true", help="render a sample line in each of --voices to .voice-audition/")
    ap.add_argument("--voices", default="Kore,Charon,Aoede")
    ap.add_argument("--text", default=None, help="sample text for --audition (default: first intro lines)")
    args = ap.parse_args()
    global PAGE
    PAGE = Page(args.page)
    if args.audition:
        script = json.loads(PAGE.script.read_text("utf-8"))
        first = collect_lines(script, json.loads(TRIP.read_text("utf-8")))[:2]
        audition(args.voices.split(","), args.text or " ".join(first))
    else:
        build(args.voice, args.dry_run)


if __name__ == "__main__":
    main()
