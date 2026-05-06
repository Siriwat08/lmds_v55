/**
 * VERSION: 001
 * FILE: 11_TransactionService.gs
 * LMDS V5.0 — FACT_DELIVERY Transaction Service
 * ===================================================
 * หน้าที่: เขียน/อ่าน FACT_DELIVERY (Fact Table หลัก)
 *          upsertFactDelivery เรียกจาก executeDecision
 *          หลัง Auto Match หรือ Create New เสร็จ
 * ===================================================
 */

// ============================================================
// SECTION 1: upsertFactDelivery — บันทึก Transaction
// ============================================================

/**
 * upsertFactDelivery — เพิ่มหรืออัปเดต Record ใน FACT_DELIVERY
 * ถ้า Invoice ซ้ำ → อัปเดต; ถ้าใหม่ → เพิ่มแถว
 * [RULE 6] ใช้ appendRow สำหรับ Insert ใหม่
 * @param {Object} srcObj      - Source Record
 * @param {string} personId
 * @param {string} placeId
 * @param {string} geoId
 * @param {string} destId
 * @param {Object} decision    - ผลจาก makeMatchDecision
 * @return {string} tx_id
 */
function upsertFactDelivery(srcObj, personId, placeId, geoId, destId, decision) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET.FACT_DELIVERY);
  const now   = new Date();

  // ตรวจสอบว่า Invoice นี้มีใน FACT แล้วหรือยัง
  const existingRow = findFactRowByInvoice_(sheet, srcObj.invoiceNo);

  // หา Resolved Lat/Lng จาก Geo Point ที่ Match ได้
  const resolvedLat = geoId ? getGeoLatLng_(geoId).lat : srcObj.rawLat;
  const resolvedLng = geoId ? getGeoLatLng_(geoId).lng : srcObj.rawLng;

  if (existingRow > 0) {
    // Update แถวที่มีอยู่แล้ว
    const updateRange = sheet.getRange(existingRow, 1, 1, SCHEMA.FACT_DELIVERY.length);
    const rowData     = updateRange.getValues()[0];

    rowData[FACT_IDX.PERSON_ID]    = personId    || rowData[FACT_IDX.PERSON_ID];
    rowData[FACT_IDX.PLACE_ID]     = placeId     || rowData[FACT_IDX.PLACE_ID];
    rowData[FACT_IDX.GEO_ID]       = geoId       || rowData[FACT_IDX.GEO_ID];
    rowData[FACT_IDX.DEST_ID]      = destId      || rowData[FACT_IDX.DEST_ID];
    rowData[FACT_IDX.MATCH_STATUS] = decision.action;
    rowData[FACT_IDX.MATCH_CONF]   = decision.confidence;
    rowData[FACT_IDX.MATCH_REASON] = decision.reason;
    rowData[FACT_IDX.MATCH_ACTION] = decision.action;
    rowData[FACT_IDX.RESOLVED_LAT] = resolvedLat;
    rowData[FACT_IDX.RESOLVED_LNG] = resolvedLng;
    rowData[FACT_IDX.UPDATED_AT]   = now;

    updateRange.setValues([rowData]);
    return String(rowData[FACT_IDX.TX_ID]);
  }

  // Insert แถวใหม่
  const newTxId = 'TX' + Utilities.getUuid().replace(/-/g, '').substring(0, 10)
                                            .toUpperCase();

  const newRow = new Array(SCHEMA.FACT_DELIVERY.length).fill('');

  newRow[FACT_IDX.TX_ID]         = newTxId;
  newRow[FACT_IDX.SOURCE_SHEET]  = srcObj.sourceSheet;
  newRow[FACT_IDX.SOURCE_ROW]    = srcObj.sourceRow;
  newRow[FACT_IDX.SOURCE_REC_ID] = srcObj.invoiceNo;
  newRow[FACT_IDX.DELIVERY_DATE] = srcObj.deliveryDate;    // ✅ index 4
  newRow[FACT_IDX.DELIVERY_TIME] = srcObj.deliveryTime;
  newRow[FACT_IDX.INVOICE_NO]    = srcObj.invoiceNo;
  newRow[FACT_IDX.SHIPMENT_NO]   = srcObj.shipmentNo;
  newRow[FACT_IDX.DRIVER_NAME]   = srcObj.driverName;
  newRow[FACT_IDX.TRUCK_LICENSE] = srcObj.truckLicense;
  newRow[FACT_IDX.CARRIER_CODE]  = srcObj.carrierCode;
  newRow[FACT_IDX.CARRIER_NAME]  = srcObj.carrierName;
  newRow[FACT_IDX.SOLD_TO_CODE]  = srcObj.soldToCode;
  newRow[FACT_IDX.SOLD_TO_NAME]  = srcObj.soldToName;
  newRow[FACT_IDX.SHIP_TO_NAME]  = srcObj.rawPersonName;
  newRow[FACT_IDX.PERSON_ID]     = personId  || '';
  newRow[FACT_IDX.PLACE_ID]      = placeId   || '';
  newRow[FACT_IDX.GEO_ID]        = geoId     || '';        // ✅ index 17
  newRow[FACT_IDX.DEST_ID]       = destId    || '';
  newRow[FACT_IDX.WAREHOUSE]     = srcObj.warehouse;
  newRow[FACT_IDX.RAW_LAT]       = srcObj.rawLat;
  newRow[FACT_IDX.RAW_LNG]       = srcObj.rawLng;
  newRow[FACT_IDX.MATCH_STATUS]  = decision.action;
  newRow[FACT_IDX.MATCH_CONF]    = decision.confidence;
  newRow[FACT_IDX.MATCH_REASON]  = decision.reason;
  newRow[FACT_IDX.MATCH_ACTION]  = decision.action;
  newRow[FACT_IDX.RESOLVED_LAT]  = resolvedLat;
  newRow[FACT_IDX.RESOLVED_LNG]  = resolvedLng;
  newRow[FACT_IDX.CREATED_AT]    = now;
  newRow[FACT_IDX.UPDATED_AT]    = now;
  newRow[FACT_IDX.RECORD_STATUS] = APP_CONST.STATUS_ACTIVE;

  sheet.appendRow(newRow);
  return newTxId;
}

/**
 * findFactRowByInvoice_ — หาแถวใน FACT_DELIVERY ด้วย Invoice No.
 * @param {Sheet} sheet
 * @param {string} invoiceNo
 * @return {number} row number (1-based) หรือ 0 ถ้าไม่พบ
 */
function findFactRowByInvoice_(sheet, invoiceNo) {
  if (!sheet || sheet.getLastRow() < 2 || !invoiceNo) return 0;

  const invoiceCol = FACT_IDX.INVOICE_NO + 1;
  const data = sheet.getRange(2, invoiceCol,
                sheet.getLastRow() - 1, 1).getValues();

  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0]).trim() === String(invoiceNo).trim()) {
      return i + 2; // แถว 1-based (header คือแถว 1)
    }
  }
  return 0;
}

/**
 * getGeoLatLng_ — ดึง Lat/Lng จาก M_GEO_POINT ตาม geoId
 * @param {string} geoId
 * @return {{ lat: number, lng: number }}
 */
function getGeoLatLng_(geoId) {
  const allGeos = loadAllGeos_();
  const geo     = allGeos.find(g => g.geoId === geoId);
  return geo ? { lat: geo.lat, lng: geo.lng } : { lat: 0, lng: 0 };
}
