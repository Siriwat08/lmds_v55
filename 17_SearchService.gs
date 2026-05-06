/**
 * VERSION: 001
 * FILE: 17_SearchService.gs
 * LMDS V5.0 — Search Service (The Bridger)
 * ===================================================
 * หน้าที่: "นักสืบหาพิกัด" — รับชื่อดิบจาก Group 2
 *          ค้นหาใน Master Data (Group 1) แล้วคืนพิกัดแท้
 *
 * Flow:
 *   Group 2 ส่ง ShipToName + ShipToAddress (ดิบ)
 *   → findBestGeoByPersonPlace()
 *   → Normalize → Match Person → Match Place
 *   → ค้นหา M_DESTINATION
 *   → คืน { lat, lng, status, confidence }
 *
 * Status ที่คืน:
 *   FOUND           ≥95% เจอตรงใน M_DESTINATION
 *   FOUND_DOMINANT  มีหลายพิกัด เลือก usageCount สูงสุด
 *   FOUND_FALLBACK  เจอแค่บุคคล — ใช้พิกัดที่คนนั้นไปบ่อยสุด
 *   SCG_API_FALLBACK ไม่เจอเลย — แนะนำให้ใช้ LatLong_SCG แทน
 *   NOT_FOUND       ไม่มีข้อมูลในระบบเลย
 * ===================================================
 */

// ============================================================
// SECTION 1: findBestGeoByPersonPlace — ฟังก์ชันหลัก
// ============================================================

/**
 * findBestGeoByPersonPlace — ค้นหาพิกัดที่ดีที่สุดสำหรับคู่ Person+Place
 * เรียกจาก 18_ServiceSCG.gs ใน applyMasterCoordinatesToDailyJob
 *
 * @param {string} rawPerson  - ShipToName ดิบ เช่น "นาย สมชาย ใจดี"
 * @param {string} rawPlace   - ShipToAddress ดิบ เช่น "123 ถ.รัชดา ลาดยาว"
 * @param {string} scgLatLng  - LatLong_SCG จาก API (Fallback สุดท้าย)
 * @return {{
 *   lat:        number,
 *   lng:        number,
 *   status:     string,
 *   confidence: number,
 *   destId:     string,
 *   reason:     string
 * }}
 */
function findBestGeoByPersonPlace(rawPerson, rawPlace, scgLatLng) {
  // --- Step 1: Normalize ชื่อดิบ ---
  const normPerson = normalizePersonNameFull(rawPerson);
  const normPlace  = normalizePlaceName(rawPlace);
  const cleanName  = normPerson.cleanName;
  const cleanPlace = normPlace.cleanPlace;

  // --- Step 2: Match บุคคล ---
  const personResult = resolvePerson(rawPerson);
  const personId     = personResult.personId;

  // --- Step 3: Match สถานที่ ---
  const placeResult  = resolvePlace(rawPlace, rawPlace);
  const placeId      = placeResult.placeId;

  // --- Step 4: ค้นหา M_DESTINATION ตาม Tier ---

  // Tier A: มีทั้ง Person + Place → เจอตรงเป๊ะ
  if (personId && placeId) {
    const dests = getDestsByPersonAndPlace(personId, placeId);
    if (dests.length === 1) {
      return buildSearchResult_(
        dests[0].lat, dests[0].lng,
        'FOUND', 98, dests[0].destId,
        `Person+Place exact match`
      );
    }
    if (dests.length > 1) {
      // หลายพิกัด — เลือก usageCount สูงสุด
      const dominant = dests[0]; // loadAllDestinations_ เรียงตาม usageCount แล้ว
      return buildSearchResult_(
        dominant.lat, dominant.lng,
        'FOUND_DOMINANT', 92, dominant.destId,
        `Person+Place — ${dests.length} พิกัด เลือก usage#${dominant.usageCount}`
      );
    }
  }

  // Tier B: มีแค่ Place → เจอพิกัดที่ Place นี้
  if (placeId && !personId) {
    const dests = getDestsByPlaceId(placeId);
    if (dests.length > 0) {
      const dominant = dests[0];
      return buildSearchResult_(
        dominant.lat, dominant.lng,
        'FOUND_DOMINANT', 85, dominant.destId,
        `Place-only match — ${dests.length} พิกัด`
      );
    }
  }

  // Tier C: มีแค่ Person → ใช้พิกัดที่คนนั้นไปบ่อยสุด (Fallback)
  if (personId && !placeId) {
    const dests = getDestsByPersonId(personId);
    if (dests.length > 0) {
      const frequent = dests[0]; // usageCount สูงสุดคือที่แรก
      return buildSearchResult_(
        frequent.lat, frequent.lng,
        'FOUND_FALLBACK', 70, frequent.destId,
        `Person-only fallback — ไปบ่อยสุด ${frequent.usageCount} ครั้ง`
      );
    }
  }

  // Tier D: ใช้ LatLong_SCG จาก API เป็น Fallback
  if (scgLatLng) {
    const parsed = parseLatLng(scgLatLng);
    if (parsed && isValidLatLng(parsed.lat, parsed.lng)) {
      return buildSearchResult_(
        parsed.lat, parsed.lng,
        'SCG_API_FALLBACK', 50, '',
        'ใช้พิกัดจาก SCG API (ยังไม่ verified)'
      );
    }
  }

  // Tier E: ไม่พบเลย
  return buildSearchResult_(
    0, 0, 'NOT_FOUND', 0, '',
    `ไม่พบข้อมูล — Person:${cleanName || '?'} Place:${cleanPlace || '?'}`
  );
}

/**
 * buildSearchResult_ — สร้าง Object ผลลัพธ์มาตรฐาน
 */
function buildSearchResult_(lat, lng, status, confidence, destId, reason) {
  return {
    lat:        lat,
    lng:        lng,
    status:     status,
    confidence: confidence,
    destId:     destId,
    reason:     reason,
  };
}

// ============================================================
// SECTION 2: runLookupEnrichment — Batch Process ทั้งชีต
// ============================================================

/**
 * runLookupEnrichment — วนทุกแถวใน ตารางงานประจำวัน
 * ค้นหาพิกัดและเติมลง LatLong_Actual (col index 26)
 * เรียกจาก 18_ServiceSCG หรือ Menu โดยตรง
 */
function runLookupEnrichment() {
  const ss        = SpreadsheetApp.getActiveSpreadsheet();
  const sheet     = ss.getSheetByName(SHEET.DAILY_JOB);

  if (!sheet || sheet.getLastRow() < 2) {
    logWarn('SearchService', 'ตารางงานประจำวัน ว่างอยู่');
    return { processed: 0, found: 0, fallback: 0, scg: 0, notFound: 0 };
  }

  const totalRows = sheet.getLastRow() - 1;
  const maxRows = Math.min(totalRows, Number(getRuntimeConfigNumber_('MAX_LOOKUP_ROWS', AI_CONFIG.MAX_LOOKUP_ROWS || 5000)) || totalRows);
  const allData = sheet.getRange(2, 1, maxRows, SCHEMA.DAILY_JOB.length).getValues();
  const employeeMap = loadEmployeeEmailMap_();
  const memo = {};

  const latActualArr = [];
  const emailArr = [];
  const bgMatrix = [];

  let countFound = 0;
  let countFallback = 0;
  let countScg = 0;
  let countNotFound = 0;

  allData.forEach(row => {
    const rawPerson = toSafeString_(row[DATA_IDX.SHIP_TO_NAME]);
    const rawPlace = toSafeString_(row[DATA_IDX.SHIP_TO_ADDR]);
    const scgLatLng = toSafeString_(row[DATA_IDX.LATLNG_SCG]);
    const existingLL = toSafeString_(row[DATA_IDX.LATLNG_ACTUAL]);
    const driverName = toSafeString_(row[DATA_IDX.DRIVER_NAME]);
    const existingEmail = toSafeString_(row[DATA_IDX.EMAIL]);

    const email = existingEmail || employeeMap[normalizeJoinKey_(driverName)] || '';
    emailArr.push([email]);

    if (existingLL && existingLL.includes(',')) {
      latActualArr.push([existingLL]);
      bgMatrix.push(new Array(SCHEMA.DAILY_JOB.length).fill('#ffffff'));
      return;
    }

    const memoKey = `${normalizeJoinKey_(rawPerson)}|${normalizeJoinKey_(rawPlace)}|${scgLatLng}`;
    if (!memo[memoKey]) {
      memo[memoKey] = findBestGeoByPersonPlace(rawPerson, rawPlace, scgLatLng);
    }
    const result = memo[memoKey];

    let outputLatLng = '';
    let bgColor = APP_CONST.COLOR_NOT_FOUND;

    switch (result.status) {
      case 'FOUND':
      case 'FOUND_DOMINANT':
        outputLatLng = `${result.lat},${result.lng}`;
        bgColor = APP_CONST.COLOR_FOUND;
        countFound++;
        break;
      case 'FOUND_FALLBACK':
        outputLatLng = `${result.lat},${result.lng}`;
        bgColor = APP_CONST.COLOR_FALLBACK;
        countFallback++;
        break;
      case 'SCG_API_FALLBACK':
        outputLatLng = `${result.lat},${result.lng}`;
        bgColor = APP_CONST.COLOR_BRANCH;
        countScg++;
        break;
      case 'NOT_FOUND':
      default:
        countNotFound++;
        break;
    }

    latActualArr.push([outputLatLng]);
    bgMatrix.push(new Array(SCHEMA.DAILY_JOB.length).fill(bgColor));
  });

  const batchSize = Number(getRuntimeConfigNumber_('SEARCH_WRITE_BATCH', AI_CONFIG.SEARCH_WRITE_BATCH || 200)) || 200;
  chunkArray_(Array.from({ length: allData.length }, (_, i) => i), batchSize).forEach(chunk => {
    const start = chunk[0];
    const len = chunk.length;
    sheet.getRange(2 + start, DATA_IDX.LATLNG_ACTUAL + 1, len, 1).setValues(latActualArr.slice(start, start + len));
    sheet.getRange(2 + start, DATA_IDX.EMAIL + 1, len, 1).setValues(emailArr.slice(start, start + len));
    sheet.getRange(2 + start, 1, len, SCHEMA.DAILY_JOB.length).setBackgrounds(bgMatrix.slice(start, start + len));
  });

  logInfo('SearchService',
    `runLookupEnrichment เสร็จ — Rows:${allData.length} ` +
    `Found:${countFound} Fallback:${countFallback} ` +
    `SCG:${countScg} NotFound:${countNotFound}`
  );

  SpreadsheetApp.getActiveSpreadsheet().toast(
    `✅ จับคู่พิกัดเสร็จ\n` +
    `เจอ: ${countFound} | Fallback: ${countFallback} | ` +
    `SCG: ${countScg} | ไม่พบ: ${countNotFound}`,
    APP_NAME, 8
  );

  return {
    processed: allData.length,
    found: countFound,
    fallback: countFallback,
    scg: countScg,
    notFound: countNotFound,
  };
}

// ============================================================
// SECTION 3: Single Row Lookup (ใช้ทดสอบ / Debug)
// ============================================================

/**
 * lookupSingleRow — ค้นหาพิกัดสำหรับ 1 แถวที่ระบุ (ทดสอบ)
 * @param {number} rowNumber - หมายเลขแถวใน ตารางงานประจำวัน (เริ่มจาก 2)
 * @return {Object} ผลลัพธ์การค้นหา
 */
function lookupSingleRow(rowNumber) {
  const ss      = SpreadsheetApp.getActiveSpreadsheet();
  const sheet   = ss.getSheetByName(SHEET.DAILY_JOB);
  if (!sheet || rowNumber < 2) return null;

  const rowData    = sheet.getRange(rowNumber, 1, 1,
                      SCHEMA.DAILY_JOB.length).getValues()[0];
  const rawPerson  = String(rowData[DATA_IDX.SHIP_TO_NAME]  || '').trim();
  const rawPlace   = String(rowData[DATA_IDX.SHIP_TO_ADDR]  || '').trim();
  const scgLatLng  = String(rowData[DATA_IDX.LATLNG_SCG]    || '').trim();

  const result = findBestGeoByPersonPlace(rawPerson, rawPlace, scgLatLng);

  console.log(`[SearchService] Row ${rowNumber} → Status:${result.status} ` +
    `(${result.confidence}%) ${result.lat},${result.lng}`);
  console.log(`  Reason: ${result.reason}`);

  return result;
}


function loadEmployeeEmailMap_() {
  const cacheKey = 'EMPLOYEE_EMAIL_MAP';
  const cached = getCacheJson_(cacheKey);
  if (cached) return cached;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET.EMPLOYEE);
  const map = {};
  if (!sheet || sheet.getLastRow() < 2) return map;

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, SCHEMA.EMPLOYEE.length).getValues();
  rows.forEach(row => {
    const driverName = normalizeJoinKey_(row[0]);
    const email = toSafeString_(row[1]);
    const active = String(row[4]).toLowerCase();
    if (!driverName || !email) return;
    if (active && active !== 'true' && active !== '1' && active !== 'yes') return;
    map[driverName] = email;
  });

  putCacheJson_(cacheKey, map, AI_CONFIG.CACHE_TTL_SEC);
  return map;
}
