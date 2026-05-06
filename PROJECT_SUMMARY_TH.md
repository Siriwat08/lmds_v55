# LMDS V5.1 — สรุปวิเคราะห์โปรเจกต์ + แพ็กโค้ดเต็ม

## 1) โปรเจกต์นี้คืออะไร
LMDS เป็นระบบ Master Data + Matching Engine สำหรับงานขนส่ง/ปลายทางบน Google Sheets + Google Apps Script โดยมี 2 ภาคหลัก:
- Group 1 = ฐานข้อมูลกลางและสมองตัดสินใจ (Master / Fact / Review / Report)
- Group 2 = งานประจำวันฝั่ง SCG (Daily Job / Input / Summary / Lookup)

ข้อมูลจะไหลจากต้นทาง → Normalize → Match Person/Place/Geo → สร้าง Destination → บันทึก FACT_DELIVERY → ถ้าไม่มั่นใจส่งเข้า Q_REVIEW

## 2) สถาปัตยกรรมโมดูล
- 00_App: เมนูหลัก / orchestration
- 01_Config: sheet names / index / constants / thresholds
- 02_Schema: schema กลางทุกชีต
- 03_SetupSheets: setup sheet + logging + default config
- 04_SourceRepository: โหลด source rows และ cache
- 05_NormalizeService: ล้างชื่อคน / สถานที่ / phonetic / compare key
- 06_PersonService: match + create + alias + merge person
- 07_PlaceService: match + alias + branch matching + create place
- 08_GeoService: match พิกัดด้วย radius/grid/haversine
- 09_DestinationService: holy-trinity person+place+geo
- 10_MatchEngine: decision tree 8 rule
- 11_TransactionService: upsert FACT_DELIVERY
- 12_ReviewService: enqueue / reviewer action / alias learning
- 13_ReportService: data quality report
- 14_Utils: similarity / distance / helper
- 15_GoogleMapsAPI: geocode / reverse geocode / route distance / hybrid cache
- 16_GeoDictionaryBuilder: postcode/province dictionary
- 17_SearchService: bridge จาก daily job ไปยัง master destination
- 18_ServiceSCG: fetch API / build daily job / summaries

## 3) ประเด็นเสี่ยงสำคัญที่พบ
1. THRESHOLD_REVIEW และ THRESHOLD_IGNORE เดิมชนกันที่ 70
2. SHIPMENT_SUM vs SHIPMENT_SUMMARY ชื่อ key ไม่ตรงกัน
3. validateSheetHeaders เดิมเช็คแค่ presence ไม่เช็คลำดับ
4. reverseGeocode เดิมพยายามอ่าน persistent cache ที่ schema ไม่ตรงกับ payload
5. setup Q_REVIEW dropdown เดิมตั้งเฉพาะตอน create ไม่ได้ตั้งตอน patch
6. fetch SCG เดิมอ่าน shipment จากคอลัมน์ A เป็นหลัก แต่ค่า B3 ยังไม่ถูกใช้จริง
7. ค่าจำนวน/น้ำหนักใน ServiceSCG มีความเสี่ยงเก็บเป็น string

## 4) สิ่งที่แก้ในแพ็กนี้
- ปรับ THRESHOLD_IGNORE = 50
- เพิ่ม SCHEMA_VERSION
- รองรับ SCG API URL จาก Script Properties ก่อน แล้ว fallback เป็น default URL
- เพิ่ม alias schema key: SHIPMENT_SUM
- อัปเกรด validateSheetHeaders ให้รายงาน orderMismatch
- ตั้ง dropdown ของ Q_REVIEW ทั้งตอน create และ patch
- seed SYS_CONFIG เพิ่ม THRESHOLD_IGNORE และ SCHEMA_VERSION
- ปิดการใช้ sheet-cache สำหรับ reverse geocode ที่ schema ไม่รองรับ payload เดิม
- เปลี่ยน runLookupEnrichment ให้เขียน background แบบ batch
- รวม Shipment จากทั้ง A4:A และ B3 พร้อม dedupe
- บังคับ cast ค่าปริมาณ/น้ำหนัก/จำนวน scan เป็น number ใน ServiceSCG

## 5) ขอบเขตของแพ็กนี้
แพ็กนี้เป็น “baseline refactor ที่ปลอดภัย” โดยคงโครงเดิมของ Claude ไว้เกือบทั้งหมด และแก้เฉพาะจุดที่เสี่ยงพังจริงหรือ mismatch สูง เพื่อให้คุณนำไปวางทับได้ง่ายก่อนเข้าสเต็ป hardening รอบถัดไป

## 6) ข้อเสนอแนะต่อจากนี้
- ทำ integration test กับ sample spreadsheet จริง
- ทดสอบ flow: setup → fetch SCG → lookup enrichment → review → report
- เพิ่ม migration log เวลา schema เปลี่ยน
- ทำ index cache แบบ keyed map สำหรับ person/place/destination เพื่อหลีกเลี่ยง full-sheet scan ซ้ำ
- แยก read/write adapter สำหรับ unit test ได้ง่ายขึ้น
