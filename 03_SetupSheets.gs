/**
 * VERSION: 001
 * FILE: 03_SetupSheets.gs
 * LMDS V5.0 — Sheet Setup & System Logging
 * ===================================================
 * หน้าที่:
 *   1. สร้างชีตทั้งหมดพร้อม Header (ถ้ายังไม่มี)
 *   2. Patch Header ที่ขาดโดยเพิ่มต่อท้าย (RULE 2)
 *   3. ฟังก์ชัน Logging ใช้ทั่วระบบ (logInfo/logError/logDebug)
 * [RULE 4] ห้าม clearContent() / deleteRow() กับชีต Master
 *          ถ้าชีตมีอยู่แล้วและ Header ถูกต้อง → ข้ามไป
 * ===================================================
 */

// ============================================================
// SECTION 1: Entry Point
// ============================================================

/**
 * setupAllSheets — สร้างชีตทั้งหมดในระบบ
 * เรียกผ่านเมนู LMDS > ระบบ > สร้างชีตทั้งหมด
 */
function setupAllSheets() {
  const ui = SpreadsheetApp.getUi();

  const confirm = ui.alert(
    '🏗️ ยืนยันการสร้างชีต',
    'ระบบจะสร้างชีตที่ยังขาดอยู่ทั้งหมด\n' +
    '(ชีตที่มีอยู่แล้วและ Header ถูกต้อง จะไม่ถูกแตะต้อง)\n\n' +
    'ดำเนินการต่อใช่ไหม?',
    ui.ButtonSet.YES_NO
  );

  if (confirm !== ui.Button.YES) return;

  const ss      = SpreadsheetApp.getActiveSpreadsheet();
  const results = [];

  try {
    // สร้างทีละกลุ่ม — เรียงตามความสำคัญ
    results.push(...setupMasterSheets_(ss));
    results.push(...setupFactSheets_(ss));
    results.push(...setupSysSheets_(ss));
    results.push(...setupGroupTwoSheets_(ss));

    // สรุปผล
    const created = results.filter(r => r.action === 'CREATED').length;
    const patched = results.filter(r => r.action === 'PATCHED').length;
    const skipped = results.filter(r => r.action === 'SKIPPED').length;

    logInfo('SetupSheets',
      `Setup สำเร็จ — สร้าง:${created} Patch:${patched} ข้าม:${skipped}`);

    ui.alert(
      '✅ Setup เสร็จสิ้น!\n\n' +
      `  🆕 สร้างใหม่:  ${created} ชีต\n` +
      `  🔧 Patch Header: ${patched} ชีต\n` +
      `  ⏭️ ข้ามไป:     ${skipped} ชีต`
    );

  } catch (err) {
    logError('SetupSheets', 'Setup ล้มเหลว: ' + err.message);
    ui.alert('❌ Setup ล้มเหลว:\n' + err.message);
  }
}

// ============================================================
// SECTION 2: กลุ่ม 1 — Master Data Sheets
// ============================================================

/**
 * setupMasterSheets_ — สร้าง M_PERSON, M_PLACE, M_GEO_POINT, M_DESTINATION
 * รวม Alias tables ด้วย
 */
function setupMasterSheets_(ss) {
  const results = [];

  // M_PERSON — สีเขียวอ่อน (Master บุคคล)
  results.push(createSheetIfMissing_(
    ss, SHEET.M_PERSON, SCHEMA.M_PERSON, '#d9ead3'
  ));

  // M_PERSON_ALIAS — สีเขียวอ่อนกว่า
  results.push(createSheetIfMissing_(
    ss, SHEET.M_PERSON_ALIAS, SCHEMA.M_PERSON_ALIAS, '#e8f5e9'
  ));

  // M_PLACE — สีฟ้าอ่อน (Master สถานที่)
  results.push(createSheetIfMissing_(
    ss, SHEET.M_PLACE, SCHEMA.M_PLACE, '#c9daf8'
  ));

  // M_PLACE_ALIAS — สีฟ้าอ่อนกว่า
  results.push(createSheetIfMissing_(
    ss, SHEET.M_PLACE_ALIAS, SCHEMA.M_PLACE_ALIAS, '#ddeeff'
  ));

  // M_GEO_POINT — สีเหลืองอ่อน (Master พิกัด GPS)
  results.push(createSheetIfMissing_(
    ss, SHEET.M_GEO_POINT, SCHEMA.M_GEO_POINT, '#fff2cc'
  ));

  // M_DESTINATION — สีส้มอ่อน (Holy Trinity: Person+Place+Geo)
  results.push(createSheetIfMissing_(
    ss, SHEET.M_DESTINATION, SCHEMA.M_DESTINATION, '#fce5cd'
  ));

  return results;
}

// ============================================================
// SECTION 3: กลุ่ม 1 — Fact Table & Review Queue
// ============================================================

/**
 * setupFactSheets_ — สร้าง FACT_DELIVERY และ Q_REVIEW
 */
function setupFactSheets_(ss) {
  const results = [];

  // FACT_DELIVERY — สีเทาอ่อน (Fact Table)
  results.push(createSheetIfMissing_(
    ss, SHEET.FACT_DELIVERY, SCHEMA.FACT_DELIVERY, '#f3f3f3'
  ));

  // Q_REVIEW — สีส้มอ่อน (Review Queue)
  const reviewResult = createSheetIfMissing_(
    ss, SHEET.Q_REVIEW, SCHEMA.Q_REVIEW, '#fce5cd'
  );
  results.push(reviewResult);

  // เพิ่ม Dropdown เฉพาะชีตที่เพิ่งสร้างใหม่
  if (reviewResult.action === 'CREATED' || reviewResult.action === 'PATCHED') {
    setupReviewDropdowns_(ss);
  }

  return results;
}

// ============================================================
// SECTION 4: กลุ่ม 1 — System Support Sheets
// ============================================================

/**
 * setupSysSheets_ — สร้าง SYS_LOG, SYS_CONFIG, SYS_TH_GEO,
 *                   RPT_DATA_QUALITY, MAPS_CACHE
 */
function setupSysSheets_(ss) {
  const results = [];

  // SYS_LOG — บันทึก Log ระบบ
  results.push(createSheetIfMissing_(
    ss, SHEET.SYS_LOG, SCHEMA.SYS_LOG, '#efefef'
  ));

  // SYS_CONFIG — ค่า Config Key-Value
  const cfgResult = createSheetIfMissing_(
    ss, SHEET.SYS_CONFIG, SCHEMA.SYS_CONFIG, '#efefef'
  );
  results.push(cfgResult);

  // เติม Default Config ถ้าเพิ่งสร้างใหม่
  if (cfgResult.action === 'CREATED') {
    seedDefaultConfig_(ss);
  }

  // SYS_TH_GEO — ฐานข้อมูลภูมิศาสตร์ไทย (ต้อง Import เองภายหลัง)
  results.push(createSheetIfMissing_(
    ss, SHEET.SYS_TH_GEO, SCHEMA.SYS_TH_GEO, '#e8eaf6'
  ));

  // RPT_DATA_QUALITY — รายงาน Data Quality
  results.push(createSheetIfMissing_(
    ss, SHEET.RPT_QUALITY, SCHEMA.RPT_DATA_QUALITY, '#efefef'
  ));

  // MAPS_CACHE — Cache ผล Google Maps (Persistent)
  results.push(createSheetIfMissing_(
    ss, SHEET.MAPS_CACHE, SCHEMA.MAPS_CACHE, '#efefef'
  ));

  return results;
}

// ============================================================
// SECTION 5: กลุ่ม 2 — Daily Ops Sheets
// ============================================================

/**
 * setupGroupTwoSheets_ — สร้างชีตฝั่ง SCG Operations
 */
function setupGroupTwoSheets_(ss) {
  const results = [];

  // ตารางงานประจำวัน — สีฟ้า (พระเอกฝั่ง Group 2)
  results.push(createSheetIfMissing_(
    ss, SHEET.DAILY_JOB, SCHEMA.DAILY_JOB, '#cfe2f3'
  ));

  // Input — รับ Shipment No. และ Cookie
  results.push(createSheetIfMissing_(
    ss, SHEET.INPUT, SCHEMA.INPUT, '#ffffff'
  ));

  // ข้อมูลพนักงาน
  results.push(createSheetIfMissing_(
    ss, SHEET.EMPLOYEE, SCHEMA.EMPLOYEE, '#ffffff'
  ));

  // สรุป_เจ้าของสินค้า
  results.push(createSheetIfMissing_(
    ss, SHEET.OWNER_SUMMARY, SCHEMA.OWNER_SUMMARY, '#fce5cd'
  ));

  // สรุป_Shipment
  results.push(createSheetIfMissing_(
    ss, SHEET.SHIPMENT_SUM, SCHEMA.SHIPMENT_SUMMARY, '#fce5cd'
  ));

  return results;
}

// ============================================================
// SECTION 6: Core Helper — สร้าง/ตรวจสอบชีต
// ============================================================

/**
 * createSheetIfMissing_ — สร้างชีตพร้อม Header ถ้ายังไม่มี
 * Logic:
 *   - มีอยู่ + Header ครบ → SKIPPED
 *   - มีอยู่ + Header ไม่ครบ → PATCHED (เพิ่มต่อท้าย)
 *   - ไม่มี → CREATED
 * [RULE 2] เพิ่ม Column ได้เฉพาะต่อท้าย ห้ามขยับของเดิม
 *
 * @param {Spreadsheet} ss
 * @param {string} sheetName - ชื่อชีต
 * @param {string[]} headers - Header Array จาก SCHEMA
 * @param {string} headerBg - สีพื้นหลัง Header row
 * @return {{ name: string, action: string }}
 */
function createSheetIfMissing_(ss, sheetName, headers, headerBg) {
  const existing = ss.getSheetByName(sheetName);

  if (existing) {
    // ชีตมีอยู่แล้ว — ตรวจสอบ Header
    const validation = validateSheetHeaders(existing, headers);

    if (validation.isValid) {
      if (validation.orderMismatch) {
        logWarn('SetupSheets', `Header order mismatch detected: ${sheetName}`);
      }
      console.log(`[Setup] SKIPPED: ${sheetName}`);
      return { name: sheetName, action: 'SKIPPED' };
    }

    if (validation.orderMismatch) {
      logWarn('SetupSheets', `Header order mismatch detected: ${sheetName} (manual review recommended)`);
    }

    // Header ไม่ครบ — เพิ่มต่อท้าย (ห้ามขยับของเดิม)
    appendMissingHeaders_(existing, validation.missing);
    console.log(`[Setup] PATCHED: ${sheetName} +${validation.missing.length} cols`);
    return { name: sheetName, action: 'PATCHED' };
  }

  // ชีตไม่มี — สร้างใหม่
  const newSheet = ss.insertSheet(sheetName);
  writeHeaderRow_(newSheet, headers, headerBg);
  console.log(`[Setup] CREATED: ${sheetName} (${headers.length} cols)`);
  return { name: sheetName, action: 'CREATED' };
}

/**
 * writeHeaderRow_ — เขียน Header row และจัดรูปแบบ
 * @param {Sheet} sheet
 * @param {string[]} headers
 * @param {string} bgColor - สีพื้นหลัง
 */
function writeHeaderRow_(sheet, headers, bgColor) {
  const range = sheet.getRange(1, 1, 1, headers.length);
  range.setValues([headers]);
  range.setFontWeight('bold');
  range.setBackground(bgColor || '#efefef');
  range.setFontColor('#000000');
  range.setWrap(false);
  range.setBorder(
    false, false, true, false, false, false,
    '#cccccc',
    SpreadsheetApp.BorderStyle.SOLID
  );
  sheet.setFrozenRows(1);
  sheet.setColumnWidths(1, headers.length, 130);
}

/**
 * appendMissingHeaders_ — เพิ่ม Header ที่ขาดต่อท้ายคอลัมน์เดิม
 * [RULE 2] ห้ามขยับคอลัมน์เดิม — เพิ่มต่อท้ายเท่านั้น
 * คอลัมน์ใหม่จะมีพื้นหลังสีเหลืองเพื่อแจ้งให้รู้ว่าเพิ่งเพิ่ม
 *
 * @param {Sheet} sheet
 * @param {string[]} missingCols - ชื่อ Column ที่ต้องเพิ่ม
 */
function appendMissingHeaders_(sheet, missingCols) {
  const lastCol = sheet.getLastColumn();

  missingCols.forEach((colName, i) => {
    const targetCol  = lastCol + i + 1;
    const headerCell = sheet.getRange(1, targetCol);
    headerCell.setValue(colName);
    headerCell.setFontWeight('bold');
    headerCell.setBackground('#fff2cc'); // สีเหลือง = คอลัมน์ที่เพิ่งเพิ่ม
    sheet.setColumnWidth(targetCol, 130);
  });
}

// ============================================================
// SECTION 7: Dropdown Setup
// ============================================================

/**
 * setupReviewDropdowns_ — ตั้ง Data Validation Dropdown ใน Q_REVIEW
 * คอลัมน์ status และ decision
 */
function setupReviewDropdowns_(ss) {
  const sheet = ss.getSheetByName(SHEET.Q_REVIEW);
  if (!sheet) return;

  const maxRows = 1000; // จำนวนแถวที่ตั้ง Dropdown

  // Dropdown: status (col index 18 → col 19)
  const statusCol  = REVIEW_IDX.STATUS + 1;
  const statusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(
      ['Pending', 'In_Review', 'Done', 'Escalated'],
      true
    )
    .setAllowInvalid(false)
    .build();
  sheet.getRange(2, statusCol, maxRows, 1).setDataValidation(statusRule);

  // Dropdown: decision (col index 21 → col 22)
  const decisionCol  = REVIEW_IDX.DECISION + 1;
  const decisionRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(
      ['CONFIRM_AUTO_MATCH', 'MERGE_TO_CANDIDATE',
       'CREATE_NEW', 'REJECT', 'ESCALATE'],
      true
    )
    .setAllowInvalid(false)
    .build();
  sheet.getRange(2, decisionCol, maxRows, 1).setDataValidation(decisionRule);

  console.log('[Setup] Q_REVIEW Dropdowns ตั้งค่าเรียบร้อย');
}

// ============================================================
// SECTION 8: Default Config Seeding
// ============================================================

/**
 * seedDefaultConfig_ — เติมค่า Config เริ่มต้นใน SYS_CONFIG
 * เรียกเฉพาะเมื่อสร้างชีตใหม่ครั้งแรก
 */
function seedDefaultConfig_(ss) {
  const sheet = ss.getSheetByName(SHEET.SYS_CONFIG);
  if (!sheet) return;

  const now      = new Date();
  const defaults = [
    ['PIPELINE_BATCH_LIMIT', '50',
     'จำนวนแถวต่อ Batch ใน MatchEngine', now],
    ['GEO_RADIUS_M', '50',
     'รัศมี GPS Matching (เมตร)', now],
    ['THRESHOLD_AUTO', '90',
     'คะแนนขั้นต่ำสำหรับ Auto Match', now],
    ['THRESHOLD_REVIEW', '70',
     'คะแนนขั้นต่ำสำหรับส่ง Q_REVIEW', now],
    ['THRESHOLD_IGNORE', '50',
     'คะแนนต่ำกว่านี้ให้ Ignore / ไม่ใช้เป็น candidate', now],
    ['CACHE_TTL_SEC', '21600',
     'อายุ Cache Service (วินาที) = 6 ชม.', now],
    ['LOG_LEVEL', 'INFO',
     'ระดับ Log: DEBUG / INFO / WARN / ERROR', now],
    ['SYSTEM_VERSION', APP_VERSION,
     'เวอร์ชันปัจจุบันของระบบ LMDS', now],
    ['SCHEMA_VERSION', SCHEMA_VERSION,
     'เวอร์ชันปัจจุบันของ schema', now],
    ['AI_MODEL', 'gemini-1.5-flash',
     'Gemini Model ที่ใช้', now],
    ['AI_BATCH_SIZE', '20',
     'จำนวน Record ต่อ Batch ที่ส่ง AI', now],
    ['SEARCH_WRITE_BATCH', '200',
     'จำนวนแถวต่อรอบสำหรับ setValues/setBackgrounds ใน SearchService', now],
    ['MAX_SHIPMENT_FETCH', '200',
     'เพดาน Shipment ต่อการดึง SCG API หนึ่งครั้ง', now],
    ['MAX_LOOKUP_ROWS', '5000',
     'เพดานจำนวนแถว DAILY_JOB ต่อการ enrich หนึ่งครั้ง', now],
  ];

  sheet.getRange(2, 1, defaults.length, 4).setValues(defaults);
  sheet.getRange(2, 4, defaults.length, 1)
       .setNumberFormat('dd/mm/yyyy HH:mm');

  console.log(`[Setup] SYS_CONFIG: เติม Default ${defaults.length} รายการ`);
}

// ============================================================
// SECTION 9: System Logging (ใช้ทั่วระบบทุก Module)
// ============================================================

/**
 * logInfo — บันทึก Log ระดับ INFO
 * @param {string} module - ชื่อ Module ที่เรียก
 * @param {string} message - ข้อความ
 */
function logInfo(module, message) {
  writeLog_('INFO', module, message, '');
}

/**
 * logWarn — บันทึก Log ระดับ WARN
 * @param {string} module
 * @param {string} message
 */
function logWarn(module, message) {
  writeLog_('WARN', module, message, '');
  console.warn(`[${module}] ${message}`);
}

/**
 * logError — บันทึก Log ระดับ ERROR พร้อม console.error
 * @param {string} module
 * @param {string} message
 */
function logError(module, message) {
  writeLog_('ERROR', module, message, '');
  console.error(`[${module}] ERROR: ${message}`);
}

/**
 * logDebug — บันทึก Log ระดับ DEBUG (ใส่รายละเอียดเพิ่มเติมได้)
 * @param {string} module
 * @param {string} message
 * @param {any} details - ข้อมูลเสริม (Optional)
 */
function logDebug(module, message, details) {
  const detailStr = details ? JSON.stringify(details) : '';
  writeLog_('DEBUG', module, message, detailStr);
}

/**
 * writeLog_ — เขียนลง SYS_LOG sheet
 * [RULE 6] ใช้ appendRow (ไม่ใช้ batch เพราะ Log เป็น Sequential)
 * [RULE 7] ใช้ try-catch ป้องกัน Log ล้มเหลวทำให้ Main Logic พัง
 *
 * @param {string} level - DEBUG/INFO/WARN/ERROR
 * @param {string} module - ชื่อ Module
 * @param {string} message - ข้อความ
 * @param {string} details - รายละเอียดเพิ่มเติม
 */
function writeLog_(level, module, message, details) {
  try {
    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET.SYS_LOG);
    if (!sheet) return; // ถ้า SYS_LOG ยังไม่มี ให้ข้ามไป

    const logId = Utilities.getUuid().substring(0, 8).toUpperCase();
    sheet.appendRow([logId, new Date(), module, level, message, details]);

  } catch (logErr) {
    // ห้าม throw error จาก logging เพื่อไม่ให้รบกวน Main Logic
    console.error('[writeLog_] ล้มเหลว: ' + logErr.message);
  }
}

/**
 * clearOldLogs — ลบ Log ที่เก่าเกิน N วัน (Admin Tool)
 * เรียกผ่าน Script Editor โดยตรง ไม่ได้อยู่ในเมนู
 * @param {number} keepDays - จำนวนวันที่เก็บ Log ไว้ (default 30)
 */
function clearOldLogs(keepDays) {
  const days      = keepDays || 30;
  const cutoff    = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET.SYS_LOG);
  if (!sheet || sheet.getLastRow() < 2) return;

  const data      = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  let deleteCount = 0;

  // วนจากล่างขึ้นบนเพื่อไม่ให้ Index เพี้ยน
  for (let i = data.length - 1; i >= 0; i--) {
    const logDate = new Date(data[i][1]);
    if (logDate < cutoff) {
      sheet.deleteRow(i + 2); // +2 เพราะ data เริ่มจาก row 2
      deleteCount++;
    }
  }

  console.log(`[clearOldLogs] ลบ Log เก่า ${deleteCount} รายการ (เก่ากว่า ${days} วัน)`);
}
