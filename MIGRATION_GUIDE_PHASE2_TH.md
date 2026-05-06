# คู่มือ Migration — LMDS Production Hardening Phase 2

## ลำดับแนะนำก่อนใช้งานบน Spreadsheet จริง
1. สำรองโปรเจกต์ Apps Script และ Spreadsheet ปัจจุบัน
2. นำไฟล์ source ในแพ็กเกจนี้ไปแทนของเดิม
3. เปิด Spreadsheet แล้วรันเมนู **สร้างชีตทั้งหมด** 1 รอบ
4. รันเมนู **PH2 Migration Helper** 1 รอบ
5. รันเมนู **PH2 Preflight Audit** เพื่อตรวจความพร้อม
6. ทดสอบ flow สำคัญตาม checklist ก่อนใช้งานจริง

## สิ่งที่ Migration Helper ทำ
- patch ชีตที่ขาด header ตาม schema ปัจจุบัน
- เติม config ใหม่ใน `SYS_CONFIG` ถ้ายังไม่มี
- dedupe ข้อมูลใน `MAPS_CACHE` โดยเก็บแถวที่ดีที่สุดจาก hit_count / created_at
- refresh runtime config cache

## Config ใหม่ที่ต้องมีหลัง migration
- `SEARCH_WRITE_BATCH` = 200
- `MAX_SHIPMENT_FETCH` = 200
- `MAX_LOOKUP_ROWS` = 5000
- `SCHEMA_VERSION` = 5.2.000
- `SYSTEM_VERSION` = 5.2.000-PH2

## จุดตรวจหลัง migration
- เมนูระบบต้องเห็นรายการ PH2 ใหม่ 2 รายการ
- ชีต `SYS_CONFIG` ต้องมี config ใหม่ครบ
- `MAPS_CACHE` ไม่ควรมี `cache_key` ซ้ำ
- `DAILY_JOB` ต้องมี header ครบ 29 คอลัมน์
- `Q_REVIEW` dropdown ต้องยังทำงานได้ตามเดิม

## Rollback Plan
ถ้าต้อง rollback:
1. คืนไฟล์ `.gs` ชุด baseline ก่อน PH2
2. ไม่ต้องลบคอลัมน์เพิ่ม เพราะงานนี้ไม่ได้เปลี่ยน schema หลักของชีตข้อมูลปฏิบัติการ
3. ถ้าต้องการล้างผล cache ให้ล้าง `MAPS_CACHE` และรอ RAM cache หมดอายุ
4. ถ้า config ใหม่ค้างอยู่ใน `SYS_CONFIG` สามารถปล่อยไว้ได้ ไม่กระทบ baseline เดิม

## คำแนะนำ production
- จำกัด shipment ต่อรอบไม่ให้เกิน `MAX_SHIPMENT_FETCH`
- หาก DAILY_JOB ใหญ่มาก ให้ enrich เป็นรอบ ๆ โดยคุม `MAX_LOOKUP_ROWS`
- รัน PH2 Preflight Audit ก่อน deploy ทุกครั้งหลังมีการแก้ source
