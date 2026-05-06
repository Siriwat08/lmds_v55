# Test Checklist — LMDS Production Hardening Phase 2

## A. Setup / Migration
- [ ] เปิดเมนูระบบแล้วพบ `PH2 Preflight Audit`
- [ ] เปิดเมนูระบบแล้วพบ `PH2 Migration Helper`
- [ ] รัน `สร้างชีตทั้งหมด` ผ่านโดยไม่ error
- [ ] รัน `PH2 Migration Helper` ผ่านโดยไม่ error
- [ ] รัน `PH2 Preflight Audit` แล้วไม่มี error critical

## B. Config / Cache
- [ ] `SYS_CONFIG` มีค่า SEARCH_WRITE_BATCH
- [ ] `SYS_CONFIG` มีค่า MAX_SHIPMENT_FETCH
- [ ] `SYS_CONFIG` มีค่า MAX_LOOKUP_ROWS
- [ ] `MAPS_CACHE` ไม่มี cache_key ซ้ำหลัง migration
- [ ] `reverseGeocode()` ยังทำงานได้ และไม่สร้าง row payload ผิด schema

## C. SCG Fetch Safety
- [ ] ไม่ใส่ Cookie แล้วระบบเตือนถูกต้อง
- [ ] ใส่ Cookie สั้นผิดปกติแล้วระบบเตือนถูกต้อง
- [ ] จำนวน shipment = 0 แล้วระบบเตือนถูกต้อง
- [ ] จำนวน shipment เกินเพดานแล้วระบบเตือนถูกต้อง
- [ ] กด fetch ซ้ำพร้อมกันแล้ว lock ช่วยกันรันชน
- [ ] แถวที่ได้จาก fetch ไม่มี duplicate composite key

## D. Lookup Enrichment
- [ ] แถวที่มี `LatLong_Actual` อยู่แล้วไม่ถูกทับผิดพลาด
- [ ] แถว FOUND / FOUND_DOMINANT ได้สีเขียว
- [ ] แถว FOUND_FALLBACK ได้สีเหลือง
- [ ] แถว SCG_API_FALLBACK ได้สีฟ้า
- [ ] แถว NOT_FOUND ได้สีแดง
- [ ] Email ถูกเติมจากชีตพนักงานเมื่อ `DriverName` ตรง
- [ ] การ enrich จำนวนมากยังเขียนผลแบบ batch ได้ครบ

## E. Master Matching Performance
- [ ] person lookup ใช้ phone / alias / normalized / phonetic ได้ตามคาด
- [ ] place lookup ใช้ alias / normalized / phonetic ได้ตามคาด
- [ ] destination lookup person+place เร็วขึ้นจาก index cache
- [ ] processed invoice set ถูก cache และไม่อ่าน FACT_DELIVERY ซ้ำโดยไม่จำเป็น

## F. Regression Check
- [ ] Full Pipeline เดิมยังรันได้
- [ ] Review Queue ยังเปิดได้
- [ ] Q_REVIEW dropdown ยังถูกต้อง
- [ ] buildOwnerSummary ยังสรุปได้ถูกต้อง
- [ ] buildShipmentSummary ยังสรุปได้ถูกต้อง
- [ ] clearAllSCGSheets_UI ยังล้างเฉพาะกลุ่ม 2

## G. Recommended UAT Dataset
- [ ] shipment ที่พบ exact destination
- [ ] shipment ที่เจอหลาย destination แล้วเลือก dominant
- [ ] shipment ที่ fallback ด้วย person-only
- [ ] shipment ที่ fallback ด้วย SCG lat/lng
- [ ] shipment ที่ไม่พบข้อมูลเลย
- [ ] driver ที่มี email ใน master
- [ ] driver ที่ไม่มี email ใน master
