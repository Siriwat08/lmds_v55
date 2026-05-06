/**
 * VERSION: 001
 * FILE: 18_ServiceSCG.gs
 * LMDS V5.0 — SCG API Service (Group 2 Commander)
 * ===================================================
 * หน้าที่: บัญชาการฝั่ง SCG API
 *   1. fetchDataFromSCGJWD    — ดึงข้อมูลจาก SCG Web API
 *   2. applyMasterCoordinatesToDailyJob — เรียก Module 17
 *      (แทน VLOOKUP ทื่อๆ เดิม)
 *   3. checkIsEPOD / buildOwnerSummary / buildShipmentSummary
 *      — ห้ามแตะ Logic เดิม
 *   4. clearAllSCGSheets_UI  — ล้างชีตทั้งหมด (Group 2)
 * ===================================================
 */

// ============================================================
// SECTION 1: fetchDataFromSCGJWD — ดึงข้อมูลจาก SCG API
// ============================================================

/**
 * fetchDataFromSCGJWD — โหลด JSON งานจาก SCG Web API
 * และกางลงชีต ตารางงานประจำวัน (29 คอลัมน์)
 * [PRESERVE] ห้ามเปลี่ยน Logic การ Fetch และ Parse JSON
 */
function fetchDataFromSCGJWD() {
  const lock = LockService.getScriptLock();
  lock.waitLock(APP_CONST.LOCK_TIMEOUT_MS);

  try {
    const ss          = SpreadsheetApp.getActiveSpreadsheet();
    const inputSheet  = ss.getSheetByName(SCG_CONFIG.SHEET_INPUT);
    const dataSheet   = ss.getSheetByName(SCG_CONFIG.SHEET_DATA);

    if (!inputSheet || !dataSheet) {
      SpreadsheetApp.getUi().alert(
        '❌ ไม่พบชีต Input หรือ ตารางงานประจำวัน\nกรุณารัน Setup ก่อน'
      );
      return;
    }

    const headerAudit = validateSheetHeaders(dataSheet, SCHEMA.DAILY_JOB);
    if (dataSheet.getLastRow() >= 1 && headerAudit.missing.length > 0) {
      throw new Error(`DAILY_JOB header ไม่ครบ: ${headerAudit.missing.join(', ')}`);
    }

    const cookie = toSafeString_(inputSheet.getRange(SCG_CONFIG.COOKIE_CELL).getValue());
    const shipmentString = toSafeString_(inputSheet.getRange(SCG_CONFIG.SHIPMENT_STRING_CELL).getValue());

    if (!cookie || cookie.length < 10) {
      SpreadsheetApp.getUi().alert('❌ กรุณาใส่ Cookie ที่ถูกต้องใน Cell B1 ของชีต Input ก่อน');
      return;
    }

    const lastInputRow = inputSheet.getLastRow();
    if (lastInputRow < SCG_CONFIG.INPUT_START_ROW && !shipmentString) {
      SpreadsheetApp.getUi().alert('❌ ไม่พบ Shipment No. ในชีต Input (เริ่มจากแถว 4)');
      return;
    }

    const shipmentNosFromRows = lastInputRow >= SCG_CONFIG.INPUT_START_ROW
      ? inputSheet.getRange(SCG_CONFIG.INPUT_START_ROW, 1, lastInputRow - SCG_CONFIG.INPUT_START_ROW + 1, 1)
          .getValues()
          .map(r => toSafeString_(r[0]))
          .filter(Boolean)
      : [];

    const shipmentNosFromCell = shipmentString
      ? shipmentString.split(/[\s,;|]+/).map(s => toSafeString_(s)).filter(Boolean)
      : [];

    const shipmentNos = uniqueNonEmptyStrings_([].concat(shipmentNosFromRows, shipmentNosFromCell));
    const maxFetch = Number(getRuntimeConfigNumber_('MAX_SHIPMENT_FETCH', AI_CONFIG.MAX_SHIPMENT_FETCH || 200)) || 200;

    if (shipmentNos.length === 0) {
      SpreadsheetApp.getUi().alert('❌ ไม่พบ Shipment No. ที่ถูกต้อง');
      return;
    }
    if (shipmentNos.length > maxFetch) {
      SpreadsheetApp.getUi().alert(`❌ จำนวน Shipment เกินเพดาน ${maxFetch} รายการต่อการดึงหนึ่งครั้ง`);
      return;
    }

    logInfo('ServiceSCG', `fetchDataFromSCGJWD: ${shipmentNos.length} Shipments`);
    SpreadsheetApp.getActiveSpreadsheet()
      .toast(`กำลังดึงข้อมูล ${shipmentNos.length} Shipment...`, APP_NAME, -1);

    let allNewRows = [];
    let fetchFail = 0;

    shipmentNos.forEach(shipNo => {
      try {
        const rows = fetchOneShipment_(shipNo, cookie);
        rows.forEach(r => allNewRows.push(r));
      } catch (err) {
        fetchFail++;
        logError('ServiceSCG', `Fetch ${shipNo} ล้มเหลว: ${err.message}`);
      }
    });

    allNewRows = dedupeObjectsByKey_(allNewRows, row => [
      row[DATA_IDX.SHIPMENT_NO],
      row[DATA_IDX.INVOICE_NO],
      row[DATA_IDX.DELIVERY_NO],
      row[DATA_IDX.SHIP_TO_NAME],
      row[DATA_IDX.MATERIAL]
    ].join('|'));

    if (allNewRows.length === 0) {
      SpreadsheetApp.getUi().alert(
        `⚠️ ไม่มีข้อมูลที่ดึงได้\n(เช็ค Cookie / Shipment No.)\nล้มเหลว: ${fetchFail}`
      );
      return;
    }

    const startRow = dataSheet.getLastRow() + 1;
    dataSheet.getRange(startRow, 1, allNewRows.length, SCHEMA.DAILY_JOB.length)
             .setValues(allNewRows);

    logInfo('ServiceSCG',
      `fetchDataFromSCGJWD เสร็จ — ${allNewRows.length} แถว (fail:${fetchFail})`);

    SpreadsheetApp.getActiveSpreadsheet()
      .toast(`✅ ดึงข้อมูลเสร็จ ${allNewRows.length} รายการ`, APP_NAME, 5);

    buildOwnerSummary();
    buildShipmentSummary();
  } finally {
    try { lock.releaseLock(); } catch (err) {}
  }
}

/**
 * fetchOneShipment_ — ดึงข้อมูล 1 Shipment จาก SCG API
 * @param {string} shipNo - Shipment Number
 * @param {string} cookie - Session Cookie
 * @return {Array[]} รายการ Row Arrays พร้อม Write
 */
function fetchOneShipment_(shipNo, cookie) {
  const payload = JSON.stringify({ shipmentNo: shipNo });

  const options = {
    method:      'POST',
    contentType: 'application/json',
    headers:     { Cookie: cookie },
    payload:     payload,
    muteHttpExceptions: true,
  };

  let response;
  let retries = 0;

  while (retries < APP_CONST.MAX_RETRIES) {
    try {
      response = UrlFetchApp.fetch(SCG_CONFIG.API_URL, options);
      break;
    } catch (err) {
      retries++;
      if (retries >= APP_CONST.MAX_RETRIES) throw err;
      Utilities.sleep(1500 * retries);
    }
  }

  const httpCode = response.getResponseCode();
  if (httpCode !== 200) {
    throw new Error(`HTTP ${httpCode} สำหรับ Shipment ${shipNo}`);
  }

  let jsonData;
  try {
    jsonData = JSON.parse(response.getContentText());
  } catch (e) {
    throw new Error(`Parse JSON ล้มเหลว Shipment ${shipNo}`);
  }

  const items = Array.isArray(jsonData) ? jsonData
              : (jsonData.data || jsonData.items || []);

  if (items.length === 0) return [];

  return items.map(item => buildDailyJobRow_(item, shipNo));
}

/**
 * buildDailyJobRow_ — แปลง JSON Item เป็น Row Array 29 คอลัมน์
 * ตรงตาม SCHEMA.DAILY_JOB และ DATA_IDX
 */
function buildDailyJobRow_(item, shipNo) {
  const row = new Array(SCHEMA.DAILY_JOB.length).fill('');

  row[DATA_IDX.JOB_ID]          = generateShortId('JB');
  row[DATA_IDX.PLAN_DELIVERY]    = item.planDeliveryDate  || item.deliveryDate  || '';
  row[DATA_IDX.INVOICE_NO]       = item.invoiceNo         || item.invoice_no    || '';
  row[DATA_IDX.SHIPMENT_NO]      = shipNo;
  row[DATA_IDX.DRIVER_NAME]      = item.driverName        || item.driver_name   || '';
  row[DATA_IDX.TRUCK_LICENSE]    = item.truckLicense      || item.truck         || '';
  row[DATA_IDX.CARRIER_CODE]     = item.carrierCode       || '';
  row[DATA_IDX.CARRIER_NAME]     = item.carrierName       || '';
  row[DATA_IDX.SOLD_TO_CODE]     = item.soldToCode        || item.sold_to       || '';
  row[DATA_IDX.SOLD_TO_NAME]     = item.soldToName        || item.customer      || '';
  row[DATA_IDX.SHIP_TO_NAME]     = item.shipToName        || item.customerName  || '';
  row[DATA_IDX.SHIP_TO_ADDR]     = item.shipToAddress     || item.address       || '';
  row[DATA_IDX.LATLNG_SCG]       = item.latLong           || item.latlng        || '';
  row[DATA_IDX.MATERIAL]         = item.materialName      || item.material      || '';
  row[DATA_IDX.QTY]              = Number(item.itemQuantity || item.qty || 0) || 0;
  row[DATA_IDX.QTY_UNIT]         = item.quantityUnit      || '';
  row[DATA_IDX.WEIGHT]           = Number(item.itemWeight || item.weight || 0) || 0;
  row[DATA_IDX.DELIVERY_NO]      = item.deliveryNo        || '';
  row[DATA_IDX.DEST_COUNT]       = item.destCount         || '';
  row[DATA_IDX.DEST_LIST]        = item.destList          || '';
  row[DATA_IDX.SCAN_STATUS]      = item.scanStatus        || 'PENDING';
  row[DATA_IDX.DELIVERY_STATUS]  = item.deliveryStatus    || '';
  row[DATA_IDX.EMAIL]            = item.email             || '';
  row[DATA_IDX.TOT_QTY]         = Number(item.totalQty || 0) || 0;
  row[DATA_IDX.TOT_WEIGHT]      = Number(item.totalWeight || 0) || 0;
  row[DATA_IDX.SCAN_INV]        = Number(item.scanInvoice || 0) || 0;
  row[DATA_IDX.LATLNG_ACTUAL]   = '';  // ยังว่าง — รอ Module 17 เติม
  row[DATA_IDX.OWNER_LABEL]     = item.ownerLabel         || '';
  row[DATA_IDX.SHOP_KEY]        = `${shipNo}|${row[DATA_IDX.SHIP_TO_NAME]}`;

  return row;
}

// ============================================================
// SECTION 2: applyMasterCoordinatesToDailyJob — เรียก Module 17
// ============================================================

/**
 * applyMasterCoordinatesToDailyJob — เติมพิกัดแท้ลง LatLong_Actual
 * [KEY CHANGE] ไม่ใช้ VLOOKUP แล้ว — เรียก findBestGeoByPersonPlace()
 *              จาก 17_SearchService.gs แทนทั้งหมด
 */
function applyMasterCoordinatesToDailyJob() {
  logInfo('ServiceSCG', 'applyMasterCoordinates: เรียก Module 17 SearchService');
  const stats = runLookupEnrichment();
  logInfo('ServiceSCG', `applyMasterCoordinates: เสร็จสิ้น (${JSON.stringify(stats)})`);
  return stats;
}

// ============================================================
// SECTION 3: checkIsEPOD — ตรวจสอบสถานะ E-POD
// [PRESERVE] ห้ามแตะ Logic เดิม
// ============================================================

/**
 * checkIsEPOD — ตรวจสอบว่า Invoice ผ่าน E-POD แล้วหรือยัง
 * อ่านจาก ScanStatus ของแถวใน ตารางงานประจำวัน
 * @param {number} rowIndex - Index 0-based ใน allData array
 * @param {Array[]} allData - ข้อมูลทั้งหมดจาก ตารางงานประจำวัน
 * @return {boolean}
 */
function checkIsEPOD(rowIndex, allData) {
  if (rowIndex < 0 || rowIndex >= allData.length) return false;
  const scanStatus = String(allData[rowIndex][DATA_IDX.SCAN_STATUS] || '').trim();
  return scanStatus === 'SCANNED' || scanStatus === 'POD';
}

// ============================================================
// SECTION 4: buildOwnerSummary — สรุปเจ้าของสินค้า
// [PRESERVE] ห้ามแตะ Logic เดิม
// ============================================================

/**
 * buildOwnerSummary — สร้างสรุปยอดแยกตาม SoldToName
 * เขียนลง สรุป_เจ้าของสินค้า
 */
function buildOwnerSummary() {
  const ss        = SpreadsheetApp.getActiveSpreadsheet();
  const dataSheet = ss.getSheetByName(SHEET.DAILY_JOB);
  const sumSheet  = ss.getSheetByName(SHEET.OWNER_SUMMARY);

  if (!dataSheet || !sumSheet) return;
  if (dataSheet.getLastRow() < 2) return;

  const allData   = dataSheet.getRange(2, 1, dataSheet.getLastRow() - 1,
                     SCHEMA.DAILY_JOB.length).getValues();

  // นับ Invoice และ EPOD แยกตาม SoldToName
  const ownerMap = {};

  allData.forEach((row, i) => {
    const ownerName = String(row[DATA_IDX.SOLD_TO_NAME] || '').trim();
    if (!ownerName) return;

    if (!ownerMap[ownerName]) {
      ownerMap[ownerName] = { invoiceCount: 0, epodCount: 0 };
    }
    ownerMap[ownerName].invoiceCount++;
    if (checkIsEPOD(i, allData)) ownerMap[ownerName].epodCount++;
  });

  // สร้าง Rows สำหรับ Write
  const now     = new Date();
  const sumRows = Object.keys(ownerMap).map((owner, idx) => [
    idx + 1,
    owner,
    '',
    ownerMap[owner].invoiceCount,
    ownerMap[owner].epodCount,
    now,
  ]);

  if (sumRows.length === 0) return;

  // ล้างข้อมูลเก่า (เฉพาะชีต Summary ไม่ใช่ Master)
  if (sumSheet.getLastRow() > 1) {
    sumSheet.deleteRows(2, sumSheet.getLastRow() - 1);
  }

  sumSheet.getRange(2, 1, sumRows.length, SCHEMA.OWNER_SUMMARY.length)
          .setValues(sumRows);

  logDebug('ServiceSCG', `buildOwnerSummary: ${sumRows.length} เจ้าของสินค้า`);
}

// ============================================================
// SECTION 5: buildShipmentSummary — สรุป Shipment
// [PRESERVE] ห้ามแตะ Logic เดิม
// ============================================================

/**
 * buildShipmentSummary — สร้างสรุปยอดแยกตาม ShipmentNo + TruckLicense
 * เขียนลง สรุป_Shipment
 */
function buildShipmentSummary() {
  const ss        = SpreadsheetApp.getActiveSpreadsheet();
  const dataSheet = ss.getSheetByName(SHEET.DAILY_JOB);
  const sumSheet  = ss.getSheetByName(SHEET.SHIPMENT_SUM);

  if (!dataSheet || !sumSheet) return;
  if (dataSheet.getLastRow() < 2) return;

  const allData   = dataSheet.getRange(2, 1, dataSheet.getLastRow() - 1,
                     SCHEMA.DAILY_JOB.length).getValues();
  const shipMap   = {};

  allData.forEach((row, i) => {
    const shipNo    = String(row[DATA_IDX.SHIPMENT_NO]  || '').trim();
    const truckLic  = String(row[DATA_IDX.TRUCK_LICENSE] || '').trim();
    if (!shipNo) return;

    const key = `${shipNo}_${truckLic}`;
    if (!shipMap[key]) {
      shipMap[key] = { shipNo, truckLic, invoiceCount: 0, epodCount: 0 };
    }
    shipMap[key].invoiceCount++;
    if (checkIsEPOD(i, allData)) shipMap[key].epodCount++;
  });

  const now     = new Date();
  const sumRows = Object.keys(shipMap).map(key => {
    const s = shipMap[key];
    return [key, s.shipNo, s.truckLic, '', s.invoiceCount, s.epodCount, now];
  });

  if (sumRows.length === 0) return;

  if (sumSheet.getLastRow() > 1) {
    sumSheet.deleteRows(2, sumSheet.getLastRow() - 1);
  }

  sumSheet.getRange(2, 1, sumRows.length, SCHEMA.SHIPMENT_SUMMARY.length)
          .setValues(sumRows);

  logDebug('ServiceSCG', `buildShipmentSummary: ${sumRows.length} Shipments`);
}

// ============================================================
// SECTION 6: Clear Functions
// ============================================================

/**
 * clearAllSCGSheets_UI — ล้างชีต Group 2 ทั้งหมด (ยืนยันก่อน)
 * เรียกผ่านเมนู
 */
function clearAllSCGSheets_UI() {
  const ui = SpreadsheetApp.getUi();

  const confirm = ui.alert(
    '🗑️ ยืนยันการล้างข้อมูล',
    'จะล้างข้อมูลในชีตต่อไปนี้:\n' +
    `  • ${SHEET.DAILY_JOB}\n` +
    `  • ${SHEET.OWNER_SUMMARY}\n` +
    `  • ${SHEET.SHIPMENT_SUM}\n\n` +
    '⚠️ Master Data (M_PERSON, M_PLACE ฯลฯ) จะไม่ถูกลบ\n' +
    'ดำเนินการต่อใช่ไหม?',
    ui.ButtonSet.YES_NO
  );

  if (confirm !== ui.Button.YES) return;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let cleared = 0;

  [SHEET.DAILY_JOB, SHEET.OWNER_SUMMARY, SHEET.SHIPMENT_SUM].forEach(name => {
    const sheet = ss.getSheetByName(name);
    if (sheet && sheet.getLastRow() > 1) {
      sheet.deleteRows(2, sheet.getLastRow() - 1);
      cleared++;
    }
  });

  logInfo('ServiceSCG', `clearAllSCGSheets_UI: ล้าง ${cleared} ชีต`);
  ui.alert(`✅ ล้างข้อมูล ${cleared} ชีตเรียบร้อย`);
}

/**
 * clearDailyJobLatLng — ล้างเฉพาะคอลัมน์ LatLong_Actual
 * ใช้ก่อนรัน applyMasterCoordinates ใหม่
 */
function clearDailyJobLatLng() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET.DAILY_JOB);
  if (!sheet || sheet.getLastRow() < 2) return;

  const totalRows   = sheet.getLastRow() - 1;
  const latActualCol = DATA_IDX.LATLNG_ACTUAL + 1;

  // ล้างเฉพาะคอลัมน์ LatLong_Actual
  sheet.getRange(2, latActualCol, totalRows, 1)
       .clearContent();

  // ล้างสีพื้นหลังทั้งแถว
  sheet.getRange(2, 1, totalRows, SCHEMA.DAILY_JOB.length)
       .setBackground(null);

  logInfo('ServiceSCG', `clearDailyJobLatLng: ล้าง ${totalRows} แถว`);
}
