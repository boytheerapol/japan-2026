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
source/day_meta.json      ชื่อวันภาษาไทย + intro (จากไฟล์ Word) แก้ด้วยมือได้
source/itinerary.xlsx     ไฟล์ Excel ของคุณ — อยู่ใน .gitignore ไม่ถูก push
scripts/build_data.py     แปลง Excel → site/data/trip.json (ตัดข้อมูลส่วนตัวออก)
site/                     ตัวเว็บที่ deploy
.github/workflows/pages.yml  push เข้า main แล้ว deploy อัตโนมัติ
```

## อัปเดตข้อมูลเมื่อแก้ Excel
```bash
pip install openpyxl
cp "Japan Trip 2026 - Itinerary Plan v8.xlsx" source/itinerary.xlsx
python3 scripts/build_data.py          # เขียน site/data/trip.json
git add site/data/trip.json && git commit -m "Update itinerary data" && git push
```
Script ตรวจชื่อชีตและหัวคอลัมน์ก่อน ถ้าโครงสร้าง Excel เปลี่ยนจะหยุดพร้อมบอกว่าช่องไหนไม่ตรง
ชีตที่ไม่ถูกอ่านเลย: Bookings, Budget, 📱 วันนี้, README (ข้อมูลส่วนตัวจึงไม่หลุดขึ้นเว็บ)

## ดูบนเครื่อง
```bash
cd site && python3 -m http.server 8000   # เปิด http://localhost:8000
```

## ตั้งค่า GitHub Pages (ครั้งเดียว)
1. Settings → General → Danger Zone → เปลี่ยน repo เป็น **Public** (GitHub Free ใช้ Pages กับ private repo ไม่ได้)
2. Settings → Pages → Build and deployment → Source: **GitHub Actions**
3. Merge เข้า `main` แล้ว workflow จะ deploy ให้
