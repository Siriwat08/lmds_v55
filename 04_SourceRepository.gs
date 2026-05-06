/**
 * VERSION: 001
 * FILE: 04_SourceRepository.gs
 * LMDS V5.0 — Source Data Repository
 * ===================================================
 * หน้าที่: อ่านข้อมูลดิบจากชีต SCGนครหลวงJWDภูมิภาค
 *          แปลงเป็น Object ที่พร้อมส่งเข้า Match Engine
 *          ชีตนี้คือ "Source of Truth" — LatLong ของแท้ 100%
 * ===================================================
 */

// ============================================================
// SECTION 1: Column Index ของชีต Source (SCGนครหลวงJWDภูมิภาค)
// ปรับตาม Layout จริงของชีต — ห้าม Hardcode ในที่อื่น
// ============================================================

const SRC_IDX = {
  ROW_NUMBER:   0,  // ลำดับแถว
  INVOICE_NO:   1,  // เลข Invoice
  SHIPMENT_NO:  2,  // เลข Shipment
  DELIVERY_DATE: 3, // วันที่ส่งของ
  DELIVERY_TIME: 4, // เวลาส่งของ
  DRIVER_NAME:  5,  // ชื่อคนขับ
  TRUCK_LICENSE: 6, // ทะเบียนรถ
  CARRIER_CODE:  7, // รหัส Carrier
  CARRIER_NAME:  8, // ชื่อ Carrier
  SOLD_TO_CODE:  9, // รหัสเจ้าของสินค้า
  SOLD_TO_NAME: 10, // ชื่อเจ้าของสินค้า
  SHIP_TO_NAME: 11, // ชื่อผู้รับ (ดิบ — อาจมียศ/บจก.)
  SYS_ADDRESS:  12, // ที่อยู่จาก System
  LAT:          13, // Latitude (ของแท้ 100%)
  LNG:          14, // Longitude (ของแท้ 100%)
  WAREHOUSE:    15, // คลังสินค้าต้นทาง
  PROVINCE:     16, // จังหวัด (ถ้ามี)
};

// ============================================================
// SECTION 2: Entry Point
// ============================================================

/**
 * runLoadSource — โหลดข้อมูลดิบจากชีต Source
 * เรียกจาก runFullPipeline() หรือ Menu โดยตรง
 */
function runLoadSource() {
  const ss     = SpreadsheetApp.getActiveSpreadsheet();
  const srcSheet = ss.getSheetByName(SHEET.SOURCE);

  if (!srcSheet) {
    logError('SourceRepo', `ไม่พบชีต: ${SHEET.SOURCE}`);
    throw new Error(`ไม่พบชีต "${SHEET.SOURCE}" กรุณาตรวจสอบชื่อชีต`);
  }

  const totalRows = srcSheet.getLastRow();
  if (totalRows < 2) {
    logWarn('SourceRepo', 'ไม่มีข้อมูลในชีต Source');
    return;
  }

  logInfo('SourceRepo', `เริ่มโหลด Source — ${totalRows - 1} แถว`);

  // [RULE 6] อ่านข้อมูลทั้งหมดในครั้งเดียว
  const allRows = srcSheet.getRange(2, 1, totalRows - 1,
                   srcSheet.getLastColumn()).getValues();

  let loaded    = 0;
  let skipped   = 0;
  let batchRows = [];

  for (let i = 0; i < allRows.length; i++) {
    const row = allRows[i];

    // ข้ามแถวที่ Invoice ว่างเปล่า
    if (!row[SRC_IDX.INVOICE_NO]) {
      skipped++;
      continue;
    }

    // แปลงเป็น Source Object
    const srcObj = buildSourceObj_(row, i + 2);
    batchRows.push(srcObj);
    loaded++;

    // ประมวลผลทีละ Batch เพื่อไม่ให้ Memory เต็ม
    if (batchRows.length >= AI_CONFIG.BATCH_SIZE * 5) {
      processSrcBatch_(batchRows);
      batchRows = [];
    }
  }

  // ประมวลผล Batch สุดท้าย
  if (batchRows.length > 0) {
    processSrcBatch_(batchRows);
  }

  logInfo('SourceRepo',
    `โหลด Source เสร็จ — โหลด:${loaded} ข้าม:${skipped}`);
}

// ============================================================
// SECTION 3: ดึงข้อมูล Source สำหรับ Match Engine
// ============================================================

/**
 * getAllSourceRows — คืน Array ของ Source Objects ทั้งหมด
 * [RULE 6] ใช้ CacheService ลด Read ซ้ำ
 * @return {Object[]} รายการ Source Objects
 */
function getAllSourceRows() {
  const cacheKey  = 'SOURCE_ROWS_CACHE';
  const cache     = CacheService.getScriptCache();
  const cached    = cache.get(cacheKey);

  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (e) {
      // Cache เสีย — อ่านใหม่
    }
  }

  const ss       = SpreadsheetApp.getActiveSpreadsheet();
  const srcSheet = ss.getSheetByName(SHEET.SOURCE);
  if (!srcSheet || srcSheet.getLastRow() < 2) return [];

  const totalRows = srcSheet.getLastRow() - 1;
  const allData   = srcSheet.getRange(2, 1, totalRows,
                     srcSheet.getLastColumn()).getValues();

  const result = allData
    .filter(row => row[SRC_IDX.INVOICE_NO])
    .map((row, i) => buildSourceObj_(row, i + 2));

  // Cache ไว้ 6 ชั่วโมง
  try {
    cache.put(cacheKey, JSON.stringify(result), AI_CONFIG.CACHE_TTL_SEC);
  } catch (e) {
    // ข้อมูลใหญ่เกินกว่าจะ Cache — ข้ามไป
  }

  return result;
}

/**
 * getUnprocessedRows — ดึงเฉพาะแถวที่ยังไม่ผ่าน Match Engine
 * ตรวจจาก FACT_DELIVERY ว่า Invoice นี้มีอยู่แล้วหรือยัง
 * @return {Object[]} แถวที่ยังไม่ได้ประมวลผล
 */
function getUnprocessedRows() {
  const allRows    = getAllSourceRows();
  if (allRows.length === 0) return [];

  // โหลด Invoice ที่มีใน FACT แล้ว
  const doneSet    = getProcessedInvoiceSet_();

  return allRows.filter(row => !doneSet.has(row.invoiceNo));
}

/**
 * getProcessedInvoiceSet_ — อ่าน Invoice ที่อยู่ใน FACT_DELIVERY แล้ว
 * @return {Set<string>}
 */
function getProcessedInvoiceSet_() {
  const cacheKey = 'FACT_INVOICE_SET';
  const cached = getCacheJson_(cacheKey);
  if (cached && Array.isArray(cached.invoiceNos)) {
    return new Set(cached.invoiceNos);
  }

  const ss        = SpreadsheetApp.getActiveSpreadsheet();
  const factSheet = ss.getSheetByName(SHEET.FACT_DELIVERY);
  const doneSet   = new Set();

  if (!factSheet || factSheet.getLastRow() < 2) return doneSet;

  const invoiceCol   = FACT_IDX.INVOICE_NO + 1;
  const lastRow      = factSheet.getLastRow() - 1;
  const invoiceData  = factSheet.getRange(2, invoiceCol, lastRow, 1)
                                .getValues();

  invoiceData.forEach(r => {
    const invoiceNo = toSafeString_(r[0]);
    if (invoiceNo) doneSet.add(invoiceNo);
  });

  putCacheJson_(cacheKey, { invoiceNos: Array.from(doneSet) }, AI_CONFIG.CACHE_TTL_SEC);
  return doneSet;
}

// ============================================================
// SECTION 4: Builder & Processor
// ============================================================

/**
 * buildSourceObj_ — แปลง Row Array เป็น Source Object
 * @param {Array} row - ข้อมูลหนึ่งแถวจากชีต Source
 * @param {number} rowNum - หมายเลขแถวใน Sheet (เริ่มจาก 2)
 * @return {Object} Source Object
 */
function buildSourceObj_(row, rowNum) {
  const rawLat = parseFloat(row[SRC_IDX.LAT]) || 0;
  const rawLng = parseFloat(row[SRC_IDX.LNG]) || 0;
  const hasGeo = rawLat !== 0 && rawLng !== 0;

  return {
    sourceSheet:   SHEET.SOURCE,
    sourceRow:     rowNum,
    invoiceNo:     String(row[SRC_IDX.INVOICE_NO] || '').trim(),
    shipmentNo:    String(row[SRC_IDX.SHIPMENT_NO] || '').trim(),
    deliveryDate:  row[SRC_IDX.DELIVERY_DATE] || '',
    deliveryTime:  row[SRC_IDX.DELIVERY_TIME] || '',
    driverName:    String(row[SRC_IDX.DRIVER_NAME] || '').trim(),
    truckLicense:  String(row[SRC_IDX.TRUCK_LICENSE] || '').trim(),
    carrierCode:   String(row[SRC_IDX.CARRIER_CODE] || '').trim(),
    carrierName:   String(row[SRC_IDX.CARRIER_NAME] || '').trim(),
    soldToCode:    String(row[SRC_IDX.SOLD_TO_CODE] || '').trim(),
    soldToName:    String(row[SRC_IDX.SOLD_TO_NAME] || '').trim(),
    rawPersonName: String(row[SRC_IDX.SHIP_TO_NAME] || '').trim(),
    rawAddress:    String(row[SRC_IDX.SYS_ADDRESS] || '').trim(),
    rawLat:        rawLat,
    rawLng:        rawLng,
    hasGeo:        hasGeo,
    warehouse:     String(row[SRC_IDX.WAREHOUSE] || '').trim(),
    province:      String(row[SRC_IDX.PROVINCE] || '').trim(),
  };
}

/**
 * processSrcBatch_ — ส่ง Source Batch เข้า Match Engine
 * @param {Object[]} batch - รายการ Source Objects
 */
function processSrcBatch_(batch) {
  try {
    // เรียก Match Engine (10_MatchEngine.gs)
    batch.forEach(srcObj => processOneRow(srcObj));
  } catch (err) {
    logError('SourceRepo', `processSrcBatch_ ล้มเหลว: ${err.message}`);
  }
}

/**
 * invalidateSourceCache — ล้าง Cache ของ Source
 * เรียกเมื่อมีการเพิ่มข้อมูลใหม่ในชีต Source
 */
function invalidateSourceCache() {
  CacheService.getScriptCache().remove('SOURCE_ROWS_CACHE');
  CacheService.getScriptCache().remove('FACT_INVOICE_SET');
}
