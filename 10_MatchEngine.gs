/**
 * VERSION: 001
 * FILE: 10_MatchEngine.gs
 * LMDS V5.0 — Match Engine (3-Tier Decision)
 * ===================================================
 * หน้าที่: ประมวลผล Source Record → ตัดสินใจ 8 Rule
 *          → Execute: AUTO_MATCH / CREATE_NEW / REVIEW
 * BUG FIX:
 *   - getSameDayDestinations: data[i][2]→[4], data[i][5]→[17]
 * ===================================================
 */

// ============================================================
// SECTION 1: runMatchEngine — Entry Point
// ============================================================

/**
 * runMatchEngine — วนรัน Match Engine กับทุก Source Row
 * [RULE 7] withLock ป้องกัน Concurrent Run
 */
function runMatchEngine() {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(APP_CONST.LOCK_TIMEOUT_MS);
  } catch (e) {
    logWarn('MatchEngine', 'ไม่สามารถ Lock ได้ — อาจมีการรันซ้อน');
    return;
  }

  const startTime  = new Date();
  const timeLimit  = 5 * 60 * 1000; // 5 นาที
  let processed    = 0;
  let autoMatched  = 0;
  let created      = 0;
  let queued       = 0;
  let errorCount   = 0;

  try {
    logInfo('MatchEngine', 'เริ่ม Match Engine');
    const pendingRows = getUnprocessedRows();

    if (pendingRows.length === 0) {
      logInfo('MatchEngine', 'ไม่มีแถวที่ต้องประมวลผล');
      return;
    }

    logInfo('MatchEngine', `ประมวลผล ${pendingRows.length} แถว`);

    for (let i = 0; i < pendingRows.length; i++) {
      // Time Guard — หยุดก่อน timeout
      if (new Date() - startTime > timeLimit) {
        logWarn('MatchEngine', `Time Guard: หยุดที่แถว ${i}/${pendingRows.length}`);
        saveCheckpoint_(i, pendingRows[i].sourceRow);
        break;
      }

      try {
        const result = processOneRow(pendingRows[i]);
        processed++;
        if (result.action === 'AUTO_MATCH')  autoMatched++;
        if (result.action === 'CREATE_NEW')  created++;
        if (result.action === 'REVIEW')      queued++;
      } catch (rowErr) {
        errorCount++;
        logError('MatchEngine', `แถว ${i}: ${rowErr.message}`);
      }
    }

    const elapsedSec = Math.round((new Date() - startTime) / 1000);
    logInfo('MatchEngine',
      `เสร็จสิ้น — รัน:${processed} Match:${autoMatched} ` +
      `สร้างใหม่:${created} Review:${queued} Error:${errorCount} ` +
      `(${elapsedSec}s)`
    );

  } catch (err) {
    logError('MatchEngine', `runMatchEngine ล้มเหลว: ${err.message}`);
    throw err;
  } finally {
    lock.releaseLock();
  }
}

// ============================================================
// SECTION 2: processOneRow — ประมวลผลทีละแถว
// ============================================================

/**
 * processOneRow — ประมวลผล 1 Source Record ผ่าน 3 Tier
 * @param {Object} srcObj - Source Object จาก 04_SourceRepository
 * @return {{ action: string, txId: string }}
 */
function processOneRow(srcObj) {
  // Tier 1: Resolve ข้อมูลแต่ละ Dimension
  const personResult = resolvePerson(srcObj.rawPersonName);
  const placeResult  = resolvePlace(srcObj.rawAddress, srcObj.rawAddress);
  const geoResult    = resolveGeo(srcObj.rawLat, srcObj.rawLng);

  // Tier 2: ตัดสินใจ
  const decision = makeMatchDecision(
    srcObj, personResult, placeResult, geoResult
  );

  // Tier 3: Execute
  const txId = executeDecision(srcObj, decision, personResult, placeResult, geoResult);

  return { action: decision.action, txId: txId };
}

// ============================================================
// SECTION 3: makeMatchDecision — 8 Rules Decision Tree
// ============================================================

/**
 * makeMatchDecision — ตัดสินใจจาก 8 Rule
 * @param {Object} srcObj
 * @param {Object} personResult  - จาก resolvePerson
 * @param {Object} placeResult   - จาก resolvePlace
 * @param {Object} geoResult     - จาก resolveGeo
 * @return {{ action, reason, confidence, priority }}
 */
function makeMatchDecision(srcObj, personResult, placeResult, geoResult) {
  const hasGeo     = geoResult.status === 'FOUND';
  const hasPerson  = personResult.status === 'FOUND' ||
                     personResult.status === 'NEEDS_REVIEW';
  const hasPlace   = placeResult.status  === 'FOUND' ||
                     placeResult.status  === 'BRANCH_MATCH';
  const isPersonOk = personResult.status === 'FOUND';
  const isPlaceOk  = placeResult.status  === 'FOUND' ||
                     placeResult.status  === 'BRANCH_MATCH';

  // --- Rule 1: ไม่มีพิกัด → REVIEW/INVALID_LATLNG ---
  if (!hasGeo && geoResult.status !== 'NOT_FOUND') {
    return {
      action:     'REVIEW',
      reason:     'INVALID_LATLNG',
      confidence: 0,
      priority:   1,
    };
  }

  // --- Rule 2: ชื่อคุณภาพต่ำ → REVIEW/LOW_QUALITY_PERSON ---
  if (personResult.status === 'LOW_QUALITY') {
    return {
      action:     'REVIEW',
      reason:     'LOW_QUALITY_PERSON',
      confidence: 0,
      priority:   2,
    };
  }

  // --- Rule 3: Province Conflict → REVIEW/GEO_PROVINCE_CONFLICT ---
  if (hasGeo && placeResult.normResult) {
    const geoProvince   = getGeoProvince_(geoResult.geoId);
    const placeProvince = placeResult.normResult.province || '';
    if (geoProvince && placeProvince &&
        geoProvince !== placeProvince) {
      return {
        action:     'REVIEW',
        reason:     'GEO_PROVINCE_CONFLICT',
        confidence: 50,
        priority:   2,
      };
    }
  }

  // --- Rule 4: ครบทั้ง 3 → AUTO_MATCH/FULL_MATCH ---
  if (hasGeo && isPersonOk && isPlaceOk) {
    const confidence = Math.round(
      (geoResult.confidence * 0.5 +
       personResult.confidence * 0.3 +
       placeResult.confidence  * 0.2)
    );
    return {
      action:     'AUTO_MATCH',
      reason:     APP_CONST.MATCH_FULL,
      confidence: confidence,
      priority:   0,
    };
  }

  // --- Rule 5: Geo + (Person หรือ Place) → AUTO_MATCH/GEO_ANCHOR ---
  if (hasGeo && (isPersonOk || isPlaceOk)) {
    const confidence = Math.round(
      geoResult.confidence * 0.7 +
      (isPersonOk ? personResult.confidence : 0) * 0.3 +
      (isPlaceOk  ? placeResult.confidence  : 0) * 0.2
    );
    return {
      action:     'AUTO_MATCH',
      reason:     APP_CONST.MATCH_GEO,
      confidence: Math.min(confidence, 95),
      priority:   0,
    };
  }

  // --- Rule 6: มี Candidate แต่ NEEDS_REVIEW → REVIEW/FUZZY_MATCH ---
  if (personResult.status === 'NEEDS_REVIEW' ||
      placeResult.status  === 'NEEDS_REVIEW') {
    const confidence = Math.max(
      personResult.confidence, placeResult.confidence
    );
    return {
      action:     'REVIEW',
      reason:     APP_CONST.MATCH_FUZZY,
      confidence: confidence,
      priority:   2,
    };
  }

  // --- Rule 7: ทุกอย่างใหม่หมด + มีพิกัด → CREATE_NEW ---
  if (hasGeo && !hasPerson && !hasPlace) {
    return {
      action:     'CREATE_NEW',
      reason:     'ALL_NEW_WITH_GEO',
      confidence: geoResult.confidence,
      priority:   0,
    };
  }

  // --- Rule 7b: ใหม่หมด + ไม่มีพิกัด → REVIEW ---
  if (!hasGeo && !hasPerson && !hasPlace) {
    return {
      action:     'REVIEW',
      reason:     'ALL_NEW_NO_GEO',
      confidence: 0,
      priority:   3,
    };
  }

  // --- Rule 8: Default → CREATE_NEW ---
  return {
    action:     'CREATE_NEW',
    reason:     'DEFAULT_NEW',
    confidence: 50,
    priority:   1,
  };
}

// ============================================================
// SECTION 4: executeDecision — Execute ตาม Action
// ============================================================

/**
 * executeDecision — ดำเนินการตาม Action ที่ตัดสินใจ
 * @return {string} tx_id ที่สร้าง
 */
function executeDecision(srcObj, decision, personResult, placeResult, geoResult) {
  let personId = personResult.personId;
  let placeId  = placeResult.placeId;
  let geoId    = geoResult.geoId;
  let destId   = null;

  switch (decision.action) {

    case 'AUTO_MATCH':
      // อัปเดต Stats ทุก Master ที่ Match ได้
      if (personId) updatePersonStats(personId);
      if (placeId)  updatePlaceStats(placeId);
      if (geoId)    updateGeoStats(geoId);
      // หา / สร้าง Destination
      const destResult = resolveDestination(personId, placeId, geoId);
      if (destResult.status === 'FOUND' || destResult.status === 'PARTIAL_MATCH') {
        destId = destResult.destId;
        updateDestinationStats(destId, srcObj.deliveryDate);
      } else {
        destId = createDestination(
          personId, placeId, geoId,
          srcObj.rawLat, srcObj.rawLng, srcObj.deliveryDate
        );
      }
      break;

    case 'CREATE_NEW':
      // สร้างสิ่งที่ไม่มีใหม่ทั้งหมด
      if (!personId && personResult.normResult) {
        personId = createPerson(personResult.normResult);
      }
      if (!placeId && placeResult.normResult) {
        placeId = createPlace(
          placeResult.normResult,
          srcObj.province, '', '', ''
        );
      }
      if (!geoId && srcObj.hasGeo) {
        geoId = createGeoPoint(
          srcObj.rawLat, srcObj.rawLng,
          'driver', '', srcObj.province, ''
        );
      }
      if (geoId || personId) {
        destId = createDestination(
          personId, placeId, geoId,
          srcObj.rawLat, srcObj.rawLng, srcObj.deliveryDate
        );
      }
      break;

    case 'REVIEW':
      // ส่งเข้า Q_REVIEW
      enqueueReview(srcObj, decision, personResult, placeResult, geoResult);
      break;

    case 'ERROR':
    default:
      logError('MatchEngine', `executeDecision: Unknown action: ${decision.action}`);
      break;
  }

  // บันทึก FACT_DELIVERY ทุกกรณี (รวม REVIEW)
  const txId = upsertFactDelivery(
    srcObj, personId, placeId, geoId, destId, decision
  );

  return txId;
}

// ============================================================
// SECTION 5: Helper Functions
// ============================================================

/**
 * getSameDayDestinations — หา Destination ในวันเดียวกัน + Geo เดียวกัน
 * [BUG FIX] เปลี่ยน data[i][2]→[4] (delivery_date)
 *            และ data[i][5]→[17] (geo_id)
 * @param {Date} deliveryDate
 * @param {string} geoId
 * @return {Object[]}
 */
function getSameDayDestinations(deliveryDate, geoId) {
  const ss        = SpreadsheetApp.getActiveSpreadsheet();
  const sheet     = ss.getSheetByName(SHEET.FACT_DELIVERY);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const data      = sheet.getRange(2, 1, sheet.getLastRow() - 1,
                     SCHEMA.FACT_DELIVERY.length).getValues();
  const targetDate = new Date(deliveryDate).toDateString();
  const results    = [];

  for (let i = 0; i < data.length; i++) {
    // ✅ BUG FIX: FACT_IDX.DELIVERY_DATE = 4, FACT_IDX.GEO_ID = 17
    const rowDate = data[i][FACT_IDX.DELIVERY_DATE]
      ? new Date(data[i][FACT_IDX.DELIVERY_DATE]).toDateString()
      : '';
    const rowGeoId = String(data[i][FACT_IDX.GEO_ID] || '');

    if (rowDate === targetDate && rowGeoId === geoId) {
      results.push({
        txId:     data[i][FACT_IDX.TX_ID],
        personId: data[i][FACT_IDX.PERSON_ID],
        placeId:  data[i][FACT_IDX.PLACE_ID],
        geoId:    rowGeoId,
      });
    }
  }

  return results;
}

/**
 * detectSameGeoMultiPerson — ตรวจสอบ condo/mall ที่มีหลายคนส่ง
 * @param {string} geoId
 * @param {string} currentPersonId
 * @return {boolean} true = มีคนอื่นส่งที่เดียวกันด้วย
 */
function detectSameGeoMultiPerson(geoId, currentPersonId) {
  const allDests = loadAllDestinations_();
  const sameGeo  = allDests.filter(d =>
    d.geoId    === geoId &&
    d.personId !== currentPersonId &&
    d.status   !== APP_CONST.STATUS_ARCHIVED
  );
  return sameGeo.length > 0;
}

/**
 * getGeoProvince_ — ดึงชื่อจังหวัดของ Geo Point
 * @param {string} geoId
 * @return {string}
 */
function getGeoProvince_(geoId) {
  const allGeos = loadAllGeos_();
  const geo     = allGeos.find(g => g.geoId === geoId);
  return geo ? geo.province : '';
}

/**
 * saveCheckpoint_ — บันทึกจุดที่ Match Engine หยุด
 * ใช้ต่อจากตรงนี้ในครั้งถัดไป
 * @param {number} batchIndex
 * @param {number} sourceRow
 */
function saveCheckpoint_(batchIndex, sourceRow) {
  PropertiesService.getScriptProperties().setProperties({
    'MATCH_CHECKPOINT_INDEX': String(batchIndex),
    'MATCH_CHECKPOINT_ROW':   String(sourceRow),
  });
  logInfo('MatchEngine', `บันทึก Checkpoint ที่ index:${batchIndex} row:${sourceRow}`);
}
