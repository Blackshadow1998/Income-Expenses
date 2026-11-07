# โปรแกรมรายรับรายจ่าย (Income / Expenses)

| ส่วน | เทคโนโลยี |
|---|---|
| หน้าบ้าน | React Native (Expo SDK 58 + Expo Router) — รันได้ทั้งเว็บ, Android, iOS |
| หลังบ้าน | Go 1.25 (net/http มาตรฐาน, ไม่ใช้ framework) |
| ฐานข้อมูล | **SQLite** (ไลบรารี `modernc.org/sqlite` — pure Go) |

## ทำไมเลือก SQLite

SQLite เบาที่สุด: ฝังอยู่ในโปรแกรม Go เลย **ไม่ต้องมี DB server, ไม่มี user/รหัสผ่าน**
ข้อมูลทั้งหมดอยู่ในไฟล์เดียว `income_expenses.db` ซึ่งเก็บใน Docker volume `income_expenses_income_expenses_data`
(ลบ container แล้วข้อมูลไม่หาย)

## วิธีรัน

### 1) ใช้งานจริง (Docker — เว็บ + API ในตัวเดียว)

```bash
docker compose up -d --build
```

image จะ build หน้าเว็บ (`expo export`) แล้ว Go เสิร์ฟทั้งหน้าเว็บและ API ที่พอร์ตเดียว — เปิดเครื่องแล้วใช้ได้เลย
(`restart: unless-stopped`)

- บนคอม: http://localhost:8080 · มือถือ/เครื่องอื่น: **https://<เครื่อง>.<tailnet>.ts.net** ผ่าน `tailscale serve --bg 8080`
  (พอร์ต 8080 เปิดเฉพาะ 127.0.0.1 — เข้าผ่าน IP ตรง ๆ จากเครื่องอื่นไม่ได้)
- API: http://localhost:8080/api/health
- มือถือ: เมนูเบราว์เซอร์ → "เพิ่มลงหน้าจอหลัก" (มี manifest + ไอคอน; แบบเต็มจอต้องเปิดผ่าน HTTPS
  เช่น `tailscale serve` หลังเปิด HTTPS Certificates ใน Tailscale admin)
- แก้หน้าเว็บแล้วต้อง `docker compose up -d --build` ใหม่ถึงจะเห็นในตัวจริง

### 2) หน้าบ้านโหมดพัฒนา (hot reload)

```bash
cd frontend
npm install
npx expo start --web
```

เปิด http://localhost:8081

- **Android emulator**: กด `a` ในหน้าต่าง Expo (ใช้ `10.0.2.2:8080` ให้อัตโนมัติ)
- **มือถือจริง (Expo Go)**: สร้างไฟล์ `frontend/.env` ใส่ IP เครื่อง PC แล้วรันใหม่
  ```
  EXPO_PUBLIC_API_URL=http://192.168.1.10:8080
  ```

> Expo SDK 58 ต้องการ Node.js >= 22.13 (เครื่องนี้ยังเป็น v20 — ยังรันได้แต่มีคำเตือน ควรอัปเดต)

## ฟีเจอร์

- **ผู้ใช้หลายคน + PIN** — สมัครเอง (ชื่อผู้ใช้ + รหัสผ่าน) ข้อมูลของแต่ละคนแยกกัน ไม่เห็นของกันและกัน
  - หลังสมัคร/เข้าสู่ระบบครั้งแรกต้องตั้ง **PIN 6 หลัก** (ห้ามแบบง่าย เช่น 000000, 123456)
  - เปิดแอปใหม่ หรือไม่ได้ใช้ **5 นาที** → ล็อกและถาม PIN (ระหว่างล็อกหน้าจอเดิมยังอยู่ เช่นฟอร์มที่กรอกค้างไว้)
  - ใส่ PIN ผิด 5 ครั้งติด → ออกจากระบบ ต้องเข้าด้วยรหัสผ่านใหม่; รหัสผ่านผิด 5 ครั้ง → พักชื่อผู้ใช้นั้น 5 นาที
  - **ลืม PIN** → กด "ลืม PIN?" ที่หน้าล็อก เข้าด้วยรหัสผ่าน แล้วตั้ง PIN ใหม่
  - แท็บ **ตั้งค่า**: ล็อกตอนนี้, เปลี่ยน PIN, เปลี่ยนรหัสผ่าน, ออกจากระบบ
  - **ลืมรหัสผ่าน** → ผู้ดูแลรันบนคอม `docker exec income-expenses-api /app/api reset-password <ชื่อผู้ใช้>`
    ได้รหัสชั่วคราว (ทุกอุปกรณ์ของผู้ใช้นั้นถูกออกจากระบบ) → เข้าสู่ระบบแล้วเปลี่ยนรหัสที่หน้า ตั้งค่า
  - ข้อมูลที่บันทึกไว้ก่อนมีระบบผู้ใช้ จะเป็นของ **ผู้ใช้คนแรกที่สมัคร**
  - **เข้าสู่ระบบด้วย Google** (ปิดอยู่จนกว่าจะตั้ง `GOOGLE_CLIENT_ID`): Google รับเฉพาะเว็บ HTTPS จึงต้อง
    1. Tailscale admin → DNS → เปิด **HTTPS Certificates** แล้วรัน `tailscale serve --bg 8080` → ได้ `https://<เครื่อง>.<tailnet>.ts.net`
    2. Google Cloud Console → APIs & Services → Credentials → **OAuth client ID** (Web application) →
       Authorized JavaScript origins = ลิงก์ https ข้างบน
    3. สร้างไฟล์ `.env` ที่โฟลเดอร์โปรเจกต์: `GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com` แล้ว `docker compose up -d`
    - ปุ่ม Google จะขึ้นที่หน้าเข้าสู่ระบบ (ผู้ใช้ใหม่ = สมัครอัตโนมัติ) และที่ ตั้งค่า (เชื่อมกับบัญชีเดิม)
- **หน้ารายเดือน** — เลือกเดือนด้วย ◀ ▶ หรือแตะชิปเดือน, ค่าเริ่มต้นคือเดือนล่าสุด
  แสดงเงินเข้า/ออก/สุทธิของเดือน, เงินคงเหลือทั้งหมด, ยอดแยกตามหมวด และปุ่ม **เพิ่ม / แก้ไข / ลบ**
- **หน้าสรุปรายปี** — กราฟแท่งรายเดือน (โหมด เข้า/ออก หรือ แยกหมวด), แตะเดือนเพื่อดูรายละเอียด, ตารางสรุป 12 เดือน
- **หน้าเพิ่ม/แก้ไข**
  - เงินคงเหลือ (แสดงอย่างเดียว อยู่นอกฟอร์ม; ตอนแก้ไขจะเป็นยอดที่ไม่รวมรายการนั้น)
  - วันเดือนปี, หมวดหมู่ (ดึงจาก DB), จำนวนเงิน, รายละเอียดเพิ่มเติม
  - **ผู้รับ (ไม่บังคับ)** — มีชื่อที่เคยใช้ให้กดเลือก, ตอนคอนเฟิร์มสลิปจะเติมจากชื่อบัญชีรับให้
  - เงินเหลือหลังบันทึก = เงินคงเหลือ ± จำนวนเงิน (คำนวณสด)

### หมวดหมู่ (ตาราง `categories`)

| code | ชื่อ | ผลต่อเงินคงเหลือ |
|---|---|---|
| income | รับ | + |
| expense | จ่าย | − |
| lend | ให้ยืม | − |
| borrow | กู้ | + |

### รายการย่อย (ตาราง `subcategories`) — select box "รายการ" ในหน้าเพิ่ม/แก้ไข

| หมวด | รายการ |
|---|---|
| จ่าย | ค่าอาหาร - น้ำ, ค่าบัตรเครดิต, โอนให้ครอบครัว, โอนทำบุญ, เลี้ยงอาหารเพื่อน, ค่า Shopee |
| รับ | เงินเดือน, เพื่อนจ่ายเงิน (หารอาหาร, หาร App), เงินคืน |

select box จะแสดงเฉพาะหมวดที่มีรายการย่อย และเลือก "ไม่ระบุ" ได้
ผู้ใช้แต่ละคนมีรายการของตัวเอง — เพิ่ม/แก้ชื่อ/ลบได้ที่ **ตั้งค่า → จัดการรายการ**
(ลบแล้วรายการรับ/จ่ายที่เคยใช้ยังอยู่ แต่จะเป็น "ไม่ระบุ"; ผู้ใช้ใหม่ได้รายการตั้งต้นชุดเล็ก ๆ)

### บัญชี (ตาราง `accounts`, `banks`, `account_types`)

- แท็บ **บัญชี**: ยอดรวมทุกบัญชี, ยอดแยกตามประเภท, รายการบัญชีพร้อมยอดคงเหลือ, ปุ่ม เพิ่ม / แก้ไข / ลบ
- ฟอร์มบัญชี: ธนาคาร (select box), ประเภท (ออมเงิน, เงินเดือน, บัตรเครดิต, ลงทุน, จ่ายเงิน), ชื่อบัญชี (ไม่บังคับ), จำนวนเงินเริ่มต้น
- ยอดคงเหลือของบัญชี = จำนวนเงินเริ่มต้น ± รายการรับ/จ่ายทั้งหมดของบัญชีนั้น
- หน้าเพิ่ม/แก้ไขรายการ **ต้องเลือกบัญชี**; หน้ารายเดือนและสรุปรายปีกรองตามบัญชีได้ ("ทุกบัญชี" = รวม)
- ลบบัญชีที่ยังมีรายการอยู่ไม่ได้ (กันข้อมูลหาย)
- รายการที่บันทึกก่อนมีระบบบัญชีจะแสดงเป็น "ไม่ระบุบัญชี" — กดแก้ไขเพื่อเลือกบัญชีให้
- เพิ่มธนาคารใหม่: `INSERT INTO banks (name, sort_order) VALUES ('ชื่อธนาคาร', 50);`

### อ่านสลิปธนาคาร (OCR ในเครื่อง — Tesseract ไทย+อังกฤษ, ไม่ส่งรูปออกนอกเครื่อง)

1. หน้ารายเดือน กด **📷 สลิป** → **ถ่ายรูปสลิป** (เปิดกล้องมือถือ) หรือ **เลือกจากคลังภาพ** (หลายรูปได้; PNG/JPG/WEBP ไม่เกิน 10MB ต่อรูป)
2. ระบบอ่าน **จำนวนเงิน, ชื่อบัญชีโอน, ชื่อบัญชีรับ** (+ วันที่, เลขที่รายการ, ธนาคาร) แล้วไปแสดงในเดือนตามวันที่บนสลิป
   เป็นการ์ด **สีเหลือง "รอคอนเฟิร์ม"** — ยังไม่นับรวมในยอดเงิน
3. กด **คอนเฟิร์ม** → เปิดฟอร์มที่กรอกจำนวนเงิน/วันที่ไว้ให้ และเลือกบัญชีธนาคารเดียวกับสลิปให้อัตโนมัติ
   ใส่หมวดหมู่ / รายการ / รายละเอียดที่เหลือ แล้วกดคอนเฟิร์ม → กลายเป็นรายการจริง (แสดง 🧾 ผู้โอน → ผู้รับ)
- อัปโหลดสลิปเดิมซ้ำไม่ได้ (เช็คจากไฟล์ และเลขที่รายการ)
- ลบรายการที่มาจากสลิป จะลบรูปสลิปไปด้วย
- รูปสลิปเก็บใน volume เดียวกับ DB: `/app/data/slips/`
- ทดสอบตัวอ่าน: `docker run --rm -v "$PWD/backend:/src" -w /src golang:1.25-alpine go test ./...`

## API

ทุก path ยกเว้น `/api/health`, `/api/auth/signup`, `/api/auth/login` ต้องส่ง `Authorization: Bearer <token>`
และ path ข้อมูล (ทั้งหมดนอก `/api/auth/*`) ต้องเป็น session ที่ปลดล็อกด้วย PIN แล้ว — ไม่งั้นได้
`401 {code: "unauthenticated" | "locked"}` หรือ `403 {code: "pin_required"}`

| Method | Path | คำอธิบาย |
|---|---|---|
| POST | `/api/auth/signup` | สมัคร `{name, username, password}` → `{token, user}` |
| POST | `/api/auth/login` | เข้าสู่ระบบ `{username, password}` → `{token, user}` |
| GET | `/api/auth/me` | ผู้ใช้ปัจจุบัน + `locked` |
| POST | `/api/auth/pin` | ตั้ง/เปลี่ยน PIN `{pin, current_pin}` |
| POST | `/api/auth/unlock` | ปลดล็อก `{pin}` |
| POST | `/api/auth/lock` / `/api/auth/logout` / `/api/auth/ping` | ล็อก / ออกจากระบบ / ต่อเวลาไม่ล็อก |
| GET | `/api/categories` | หมวดหมู่ทั้งหมด |
| GET | `/api/months` | เดือนที่มีข้อมูล (ใหม่สุดก่อน) |
| GET | `/api/years` | ปีที่มีข้อมูล |
| GET | `/api/balance?exclude_id=` | เงินคงเหลือทั้งหมด |
| GET | `/api/transactions?month=YYYY-MM` | รายการ + ยอดรวมของเดือน |
| GET | `/api/transactions/search?q=&from=&to=&category_id=&account_id=&min=&max=` | ค้นหา/กรองรายการ (สูงสุด 300) |
| GET | `/api/transactions/{id}` | รายการเดียว |
| POST | `/api/transactions` | เพิ่ม `{date, category_id, amount, note}` |
| PUT | `/api/transactions/{id}` | แก้ไข |
| DELETE | `/api/transactions/{id}` | ลบ |
| GET | `/api/summary/yearly?year=YYYY` | สรุป 12 เดือน |
| GET | `/api/accounts` | บัญชีทั้งหมด + ยอดรวม + ยอดแยกประเภท |
| GET | `/api/accounts/options` | รายชื่อธนาคาร และประเภทบัญชี |
| GET/PUT/DELETE | `/api/accounts/{id}` | ดู / แก้ไข / ลบ บัญชี |
| POST | `/api/accounts` | เพิ่มบัญชี `{bank_id, type_id, name, opening_balance}` |
| GET | `/api/insights?month=YYYY-MM` | สรุปเชิงลึก: เทียบเดือนก่อน, ใช้มากสุด 3 อันดับ, เฉลี่ยต่อวัน, ก้อนใหญ่สุด |
| GET | `/api/export.csv?from=&to=` | ส่งออกรายการ + การโอน เป็น CSV (UTF-8 BOM เปิดใน Excel ได้) — ปุ่มที่ ตั้งค่า |
| GET | `/api/debts` | หนี้ค้างต่อคน (ให้ยืม−รับคืน, กู้−คืนเงินกู้) แยกตามช่องผู้รับ |
| GET/POST | `/api/recurring` | รายการประจำ (สร้างรายการอัตโนมัติทุกเดือนตามวันที่, เริ่มจากวันนี้ ไม่ย้อนหลัง) |
| PUT/DELETE | `/api/recurring/{id}` | แก้/หยุด (`active:false`)/ลบ — รายการที่สร้างแล้วยังอยู่ |
| GET | `/api/budgets?month=YYYY-MM` | งบประมาณรายเดือน + ยอดที่ใช้ไปในเดือนนั้น |
| POST | `/api/budgets` | ตั้ง/แก้งบ `{category_id, subcategory_id?, amount}` (หมวด/รายการเดิม = แทนที่) |
| DELETE | `/api/budgets/{id}` | ลบงบ |
| POST/PUT/DELETE | `/api/subcategories[/{id}]` | เพิ่ม/แก้ชื่อ/ลบ รายการ (หมวดย่อย) ของตัวเอง |
| POST | `/api/transfers` | โอนระหว่างบัญชีตัวเอง `{date, from_account_id, to_account_id, amount, note}` (ไม่นับเป็นรับ/จ่าย) |
| GET/PUT/DELETE | `/api/transfers/{id}` | ดู / แก้ไข / ลบ รายการโอน |
| POST | `/api/slips` | อัปโหลดสลิป (multipart field `files`, หลายไฟล์ได้) → อ่านแล้วบันทึกเป็นรอคอนเฟิร์ม |
| GET | `/api/slips/{id}` | ข้อมูลสลิป (มี `image_url` = ลิงก์รูปแบบลงลายเซ็น อายุ 1–2 ชม.) |
| GET | `/api/slips/{id}/image?exp=&sig=` | รูปสลิป (ใช้ลิงก์จาก `image_url` ไม่ต้องส่ง token) |
| DELETE | `/api/slips/{id}` | ลบสลิปที่ยังรอคอนเฟิร์ม |

`/api/transactions`, `/api/summary/yearly`, `/api/balance` รับ `account_id=` เพื่อกรองเฉพาะบัญชีได้
คอนเฟิร์มสลิป = `POST /api/transactions` พร้อม `slip_id`

## สำรองข้อมูล

**อัตโนมัติ:** API สำรอง DB วันละครั้ง (`VACUUM INTO` — ไม่ต้องหยุดระบบ) ไปที่ `backups/auto/income_expenses-YYYY-MM-DD.db`
บนดิสก์ของคอม (นอก Docker volume) เก็บ 30 ไฟล์ล่าสุด ตั้งค่าด้วย `BACKUP_DIR` ใน `docker-compose.yml`

กู้คืน: `docker compose stop` → `docker cp backups/auto/<ไฟล์>.db income-expenses-api:/app/data/income_expenses.db` → `docker compose start`

**สำรองเอง:**

หยุด container ก่อน (ให้ SQLite เขียนข้อมูลจากไฟล์ WAL ลงไฟล์หลักให้ครบ) แล้วค่อย copy:

```bash
docker compose stop
docker cp income-expenses-api:/app/data/income_expenses.db ./backup.db
docker compose start
```
