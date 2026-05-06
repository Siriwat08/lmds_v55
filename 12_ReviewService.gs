/**
 * VERSION: 001
 * FILE: 12_ReviewService.gs
 * LMDS V5.0 — Review Queue Service
 * ===================================================
 * หน้าที่: จัดการ Q_REVIEW — เพิ่ม/ประมวลผล Review
 * BUG FIX:
 *   - applyReviewDecision: เพิ่ม Place Alias Learning
 *     (เดิมมีเฉพาะ Person Alias — Place Alias หายไป)
 * ===================================================
 */

// ============================================================
// SECTION 1: enqueueReview — เพิ่ม Record เข้า Q_REVIEW
// ============================================================

/**
 * enqueueReview — เพิ่มรายการรอ Review ใน Q_REVIEW
 * @param {Object} srcObj     - Source Record
 * @param {Object} decision   - ผลจาก makeMatchDecision
 * @param {Object} personResult
 * @param {Object} placeResult
 * @param {Object} geoResult
 */
function enqueueReview(srcObj, decision, personResult, placeResult, geoResult) {
  try {
    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET.Q_REVIEW);
    const now   = new Date();
    const revId = 'RV' + Utilities.getUuid().replace(/-/g, '').substring(0, 10)
                                            .toUpperCase();

    // สร้าง 23-column Row ตรงตาม SCHEMA.Q_REVIEW
    const newRow = new Array(SCHEMA.Q_REVIEW.length).fill('');

    newRow[REVIEW_IDX.REVIEW_ID]     = revId;
    newRow[REVIEW_IDX.ISSUE_TYPE]    = decision.reason;
    newRow[REVIEW_IDX.PRIORITY]      = decision.priority || 2;
    newRow[REVIEW_IDX.SOURCE_REC_ID] = srcObj.invoiceNo;
    newRow[REVIEW_IDX.SOURCE_ROW]    = srcObj.sourceRow;
    newRow[REVIEW_IDX.INVOICE_NO]    = srcObj.invoiceNo;
    newRow[REVIEW_IDX.RAW_PERSON]    = srcObj.rawPersonName;
    newRow[REVIEW_IDX.RAW_PLACE]     = srcObj.rawAddress;
    newRow[REVIEW_IDX.RAW_SYS_ADDR]  = srcObj.rawAddress;
    newRow[REVIEW_IDX.RAW_GEO_ADDR]  = '';
    newRow[REVIEW_IDX.RAW_LAT]       = srcObj.rawLat;
    newRow[REVIEW_IDX.RAW_LNG]       = srcObj.rawLng;
    newRow[REVIEW_IDX.CAND_PERSONS]  = personResult.personId || '';
    newRow[REVIEW_IDX.CAND_PLACES]   = placeResult.placeId   || '';
    newRow[REVIEW_IDX.CAND_GEOS]     = geoResult.geoId       || '';
    newRow[REVIEW_IDX.CAND_DESTS]    = '';
    newRow[REVIEW_IDX.MATCH_SCORE]   = decision.confidence;
    newRow[REVIEW_IDX.RECOMMEND]     = buildRecommendText_(decision, personResult, placeResult);
    newRow[REVIEW_IDX.STATUS]        = 'Pending';
    newRow[REVIEW_IDX.REVIEWER]      = '';
    newRow[REVIEW_IDX.REVIEWED_AT]   = '';
    newRow[REVIEW_IDX.DECISION]      = '';
    newRow[REVIEW_IDX.NOTE]          = '';

    sheet.appendRow(newRow);
    logDebug('ReviewService', `enqueueReview: ${revId} reason:${decision.reason}`);

  } catch (err) {
    logError('ReviewService', `enqueueReview ล้มเหลว: ${err.message}`);
  }
}

/**
 * buildRecommendText_ — สร้างข้อความแนะนำสำหรับ Reviewer
 */
function buildRecommendText_(decision, personResult, placeResult) {
  const lines = [`เหตุผล: ${decision.reason} (${decision.confidence}%)`];

  if (personResult.personId) {
    lines.push(`Person Candidate: ${personResult.personId}`);
  }
  if (placeResult.placeId) {
    lines.push(`Place Candidate: ${placeResult.placeId}`);
  }
  if (decision.confidence >= AI_CONFIG.THRESHOLD_REVIEW) {
    lines.push('แนะนำ: MERGE_TO_CANDIDATE');
  } else {
    lines.push('แนะนำ: CREATE_NEW');
  }

  return lines.join(' | ');
}

// ============================================================
// SECTION 2: applyReviewDecision — ประมวลผลการตัดสินใจ
// ============================================================

/**
 * applyReviewDecision — ประมวลผลเมื่อ Reviewer ตัดสินใจแล้ว
 * [BUG FIX] เพิ่ม Place Alias Learning (เดิมมีแค่ Person)
 * @param {number} reviewRow - แถวใน Q_REVIEW (1-based)
 */
function applyReviewDecision(reviewRow) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET.Q_REVIEW);

  if (!sheet || reviewRow < 2) {
    logError('ReviewService', `applyReviewDecision: แถวไม่ถูกต้อง ${reviewRow}`);
    return;
  }

  const headers   = sheet.getRange(1, 1, 1, SCHEMA.Q_REVIEW.length).getValues()[0];
  const rowData   = sheet.getRange(reviewRow, 1, 1, SCHEMA.Q_REVIEW.length)
                         .getValues()[0];

  const decision      = String(rowData[REVIEW_IDX.DECISION]      || '').trim();
  const rawPersonName = String(rowData[REVIEW_IDX.RAW_PERSON]    || '').trim();
  const rawPlaceName  = String(rowData[REVIEW_IDX.RAW_PLACE]     || '').trim();
  const candPersonId  = String(rowData[REVIEW_IDX.CAND_PERSONS]  || '').trim();
  const candPlaceId   = String(rowData[REVIEW_IDX.CAND_PLACES]   || '').trim();
  const candGeoId     = String(rowData[REVIEW_IDX.CAND_GEOS]     || '').trim();
  const matchScore    = Number(rowData[REVIEW_IDX.MATCH_SCORE]   || 0);

  switch (decision) {

    case 'CONFIRM_AUTO_MATCH':
      // ยืนยัน Match ที่ระบบแนะนำ → อัปเดต Stats
      if (candPersonId) updatePersonStats(candPersonId);
      if (candPlaceId)  updatePlaceStats(candPlaceId);
      if (candGeoId)    updateGeoStats(candGeoId);
      break;

    case 'MERGE_TO_CANDIDATE':
      // ✅ BUG FIX: เพิ่ม Place Alias Learning ด้วย (ไม่ใช่แค่ Person)
      if (candPersonId && rawPersonName) {
        createPersonAlias(candPersonId, rawPersonName, matchScore);
        updatePersonStats(candPersonId);
      }
      if (candPlaceId && rawPlaceName) {
        // ✅ BUG FIX: สร้าง Place Alias ด้วย (เดิมหายไป)
        createPlaceAlias(candPlaceId, rawPlaceName, matchScore);
        updatePlaceStats(candPlaceId);
      }
      if (candGeoId) updateGeoStats(candGeoId);
      break;

    case 'CREATE_NEW':
      // สร้างใหม่ทุกอย่าง
      const srcObj = {
        rawPersonName: rawPersonName,
        rawAddress:    rawPlaceName,
        rawLat:        Number(rowData[REVIEW_IDX.RAW_LAT]),
        rawLng:        Number(rowData[REVIEW_IDX.RAW_LNG]),
        province:      '',
        deliveryDate:  new Date(),
        hasGeo:        !!(Number(rowData[REVIEW_IDX.RAW_LAT])),
      };
      const newDecision = {
        action:     'CREATE_NEW',
        reason:     'MANUAL_REVIEW',
        confidence: 100,
        priority:   0,
      };
      const personResult = resolvePerson(rawPersonName);
      const placeResult  = resolvePlace(rawPlaceName, rawPlaceName);
      const geoResult    = resolveGeo(srcObj.rawLat, srcObj.rawLng);
      executeDecision(srcObj, newDecision, personResult, placeResult, geoResult);
      break;

    case 'REJECT':
      // ปฏิเสธ — ทำเครื่องหมายว่าตรวจแล้วไม่ดำเนินการ
      logInfo('ReviewService', `Rejected: Review ${rowData[REVIEW_IDX.REVIEW_ID]}`);
      break;

    case 'ESCALATE':
      // ส่งต่อ — เปลี่ยน Status เป็น Escalated
      break;

    default:
      logWarn('ReviewService', `applyReviewDecision: Unknown decision: ${decision}`);
      return;
  }

  // อัปเดต Status ของ Review ว่า Done แล้ว
  const statusCol     = headers.indexOf('status')      + 1;
  const reviewedAtCol = headers.indexOf('reviewed_at') + 1;
  sheet.getRange(reviewRow, statusCol).setValue('Done');
  sheet.getRange(reviewRow, reviewedAtCol).setValue(new Date());

  logInfo('ReviewService',
    `applyReviewDecision: ${rowData[REVIEW_IDX.REVIEW_ID]} → ${decision}`);
}

// ============================================================
// SECTION 3: Bulk Apply — ประมวลผล Review ที่ Done ทั้งหมด
// ============================================================

/**
 * applyAllPendingDecisions — วนประมวลผล Q_REVIEW ที่ Reviewer ตัดสินใจแล้ว
 * เรียกผ่าน Menu หรือ Trigger
 */
function applyAllPendingDecisions() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET.Q_REVIEW);
  if (!sheet || sheet.getLastRow() < 2) return;

  const data    = sheet.getRange(2, 1, sheet.getLastRow() - 1,
                   SCHEMA.Q_REVIEW.length).getValues();
  const headers = sheet.getRange(1, 1, 1, SCHEMA.Q_REVIEW.length).getValues()[0];

  let applied = 0;
  let skipped = 0;

  data.forEach((row, i) => {
    const status   = String(row[REVIEW_IDX.STATUS]   || '').trim();
    const decision = String(row[REVIEW_IDX.DECISION] || '').trim();

    // ประมวลผลเฉพาะ: มี Decision + Status ยังไม่ Done
    if (decision && status === 'In_Review') {
      try {
        applyReviewDecision(i + 2); // +2 = header + 0-index offset
        applied++;
      } catch (err) {
        logError('ReviewService', `แถว ${i+2}: ${err.message}`);
        skipped++;
      }
    } else {
      skipped++;
    }
  });

  logInfo('ReviewService', `applyAllPendingDecisions: ${applied} applied, ${skipped} skipped`);
  SpreadsheetApp.getActiveSpreadsheet()
    .toast(`✅ ประมวลผล ${applied} รายการ`, APP_NAME, 5);
}

// ============================================================
// SECTION 4: Stats & Utilities
// ============================================================

/**
 * getReviewStats — ดึงสรุปสถานะ Q_REVIEW
 * @return {{ pending, inReview, done, escalated, total }}
 */
function getReviewStats() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET.Q_REVIEW);
  const stats = { pending:0, inReview:0, done:0, escalated:0, total:0 };

  if (!sheet || sheet.getLastRow() < 2) return stats;

  const statusCol = REVIEW_IDX.STATUS + 1;
  const data      = sheet.getRange(2, statusCol,
                     sheet.getLastRow() - 1, 1).getValues();

  data.forEach(r => {
    const status = String(r[0]).trim();
    stats.total++;
    if (status === 'Pending')    stats.pending++;
    if (status === 'In_Review')  stats.inReview++;
    if (status === 'Done')       stats.done++;
    if (status === 'Escalated')  stats.escalated++;
  });

  return stats;
}

/**
 * generateQualityReport — สร้างรายงาน Data Quality
 * เรียกจาก Menu
 */
function generateQualityReport() {
  const stats   = getReviewStats();
  const ss      = SpreadsheetApp.getActiveSpreadsheet();
  const rptSheet = ss.getSheetByName(SHEET.RPT_QUALITY);

  if (!rptSheet) return;

  const factSheet = ss.getSheetByName(SHEET.FACT_DELIVERY);
  const totalFact = factSheet ? Math.max(0, factSheet.getLastRow() - 1) : 0;
  const doneCount = totalFact - stats.pending;
  const matchRate = totalFact > 0 ? Math.round((doneCount / totalFact) * 100) : 0;

  rptSheet.appendRow([
    new Date(),     // report_date
    totalFact,      // total_records
    doneCount,      // auto_matched (approx)
    stats.pending,  // reviewed
    0,              // created_new
    0,              // failed
    matchRate + '%',// match_rate
    `Pending:${stats.pending} InReview:${stats.inReview}`, // notes
  ]);

  logInfo('ReviewService', `generateQualityReport: ${matchRate}% match rate`);
  SpreadsheetApp.getUi().alert(
    `📊 รายงาน Data Quality\n\n` +
    `รวมทั้งหมด: ${totalFact} รายการ\n` +
    `Match Rate: ${matchRate}%\n` +
    `รอ Review: ${stats.pending} รายการ\n` +
    `Escalated: ${stats.escalated} รายการ`
  );
}

/**
 * highlightHighPriorityReviews — ไฮไลต์แถวที่ Priority = 1
 */
function highlightHighPriorityReviews() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET.Q_REVIEW);
  if (!sheet || sheet.getLastRow() < 2) return;

  const data        = sheet.getRange(2, 1, sheet.getLastRow() - 1,
                       SCHEMA.Q_REVIEW.length).getValues();
  const priorityCol = REVIEW_IDX.PRIORITY;
  const statusCol   = REVIEW_IDX.STATUS;

  data.forEach((row, i) => {
    const priority = Number(row[priorityCol]) || 99;
    const status   = String(row[statusCol] || '').trim();
    const targetRow = i + 2;

    if (priority === 1 && status === 'Pending') {
      sheet.getRange(targetRow, 1, 1, SCHEMA.Q_REVIEW.length)
           .setBackground('#f4cccc'); // แดง = ด่วนมาก
    } else if (priority === 2 && status === 'Pending') {
      sheet.getRange(targetRow, 1, 1, SCHEMA.Q_REVIEW.length)
           .setBackground('#ffe599'); // เหลือง = ปานกลาง
    }
  });
}
