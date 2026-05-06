/**
 * VERSION: 001
 * FILE: 01_Config.gs
 * LMDS V5.0 — System Configuration
 * ===================================================
 * หน้าที่: ศูนย์กลางค่าคอนฟิก ชื่อชีต และ Index คอลัมน์
 * [RULE 3] ทุก Module ต้องอ้างอิงผ่านไฟล์นี้เท่านั้น
 *          ห้าม Hardcode ชื่อชีต หรือเลขคอลัมน์ในโค้ด
 * ===================================================
 */

// ============================================================
// SECTION 1: ชื่อชีตทั้งหมด (Sheet Name Constants)
// ============================================================

const SCHEMA_VERSION = '5.2.000';

/**
 * SHEET — Object กลางเก็บชื่อชีตทุกชีตในระบบ
 * การแก้ไขชื่อชีตให้เปลี่ยนที่นี่จุดเดียว
 */
const SHEET = {

  // -- กลุ่ม 1: Master Data --
  M_PERSON:       'M_PERSON',        // ฐานข้อมูลบุคคล
  M_PERSON_ALIAS: 'M_PERSON_ALIAS',  // ชื่อสำรองของบุคคล
  M_PLACE:        'M_PLACE',         // ฐานข้อมูลสถานที่
  M_PLACE_ALIAS:  'M_PLACE_ALIAS',   // ชื่อสำรองของสถานที่
  M_GEO_POINT:    'M_GEO_POINT',     // ฐานข้อมูลพิกัด GPS
  M_DESTINATION:  'M_DESTINATION',   // ความสัมพันธ์ บุคคล+สถานที่+พิกัด

  // -- กลุ่ม 1: Fact & Queue --
  FACT_DELIVERY:  'FACT_DELIVERY',   // ประวัติการส่งของทั้งหมด (Fact Table)
  Q_REVIEW:       'Q_REVIEW',        // คิวรอตรวจสอบ

  // -- กลุ่ม 1: Source (ข้อมูลดิบต้นทาง) --
  SOURCE:         'SCGนครหลวงJWDภูมิภาค', // ชีตข้อมูลดิบที่มี LatLong จริง 100%

  // -- กลุ่ม 1: System Support --
  SYS_CONFIG:     'SYS_CONFIG',      // ค่า Config ของระบบ (Key-Value)
  SYS_LOG:        'SYS_LOG',         // บันทึก Log การทำงาน
  SYS_TH_GEO:     'SYS_TH_GEO',     // ฐานข้อมูลภูมิศาสตร์ไทย (รหัสไปรษณีย์)
  RPT_QUALITY:    'RPT_DATA_QUALITY', // รายงาน Data Quality
  MAPS_CACHE:     'MAPS_CACHE',       // Cache ผลการค้นหาพิกัดจาก Maps API

  // -- กลุ่ม 2: Daily Ops --
  DAILY_JOB:      'ตารางงานประจำวัน', // ตารางงานหลักฝั่ง SCG
  INPUT:          'Input',            // รับ Shipment No. และ Cookie
  EMPLOYEE:       'ข้อมูลพนักงาน',    // ข้อมูลพนักงาน/คนขับ
  OWNER_SUMMARY:  'สรุป_เจ้าของสินค้า', // สรุปยอดแยกเจ้าของสินค้า
  SHIPMENT_SUM:   'สรุป_Shipment',     // สรุปยอดแยก Shipment
};

// ============================================================
// SECTION 2: Column Index (0-based) ของ Master Tables
// [RULE 2] ห้ามขยับลำดับ — เพิ่มได้เฉพาะต่อท้าย
// ============================================================

/**
 * PERSON_IDX — M_PERSON (9 คอลัมน์)
 * person_id | canonical_name | normalized_name | phone |
 * first_seen | last_seen | usage_count | record_status | note
 */
const PERSON_IDX = {
  PERSON_ID:   0,  // รหัสบุคคล (UUID)
  CANONICAL:   1,  // ชื่อมาตรฐานที่ถูกต้อง
  NORMALIZED:  2,  // ชื่อหลังจากล้างคำเสร็จ
  PHONE:       3,  // เบอร์โทรศัพท์
  FIRST_SEEN:  4,  // วันที่พบครั้งแรกในระบบ
  LAST_SEEN:   5,  // วันที่พบล่าสุด
  USAGE_COUNT: 6,  // จำนวนครั้งที่ถูกจับคู่
  STATUS:      7,  // Active / Archived / Merged
  NOTE:        8,  // หมายเหตุ
};

/**
 * PERSON_ALIAS_IDX — M_PERSON_ALIAS (6 คอลัมน์)
 * alias_id | person_id | alias_name | match_score | created_at | active_flag
 */
const PERSON_ALIAS_IDX = {
  ALIAS_ID:    0,  // รหัส Alias (UUID)
  PERSON_ID:   1,  // FK → M_PERSON.person_id
  ALIAS_NAME:  2,  // ชื่อสำรองที่พบ
  MATCH_SCORE: 3,  // คะแนนความใกล้เคียง 0-100
  CREATED_AT:  4,  // วันที่เพิ่ม Alias
  ACTIVE_FLAG: 5,  // TRUE = ใช้งาน, FALSE = ปิดการใช้งาน
};

/**
 * PLACE_IDX — M_PLACE (13 คอลัมน์)
 * place_id | canonical_name | normalized_name | place_type |
 * sub_district | district | province | postcode |
 * first_seen | last_seen | usage_count | record_status | note
 */
const PLACE_IDX = {
  PLACE_ID:    0,  // รหัสสถานที่ (UUID)
  CANONICAL:   1,  // ชื่อสถานที่มาตรฐาน
  NORMALIZED:  2,  // ชื่อหลังล้างคำ
  PLACE_TYPE:  3,  // ประเภท: condo/mall/house/site/other
  SUB_DISTRICT: 4, // แขวง/ตำบล
  DISTRICT:    5,  // เขต/อำเภอ
  PROVINCE:    6,  // จังหวัด
  POSTCODE:    7,  // รหัสไปรษณีย์
  FIRST_SEEN:  8,  // วันที่พบครั้งแรก
  LAST_SEEN:   9,  // วันที่พบล่าสุด
  USAGE_COUNT: 10, // จำนวนครั้งที่ถูกจับคู่
  STATUS:      11, // Active / Archived
  NOTE:        12, // หมายเหตุ
};

/**
 * PLACE_ALIAS_IDX — M_PLACE_ALIAS (6 คอลัมน์)
 * alias_id | place_id | alias_name | match_score | created_at | active_flag
 */
const PLACE_ALIAS_IDX = {
  ALIAS_ID:    0,
  PLACE_ID:    1,  // FK → M_PLACE.place_id
  ALIAS_NAME:  2,
  MATCH_SCORE: 3,
  CREATED_AT:  4,
  ACTIVE_FLAG: 5,
};

/**
 * GEO_IDX — M_GEO_POINT (13 คอลัมน์)
 * geo_id | lat | lng | radius_m | resolved_address |
 * province | district | source | coord_confidence |
 * first_seen | last_seen | usage_count | record_status
 */
const GEO_IDX = {
  GEO_ID:        0,  // รหัสพิกัด (UUID)
  LAT:           1,  // Latitude
  LNG:           2,  // Longitude
  RADIUS_M:      3,  // รัศมีพื้นที่ครอบคลุม (เมตร) default 50
  RESOLVED_ADDR: 4,  // ที่อยู่ที่ได้จาก Reverse Geocode
  PROVINCE:      5,  // จังหวัด
  DISTRICT:      6,  // เขต/อำเภอ
  SOURCE:        7,  // แหล่งข้อมูล: driver/maps/manual
  CONFIDENCE:    8,  // ระดับความเชื่อมั่น 0-100
  FIRST_SEEN:    9,  // วันที่พบครั้งแรก
  LAST_SEEN:     10, // วันที่พบล่าสุด
  USAGE_COUNT:   11, // จำนวนครั้งที่ถูกใช้
  STATUS:        12, // Active / Archived
};

/**
 * DEST_IDX — M_DESTINATION (11 คอลัมน์)
 * dest_id | person_id | place_id | geo_id |
 * lat | lng | route_label | delivery_date |
 * usage_count | last_seen | record_status
 */
const DEST_IDX = {
  DEST_ID:       0,  // รหัส Destination (UUID)
  PERSON_ID:     1,  // FK → M_PERSON.person_id
  PLACE_ID:      2,  // FK → M_PLACE.place_id
  GEO_ID:        3,  // FK → M_GEO_POINT.geo_id
  LAT:           4,  // Latitude ของแท้ 100%
  LNG:           5,  // Longitude ของแท้ 100%
  ROUTE_LABEL:   6,  // ป้ายชื่อเส้นทาง (ถ้ามี)
  DELIVERY_DATE: 7,  // วันที่ส่งล่าสุดที่จุดนี้
  USAGE_COUNT:   8,  // นับครั้งที่รถวิ่งมาจุดนี้
  LAST_SEEN:     9,  // วันที่ใช้งานล่าสุด
  STATUS:        10, // Active / Archived
};

/**
 * FACT_IDX — FACT_DELIVERY (31 คอลัมน์)
 * Fact Table เก็บประวัติการส่งของทุกรายการที่ผ่านระบบ
 */
const FACT_IDX = {
  TX_ID:         0,  // รหัส Transaction (UUID)
  SOURCE_SHEET:  1,  // ชื่อชีตต้นทาง
  SOURCE_ROW:    2,  // แถวต้นทาง (สำหรับ Trace กลับ)
  SOURCE_REC_ID: 3,  // รหัสข้อมูลต้นทาง
  DELIVERY_DATE: 4,  // วันที่ส่งของ ✅ (Bug Fix: เดิมใช้ [2] ผิด)
  DELIVERY_TIME: 5,  // เวลาส่งของ
  INVOICE_NO:    6,  // เลข Invoice
  SHIPMENT_NO:   7,  // เลข Shipment
  DRIVER_NAME:   8,  // ชื่อคนขับ
  TRUCK_LICENSE: 9,  // ทะเบียนรถ
  CARRIER_CODE:  10, // รหัส Carrier
  CARRIER_NAME:  11, // ชื่อ Carrier
  SOLD_TO_CODE:  12, // รหัสเจ้าของสินค้า
  SOLD_TO_NAME:  13, // ชื่อเจ้าของสินค้า
  SHIP_TO_NAME:  14, // ชื่อผู้รับดิบ (ก่อน Normalize)
  PERSON_ID:     15, // FK → M_PERSON (หลัง Match)
  PLACE_ID:      16, // FK → M_PLACE  (หลัง Match)
  GEO_ID:        17, // FK → M_GEO_POINT ✅ (Bug Fix: เดิมใช้ [5] ผิด)
  DEST_ID:       18, // FK → M_DESTINATION
  WAREHOUSE:     19, // คลังสินค้าต้นทาง
  RAW_LAT:       20, // Lat ดิบจากต้นทาง
  RAW_LNG:       21, // Lng ดิบจากต้นทาง
  MATCH_STATUS:  22, // AUTO_MATCH / CREATE_NEW / REVIEW / ERROR
  MATCH_CONF:    23, // คะแนน Confidence 0-100
  MATCH_REASON:  24, // เหตุผลการ Match
  MATCH_ACTION:  25, // Action ที่ระบบเลือก
  RESOLVED_LAT:  26, // Lat ที่ verified แล้ว
  RESOLVED_LNG:  27, // Lng ที่ verified แล้ว
  CREATED_AT:    28, // วันที่สร้าง Record
  UPDATED_AT:    29, // วันที่แก้ไขล่าสุด
  RECORD_STATUS: 30, // Active / Archived / Merged
};

/**
 * REVIEW_IDX — Q_REVIEW (23 คอลัมน์) [ยืนยันจาก GitHub 12_ReviewService.gs]
 */
const REVIEW_IDX = {
  REVIEW_ID:     0,  // รหัส Review (UUID)
  ISSUE_TYPE:    1,  // ประเภทปัญหา เช่น R01-R08
  PRIORITY:      2,  // ลำดับความสำคัญ
  SOURCE_REC_ID: 3,  // รหัส Record ต้นทาง
  SOURCE_ROW:    4,  // แถวต้นทาง
  INVOICE_NO:    5,  // เลข Invoice
  RAW_PERSON:    6,  // ชื่อบุคคลดิบ
  RAW_PLACE:     7,  // ชื่อสถานที่ดิบ
  RAW_SYS_ADDR:  8,  // ที่อยู่จาก System
  RAW_GEO_ADDR:  9,  // ที่อยู่จาก Reverse Geocode
  RAW_LAT:       10, // Lat ดิบ
  RAW_LNG:       11, // Lng ดิบ
  CAND_PERSONS:  12, // รายการ Person ID ที่เป็นไปได้
  CAND_PLACES:   13, // รายการ Place ID ที่เป็นไปได้
  CAND_GEOS:     14, // รายการ Geo ID ที่เป็นไปได้
  CAND_DESTS:    15, // รายการ Dest ID ที่เป็นไปได้
  MATCH_SCORE:   16, // คะแนนการ Match สูงสุด
  RECOMMEND:     17, // คำแนะนำจาก AI
  STATUS:        18, // Pending / In_Review / Done / Escalated
  REVIEWER:      19, // ผู้ตรวจสอบ
  REVIEWED_AT:   20, // วันที่ตรวจสอบ
  DECISION:      21, // ผลการตัดสินใจ
  NOTE:          22, // หมายเหตุ
};

// ============================================================
// SECTION 3: Column Index ของชีตกลุ่ม 2
// ============================================================

/**
 * DATA_IDX — ตารางงานประจำวัน (29 คอลัมน์)
 * [PRESERVED 100% จาก Legacy CONFIG.md — ห้ามเปลี่ยน Index]
 */
const DATA_IDX = {
  JOB_ID:          0,  // ID_งานประจำวัน
  PLAN_DELIVERY:   1,  // PlanDelivery
  INVOICE_NO:      2,  // InvoiceNo
  SHIPMENT_NO:     3,  // ShipmentNo
  DRIVER_NAME:     4,  // DriverName
  TRUCK_LICENSE:   5,  // TruckLicense
  CARRIER_CODE:    6,  // CarrierCode
  CARRIER_NAME:    7,  // CarrierName
  SOLD_TO_CODE:    8,  // SoldToCode
  SOLD_TO_NAME:    9,  // SoldToName
  SHIP_TO_NAME:    10, // ShipToName (คอลัมน์ K)
  SHIP_TO_ADDR:    11, // ShipToAddress (คอลัมน์ L)
  LATLNG_SCG:      12, // LatLong_SCG (จาก SCG API)
  MATERIAL:        13, // MaterialName
  QTY:             14, // ItemQuantity
  QTY_UNIT:        15, // QuantityUnit
  WEIGHT:          16, // ItemWeight
  DELIVERY_NO:     17, // DeliveryNo
  DEST_COUNT:      18, // จำนวนปลายทาง_System
  DEST_LIST:       19, // รายชื่อปลายทาง_System
  SCAN_STATUS:     20, // ScanStatus
  DELIVERY_STATUS: 21, // DeliveryStatus
  EMAIL:           22, // Email พนักงาน
  TOT_QTY:         23, // จำนวนสินค้ารวมของร้านนี้
  TOT_WEIGHT:      24, // น้ำหนักสินค้ารวมของร้านนี้
  SCAN_INV:        25, // จำนวน_Invoice_ที่ต้องสแกน
  LATLNG_ACTUAL:   26, // LatLong_Actual (คอลัมน์ AA — จุดปลาย Module 17)
  OWNER_LABEL:     27, // ชื่อเจ้าของสินค้า_Invoice_ที่ต้องสแกน
  SHOP_KEY:        28, // ShopKey (ShipmentNo|ShipToName)
};

// ============================================================
// SECTION 4: SCG Config [PRESERVED จาก Legacy — ห้ามเปลี่ยน]
// ============================================================

/**
 * SCG_CONFIG — ค่าตั้งค่าสำหรับ SCG API และชีตปฏิบัติการ
 * [ใช้ใน 18_ServiceSCG.gs]
 */
const SCG_CONFIG = {
  SHEET_DATA:           SHEET.DAILY_JOB,  // ชีตตารางงานประจำวัน
  SHEET_INPUT:          SHEET.INPUT,       // ชีตรับ Shipment No.
  SHEET_EMPLOYEE:       SHEET.EMPLOYEE,    // ชีตข้อมูลพนักงาน
  API_URL:              PropertiesService.getScriptProperties().getProperty('SCG_API_URL') ||
                        'https://fsm.scgjwd.com/Monitor/SearchDelivery',
  INPUT_START_ROW:      4,     // แถวเริ่มต้นรายการ Shipment ในชีต Input
  COOKIE_CELL:          'B1',  // Cell เก็บ Cookie
  SHIPMENT_STRING_CELL: 'B3',  // Cell รวม Shipment String
  GPS_THRESHOLD_METERS: 50,    // ระยะห่างสูงสุด (เมตร) ที่ถือว่าพิกัดตรงกัน
};

// ============================================================
// SECTION 5: AI & Matching Config
// ============================================================

/**
 * AI_CONFIG — ค่าตั้งค่าสำหรับ AI Matching และ Gemini
 */
const AI_CONFIG = {
  THRESHOLD_AUTO:    90,  // >= 90 → Auto Match ทันที
  THRESHOLD_REVIEW:  70,  // 70-89 → ส่ง Q_REVIEW
  THRESHOLD_IGNORE:  50,  // < 70  → ไม่นำมาพิจารณา (กัน logic ทับกับ REVIEW)
  MODEL:             'gemini-1.5-flash', // Gemini Model ที่ใช้
  BATCH_SIZE:        20,  // จำนวน Record ต่อ Batch ที่ส่ง AI
  RETRIEVAL_LIMIT:   50,  // จำนวน Candidate สูงสุดก่อนส่ง AI
  CACHE_TTL_SEC:     21600, // TTL Cache = 6 ชั่วโมง
  GEO_RADIUS_M:      50,   // รัศมี GPS Matching (เมตร)
  SEARCH_WRITE_BATCH: 200, // จำนวนแถวต่อหนึ่งรอบการเขียนผล lookup
  MAX_SHIPMENT_FETCH: 200, // เพดาน Shipment ต่อการดึงหนึ่งครั้ง
  MAX_LOOKUP_ROWS:   5000, // เพดานแถวต่อการ enrich หนึ่งครั้ง
};

// ============================================================
// SECTION 6: App Constants (สีและค่าคงที่ต่างๆ)
// ============================================================

/**
 * APP_CONST — ค่าคงที่ใช้ทั่วระบบ
 */
const APP_CONST = {
  // Record Status Values
  STATUS_ACTIVE:    'Active',
  STATUS_ARCHIVED:  'Archived',
  STATUS_MERGED:    'Merged',

  // สีพื้นหลังตาม Match Status
  COLOR_FOUND:      '#b6d7a8', // เขียว = เจอแบบ Exact
  COLOR_FALLBACK:   '#ffe599', // เหลือง = เจอแบบ Fallback (ไม่ชัวร์ 100%)
  COLOR_NOT_FOUND:  '#f4cccc', // แดง = ไม่เจอ
  COLOR_BRANCH:     '#cfe2f3', // ฟ้า = เจอแบบ Branch Match

  // System Limits
  MAX_RETRIES:      3,      // จำนวนครั้งที่ retry สูงสุด
  LOCK_TIMEOUT_MS:  10000,  // Timeout ของ LockService (ms)
  PIPELINE_BATCH:   50,     // จำนวนแถวต่อ Batch ใน Pipeline

  // Match Status Labels
  MATCH_FULL:       'FULL_MATCH',
  MATCH_GEO:        'GEO_ANCHOR',
  MATCH_FUZZY:      'FUZZY_MATCH',
  MATCH_NEW:        'CREATE_NEW',
  MATCH_REVIEW:     'NEEDS_REVIEW',
  MATCH_ERROR:      'ERROR',
};

// ============================================================
// SECTION 7: API Key Helper
// ============================================================

/**
 * getGeminiApiKey — ดึง API Key จาก PropertiesService
 * [RULE 5] ห้าม Hardcode API Key ในโค้ดเด็ดขาด
 * @return {string} Gemini API Key
 */
function getGeminiApiKey() {
  const key = PropertiesService.getScriptProperties()
                               .getProperty('GEMINI_API_KEY');
  if (!key || !/^AIza[0-9A-Za-z\-_]{35}$/.test(String(key).trim())) {
    throw new Error(
      'GEMINI_API_KEY ยังไม่ได้ตั้งค่า\n' +
      'กรุณารัน เมนู LMDS > ระบบ > ตั้งค่า API Key ก่อน'
    );
  }
  return key;
}
