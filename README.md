# Stock & Expiration Date Tracker

Desktop application สำหรับ Windows และ macOS ใช้จัดการสต็อก ติดตามวันหมดอายุ ส่งออก/นำเข้า Excel หรือ CSV และแจ้งเตือนอัตโนมัติผ่าน Telegram Bot กับ LINE Messaging API

## Stack ที่เลือกและเหตุผล

โปรเจกต์นี้ใช้ **Electron + React + TypeScript + SQLite (`node:sqlite`)** เพราะเหมาะกับโจทย์นี้มากกว่า Python GUI ในด้านต่อไปนี้

| หัวข้อ | Electron + React (เลือกใช้) | Python + PyQt |
|---|---|---|
| UI ตาราง/ตัวกรอง/Dashboard | ecosystem เว็บยืดหยุ่นและออกแบบได้เร็ว | widget แข็งแรง แต่ปรับหน้าตาละเอียดกว่า |
| SQLite | `node:sqlite` อยู่ใน runtime ไม่ต้อง rebuild native addon | `sqlite3` ติดมากับ Python |
| REST API / Bot | ใช้ `fetch` ใน Node ได้โดยตรง | ใช้ `requests` ได้ง่าย |
| Scheduler | `node-cron` และทำงานใน main process | `APScheduler`/`schedule` |
| Packaging | `electron-builder` ทำ NSIS/DMG | PyInstaller + Qt plugin มีรายละเอียดเฉพาะ OS |
| ขนาดไฟล์ | ใหญ่กว่า (รวม Chromium) | มักเล็กกว่าเล็กน้อย |
| ทีมเว็บ/การต่อยอด | React/TypeScript และ component ecosystem ได้เปรียบ | เหมาะกับทีม Python/งาน scientific |

ถ้าเครื่องปลายทางมีทรัพยากรจำกัดมากหรือทีมถนัด Python อย่างเดียว PyQt6 เป็นทางเลือกที่ดี แต่สำหรับ UI เชิงธุรกิจ การแพ็กสองระบบ และ API integration ชุดนี้ Electron ให้ต้นทุนดูแลระยะยาวต่ำกว่า

## Architecture

```text
React Renderer (ไม่มีสิทธิ์ Node/filesystem)
        │ typed IPC ผ่าน contextBridge
        ▼
Electron Main Process
  ├─ CRUD / validation / import-export
  ├─ node-cron scheduler (ค่าเริ่มต้น 08:00 Asia/Bangkok)
  ├─ Telegram + LINE HTTPS clients
  └─ node:sqlite / DatabaseSync (WAL)
        │
        └─ stock-tracker.sqlite ใน Electron userData
```

เปิด `contextIsolation` และปิด `nodeIntegration` ใน renderer; UI เรียกได้เฉพาะ API ที่ประกาศใน preload เท่านั้น Bot token ไม่เคยถูกส่งกลับไปฝั่ง React และถูกเข้ารหัสด้วย Electron `safeStorage` (Windows DPAPI / macOS Keychain) ก่อนเก็บใน SQLite

## ฟีเจอร์ที่มีแล้ว

- Dashboard นับรายการ จำนวนหน่วย หมดอายุ ใกล้หมดอายุ และปกติ
- ตารางค้นหาจากชื่อ/หมวดหมู่/บาร์โค้ด พร้อมกรองหมวดหมู่และสถานะ
- CRUD สินค้า: ชื่อ หมวดหมู่หลัก/รอง จำนวนทั้งหมด จำนวนคงเหลือ วันที่ผลิต วันหมดอายุ บาร์โค้ด หมายเหตุ
- ปุ่ม `− / +` ปรับจำนวนคงเหลือจากตารางได้ทันที โดยไม่เกินจำนวนทั้งหมด
- สีแดง = วันหมดอายุก่อนวันนี้, สีส้ม = วันนี้ถึงจำนวนวันเตือน, สีเขียว = เกินช่วงเตือน
- Import `.xlsx`, `.csv` และ Export `.xlsx`, CSV UTF-8 BOM
- ตั้งเวลาตรวจทุกวัน, timezone และ warning threshold จาก UI
- Telegram Bot API และ LINE Messaging API Push Message
- ปุ่ม “ทดสอบใกล้หมดอายุ” ส่งข้อความตัวอย่างได้โดยไม่แก้ข้อมูลสต็อก
- ป้องกัน scheduler ส่งซ้ำในวันเดียวกันแยกตามช่องทาง; ปุ่ม “แจ้งเตือนตอนนี้” ยังใช้ทดสอบซ้ำได้

> วันหมดอายุ “วันนี้” ถูกจัดเป็นใกล้หมดอายุ (เหลือ 0 วัน) และจะเป็นหมดอายุในวันถัดไป

## โครงสร้างโปรเจกต์

```text
.
├─ src/
│  ├─ main/
│  │  ├─ index.ts             Electron lifecycle + secure BrowserWindow
│  │  ├─ database.ts          schema, CRUD, dashboard, settings, alert log
│  │  ├─ expiration.ts        calendar-day calculation
│  │  ├─ files.ts             Excel/CSV import-export
│  │  ├─ notifications.ts     Telegram/LINE clients + message formatter
│  │  ├─ scheduler.ts         node-cron daily worker
│  │  ├─ secrets.ts           safeStorage encryption
│  │  ├─ validation.ts        input validation
│  │  └─ ipc.ts               IPC allowlist
│  ├─ preload/index.ts        typed contextBridge
│  ├─ renderer/               React UI และ CSS
│  └─ shared/types.ts         contract ระหว่าง process
├─ docs/schema.sql
├─ samples/inventory-template.csv
├─ scripts/line-id-helper.mjs
├─ electron.vite.config.ts
└─ package.json
```

## ติดตั้งและรัน

ต้องมี Node.js 22 LTS หรือใหม่กว่าสำหรับขั้นตอนพัฒนา ตัวแอปที่แพ็กแล้วรวม Electron runtime และ SQLite มาให้ ไม่ต้องติดตั้ง Python, SQLite หรือ C++ Build Tools เพิ่ม

```bash
npm install
npm run dev
```

ฐานข้อมูลสร้างอัตโนมัติที่:

- Windows: `%APPDATA%/stock-expiration-tracker/stock-tracker.sqlite` (ตำแหน่งจริงขึ้นกับ Electron app name)
- macOS: `~/Library/Application Support/stock-expiration-tracker/stock-tracker.sqlite`

ตรวจ type และสร้าง production bundle:

```bash
npm run typecheck
npm run build
npm run dist:win   # สร้าง NSIS installer ใน release/
npm run dist:portable # สร้างไฟล์ Portable เปิดได้ทันทีโดยไม่ติดตั้ง
npm run dist:mac   # ต้องรันบน macOS เพื่อสร้าง DMG/ZIP
```

การ sign/notarize สำหรับแจกจ่ายจริงต้องเพิ่ม Windows code-signing certificate หรือ Apple Developer ID ตามข้อกำหนดของแต่ละระบบ

## รูปแบบ Import

ใช้ไฟล์ตัวอย่าง `samples/inventory-template.csv` ได้ทันที Header รองรับทั้งไทยและอังกฤษ:

| ฟิลด์ | Header ที่รองรับ (ตัวอย่าง) | บังคับ |
|---|---|---|
| ชื่อ | `ชื่อสินค้า`, `name`, `productName` | ใช่ |
| หมวดหมู่หลัก | `หมวดหมู่`, `category` | ใช่ |
| หมวดหมู่รอง | `หมวดหมู่รอง`, `subcategory`, `ประเภทย่อย` | ไม่ |
| จำนวนทั้งหมด | `จำนวนทั้งหมด`, `totalQuantity`, `totalQty` | ใช่ (ถ้าไม่มีจะใช้จำนวนคงเหลือ) |
| จำนวนคงเหลือ | `จำนวนคงเหลือ`, `คงเหลือ`, `quantity`, `remaining` | ใช่ (ถ้าไม่มีจะใช้จำนวนทั้งหมด) |
| วันที่ผลิต | `วันที่ผลิต`, `manufactureDate`, `mfgDate` | ไม่ |
| วันหมดอายุ | `วันหมดอายุ`, `expirationDate`, `expiryDate` | ใช่ |
| รหัสสินค้า/บาร์โค้ด | `รหัสสินค้า`, `บาร์โค้ด`, `productCode`, `SKU`, `barcode` | ไม่ |
| หมายเหตุ | `หมายเหตุ`, `notes` | ไม่ |

วันที่ใช้ `YYYY-MM-DD` หรือ `DD/MM/YYYY` และ Excel date cell ได้ แถวผิดจะถูกข้ามพร้อมแสดงสาเหตุ โดยแถวอื่นยัง import ต่อภายใน transaction เดียว

## ตั้งค่า Telegram Bot

1. เปิด Telegram ค้นหา **@BotFather** แล้วส่ง `/newbot`
2. ตั้งชื่อและ username จากนั้นเก็บ Bot Token ที่ได้รับ
3. เปิดแชตกับ bot แล้วกด Start/ส่งข้อความหนึ่งครั้ง (ถ้าเป็นกลุ่ม ให้เพิ่ม bot เข้ากลุ่มและส่งข้อความในกลุ่ม)
4. เปิด URL ต่อไปนี้ใน browser โดยแทน token จริง:

   ```text
   https://api.telegram.org/bot<TOKEN>/getUpdates
   ```

5. อ่าน `result[].message.chat.id`; กลุ่มมักเป็นเลขติดลบ
6. ในแอปไป “ตั้งค่าระบบ” เปิด Telegram ใส่ Chat ID และ Bot Token กดบันทึก แล้วกด “ส่งข้อความทดสอบ”

ถ้า `getUpdates` ว่าง ให้ส่งข้อความใหม่ หา bot username ให้ถูก และตรวจว่า bot ไม่ได้ตั้ง webhook ค้างไว้ Token คือความลับ—ห้าม commit, ถ่ายภาพเผยแพร่ หรือส่งให้บุคคลอื่น

## ตั้งค่า LINE Messaging API

LINE Notify ยุติบริการแล้วตั้งแต่ 31 มีนาคม 2025 โปรเจกต์นี้จึงใช้ LINE Official Account + Messaging API เท่านั้น

1. สร้าง LINE Official Account ใน LINE Official Account Manager
2. เปิดใช้ Messaging API; channel จะปรากฏใน LINE Developers Console
3. ที่ Messaging API tab ออก Channel Access Token (สำหรับเริ่มต้นใช้ long-lived token ได้; production ควรวางแผนหมุน token)
4. ให้ผู้รับเพิ่ม Official Account เป็นเพื่อนก่อน จึงจะรับ push message ได้
5. หา target ID:
   - บัญชีนักพัฒนาของคุณ: ดู “Your user ID” ใน Basic settings ของ LINE Developers Console
   - ผู้ใช้อื่น/กลุ่ม: เปิด webhook แล้วอ่านข้อความ `event.source.userId` หรือ `event.source.groupId`

มี helper ตรวจลายเซ็น webhook ให้แล้ว:

```powershell
$env:LINE_CHANNEL_SECRET="ใส่ Channel secret"
npm run line:id-helper
```

จากนั้น expose `http://127.0.0.1:8787/line-webhook` ด้วย HTTPS tunnel ที่เชื่อถือได้ ตั้ง URL สาธารณะนั้นใน LINE Developers Console และกด Verify เมื่อผู้ใช้ส่งข้อความ/เพิ่มเพื่อน helper จะแสดง ID เท่านั้น ไม่แสดงเนื้อหาข้อความ หลังได้ ID ให้ปิด tunnel และล้างตัวแปร secret

6. ในแอปเปิด LINE ใส่ `U...` (user) หรือ `C...` (group) และ Channel Access Token แล้วกดทดสอบ

Messaging API มี quota/ค่าบริการตามแพ็กเกจ Official Account และผู้ใช้ที่บล็อก OA จะรับ push ไม่ได้

## Scheduler และพฤติกรรมสำคัญ

- ค่าเริ่มต้นคือ `08:00`, `Asia/Bangkok`, เตือนล่วงหน้า 30 วัน
- cron expression ถูกสร้างจากค่าบน UI เป็น `minute hour * * *`
- ทำงานใน Electron main process จึงไม่ถูก throttle ตามหน้าจอ renderer
- แอปต้องเปิดอยู่ ณ เวลาที่กำหนด หากปิดอยู่จะไม่ catch up ย้อนหลัง
- สำหรับงานที่ต้องรับประกันแม้ผู้ใช้ logout/ปิดเครื่อง ควรแยก worker ไป Windows Task Scheduler, launchd หรือ server/cloud job และใช้ SQLite file locking/central database ให้เหมาะสม
- Scheduled run บันทึก `alert_runs` หลัง API สำเร็จเท่านั้น หาก API ล้มเหลว วันนั้นยังลองใหม่ได้เมื่อ restart scheduler หรือกดส่งด้วยตนเอง

## Database

schema เต็มอยู่ที่ `docs/schema.sql` โค้ดจริง migrate แบบ idempotent ใน `src/main/database.ts` วันที่เก็บเป็น ISO `YYYY-MM-DD` ทำให้ sort ได้ตรงและไม่เกิดปัญหา UTC เลื่อนวัน เปิด WAL เพื่อให้การอ่าน/เขียนทนต่อการใช้งานพร้อมกันใน process เดียว

การสำรองข้อมูล: ปิดแอปก่อน แล้วคัดลอกไฟล์ `stock-tracker.sqlite` ไปยังที่ปลอดภัย การกู้คืนให้ปิดแอปและนำไฟล์กลับตำแหน่งเดิม

## Security checklist ก่อนใช้จริง

- จำกัดสิทธิ์เครื่องและบัญชี OS เพราะฐานข้อมูลเป็น local data
- Token เข้ารหัสผูกกับบัญชี OS แต่ผู้ใช้ที่ควบคุมบัญชีเดียวกันอาจเรียกแอปเพื่อส่งข้อความได้
- เพิกถอน/ออก token ใหม่ทันทีหากสงสัยว่ารั่ว
- LINE webhook production ต้องตรวจ `x-line-signature` จาก raw body เสมอ (helper ทำแล้ว)
- ตั้ง code signing, auto-update ที่ลงลายเซ็น และกระบวนการ backup ก่อน deploy ในองค์กร
