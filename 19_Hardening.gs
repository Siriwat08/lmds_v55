/**
 * VERSION: 001
 * FILE: 19_Hardening.gs
 * LMDS V5.2 — Production Hardening Phase 2
 * ===================================================
 * หน้าที่:
 *   1. Runtime config helper จาก SYS_CONFIG
 *   2. Preflight audit ก่อน deploy
 *   3. Migration helper สำหรับ patch config / cache duplicates
 * ===================================================
 */

function getRuntimeConfigMap_() {
  const cacheKey = 'SYS_CONFIG_MAP';
  const cached = getCacheJson_(cacheKey);
  if (cached) return cached;

  const defaults = {
    PIPELINE_BATCH_LIMIT: '50',
    GEO_RADIUS_M: '50',
    THRESHOLD_AUTO: '90',
    THRESHOLD_REVIEW: '70',
    THRESHOLD_IGNORE: '50',
    CACHE_TTL_SEC: '21600',
    SEARCH_WRITE_BATCH: '200',
    MAX_SHIPMENT_FETCH: '200',
    MAX_LOOKUP_ROWS: '5000',
    SYSTEM_VERSION: APP_VERSION,
    SCHEMA_VERSION: SCHEMA_VERSION,
  };

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET.SYS_CONFIG);
  if (!sheet || sheet.getLastRow() < 2) {
    putCacheJson_(cacheKey, defaults, AI_CONFIG.CACHE_TTL_SEC);
    return defaults;
  }

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, SCHEMA.SYS_CONFIG.length).getValues();
  const map = Object.assign({}, defaults);
  rows.forEach(row => {
    const key = toSafeString_(row[0]);
    if (!key) return;
    map[key] = row[1];
  });

  putCacheJson_(cacheKey, map, AI_CONFIG.CACHE_TTL_SEC);
  return map;
}

function getRuntimeConfigNumber_(key, fallback) {
  const map = getRuntimeConfigMap_();
  const val = Number(map[key]);
  return isNaN(val) ? fallback : val;
}

function runPhase2PreflightAudit() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const required = [
    [SHEET.M_PERSON, SCHEMA.M_PERSON],
    [SHEET.M_PLACE, SCHEMA.M_PLACE],
    [SHEET.M_DESTINATION, SCHEMA.M_DESTINATION],
    [SHEET.DAILY_JOB, SCHEMA.DAILY_JOB],
    [SHEET.SYS_CONFIG, SCHEMA.SYS_CONFIG],
    [SHEET.MAPS_CACHE, SCHEMA.MAPS_CACHE],
  ];

  const errors = [];
  const warns = [];
  required.forEach(pair => {
    const sheet = ss.getSheetByName(pair[0]);
    if (!sheet) {
      errors.push(`ไม่พบชีต ${pair[0]}`);
      return;
    }
    const audit = validateSheetHeaders(sheet, pair[1]);
    if (audit.missing.length > 0) errors.push(`${pair[0]} ขาดคอลัมน์: ${audit.missing.join(', ')}`);
    if (audit.extra.length > 0) warns.push(`${pair[0]} มีคอลัมน์ส่วนเกิน: ${audit.extra.join(', ')}`);
    if (audit.orderMismatch) warns.push(`${pair[0]} ลำดับคอลัมน์ไม่ตรง schema`);
  });

  const cfg = getRuntimeConfigMap_();
  ['SEARCH_WRITE_BATCH', 'MAX_SHIPMENT_FETCH', 'MAX_LOOKUP_ROWS', 'SCHEMA_VERSION'].forEach(key => {
    if (!(key in cfg)) warns.push(`SYS_CONFIG ยังไม่มี ${key}`);
  });

  const mapsCacheSheet = ss.getSheetByName(SHEET.MAPS_CACHE);
  if (mapsCacheSheet && mapsCacheSheet.getLastRow() > 1) {
    const keys = mapsCacheSheet.getRange(2, 1, mapsCacheSheet.getLastRow() - 1, 1).getValues().map(r => toSafeString_(r[0])).filter(Boolean);
    if (new Set(keys).size !== keys.length) {
      warns.push('MAPS_CACHE พบ cache_key ซ้ำ — ควรรัน Migration Helper');
    }
  }

  const message = [
    'Phase 2 Preflight',
    `Errors: ${errors.length}`,
    `Warnings: ${warns.length}`,
    errors.length ? ('\n❌ ' + errors.join('\n❌ ')) : '',
    warns.length ? ('\n⚠️ ' + warns.join('\n⚠️ ')) : '',
    (!errors.length && !warns.length) ? '\n✅ พร้อม deploy' : ''
  ].join('\n');

  if (errors.length) logError('HardeningPH2', message);
  else if (warns.length) logWarn('HardeningPH2', message);
  else logInfo('HardeningPH2', message);

  SpreadsheetApp.getUi().alert(message);
  return { errors: errors, warnings: warns };
}

function migrateProductionHardeningPhase2() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  setupAllSheets_SilentPH2_(ss);
  seedMissingPhase2Config_(ss);
  dedupeMapsCacheSheet_(ss);
  CacheService.getScriptCache().remove('SYS_CONFIG_MAP');
  logInfo('HardeningPH2', 'migrateProductionHardeningPhase2: เสร็จสิ้น');
  SpreadsheetApp.getUi().alert('✅ Production Hardening Phase 2 migration เสร็จสิ้น');
}

function setupAllSheets_SilentPH2_(ss) {
  setupMasterSheets_(ss);
  setupFactSheets_(ss);
  setupSysSheets_(ss);
  setupGroupTwoSheets_(ss);
}

function seedMissingPhase2Config_(ss) {
  const sheet = ss.getSheetByName(SHEET.SYS_CONFIG);
  if (!sheet) return;
  const existing = sheet.getLastRow() >= 2
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().map(r => toSafeString_(r[0]))
    : [];
  const existingSet = new Set(existing);
  const now = new Date();
  const rows = [
    ['SEARCH_WRITE_BATCH', '200', 'จำนวนแถวต่อรอบสำหรับ setValues/setBackgrounds ใน SearchService', now],
    ['MAX_SHIPMENT_FETCH', '200', 'เพดาน Shipment ต่อการดึง SCG API หนึ่งครั้ง', now],
    ['MAX_LOOKUP_ROWS', '5000', 'เพดานจำนวนแถว DAILY_JOB ต่อการ enrich หนึ่งครั้ง', now],
    ['SCHEMA_VERSION', SCHEMA_VERSION, 'เวอร์ชันปัจจุบันของ schema', now],
    ['SYSTEM_VERSION', APP_VERSION, 'เวอร์ชันปัจจุบันของระบบ LMDS', now],
  ].filter(row => !existingSet.has(row[0]));

  if (rows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 4).setValues(rows);
  }
}

function dedupeMapsCacheSheet_(ss) {
  const sheet = ss.getSheetByName(SHEET.MAPS_CACHE);
  if (!sheet || sheet.getLastRow() < 3) return;

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, SCHEMA.MAPS_CACHE.length).getValues();
  const bestByKey = {};
  rows.forEach(row => {
    const key = toSafeString_(row[0]);
    if (!key) return;
    const hit = safeNumber_(row[7], 0);
    const createdAt = row[6] instanceof Date ? row[6].getTime() : 0;
    const current = bestByKey[key];
    if (!current || hit > current.hit || (hit === current.hit && createdAt > current.createdAt)) {
      bestByKey[key] = { row: row, hit: hit, createdAt: createdAt };
    }
  });

  const dedupedRows = Object.keys(bestByKey).sort().map(key => bestByKey[key].row);
  sheet.deleteRows(2, sheet.getLastRow() - 1);
  if (dedupedRows.length > 0) {
    sheet.getRange(2, 1, dedupedRows.length, SCHEMA.MAPS_CACHE.length).setValues(dedupedRows);
  }
}
