/**
 * VERSION: 001
 * FILE: 07_PlaceService.gs
 * LMDS V5.0 — Place Master Service
 * ===================================================
 * หน้าที่: จัดการข้อมูล M_PLACE และ M_PLACE_ALIAS
 *          - ค้นหาสถานที่ด้วยชื่อ/Alias
 *          - รองรับ Branch Match (ร้านเดียวกัน หลายสาขา)
 *          - สร้าง/Merge สถานที่ใหม่
 * ===================================================
 */

// ============================================================
// SECTION 1: resolvePlace — ค้นหาหรือสร้างสถานที่
// ============================================================

/**
 * resolvePlace — วิเคราะห์ชื่อดิบ และค้นหาใน M_PLACE
 * @param {string} rawName - ชื่อสถานที่ดิบ
 * @param {string} rawAddress - ที่อยู่ดิบ (ใช้ช่วย Province Match)
 * @return {{
 *   placeId: string,
 *   status: string,    FOUND / BRANCH_MATCH / NEEDS_REVIEW / NOT_FOUND
 *   confidence: number,
 *   normResult: Object
 * }}
 */
function resolvePlace(rawName, rawAddress) {
  const normResult = normalizePlaceName(rawName);
  const cleanPlace = normResult.cleanPlace;

  if (!cleanPlace || cleanPlace.length < 2) {
    return {
      placeId:    null,
      status:     'LOW_QUALITY',
      confidence: 0,
      normResult: normResult,
    };
  }

  const candidates = findPlaceCandidates(cleanPlace, rawAddress);

  if (candidates.length === 0) {
    return {
      placeId:    null,
      status:     'NOT_FOUND',
      confidence: 0,
      normResult: normResult,
    };
  }

  // คำนวณ Score
  let bestPlace = null;
  let bestScore = 0;

  candidates.forEach(candidate => {
    const score = scorePlaceCandidate(cleanPlace, candidate);
    if (score > bestScore) {
      bestScore = score;
      bestPlace = candidate;
    }
  });

  // ลอง Branch Match ถ้า Score ไม่ถึง Auto
  if (bestScore < AI_CONFIG.THRESHOLD_AUTO) {
    const branchResult = tryMatchBranch(cleanPlace, rawAddress);
    if (branchResult) {
      return {
        placeId:    branchResult.placeId,
        status:     'BRANCH_MATCH',
        confidence: branchResult.score,
        normResult: normResult,
      };
    }
  }

  if (bestScore >= AI_CONFIG.THRESHOLD_AUTO) {
    return {
      placeId:    bestPlace.placeId,
      status:     'FOUND',
      confidence: bestScore,
      normResult: normResult,
    };
  }

  if (bestScore >= AI_CONFIG.THRESHOLD_REVIEW) {
    return {
      placeId:    bestPlace.placeId,
      status:     'NEEDS_REVIEW',
      confidence: bestScore,
      normResult: normResult,
    };
  }

  return {
    placeId:    null,
    status:     'NOT_FOUND',
    confidence: bestScore,
    normResult: normResult,
  };
}

// ============================================================
// SECTION 2: findPlaceCandidates
// ============================================================

/**
 * findPlaceCandidates — ค้นหา Candidate จาก M_PLACE และ M_PLACE_ALIAS
 * @param {string} cleanPlace
 * @param {string} rawAddress
 * @return {Object[]} รายการ Candidate
 */
function findPlaceCandidates(cleanPlace, rawAddress) {
  const allPlaces = loadAllPlaces_();
  const placeIndex = loadPlaceIndex_();
  const placeById = {};
  allPlaces.forEach(place => { placeById[place.placeId] = place; });

  const results = [];
  const seen = new Set();
  const pushById = placeId => {
    const found = placeById[placeId];
    if (found && !seen.has(found.placeId)) {
      seen.add(found.placeId);
      results.push(found);
    }
  };

  const normPlace = normalizeForCompare(cleanPlace);
  (placeIndex.aliasToPlaceIds[normPlace] || []).forEach(pushById);
  (placeIndex.byNorm[normPlace] || []).forEach(pushById);

  const searchKey = buildThaiPhoneticKey(cleanPlace);
  if (searchKey && placeIndex.byPhonetic[searchKey]) {
    placeIndex.byPhonetic[searchKey].forEach(pushById);
  }

  if (results.length === 0) {
    const prefix = normPlace.substring(0, 3);
    allPlaces.forEach(place => {
      const target = normalizeForCompare(place.normalized);
      if (prefix && target.startsWith(prefix)) pushById(place.placeId);
    });
  }

  return results;
}

/**
 * findPlaceByAlias_ — ค้นหา Place ID จาก M_PLACE_ALIAS
 * @param {string} cleanPlace
 * @return {string[]}
 */
function findPlaceByAlias_(cleanPlace) {
  const allAliases = loadAllPlaceAliases_();
  const targetNorm = normalizeForCompare(cleanPlace);
  const found      = [];

  allAliases.forEach(alias => {
    if (!alias[PLACE_ALIAS_IDX.ACTIVE_FLAG]) return;
    const aliasNorm = normalizeForCompare(alias[PLACE_ALIAS_IDX.ALIAS_NAME]);
    if (aliasNorm === targetNorm && aliasNorm.length > 0) {
      found.push(alias[PLACE_ALIAS_IDX.PLACE_ID]);
    }
  });

  return [...new Set(found)];
}

// ============================================================
// SECTION 3: Branch Match (Chain Store / ร้านสาขา)
// ============================================================

/**
 * tryMatchBranch — พยายาม Match กับสาขาของร้านใหญ่
 * เช่น "ไทวัสดุ รังสิต" ควร Match กับ "ไทวัสดุ" ใน M_PLACE
 * @param {string} cleanPlace
 * @param {string} rawAddress
 * @return {{ placeId: string, score: number } | null}
 */
function tryMatchBranch(cleanPlace, rawAddress) {
  const allPlaces  = loadAllPlaces_();
  const normQuery  = normalizeForCompare(cleanPlace);

  for (const store of CHAIN_STORE_LIST) {
    const normStore = normalizeForCompare(store);
    if (!normQuery.includes(normStore)) continue;

    // พบว่าชื่อมี Chain Store — ค้นหาสาขาที่ตรง Province
    const province = extractProvince_(rawAddress);
    const matching = allPlaces.filter(p => {
      const normPlace = normalizeForCompare(p.normalized);
      return normPlace.includes(normStore) &&
             (!province || !p.province ||
              p.province === province);
    });

    if (matching.length === 1) {
      return { placeId: matching[0].placeId, score: 85 };
    }
    if (matching.length > 1) {
      // หลายสาขา — เลือก Usage สูงสุด
      matching.sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0));
      return { placeId: matching[0].placeId, score: 75 };
    }
  }

  return null;
}

/**
 * extractProvince_ — ดึงชื่อจังหวัดจากที่อยู่ดิบ
 * @param {string} rawAddress
 * @return {string}
 */
function extractProvince_(rawAddress) {
  const addr = String(rawAddress || '');
  // รูปแบบ: "จ.เชียงใหม่", "จังหวัดเชียงใหม่", "กรุงเทพฯ"
  const match = addr.match(/จ\.(\S+)|จังหวัด(\S+)/);
  if (match) return match[1] || match[2] || '';
  if (addr.includes('กรุงเทพ')) return 'กรุงเทพมหานคร';
  return '';
}

// ============================================================
// SECTION 4: Scoring
// ============================================================

/**
 * scorePlaceCandidate — คำนวณคะแนน Match สถานที่
 * @param {string} queryPlace
 * @param {Object} candidate
 * @return {number} 0-100
 */
function scorePlaceCandidate(queryPlace, candidate) {
  const nameA = normalizeForCompare(queryPlace);
  const nameB = normalizeForCompare(candidate.normalized || candidate.canonical);

  if (!nameA || !nameB) return 0;

  const levDist  = levenshteinDistance(nameA, nameB);
  const maxLen   = Math.max(nameA.length, nameB.length);
  const levScore = maxLen > 0 ? Math.max(0, (1 - levDist / maxLen) * 100) : 0;
  const diceScore = diceCoefficient(nameA, nameB) * 100;
  const exactScore = nameA === nameB ? 100 : 0;

  // สถานที่เน้น Dice มากกว่าเพราะชื่อมักยาว
  const finalScore = exactScore > 0 ? 100
    : diceScore * 0.6 + levScore * 0.4;

  return finalScore < 55 ? 0 : Math.round(finalScore);
}

// ============================================================
// SECTION 5: CRUD
// ============================================================

/**
 * createPlace — สร้างสถานที่ใหม่ใน M_PLACE
 * @param {Object} normResult - ผลจาก normalizePlaceName
 * @param {string} province
 * @param {string} district
 * @param {string} subDistrict
 * @param {string} postcode
 * @return {string} place_id
 */
function createPlace(normResult, province, district, subDistrict, postcode) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET.M_PLACE);
  const now   = new Date();
  const newId = 'PL' + Utilities.getUuid().replace(/-/g, '').substring(0, 10)
                                          .toUpperCase();

  const newRow = [
    newId,                    // [0] place_id
    normResult.cleanPlace,    // [1] canonical_name
    normResult.cleanPlace,    // [2] normalized_name
    normResult.placeType,     // [3] place_type
    subDistrict || '',        // [4] sub_district
    district    || '',        // [5] district
    province    || '',        // [6] province
    postcode    || '',        // [7] postcode
    now,                      // [8] first_seen
    now,                      // [9] last_seen
    1,                        // [10] usage_count
    APP_CONST.STATUS_ACTIVE,  // [11] record_status
    normResult.notes ? normResult.notes.join(',') : '', // [12] note
  ];

  sheet.appendRow(newRow);
  invalidatePlaceCache_();
  logDebug('PlaceService', `createPlace: ${newId} — ${normResult.cleanPlace}`);
  return newId;
}

/**
 * createPlaceAlias — เพิ่มชื่อสำรองให้สถานที่ (ใช้ใน ReviewService)
 * @param {string} placeId
 * @param {string} aliasName
 * @param {number} matchScore
 */
function createPlaceAlias(placeId, aliasName, matchScore) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET.M_PLACE_ALIAS);
  const newId = 'PLA' + Utilities.getUuid().replace(/-/g, '').substring(0, 9)
                                           .toUpperCase();

  sheet.appendRow([
    newId,
    placeId,
    aliasName,
    matchScore || 0,
    new Date(),
    true,
  ]);

  invalidatePlaceAliasCache_();
  logDebug('PlaceService', `createPlaceAlias: ${aliasName} → ${placeId}`);
}

/**
 * updatePlaceStats — อัปเดต last_seen และ usage_count
 * @param {string} placeId
 */
function updatePlaceStats(placeId) {
  try {
    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET.M_PLACE);
    const data  = sheet.getRange(1, 1, sheet.getLastRow(),
                   SCHEMA.M_PLACE.length).getValues();
    const headers = data[0];
    const idCol   = headers.indexOf('place_id');

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][idCol]) === placeId) {
        const targetRow = i + 1;
        sheet.getRange(targetRow, PLACE_IDX.LAST_SEEN + 1).setValue(new Date());
        const curr = Number(data[i][PLACE_IDX.USAGE_COUNT]) || 0;
        sheet.getRange(targetRow, PLACE_IDX.USAGE_COUNT + 1)
             .setValue(curr + 1);
        invalidatePlaceCache_();
        break;
      }
    }
  } catch (err) {
    logError('PlaceService', `updatePlaceStats ล้มเหลว: ${err.message}`);
  }
}

// ============================================================
// SECTION 6: Data Loaders (with Cache)
// ============================================================

function loadAllPlaces_() {
  const cacheKey = 'M_PLACE_ALL';
  const cache    = CacheService.getScriptCache();
  const cached   = cache.get(cacheKey);
  if (cached) { try { return JSON.parse(cached); } catch(e) {} }

  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET.M_PLACE);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1,
                SCHEMA.M_PLACE.length).getValues();

  const result = rows
    .filter(r => r[PLACE_IDX.PLACE_ID])
    .filter(r => r[PLACE_IDX.STATUS] !== APP_CONST.STATUS_ARCHIVED)
    .map(r => ({
      placeId:    String(r[PLACE_IDX.PLACE_ID]),
      canonical:  String(r[PLACE_IDX.CANONICAL]   || ''),
      normalized: String(r[PLACE_IDX.NORMALIZED]  || ''),
      placeType:  String(r[PLACE_IDX.PLACE_TYPE]  || ''),
      province:   String(r[PLACE_IDX.PROVINCE]    || ''),
      district:   String(r[PLACE_IDX.DISTRICT]    || ''),
      usageCount: Number(r[PLACE_IDX.USAGE_COUNT] || 0),
    }));

  try { cache.put(cacheKey, JSON.stringify(result), AI_CONFIG.CACHE_TTL_SEC); }
  catch(e) {}
  return result;
}

function loadAllPlaceAliases_() {
  const cacheKey = 'M_PLACE_ALIAS_ALL';
  const cache    = CacheService.getScriptCache();
  const cached   = cache.get(cacheKey);
  if (cached) { try { return JSON.parse(cached); } catch(e) {} }

  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET.M_PLACE_ALIAS);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1,
                SCHEMA.M_PLACE_ALIAS.length).getValues();

  try { cache.put(cacheKey, JSON.stringify(rows), AI_CONFIG.CACHE_TTL_SEC); }
  catch(e) {}
  return rows;
}

function invalidatePlaceCache_() {
  CacheService.getScriptCache().remove('M_PLACE_ALL');
  CacheService.getScriptCache().remove('IDX_PLACE');
}

function invalidatePlaceAliasCache_() {
  CacheService.getScriptCache().remove('M_PLACE_ALIAS_ALL');
  CacheService.getScriptCache().remove('IDX_PLACE');
}

function loadPlaceIndex_() {
  const cacheKey = 'IDX_PLACE';
  const cached = getCacheJson_(cacheKey);
  if (cached) return cached;

  const places = loadAllPlaces_();
  const aliases = loadAllPlaceAliases_();
  const index = { byNorm: {}, byPhonetic: {}, aliasToPlaceIds: {} };

  places.forEach(place => {
    const placeId = toSafeString_(place.placeId);
    if (!placeId) return;

    const norm = normalizeForCompare(place.normalized || place.canonical);
    if (norm) {
      if (!index.byNorm[norm]) index.byNorm[norm] = [];
      index.byNorm[norm].push(placeId);
    }

    const phonetic = buildThaiPhoneticKey(place.normalized || place.canonical);
    if (phonetic) {
      if (!index.byPhonetic[phonetic]) index.byPhonetic[phonetic] = [];
      index.byPhonetic[phonetic].push(placeId);
    }
  });

  aliases.forEach(alias => {
    if (!alias[PLACE_ALIAS_IDX.ACTIVE_FLAG]) return;
    const aliasNorm = normalizeForCompare(alias[PLACE_ALIAS_IDX.ALIAS_NAME]);
    const placeId = toSafeString_(alias[PLACE_ALIAS_IDX.PLACE_ID]);
    if (!aliasNorm || !placeId) return;
    if (!index.aliasToPlaceIds[aliasNorm]) index.aliasToPlaceIds[aliasNorm] = [];
    index.aliasToPlaceIds[aliasNorm].push(placeId);
  });

  Object.keys(index).forEach(bucket => {
    Object.keys(index[bucket]).forEach(key => {
      index[bucket][key] = uniqueNonEmptyStrings_(index[bucket][key]);
    });
  });

  putCacheJson_(cacheKey, index, AI_CONFIG.CACHE_TTL_SEC);
  return index;
}
