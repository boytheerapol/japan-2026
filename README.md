# Japan 2026 · 晩秋の旅

เว็บโปรแกรมทริปญี่ปุ่น 29 ต.ค. – 8 พ.ย. 2026 (ฟูจิ · ชิซุโอกะ · อิซุ · คามาคุระ · โตเกียว)
Static site บน GitHub Pages — HTML/CSS/JS ล้วน ไม่มีขั้น build, ใช้งานออฟไลน์ได้ (PWA)

**URL:** https://boytheerapol.github.io/japan-2026/

## ฟีเจอร์
- **โหมดเพื่อน** — ภาพรวม 11 วัน, timeline รายวัน, คู่มืออาหาร/โตเกียว/จุดชมฟูจิ/เตรียมตัว
- **โหมดคนขับ** (ปุ่ม 🚗 มุมขวาบน) — ปุ่มเปิดเส้นทาง Google Maps ของแต่ละวัน, ปุ่มนำทางลานจอดหลัก/สำรองใต้แต่ละจุด, หน้า 🅿️ ที่จอดทั้งหมด, แตะเบอร์เพื่อโทร
- Dark mode, ติดตั้งลงหน้าจอหลัก, QR code สำหรับแชร์, เตือนเมื่อสถานที่ปิดตรงกับวันในแผน

## โครงสร้าง
```
source/day_meta.json         ชื่อวันภาษาไทย + intro + รูปไฮไลท์ของแต่ละวัน + รายการของที่ต้องเตรียม (อยู่ใน repo แก้ด้วยมือได้)
source/itinerary.xlsx        ไฟล์ Excel ของคุณ — ไม่มีใน repo (ดูหัวข้อถัดไป)
scripts/build_data.py        แปลง Excel → site/data/trip.json (ตัดข้อมูลส่วนตัวออก)
site/                        ตัวเว็บที่ deploy
site/story/                  หน้าเรื่องเล่าทริป (ดูหัวข้อ Story)
site/img/days/               รูปไฮไลท์รายวัน (WebP 600/1200px) จาก Wikimedia Commons — เครดิตและลิขสิทธิ์อยู่ใน day_meta.json
.github/workflows/pages.yml  push เข้า main แล้ว deploy อัตโนมัติ
```

## ไฟล์ต้นฉบับ: ต้องใช้อะไรบ้าง
| ไฟล์ | อยู่ใน repo? | ต้องทำอะไร |
|---|---|---|
| **Excel** (`Japan Trip 2026 - Itinerary Plan vX.xlsx`) | ❌ ไม่มี — ถูก `.gitignore` เพราะมีเลขจองและยอดเงินจริง | ใช้ไฟล์บนเครื่องคุณเอง ชื่ออะไรก็ได้ ดูวิธีรันด้านล่าง |
| **Word** (`Japan Trip 2026 - ... v4.docx`) | ❌ ไม่มี | **ไม่ต้องใช้แล้ว** script ไม่อ่าน Word — เนื้อหาถูกดึงมาเก็บใน `source/day_meta.json` แล้วครั้งเดียว ถ้าจะแก้ชื่อวัน/intro ให้แก้ JSON ไฟล์นั้นตรงๆ |

ข้อมูลส่วนตัวไม่หลุดขึ้นเว็บ เพราะ script ไม่อ่านชีต Bookings, Budget, 📱 วันนี้ และ README เลย
และตัดยอดเงินจริงกับคำว่า "คุณ" ออกจากข้อความในชีตอื่น

## อัปเดตข้อมูลเมื่อแก้ Excel
โปรเจกต์นี้ใช้ [uv](https://docs.astral.sh/uv/) เป็น Python package manager ครั้งแรกติดตั้ง dependencies ก่อน (uv จะสร้าง virtualenv ให้อัตโนมัติ):
```bash
uv sync
```

**วิธีที่ 1 — ส่ง path ของไฟล์ Excel ไปตรงๆ (แนะนำ ไม่ต้อง copy)**
```bash
uv run scripts/build_data.py "/path/to/Japan Trip 2026 - Itinerary Plan v8.xlsx"
```

**วิธีที่ 2 — copy มาวางใน `source/` โดยตั้งชื่อว่า `itinerary.xlsx` เท่านั้น**
```bash
cp "/path/to/Japan Trip 2026 - Itinerary Plan v8.xlsx" source/itinerary.xlsx
uv run scripts/build_data.py
```
(ถ้ารันโดยไม่ส่ง path script จะหาไฟล์ที่ `source/itinerary.xlsx` — ชื่ออื่นจะหาไม่เจอ)

จากนั้น commit เฉพาะไฟล์ JSON แล้ว push เข้า `main` — Pages จะ deploy ให้เอง:
```bash
git add site/data/trip.json
git commit -m "Update itinerary data"
git push
```

**ถ้า script หยุดทำงาน** มันจะบอกสาเหตุ เช่น
- `workbook not found` → path ผิด หรือไม่มี `source/itinerary.xlsx`
- `sheet '...' header X4 is '...'` → มีการย้าย/เปลี่ยนชื่อคอลัมน์หรือชีตใน Excel ให้แก้กลับ หรือแก้ `EXPECTED_HEADERS` ใน script ให้ตรง

## 🎬 Story — เรื่องเล่าทริปแบบ animation
หน้า `site/story/` (ปุ่ม 🎬 บนหน้าแรก) เล่าทริปทั้ง 11 วันแบบเล่นอัตโนมัติ ~10 นาที: แผนที่ลากเส้นทาง, รูปแต่ละจุด, ซับไทย + transcript, เพลงประกอบที่สร้างด้วย Web Audio (ไม่มีไฟล์เพลง)
คีย์ลัด: `Space` เล่น/หยุด · `←/→` ฉากก่อน/ถัดไป · `M` เพลง · `T` transcript · `F` เต็มจอ · ลิงก์ตรงไปวันไหนก็ได้ด้วย `story/#d6`

| ไฟล์ | หน้าที่ |
|---|---|
| `site/story/script.json` | บทพากย์ จุดแวะ พิกัด และรูปของแต่ละจุด — แก้ข้อความได้ตรงนี้ · `{d6.depart}` `{d1.sunset}` `{km}` ดึงค่าจาก `trip.json` อัตโนมัติ |
| `site/story/story.js` · `story.css` · `index.html` | ตัว engine (ความเร็วปรับที่ `CHAR_RATE` บรรทัดต้นไฟล์) |
| `site/story/map.json` | เส้นชายฝั่ง (สร้างครั้งเดียวด้วย `scripts/build_story_map.mjs`) |
| `site/story/routes.json` | เส้นทางวิ่งบนแผ่นดิน — **รันใหม่ทุกครั้งที่แก้พิกัดใน script.json:** `node scripts/build_story_routes.mjs` |
| `source/story_images.json` | รูปเพิ่มเติมของ story (Wikimedia `commons` หรือ `url` ตรง) |
| `site/img/story/` | รูป webp 600/1200 ที่ดาวน์โหลดแล้ว |

**เปลี่ยน/เพิ่มรูป:** แก้ `url` ใน `source/story_images.json` แล้วรัน `uv run scripts/fetch_story_images.py` (ดาวน์โหลดเฉพาะรายการที่เปลี่ยน) จากนั้นชี้ `"img": "story/<key>"` ใน `script.json`
หมายเหตุ: repo เป็น public — รูปจาก blog/Facebook ใน `site/img/story/` เปิดดูได้โดยทุกคนที่มีลิงก์

## ดูบนเครื่อง
```bash
cd site && python3 -m http.server 8000   # เปิด http://localhost:8000
```

## ตั้งค่า GitHub Pages (ครั้งเดียว)
1. Settings → General → Danger Zone → เปลี่ยน repo เป็น **Public** (GitHub Free ใช้ Pages กับ private repo ไม่ได้)
2. Settings → Pages → Build and deployment → Source: **GitHub Actions**
3. Merge เข้า `main` แล้ว workflow จะ deploy ให้
