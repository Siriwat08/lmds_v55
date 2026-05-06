/**
 * VERSION: 001
 * FILE: 09_DestinationService.gs
 * LMDS V5.0 — Destination Master Service
 * ===================================================
 * หน้าที่: จัดการข้อมูล M_DESTINATION
 *          Holy Trinity: Person + Place + Geo = จุดส่งที่แม่นยำ 100%
 *          - ค้นหา Destination จาก person_id + place_id + geo_id
 *          - สร้าง Destination ใหม่
 *          - ค้นหาจุดส่งที่คนๆ หนึ่งไปบ่อยที่สุด
 * ===================================================
 */

// ============================================================
// SECTION 1: resolveDestination — ค้นหาหรือสร้าง Destination
// ============================================================

/**
 * resolveDestination — ค้นหา Destination จาก Trinity
 * @param {string} personId
 * @param {string} placeId
 * @param {string} geoId
 * @return {{ destId: string, status: string, isNew: boolean }}
 */
function resolveDestination(personId, placeId, geoId) {
  if (!personId && !placeId && !geoId) {
    return { destId: null, status: 'INSUFFICIENT', isNew: false };
  }

  const allDests = loadAllDestinations_();

  // ค้นหา Exact Match ด้วย Trinity ทั้ง 3
  const exactMatch = allDests.find(d =>
    d.personId === personId &&
    d.placeId  === placeId  &&
    d.geoId    === geoId
  );

  if (exactMatch) {
    return { destId: exactMatch.destId, status: 'FOUND', isNew: false };
  }

  // ค้นหา Partial Match (Person + Geo)
  if (personId && geoId) {
    const partialMatch = allDests.find(d =>
      d.personId === personId && d.geoId === geoId
    );
    if (partialMatch) {
      return {
        destId: partialMatch.destId,
        status: 'PARTIAL_MATCH',
        isNew:  false,
      };
    }
  }

  return { destId: null, status: 'NOT_FOUND', isNew: false };
}

// ============================================================
// SECTION 2: CRUD
// ============================================================

/**
 * createDestination — สร้าง Destination ใหม่ (Trinity)
 * @param {string} personId
 * @param {string} placeId
 * @param {string} geoId
 * @param {number} lat - พิกัดของแท้
 * @param {number} lng - พิกัดของแท้
 * @param {Date} deliveryDate
 * @return {string} dest_id
 */
function createDestination(personId, placeId, geoId, lat, lng, deliveryDate) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET.M_DESTINATION);
  const now   = new Date();
  const newId = 'D' + Utilities.getUuid().replace(/-/g, '').substring(0, 12)
                                         .toUpperCase();

  const newRow = [
    newId,                    // [0] dest_id
    personId  || '',          // [1] person_id
    placeId   || '',          // [2] place_id
    geoId     || '',          // [3] geo_id
    lat       || 0,           // [4] lat
    lng       || 0,           // [5] lng
    '',                       // [6] route_label
    deliveryDate || now,      // [7] delivery_date
    1,                        // [8] usage_count
    now,                      // [9] last_seen
    APP_CONST.STATUS_ACTIVE,  // [10] record_status
  ];

  sheet.appendRow(newRow);
  invalidateDestCache_();
  logDebug('DestService', `createDestination: ${newId} P:${personId} PL:${placeId}`);
  return newId;
}

/**
 * updateDestinationStats — อัปเดต last_seen, usage_count, delivery_date
 * @param {string} destId
 * @param {Date} deliveryDate
 */
function updateDestinationStats(destId, deliveryDate) {
  try {
    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET.M_DESTINATION);
    const data  = sheet.getRange(1, 1, sheet.getLastRow(),
                   SCHEMA.M_DESTINATION.length).getValues();
    const headers = data[0];
    const idCol   = headers.indexOf('dest_id');

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][idCol]) === destId) {
        const targetRow = i + 1;
        sheet.getRange(targetRow, DEST_IDX.LAST_SEEN + 1)
             .setValue(new Date());
        const curr = Number(data[i][DEST_IDX.USAGE_COUNT]) || 0;
        sheet.getRange(targetRow, DEST_IDX.USAGE_COUNT + 1)
             .setValue(curr + 1);
        if (deliveryDate) {
          sheet.getRange(targetRow, DEST_IDX.DELIVERY_DATE + 1)
               .setValue(deliveryDate);
        }
        invalidateDestCache_();
        break;
      }
    }
  } catch (err) {
    logError('DestService', `updateDestinationStats ล้มเหลว: ${err.message}`);
  }
}

// ============================================================
// SECTION 3: Query Functions สำหรับ Module 17
// ============================================================

/**
 * getDestsByPersonId — หา Destination ทั้งหมดของบุคคลนี้
 * ใช้ใน Module 17 SearchService (Fallback หาไม่เจอ Place)
 * @param {string} personId
 * @return {Object[]} เรียงตาม usage_count สูงสุดก่อน
 */
function getDestsByPersonId(personId) {
  const index = loadDestinationIndex_();
  return (index.byPerson[toSafeString_(personId)] || []).slice();
}

/**
 * getDestsByPlaceId — หา Destination ทั้งหมดของสถานที่นี้
 * @param {string} placeId
 * @return {Object[]}
 */
function getDestsByPlaceId(placeId) {
  const index = loadDestinationIndex_();
  return (index.byPlace[toSafeString_(placeId)] || []).slice();
}

/**
 * getDestsByPersonAndPlace — หา Destination จาก Person + Place
 * @param {string} personId
 * @param {string} placeId
 * @return {Object[]}
 */
function getDestsByPersonAndPlace(personId, placeId) {
  const index = loadDestinationIndex_();
  return (index.byPersonPlace[buildCompositeKey_(personId, placeId)] || []).slice();
}

/**
 * getDominantDestByGeo — หา Destination ที่ใช้บ่อยที่สุดใน Geo เดียวกัน
 * ใช้กรณี condo/mall ที่มีหลายคนส่งที่เดียวกัน
 * @param {string} geoId
 * @return {Object|null}
 */
function getDominantDestByGeo(geoId) {
  const index = loadDestinationIndex_();
  const filtered = index.byGeo[toSafeString_(geoId)] || [];
  return filtered.length > 0 ? filtered[0] : null;
}

// ============================================================
// SECTION 4: Data Loaders (with Cache)
// ============================================================

function loadAllDestinations_() {
  const cacheKey = 'M_DEST_ALL';
  const cache    = CacheService.getScriptCache();
  const cached   = cache.get(cacheKey);
  if (cached) { try { return JSON.parse(cached); } catch(e) {} }

  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET.M_DESTINATION);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1,
                SCHEMA.M_DESTINATION.length).getValues();

  const result = rows
    .filter(r => r[DEST_IDX.DEST_ID])
    .map(r => ({
      destId:    String(r[DEST_IDX.DEST_ID]     || ''),
      personId:  String(r[DEST_IDX.PERSON_ID]   || ''),
      placeId:   String(r[DEST_IDX.PLACE_ID]    || ''),
      geoId:     String(r[DEST_IDX.GEO_ID]      || ''),
      lat:       Number(r[DEST_IDX.LAT]          || 0),
      lng:       Number(r[DEST_IDX.LNG]          || 0),
      usageCount:Number(r[DEST_IDX.USAGE_COUNT]  || 0),
      lastSeen:  r[DEST_IDX.LAST_SEEN]            || '',
      status:    String(r[DEST_IDX.STATUS]        || ''),
    }));

  try { cache.put(cacheKey, JSON.stringify(result), AI_CONFIG.CACHE_TTL_SEC); }
  catch(e) {}
  return result;
}

function invalidateDestCache_() {
  CacheService.getScriptCache().remove('M_DEST_ALL');
  CacheService.getScriptCache().remove('IDX_DEST');
}

function loadDestinationIndex_() {
  const cacheKey = 'IDX_DEST';
  const cached = getCacheJson_(cacheKey);
  if (cached) return cached;

  const allDests = loadAllDestinations_();
  const activeDests = allDests.filter(d => d.status !== APP_CONST.STATUS_ARCHIVED);
  const index = { byPerson: {}, byPlace: {}, byPersonPlace: {}, byGeo: {} };

  const push = (bucket, key, item) => {
    if (!key) return;
    if (!bucket[key]) bucket[key] = [];
    bucket[key].push(item);
  };

  activeDests.forEach(dest => {
    push(index.byPerson, toSafeString_(dest.personId), dest);
    push(index.byPlace, toSafeString_(dest.placeId), dest);
    push(index.byPersonPlace, buildCompositeKey_(dest.personId, dest.placeId), dest);
    push(index.byGeo, toSafeString_(dest.geoId), dest);
  });

  Object.keys(index).forEach(bucketName => {
    Object.keys(index[bucketName]).forEach(key => {
      index[bucketName][key].sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0));
    });
  });

  putCacheJson_(cacheKey, index, AI_CONFIG.CACHE_TTL_SEC);
  return index;
}

function buildCompositeKey_(left, right) {
  return `${toSafeString_(left)}|${toSafeString_(right)}`;
}
