# เตี๋ยวอิ่มใจ — ระบบสั่งก๋วยเตี๋ยวออนไลน์

หน้าลูกค้า (`/`) สั่งอาหารและติดตามสถานะ · หน้าร้าน (`/admin`) รับออเดอร์ เปลี่ยนสถานะ และเปิด/ปิดเมนู

ระบบมี 2 โหมด เลือกอัตโนมัติตอน build:

| โหมด | เมื่อไร | ข้อมูลอยู่ที่ |
|---|---|---|
| **Supabase** (ใช้งานจริง) | ตั้งค่า `VITE_SUPABASE_URL` และ `VITE_SUPABASE_ANON_KEY` | ฐานข้อมูลออนไลน์ ลูกค้าสั่งจากมือถือ ร้านเห็นทันที |
| **เดโม** | ไม่ได้ตั้งค่า Supabase | localStorage ของเบราว์เซอร์นั้นเครื่องเดียว |

## ตั้งค่า Supabase (ครั้งเดียว)

1. สมัคร/เข้าสู่ระบบที่ https://supabase.com แล้วกด **New project** (เลือก Region ใกล้ไทย เช่น Singapore)
2. ไปที่ **SQL Editor → New query** วางเนื้อหาทั้งหมดจาก [`supabase/schema.sql`](supabase/schema.sql) แล้วกด **Run**
3. สร้างบัญชีพนักงาน: **Authentication → Users → Add user → Create new user** ใส่อีเมล + รหัสผ่าน และติ๊ก **Auto Confirm User**
4. ให้สิทธิ์พนักงาน: กลับไป SQL Editor แล้วรัน (เปลี่ยนอีเมล)
   ```sql
   insert into public.staff (user_id) select id from auth.users where email = 'อีเมลพนักงาน' on conflict do nothing;
   ```
5. ปิดการสมัครสมาชิกเอง: **Authentication → Sign In / Providers → Email** ปิด **Allow new users to sign up** (มีแค่ร้านที่สร้างบัญชีพนักงานได้)
6. คัดลอกค่า: **Project Settings → API** → `Project URL` และ `anon public` key
   (anon key เป็นคีย์สาธารณะ ใส่ในเว็บได้ ความปลอดภัยมาจากสิทธิ์ใน `schema.sql` — **ห้ามใช้ `service_role` key**)

## Deploy บน GitHub Pages

1. **Settings → Pages → Source** = **GitHub Actions**
2. **Settings → Secrets and variables → Actions → Variables → New repository variable** สร้าง 2 ตัว
   - `VITE_SUPABASE_URL` = Project URL
   - `VITE_SUPABASE_ANON_KEY` = anon public key
3. push ขึ้น `main` (หรือ **Actions → Deploy to GitHub Pages → Run workflow**) — workflow จะรัน lint + test ก่อน deploy

## พัฒนาในเครื่อง

```bash
npm install
npm run dev      # ไม่มี .env.local = โหมดเดโม
npm test         # unit test + ทดสอบ SQL ด้วย PGlite
```

ใช้ Supabase ในเครื่อง: สร้างไฟล์ `.env.local` (ไม่ถูก commit)

```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

## แก้เมนู

แก้ในตาราง `menu` ผ่าน Supabase **Table Editor** — `image` ใส่ชื่อไฟล์ใน `public/images` หรือ URL รูปเต็ม `https://...` ราคาจะคิดจากตารางนี้เสมอ (ไซซ์พิเศษ +10 บาท)
