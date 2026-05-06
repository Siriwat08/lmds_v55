# LMDS Production Hardening Phase 2

เวอร์ชันแพ็กเกจนี้เป็นงานต่อจาก baseline V5.1 โดยโฟกัสที่ **performance optimization**, **cache/index improvements**, **deduplication**, **safety guards**, **migration helpers** และ **test checklist** สำหรับนำขึ้น production ได้ปลอดภัยขึ้น

## ขอบเขตงานที่ทำ

### 1) Performance / Indexing
- เพิ่ม helper กลางใน `14_Utils.gs` สำหรับ cache JSON, dedupe, chunking และ safe parsing
- เพิ่ม **Person index cache** ใน `06_PersonService.gs`
  - byPhone
  - byNorm
  - byPhonetic
  - aliasToPersonIds
- เพิ่ม **Place index cache** ใน `07_PlaceService.gs`
  - byNorm
  - byPhonetic
  - aliasToPlaceIds
- เพิ่ม **Destination index cache** ใน `09_DestinationService.gs`
  - byPerson
  - byPlace
  - byPersonPlace
  - byGeo
- เพิ่ม cache ให้ `getProcessedInvoiceSet_()` ใน `04_SourceRepository.gs`
- ปรับ `17_SearchService.gs` ให้มี memoization ต่อชุดข้อมูลค้นหาซ้ำในรอบเดียวกัน และเขียนผลแบบ batch chunk

### 2) Deduplication
- ป้องกัน cache key ซ้ำใน `15_GoogleMapsAPI.gs` โดยเปลี่ยน `saveToSheetCache_()` เป็นแนว upsert แทน append อย่างเดียว
- เพิ่มการ dedupe แถวจาก SCG fetch ใน `18_ServiceSCG.gs` ด้วย composite key:
  - ShipmentNo
  - InvoiceNo
  - DeliveryNo
  - ShipToName
  - Material
- เพิ่ม helper dedupe สำหรับใช้งานซ้ำทั้งระบบ

### 3) Safety Guards
- เพิ่ม Script Lock ใน `fetchDataFromSCGJWD()` เพื่อกันการกดซ้ำ/รันชนกัน
- ตรวจ header ของ DAILY_JOB ก่อนเขียนข้อมูล
- เพิ่ม guard เรื่อง Cookie ว่าง/สั้นผิดปกติ
- เพิ่ม guard เรื่องเพดานจำนวน Shipment ต่อรอบผ่าน config
- ปรับ `reverseGeocode()` ให้ใช้เฉพาะ RAM cache ไม่บันทึก payload ที่ไม่ตรง schema ลง `MAPS_CACHE`

### 4) Lookup Enrichment Hardening
- `runLookupEnrichment()` เติม Email จากชีตพนักงานอัตโนมัติถ้ายังว่าง
- เขียนผล `LatLong_Actual`, `Email`, และสีพื้นหลังแบบ batch
- รองรับ config เพดานจำนวนแถวต่อรอบ (`MAX_LOOKUP_ROWS`)
- รองรับ config ขนาด batch สำหรับการเขียน (`SEARCH_WRITE_BATCH`)

### 5) Migration / Operations
- เพิ่มไฟล์ใหม่ `19_Hardening.gs`
- เพิ่มเมนูใหม่ในระบบ:
  - PH2 Preflight Audit
  - PH2 Migration Helper
- เพิ่ม helper:
  - `runPhase2PreflightAudit()`
  - `migrateProductionHardeningPhase2()`
  - `seedMissingPhase2Config_()`
  - `dedupeMapsCacheSheet_()`
- เพิ่ม config ใหม่ใน `SYS_CONFIG`
  - SEARCH_WRITE_BATCH
  - MAX_SHIPMENT_FETCH
  - MAX_LOOKUP_ROWS

## ไฟล์ที่ถูกแก้ไข
- `00_App.gs`
- `01_Config.gs`
- `03_SetupSheets.gs`
- `04_SourceRepository.gs`
- `06_PersonService.gs`
- `07_PlaceService.gs`
- `09_DestinationService.gs`
- `14_Utils.gs`
- `15_GoogleMapsAPI.gs`
- `17_SearchService.gs`
- `18_ServiceSCG.gs`
- `19_Hardening.gs` (ใหม่)

## หมายเหตุด้านความเข้ากันได้
- ยังคงโครงสร้างหลักของระบบเดิมไว้
- ไม่เปลี่ยน schema หลักของ master/fact sheets
- การเพิ่ม config เป็นแบบ append-only และ migration-safe
- ใช้แนวทาง patch / helper overlay เพื่อให้ rollback ง่าย

## สถานะการตรวจสอบ
- ตรวจ syntax แบบรวมทุกไฟล์ผ่านแล้ว
- พร้อมส่งต่อเป็น package สำหรับดาวน์โหลดและ deploy
