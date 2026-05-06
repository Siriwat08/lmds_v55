/**
 * VERSION: 001
 * FILE: 06_PersonService.gs
 * LMDS V5.0 — Person Master Service
 * ===================================================
 * หน้าที่: จัดการข้อมูล M_PERSON และ M_PERSON_ALIAS
 *          - ค้นหาบุคคลด้วย Phone/Alias/Name
 *          - คำนวณ Score ด้วย Levenshtein + Dice
 *          - สร้าง/Merge บุคคลใหม่
 * ===================================================
 */

// ============================================================
// SECTION 1: resolvePerson — ค้นหาหรือสร้างบุคคล
// ============================================================

/**
 * resolvePerson — วิเคราะห์ชื่อดิบ และค้นหาใน M_PERSON
 * @param {string} rawName - ชื่อดิบจาก Source
 * @return {{
 *   personId: string,
 *   status: string,     FOUND / LOW_QUALITY / NOT_FOUND
 *   confidence: number,
 *   normResult: Object
 * }}
 */
function resolvePerson(rawName) {
  // Normalize ชื่อก่อน
  const normResult = normalizePersonNameFull(rawName);
  const cleanName  = normResult.cleanName;

  // ชื่อสั้นเกิน 1 ตัวอักษร หรือว่างเปล่า = คุณภาพต่ำ
  if (!cleanName || cleanName.length < 2) {
    return {
      personId:   null,
      status:     'LOW_QUALITY',
      confidence: 0,
      normResult: normResult,
    };
  }

  // ค้นหา Candidate จาก M_PERSON
  const candidates = findPersonCandidates(
    cleanName, normResult.extractedPhone
  );

  if (candidates.length === 0) {
    return {
      personId:   null,
      status:     'NOT_FOUND',
      confidence: 0,
      normResult: normResult,
    };
  }

  // คำนวณ Score และเลือกดีที่สุด
  let bestPerson = null;
  let bestScore  = 0;

  candidates.forEach(candidate => {
    const score = scorePersonCandidate(cleanName, candidate);
    if (score > bestScore) {
      bestScore  = score;
      bestPerson = candidate;
    }
  });

  if (bestScore >= AI_CONFIG.THRESHOLD_AUTO) {
    return {
      personId:   bestPerson.personId,
      status:     'FOUND',
      confidence: bestScore,
      normResult: normResult,
    };
  }

  if (bestScore >= AI_CONFIG.THRESHOLD_REVIEW) {
    return {
      personId:   bestPerson.personId,
      status:     'NEEDS_REVIEW',
      confidence: bestScore,
      normResult: normResult,
    };
  }

  return {
    personId:   null,
    status:     'NOT_FOUND',
    confidence: bestScore,
    normResult: normResult,
  };
}

// ============================================================
// SECTION 2: findPersonCandidates — ค้นหา Candidate
// ============================================================

/**
 * findPersonCandidates — ดึง Candidate จาก M_PERSON
 * ลำดับการค้นหา:
 *   1. Phone Match (ตรงเลย 100%)
 *   2. Alias Match (ใน M_PERSON_ALIAS)
 *   3. Normalized Name Match
 * @param {string} cleanName - ชื่อที่ล้างแล้ว
 * @param {string} phone - เบอร์โทร (ถ้ามี)
 * @return {Object[]} รายการ Candidate
 */
function findPersonCandidates(cleanName, phone) {
  const allPersons = loadAllPersons_();
  const personIndex = loadPersonIndex_();
  const personById = {};
  allPersons.forEach(person => { personById[person.personId] = person; });

  const results = [];
  const seen = new Set();
  const pushById = personId => {
    const found = personById[personId];
    if (found && !seen.has(found.personId)) {
      seen.add(found.personId);
      results.push(found);
    }
  };

  if (phone) {
    const cleanPhone = String(phone).replace(/[^0-9]/g, '');
    const byPhone = personIndex.byPhone[cleanPhone] || [];
    if (byPhone.length > 0) {
      byPhone.forEach(pushById);
      return results;
    }
  }

  const normName = normalizeForCompare(cleanName);
  (personIndex.aliasToPersonIds[normName] || []).forEach(pushById);
  (personIndex.byNorm[normName] || []).forEach(pushById);

  const searchKey = buildThaiPhoneticKey(cleanName);
  if (searchKey && personIndex.byPhonetic[searchKey]) {
    personIndex.byPhonetic[searchKey].forEach(pushById);
  }

  if (results.length === 0) {
    const prefix = normName.substring(0, 2);
    allPersons.forEach(person => {
      const target = normalizeForCompare(person.normalized);
      if (prefix && target.startsWith(prefix)) pushById(person.personId);
    });
  }

  return results;
}

/**
 * findByAlias_ — ค้นหา Person ID จาก M_PERSON_ALIAS
 * @param {string} cleanName
 * @return {string[]} รายการ person_id ที่พบ
 */
function findByAlias_(cleanName) {
  const allAliases = loadAllAliases_();
  const targetNorm = normalizeForCompare(cleanName);
  const found      = [];

  allAliases.forEach(alias => {
    // [RULE: ตรวจ active_flag ที่ index 5]
    if (!alias[PERSON_ALIAS_IDX.ACTIVE_FLAG]) return;
    const aliasNorm = normalizeForCompare(
      alias[PERSON_ALIAS_IDX.ALIAS_NAME]
    );
    if (aliasNorm === targetNorm && aliasNorm.length > 0) {
      found.push(alias[PERSON_ALIAS_IDX.PERSON_ID]);
    }
  });

  return [...new Set(found)]; // ไม่ซ้ำ
}

// ============================================================
// SECTION 3: Scoring
// ============================================================

/**
 * scorePersonCandidate — คำนวณคะแนน Match ระหว่างชื่อค้นหา กับ Candidate
 * ชื่อสั้น (<4 ตัว): Levenshtein 60% + Dice 20% + Ratio 20%
 * ชื่อยาว (≥4 ตัว): Dice 50% + Levenshtein 30% + Ratio 20%
 * @param {string} queryName - ชื่อที่ค้นหา
 * @param {Object} candidate - Person object จาก M_PERSON
 * @return {number} คะแนน 0-100
 */
function scorePersonCandidate(queryName, candidate) {
  const nameA  = normalizeForCompare(queryName);
  const nameB  = normalizeForCompare(candidate.normalized || candidate.canonical);

  if (!nameA || !nameB) return 0;

  const levDist   = levenshteinDistance(nameA, nameB);
  const maxLen    = Math.max(nameA.length, nameB.length);
  const levScore  = maxLen > 0
    ? Math.max(0, (1 - levDist / maxLen) * 100)
    : 0;
  const diceScore = diceCoefficient(nameA, nameB) * 100;
  const ratioScore = nameA === nameB ? 100 :
    (nameA.includes(nameB) || nameB.includes(nameA)) ? 80 : 0;

  let finalScore;
  if (nameA.length < 4) {
    // ชื่อสั้น — เน้น Levenshtein
    finalScore = levScore * 0.6 + diceScore * 0.2 + ratioScore * 0.2;
  } else {
    // ชื่อยาว — เน้น Dice
    finalScore = diceScore * 0.5 + levScore * 0.3 + ratioScore * 0.2;
  }

  // คะแนนต่ำกว่า 60 ถือว่าไม่เกี่ยวกัน
  return finalScore < 60 ? 0 : Math.round(finalScore);
}

// ============================================================
// SECTION 4: CRUD — สร้าง/อ่าน M_PERSON
// ============================================================

/**
 * createPerson — สร้างบุคคลใหม่ใน M_PERSON
 * @param {Object} normResult - ผลจาก normalizePersonNameFull
 * @return {string} person_id ที่สร้าง
 */
function createPerson(normResult) {
  const ss     = SpreadsheetApp.getActiveSpreadsheet();
  const sheet  = ss.getSheetByName(SHEET.M_PERSON);
  const now    = new Date();
  const newId  = 'P' + Utilities.getUuid().replace(/-/g, '').substring(0, 11)
                                          .toUpperCase();

  // [RULE: เบอร์โทรขึ้นต้น ' เพื่อป้องกัน 0 หาย]
  const phoneStr = normResult.extractedPhone
    ? "'" + normResult.extractedPhone
    : '';

  const newRow = [
    newId,                        // [0] person_id
    normResult.cleanName,         // [1] canonical_name
    normResult.cleanName,         // [2] normalized_name
    phoneStr,                     // [3] phone
    now,                          // [4] first_seen
    now,                          // [5] last_seen
    1,                            // [6] usage_count
    APP_CONST.STATUS_ACTIVE,      // [7] record_status
    normResult.deliveryNotes.join(',') || '', // [8] note
  ];

  sheet.appendRow(newRow);
  invalidatePersonCache_();
  logDebug('PersonService', `createPerson: ${newId} — ${normResult.cleanName}`);
  return newId;
}

/**
 * createPersonAlias — เพิ่มชื่อสำรองให้บุคคล
 * เรียกเมื่อ Review ตัดสินใจว่าชื่อ A = บุคคล B
 * @param {string} personId - person_id เป้าหมาย
 * @param {string} aliasName - ชื่อสำรองที่พบ
 * @param {number} matchScore - คะแนนที่ Match ได้
 */
function createPersonAlias(personId, aliasName, matchScore) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET.M_PERSON_ALIAS);
  const newId = 'PA' + Utilities.getUuid().replace(/-/g, '').substring(0, 10)
                                          .toUpperCase();

  sheet.appendRow([
    newId,           // [0] alias_id
    personId,        // [1] person_id
    aliasName,       // [2] alias_name
    matchScore || 0, // [3] match_score
    new Date(),      // [4] created_at
    true,            // [5] active_flag
  ]);

  invalidateAliasCache_();
  logDebug('PersonService', `createPersonAlias: ${aliasName} → ${personId}`);
}

/**
 * updatePersonStats — อัปเดต last_seen และ usage_count
 * [RULE 6] อ่านแถวเดียวที่จำเป็น ไม่โหลดทั้งชีต
 * @param {string} personId
 */
function updatePersonStats(personId) {
  try {
    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET.M_PERSON);
    const data  = sheet.getRange(1, 1, sheet.getLastRow(),
                   sheet.getLastColumn()).getValues();
    const headers = data[0];
    const idCol   = headers.indexOf('person_id');

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][idCol]) === personId) {
        const targetRow = i + 1;
        // อัปเดต last_seen (col F = index 5 → col 6)
        sheet.getRange(targetRow, PERSON_IDX.LAST_SEEN + 1).setValue(new Date());
        // อัปเดต usage_count (col G = index 6 → col 7)
        const currCount = Number(data[i][PERSON_IDX.USAGE_COUNT]) || 0;
        sheet.getRange(targetRow, PERSON_IDX.USAGE_COUNT + 1)
             .setValue(currCount + 1);
        invalidatePersonCache_();
        break;
      }
    }
  } catch (err) {
    logError('PersonService', `updatePersonStats ล้มเหลว: ${err.message}`);
  }
}

/**
 * mergePersonRecords — Merge บุคคล 2 คนให้เป็น 1 (ทำ Record_Status = Merged)
 * [RULE 4] ห้างลบ — ใช้ record_status = Merged แทน
 * @param {string} sourceId - person_id ที่ถูก Merge ออก
 * @param {string} targetId - person_id ที่รับ Merge เข้า
 */
function mergePersonRecords(sourceId, targetId) {
  try {
    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET.M_PERSON);
    const data  = sheet.getRange(1, 1, sheet.getLastRow(),
                   sheet.getLastColumn()).getValues();
    const headers = data[0];
    const idCol   = headers.indexOf('person_id');
    const statCol = headers.indexOf('record_status');
    const noteCol = headers.indexOf('note');

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][idCol]) === sourceId) {
        const targetRow = i + 1;
        sheet.getRange(targetRow, statCol + 1).setValue(APP_CONST.STATUS_MERGED);
        sheet.getRange(targetRow, noteCol + 1)
             .setValue(`Merged → ${targetId} on ${new Date().toLocaleDateString('th-TH')}`);
        break;
      }
    }

    // ย้าย Alias ของ sourceId ไปเป็น Alias ของ targetId
    createPersonAlias(targetId, sourceId, 100);
    invalidatePersonCache_();
    logInfo('PersonService', `mergePersonRecords: ${sourceId} → ${targetId}`);

  } catch (err) {
    logError('PersonService', `mergePersonRecords ล้มเหลว: ${err.message}`);
    throw err;
  }
}

// ============================================================
// SECTION 5: Data Loaders (with Cache)
// ============================================================

/**
 * loadAllPersons_ — โหลด M_PERSON ทั้งหมดพร้อม Cache
 * [RULE 6] CacheService 6 ชั่วโมง
 * @return {Object[]}
 */
function loadAllPersons_() {
  const cacheKey = 'M_PERSON_ALL';
  const cache    = CacheService.getScriptCache();
  const cached   = cache.get(cacheKey);

  if (cached) {
    try { return JSON.parse(cached); } catch (e) {}
  }

  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET.M_PERSON);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1,
                SCHEMA.M_PERSON.length).getValues();

  const result = rows
    .filter(r => r[PERSON_IDX.PERSON_ID])
    .filter(r => r[PERSON_IDX.STATUS] !== APP_CONST.STATUS_ARCHIVED &&
                 r[PERSON_IDX.STATUS] !== APP_CONST.STATUS_MERGED)
    .map(r => ({
      personId:   String(r[PERSON_IDX.PERSON_ID]),
      canonical:  String(r[PERSON_IDX.CANONICAL]  || ''),
      normalized: String(r[PERSON_IDX.NORMALIZED] || ''),
      phone:      String(r[PERSON_IDX.PHONE]       || '').replace(/^'/, ''),
      usageCount: Number(r[PERSON_IDX.USAGE_COUNT] || 0),
    }));

  try {
    cache.put(cacheKey, JSON.stringify(result), AI_CONFIG.CACHE_TTL_SEC);
  } catch (e) {}

  return result;
}

/**
 * loadAllAliases_ — โหลด M_PERSON_ALIAS ทั้งหมดพร้อม Cache
 * @return {Array[]}
 */
function loadAllAliases_() {
  const cacheKey = 'M_PERSON_ALIAS_ALL';
  const cache    = CacheService.getScriptCache();
  const cached   = cache.get(cacheKey);

  if (cached) {
    try { return JSON.parse(cached); } catch (e) {}
  }

  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET.M_PERSON_ALIAS);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1,
                SCHEMA.M_PERSON_ALIAS.length).getValues();

  try {
    cache.put(cacheKey, JSON.stringify(rows), AI_CONFIG.CACHE_TTL_SEC);
  } catch (e) {}

  return rows;
}

function invalidatePersonCache_() {
  CacheService.getScriptCache().remove('M_PERSON_ALL');
  CacheService.getScriptCache().remove('IDX_PERSON');
}

function invalidateAliasCache_() {
  CacheService.getScriptCache().remove('M_PERSON_ALIAS_ALL');
  CacheService.getScriptCache().remove('IDX_PERSON');
}

function loadPersonIndex_() {
  const cacheKey = 'IDX_PERSON';
  const cached = getCacheJson_(cacheKey);
  if (cached) return cached;

  const persons = loadAllPersons_();
  const aliases = loadAllAliases_();
  const index = { byPhone: {}, byNorm: {}, byPhonetic: {}, aliasToPersonIds: {} };

  persons.forEach(person => {
    const personId = toSafeString_(person.personId);
    if (!personId) return;

    const phone = toSafeString_(person.phone).replace(/[^0-9]/g, '');
    if (phone.length >= 9) {
      if (!index.byPhone[phone]) index.byPhone[phone] = [];
      index.byPhone[phone].push(personId);
    }

    const norm = normalizeForCompare(person.normalized || person.canonical);
    if (norm) {
      if (!index.byNorm[norm]) index.byNorm[norm] = [];
      index.byNorm[norm].push(personId);
    }

    const phonetic = buildThaiPhoneticKey(person.normalized || person.canonical);
    if (phonetic) {
      if (!index.byPhonetic[phonetic]) index.byPhonetic[phonetic] = [];
      index.byPhonetic[phonetic].push(personId);
    }
  });

  aliases.forEach(alias => {
    if (!alias[PERSON_ALIAS_IDX.ACTIVE_FLAG]) return;
    const aliasNorm = normalizeForCompare(alias[PERSON_ALIAS_IDX.ALIAS_NAME]);
    const personId = toSafeString_(alias[PERSON_ALIAS_IDX.PERSON_ID]);
    if (!aliasNorm || !personId) return;
    if (!index.aliasToPersonIds[aliasNorm]) index.aliasToPersonIds[aliasNorm] = [];
    index.aliasToPersonIds[aliasNorm].push(personId);
  });

  Object.keys(index).forEach(bucket => {
    Object.keys(index[bucket]).forEach(key => {
      index[bucket][key] = uniqueNonEmptyStrings_(index[bucket][key]);
    });
  });

  putCacheJson_(cacheKey, index, AI_CONFIG.CACHE_TTL_SEC);
  return index;
}
