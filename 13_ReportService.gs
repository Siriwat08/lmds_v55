/**
 * VERSION: 001
 * FILE: 13_ReportService.gs
 * LMDS V5.0 — Report Service
 * ===================================================
 * หน้าที่: สร้างรายงานสรุป Data Quality และสถานะระบบ
 * ===================================================
 */

/**
 * buildFullQualityReport — สร้างรายงานสมบูรณ์และเขียนลง RPT_DATA_QUALITY
 */
function buildFullQualityReport() {
  const ss        = SpreadsheetApp.getActiveSpreadsheet();
  const rptSheet  = ss.getSheetByName(SHEET.RPT_QUALITY);
  if (!rptSheet) {
    logError('ReportService', 'ไม่พบชีต RPT_DATA_QUALITY');
    return;
  }

  // นับจาก FACT_DELIVERY
  const factSheet  = ss.getSheetByName(SHEET.FACT_DELIVERY);
  const totalFact  = factSheet ? Math.max(0, factSheet.getLastRow() - 1) : 0;

  let autoCount    = 0;
  let newCount     = 0;
  let reviewCount  = 0;
  let errorCount   = 0;

  if (factSheet && totalFact > 0) {
    const statusCol  = FACT_IDX.MATCH_STATUS + 1;
    const statusData = factSheet.getRange(2, statusCol, totalFact, 1).getValues();
    statusData.forEach(r => {
      const s = String(r[0] || '').trim();
      if (s === 'AUTO_MATCH')  autoCount++;
      else if (s === 'CREATE_NEW') newCount++;
      else if (s === 'REVIEW')     reviewCount++;
      else if (s === 'ERROR')      errorCount++;
    });
  }

  const matchRate = totalFact > 0
    ? Math.round(((autoCount + newCount) / totalFact) * 100)
    : 0;

  // นับจาก Master Tables
  const personCount = countSheetRows_(ss, SHEET.M_PERSON);
  const placeCount  = countSheetRows_(ss, SHEET.M_PLACE);
  const geoCount    = countSheetRows_(ss, SHEET.M_GEO_POINT);
  const destCount   = countSheetRows_(ss, SHEET.M_DESTINATION);
  const reviewStats = getReviewStats();

  const note = [
    `Person:${personCount}`,
    `Place:${placeCount}`,
    `Geo:${geoCount}`,
    `Dest:${destCount}`,
    `Q_Pending:${reviewStats.pending}`,
  ].join(' | ');

  rptSheet.appendRow([
    new Date(),
    totalFact,
    autoCount,
    reviewCount,
    newCount,
    errorCount,
    matchRate + '%',
    note,
  ]);

  logInfo('ReportService',
    `Report สร้างแล้ว — Total:${totalFact} Match:${matchRate}%`);

  SpreadsheetApp.getUi().alert(
    '📊 Data Quality Report\n\n' +
    `รวมทั้งหมด:    ${totalFact} รายการ\n` +
    `Auto Match:    ${autoCount} (${matchRate}%)\n` +
    `Create New:    ${newCount}\n` +
    `รอ Review:     ${reviewCount}\n` +
    `Error:         ${errorCount}\n\n` +
    `Master Data:\n` +
    `  Person:  ${personCount} รายการ\n` +
    `  Place:   ${placeCount} รายการ\n` +
    `  Geo:     ${geoCount} รายการ\n` +
    `  Dest:    ${destCount} รายการ`
  );
}

/**
 * countSheetRows_ — นับแถวข้อมูล (ไม่รวม Header)
 * @param {Spreadsheet} ss
 * @param {string} sheetName
 * @return {number}
 */
function countSheetRows_(ss, sheetName) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return 0;
  return Math.max(0, sheet.getLastRow() - 1);
}
