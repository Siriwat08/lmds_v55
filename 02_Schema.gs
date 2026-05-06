/**
 * VERSION: 001
 * FILE: 02_Schema.gs
 * LMDS V5.0 — Sheet Schema Definitions
 * ===================================================
 * หน้าที่: นิยาม Header Array ของทุกชีตในระบบ
 * [RULE 2] ลำดับ Column ห้ามขยับ — เพิ่มได้เฉพาะต่อท้าย
 *          Index ใน SCHEMA ต้องสอดคล้องกับ *_IDX ใน 01_Config
 * ===================================================
 */

/**
 * SCHEMA — Object กลางเก็บ Header Array ของทุกชีต
 * Key = ใช้ตรงกับ SHEET constants ใน 01_Config
 */
const SCHEMA = {

  // ============================================================
  // กลุ่ม 1: Master Data Sheets
  // ============================================================

  /**
   * M_PERSON — 9 คอลัมน์
   * ตรวจสอบ index: สอดคล้องกับ PERSON_IDX ใน 01_Config
   */
  M_PERSON: [
    'person_id',       // [0] รหัสบุคคล UUID
    'canonical_name',  // [1] ชื่อมาตรฐาน
    'normalized_name', // [2] ชื่อหลังล้างคำ
    'phone',           // [3] เบอร์โทร
    'first_seen',      // [4] วันที่พบครั้งแรก
    'last_seen',       // [5] วันที่พบล่าสุด
    'usage_count',     // [6] จำนวนครั้งที่ถูกจับคู่
    'record_status',   // [7] Active / Archived / Merged
    'note',            // [8] หมายเหตุ
  ],

  /**
   * M_PERSON_ALIAS — 6 คอลัมน์
   * ตรวจสอบ index: สอดคล้องกับ PERSON_ALIAS_IDX ใน 01_Config
   */
  M_PERSON_ALIAS: [
    'alias_id',    // [0] รหัส Alias UUID
    'person_id',   // [1] FK → M_PERSON
    'alias_name',  // [2] ชื่อสำรองที่พบ
    'match_score', // [3] คะแนนความใกล้เคียง 0-100
    'created_at',  // [4] วันที่เพิ่ม
    'active_flag', // [5] TRUE = ใช้งาน
  ],

  /**
   * M_PLACE — 13 คอลัมน์
   * ตรวจสอบ index: สอดคล้องกับ PLACE_IDX ใน 01_Config
   */
  M_PLACE: [
    'place_id',       // [0] รหัสสถานที่ UUID
    'canonical_name', // [1] ชื่อสถานที่มาตรฐาน
    'normalized_name',// [2] ชื่อหลังล้างคำ
    'place_type',     // [3] condo / mall / house / site / other
    'sub_district',   // [4] แขวง/ตำบล
    'district',       // [5] เขต/อำเภอ
    'province',       // [6] จังหวัด
    'postcode',       // [7] รหัสไปรษณีย์
    'first_seen',     // [8] วันที่พบครั้งแรก
    'last_seen',      // [9] วันที่พบล่าสุด
    'usage_count',    // [10] จำนวนครั้งที่ถูกจับคู่
    'record_status',  // [11] Active / Archived
    'note',           // [12] หมายเหตุ
  ],

  /**
   * M_PLACE_ALIAS — 6 คอลัมน์
   * ตรวจสอบ index: สอดคล้องกับ PLACE_ALIAS_IDX ใน 01_Config
   */
  M_PLACE_ALIAS: [
    'alias_id',    // [0]
    'place_id',    // [1] FK → M_PLACE
    'alias_name',  // [2]
    'match_score', // [3]
    'created_at',  // [4]
    'active_flag', // [5]
  ],

  /**
   * M_GEO_POINT — 13 คอลัมน์
   * ตรวจสอบ index: สอดคล้องกับ GEO_IDX ใน 01_Config
   */
  M_GEO_POINT: [
    'geo_id',          // [0] รหัสพิกัด UUID
    'lat',             // [1] Latitude
    'lng',             // [2] Longitude
    'radius_m',        // [3] รัศมีพื้นที่ครอบคลุม (เมตร)
    'resolved_address',// [4] ที่อยู่จาก Reverse Geocode
    'province',        // [5] จังหวัด
    'district',        // [6] เขต/อำเภอ
    'source',          // [7] driver / maps / manual
    'coord_confidence',// [8] ระดับความเชื่อมั่น 0-100
    'first_seen',      // [9] วันที่พบครั้งแรก
    'last_seen',       // [10] วันที่พบล่าสุด
    'usage_count',     // [11] จำนวนครั้งที่ถูกใช้
    'record_status',   // [12] Active / Archived
  ],

  /**
   * M_DESTINATION — 11 คอลัมน์
   * Holy Trinity: person_id + place_id + geo_id = จุดส่งที่ไว้วางใจได้
   * ตรวจสอบ index: สอดคล้องกับ DEST_IDX ใน 01_Config
   */
  M_DESTINATION: [
    'dest_id',       // [0] รหัส Destination UUID
    'person_id',     // [1] FK → M_PERSON
    'place_id',      // [2] FK → M_PLACE
    'geo_id',        // [3] FK → M_GEO_POINT
    'lat',           // [4] Latitude ของแท้ 100%
    'lng',           // [5] Longitude ของแท้ 100%
    'route_label',   // [6] ป้ายชื่อเส้นทาง
    'delivery_date', // [7] วันที่ส่งล่าสุด
    'usage_count',   // [8] จำนวนครั้งที่รถไปจุดนี้
    'last_seen',     // [9] วันที่ใช้งานล่าสุด
    'record_status', // [10] Active / Archived
  ],

  // ============================================================
  // กลุ่ม 1: Fact Table
  // ============================================================

  /**
   * FACT_DELIVERY — 31 คอลัมน์
   * ตรวจสอบ index: สอดคล้องกับ FACT_IDX ใน 01_Config
   */
  FACT_DELIVERY: [
    'tx_id',            // [0] Transaction ID
    'source_sheet',     // [1] ชีตต้นทาง
    'source_row_number',// [2] แถวต้นทาง
    'source_record_id', // [3] Record ID ต้นทาง
    'delivery_date',    // [4] วันที่ส่งของ ✅
    'delivery_time',    // [5] เวลาส่งของ
    'invoice_no',       // [6] เลข Invoice
    'shipment_no',      // [7] เลข Shipment
    'driver_name',      // [8] ชื่อคนขับ
    'truck_license',    // [9] ทะเบียนรถ
    'carrier_code',     // [10] รหัส Carrier
    'carrier_name',     // [11] ชื่อ Carrier
    'sold_to_code',     // [12] รหัสเจ้าของสินค้า
    'sold_to_name',     // [13] ชื่อเจ้าของสินค้า
    'ship_to_name',     // [14] ชื่อผู้รับดิบ
    'person_id',        // [15] FK → M_PERSON (หลัง Match)
    'place_id',         // [16] FK → M_PLACE
    'geo_id',           // [17] FK → M_GEO_POINT ✅
    'destination_id',   // [18] FK → M_DESTINATION
    'warehouse',        // [19] คลังสินค้าต้นทาง
    'raw_lat',          // [20] Lat ดิบจากต้นทาง
    'raw_lng',          // [21] Lng ดิบจากต้นทาง
    'match_status',     // [22] AUTO_MATCH / CREATE_NEW / REVIEW / ERROR
    'match_confidence', // [23] คะแนน Confidence 0-100
    'match_reason',     // [24] เหตุผลการ Match
    'match_action',     // [25] Action ที่ระบบเลือก
    'resolved_lat',     // [26] Lat ที่ verified แล้ว
    'resolved_lng',     // [27] Lng ที่ verified แล้ว
    'created_at',       // [28] วันที่สร้าง
    'updated_at',       // [29] วันที่แก้ไข
    'record_status',    // [30] Active / Archived
  ],

  // ============================================================
  // กลุ่ม 1: Review Queue
  // ============================================================

  /**
   * Q_REVIEW — 23 คอลัมน์ [ยืนยันจาก GitHub 12_ReviewService.gs]
   * ตรวจสอบ index: สอดคล้องกับ REVIEW_IDX ใน 01_Config
   */
  Q_REVIEW: [
    'review_id',                  // [0]
    'issue_type',                 // [1] R01-R08
    'priority',                   // [2]
    'source_record_id',           // [3]
    'source_row_number',          // [4]
    'invoice_no',                 // [5]
    'raw_person_name',            // [6]
    'raw_place_name',             // [7]
    'raw_system_address',         // [8]
    'raw_geo_resolved_address',   // [9]
    'raw_lat',                    // [10]
    'raw_long',                   // [11]
    'candidate_person_ids',       // [12]
    'candidate_place_ids',        // [13]
    'candidate_geo_ids',          // [14]
    'candidate_destination_ids',  // [15]
    'match_score',                // [16]
    'recommended_action',         // [17]
    'status',                     // [18] Pending/In_Review/Done/Escalated
    'reviewer',                   // [19]
    'reviewed_at',                // [20]
    'decision',                   // [21]
    'note',                       // [22]
  ],

  // ============================================================
  // กลุ่ม 1: System Support Sheets
  // ============================================================

  /**
   * SYS_LOG — 6 คอลัมน์
   */
  SYS_LOG: [
    'log_id',    // [0] UUID ย่อ
    'timestamp', // [1] วันเวลา
    'module',    // [2] ชื่อ Module
    'level',     // [3] DEBUG / INFO / WARN / ERROR
    'message',   // [4] ข้อความ Log
    'details',   // [5] รายละเอียดเพิ่มเติม
  ],

  /**
   * SYS_CONFIG — 4 คอลัมน์
   */
  SYS_CONFIG: [
    'config_key',   // [0] ชื่อค่า Config
    'config_value', // [1] ค่าปัจจุบัน
    'description',  // [2] คำอธิบาย
    'updated_at',   // [3] วันที่แก้ไขล่าสุด
  ],

  /**
   * SYS_TH_GEO — 5 คอลัมน์
   * ฐานข้อมูลภูมิศาสตร์ไทย (Import จากแหล่งราชการ)
   */
  SYS_TH_GEO: [
    'sub_district', // [0] แขวง/ตำบล
    'district',     // [1] เขต/อำเภอ
    'province',     // [2] จังหวัด
    'postcode',     // [3] รหัสไปรษณีย์
    'region',       // [4] ภูมิภาค
  ],

  /**
   * RPT_DATA_QUALITY — 8 คอลัมน์
   */
  RPT_DATA_QUALITY: [
    'report_date',   // [0] วันที่รายงาน
    'total_records', // [1] จำนวน Record ทั้งหมด
    'auto_matched',  // [2] จำนวน Auto Match
    'reviewed',      // [3] จำนวนที่รอ Review
    'created_new',   // [4] จำนวน Create New
    'failed',        // [5] จำนวนที่ล้มเหลว
    'match_rate',    // [6] อัตรา Match (%)
    'notes',         // [7] หมายเหตุ
  ],

  /**
   * MAPS_CACHE — 8 คอลัมน์
   * Persistent Cache สำหรับผลการค้นหา Google Maps
   */
  MAPS_CACHE: [
    'cache_key',       // [0] MD5 hash ของ input
    'address_input',   // [1] ที่อยู่ที่ค้นหา
    'lat',             // [2] Latitude ที่ได้
    'lng',             // [3] Longitude ที่ได้
    'resolved_address',// [4] ที่อยู่เต็มจาก Maps
    'source',          // [5] maps_api / manual
    'created_at',      // [6] วันที่ Cache
    'hit_count',       // [7] จำนวนครั้งที่ถูกเรียกใช้
  ],

  // ============================================================
  // กลุ่ม 2: Daily Ops Sheets
  // ============================================================

  /**
   * DAILY_JOB — 29 คอลัมน์ (ตารางงานประจำวัน)
   * [PRESERVED 100% จาก Legacy Service_SCG.md]
   * ตรวจสอบ index: สอดคล้องกับ DATA_IDX ใน 01_Config
   */
  DAILY_JOB: [
    'ID_งานประจำวัน',                        // [0]
    'PlanDelivery',                           // [1]
    'InvoiceNo',                              // [2]
    'ShipmentNo',                             // [3]
    'DriverName',                             // [4]
    'TruckLicense',                           // [5]
    'CarrierCode',                            // [6]
    'CarrierName',                            // [7]
    'SoldToCode',                             // [8]
    'SoldToName',                             // [9]
    'ShipToName',                             // [10] ← Module 17 ใช้ตรงนี้
    'ShipToAddress',                          // [11] ← Module 17 ใช้ตรงนี้
    'LatLong_SCG',                            // [12]
    'MaterialName',                           // [13]
    'ItemQuantity',                           // [14]
    'QuantityUnit',                           // [15]
    'ItemWeight',                             // [16]
    'DeliveryNo',                             // [17]
    'จำนวนปลายทาง_System',                   // [18]
    'รายชื่อปลายทาง_System',                 // [19]
    'ScanStatus',                             // [20]
    'DeliveryStatus',                         // [21]
    'Email พนักงาน',                          // [22]
    'จำนวนสินค้ารวมของร้านนี้',              // [23]
    'น้ำหนักสินค้ารวมของร้านนี้',           // [24]
    'จำนวน_Invoice_ที่ต้องสแกน',            // [25]
    'LatLong_Actual',                         // [26] ← Module 17 เติมพิกัดที่นี่
    'ชื่อเจ้าของสินค้า_Invoice_ที่ต้องสแกน', // [27]
    'ShopKey',                                // [28]
  ],

  /**
   * INPUT — 2 คอลัมน์ (ชีตรับ Shipment No.)
   */
  INPUT: [
    'Shipment_No', // [0] เลข Shipment
    'หมายเหตุ',   // [1] หมายเหตุ
  ],

  /**
   * EMPLOYEE — 5 คอลัมน์ (ข้อมูลพนักงาน/คนขับ)
   */
  EMPLOYEE: [
    'driver_name',   // [0] ชื่อคนขับ
    'email',         // [1] อีเมล
    'phone',         // [2] เบอร์โทร
    'truck_license', // [3] ทะเบียนรถ
    'active',        // [4] TRUE = ยังทำงานอยู่
  ],

  /**
   * OWNER_SUMMARY — 6 คอลัมน์ (สรุป_เจ้าของสินค้า)
   */
  OWNER_SUMMARY: [
    'ลำดับ',          // [0]
    'เจ้าของสินค้า',  // [1]
    'หมายเหตุ',       // [2]
    'จำนวน Invoice',  // [3]
    'จำนวน E-POD',    // [4]
    'วันที่อัปเดต',   // [5]
  ],

  /**
   * SHIPMENT_SUMMARY — 7 คอลัมน์ (สรุป_Shipment)
   */
  SHIPMENT_SUMMARY: [
    'key',            // [0] ShipmentNo_TruckLicense
    'ShipmentNo',     // [1]
    'TruckLicense',   // [2]
    'หมายเหตุ',       // [3]
    'จำนวน Invoice',  // [4]
    'จำนวน E-POD',    // [5]
    'วันที่อัปเดต',   // [6]
  ],

  /**
   * SHIPMENT_SUM — alias key ให้ตรงกับ SHEET.SHIPMENT_SUM
   */
  SHIPMENT_SUM: [
    'key',            // [0] ShipmentNo_TruckLicense
    'ShipmentNo',     // [1]
    'TruckLicense',   // [2]
    'หมายเหตุ',       // [3]
    'จำนวน Invoice',  // [4]
    'จำนวน E-POD',    // [5]
    'วันที่อัปเดต',   // [6]
  ],
};

// ============================================================
// Schema Utility Functions
// ============================================================

/**
 * getSheetHeaders — คืน Header Array ของชีตที่ระบุ
 * @param {string} schemaKey - Key ใน SCHEMA object
 * @return {string[]} Header array
 */
function getSheetHeaders(schemaKey) {
  const headers = SCHEMA[schemaKey];
  if (!headers) {
    throw new Error(`[Schema] ไม่พบ Schema key: "${schemaKey}"`);
  }
  return headers;
}

/**
 * validateSheetHeaders — ตรวจสอบ Header ของชีตกับ Schema
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {string[]} expected - Header ที่ควรจะมี
 * @return {{ isValid: boolean, missing: string[], extra: string[], orderMismatch: boolean, actual: string[] }}
 */
function validateSheetHeaders(sheet, expected) {
  const lastCol = sheet.getLastColumn();
  if (lastCol === 0) {
    return { isValid: false, missing: expected, extra: [], orderMismatch: false, actual: [] };
  }

  const actual = sheet.getRange(1, 1, 1, lastCol)
                      .getValues()[0]
                      .map(h => String(h).trim());

  const missing = expected.filter(h => !actual.includes(h));
  const extra   = actual.filter(h => !expected.includes(h) && h !== '');
  const comparableLength = Math.min(actual.length, expected.length);
  let orderMismatch = false;
  for (let i = 0; i < comparableLength; i++) {
    if (actual[i] && expected[i] && actual[i] !== expected[i]) {
      orderMismatch = true;
      break;
    }
  }

  return {
    isValid: missing.length === 0 && extra.length === 0,
    missing: missing,
    extra:   extra,
    orderMismatch: orderMismatch,
    actual: actual,
  };
}

/**
 * getColIndex — ค้นหา Index ของ Column ใน Schema (0-based)
 * ใช้เป็น Fallback กรณีที่ต้องการค้นหาแบบ Dynamic
 * @param {string} schemaKey - Key ใน SCHEMA
 * @param {string} colName - ชื่อ Column ที่ต้องการ
 * @return {number} Index (0-based) หรือ -1 ถ้าไม่พบ
 */
function getColIndex(schemaKey, colName) {
  const headers = SCHEMA[schemaKey];
  if (!headers) return -1;
  return headers.indexOf(colName);
}
