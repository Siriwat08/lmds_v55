/**
 * VERSION: 001
 * FILE: 08_GeoService.gs
 * LMDS V5.0 — Geo Point Master Service
 * ===================================================
 * หน้าที่: จัดการข้อมูล M_GEO_POINT
 *          - ค้นหาพิกัดที่ใกล้เคียงด้วย Haversine Distance
 *          - สร้าง Geo Point ใหม่
 *          - Grid Search สำหรับ Performance
 * ===================================================
 */

// ============================================================
// SECTION 1: resolveGeo — ค้นหาหรือสร้าง Geo Point
// ============================================================

/**
 * resolveGeo — ค้นหา Geo Point ที่ใกล้ที่สุดใน M_GEO_POINT
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @return {{
 *   geoId: string,
 *   status: string,    FOUND / NOT_FOUND / INVALID
 *   confidence: number,
 *   distanceM: number
 * }}
 */
function resolveGeo(lat, lng) {
  // ตรวจสอบพิกัดก่อน
  if (!lat || !lng || lat === 0 || lng === 0) {
    return { geoId: null, status: 'INVALID', confidence: 0, distanceM: -1 };
  }

  // ตรวจว่าพิกัดอยู่ในประเทศไทยหรือไม่ (กรอบคร่าว)
  if (lat < 5.5 || lat > 20.5 || lng < 97.5 || lng > 105.7) {
    return { geoId: null, status: 'OUT_OF_BOUNDS', confidence: 0, distanceM: -1 };
  }

  const candidates = findGeoCandidates_(lat, lng);
  if (candidates.length === 0) {
    return { geoId: null, status: 'NOT_FOUND', confidence: 0, distanceM: -1 };
  }

  // เลือก Geo Point ที่ใกล้ที่สุด
  let bestGeo  = null;
  let minDist  = Infinity;

  candidates.forEach(geo => {
    const distM = haversineDistanceM(lat, lng, geo.lat, geo.lng);
    if (distM < minDist) {
      minDist  = distM;
      bestGeo  = geo;
    }
  });

  const radius     = Number(bestGeo.radiusM) || AI_CONFIG.GEO_RADIUS_M;
  const isInRadius = minDist <= radius;

  if (!isInRadius) {
    return { geoId: null, status: 'NOT_FOUND', confidence: 0, distanceM: minDist };
  }

  // คำนวณ Confidence แบบ Proportional (จาก aistudio.md)
  const confidence = Math.round(100 - ((minDist / radius) * 30));

  return {
    geoId:      bestGeo.geoId,
    status:     'FOUND',
    confidence: Math.min(confidence, 100),
    distanceM:  Math.round(minDist),
  };
}

// ============================================================
// SECTION 2: findGeoCandidates_ — ค้นหาด้วย Grid Key (เร็ว)
// ============================================================

/**
 * findGeoCandidates_ — Pre-filter ด้วย Grid Key ก่อน Haversine
 * แบ่ง Grid ขนาด 0.01 องศา (~1.1 กม.) และค้นหา 9 ช่องรอบๆ
 * @param {number} lat
 * @param {number} lng
 * @return {Object[]}
 */
function findGeoCandidates_(lat, lng) {
  const allGeos  = loadAllGeos_();
  const gridSize = 0.01; // ประมาณ 1.1 กม.

  // สร้าง Grid Keys ของ 9 ช่องรอบๆ จุดค้นหา
  const searchKeys = [];
  for (let dlat = -1; dlat <= 1; dlat++) {
    for (let dlng = -1; dlng <= 1; dlng++) {
      const gridLat = Math.floor((lat + dlat * gridSize) / gridSize);
      const gridLng = Math.floor((lng + dlng * gridSize) / gridSize);
      searchKeys.push(`${gridLat}_${gridLng}`);
    }
  }

  const keySet = new Set(searchKeys);
  return allGeos.filter(geo => keySet.has(geo.gridKey));
}

/**
 * buildGridKey_ — สร้าง Grid Key จากพิกัด
 * @param {number} lat
 * @param {number} lng
 * @return {string}
 */
function buildGridKey_(lat, lng) {
  const gridSize = 0.01;
  const gLat     = Math.floor(lat / gridSize);
  const gLng     = Math.floor(lng / gridSize);
  return `${gLat}_${gLng}`;
}

// ============================================================
// SECTION 3: CRUD
// ============================================================

/**
 * createGeoPoint — สร้าง Geo Point ใหม่ใน M_GEO_POINT
 * @param {number} lat
 * @param {number} lng
 * @param {string} source - driver / maps / manual
 * @param {string} resolvedAddr - ที่อยู่จาก Reverse Geocode
 * @param {string} province
 * @param {string} district
 * @return {string} geo_id
 */
function createGeoPoint(lat, lng, source, resolvedAddr, province, district) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET.M_GEO_POINT);
  const now   = new Date();
  const newId = 'G' + Utilities.getUuid().replace(/-/g, '').substring(0, 12)
                                         .toUpperCase();

  const newRow = [
    newId,                      // [0] geo_id
    lat,                        // [1] lat
    lng,                        // [2] lng
    AI_CONFIG.GEO_RADIUS_M,    // [3] radius_m (default 50 ม.)
    resolvedAddr || '',         // [4] resolved_address
    province     || '',         // [5] province
    district     || '',         // [6] district
    source       || 'driver',   // [7] source
    85,                         // [8] coord_confidence (default)
    now,                        // [9] first_seen
    now,                        // [10] last_seen
    1,                          // [11] usage_count
    APP_CONST.STATUS_ACTIVE,    // [12] record_status
  ];

  sheet.appendRow(newRow);
  invalidateGeoCache_();
  logDebug('GeoService', `createGeoPoint: ${newId} (${lat},${lng})`);
  return newId;
}

/**
 * updateGeoStats — อัปเดต last_seen และ usage_count
 * @param {string} geoId
 */
function updateGeoStats(geoId) {
  try {
    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET.M_GEO_POINT);
    const data  = sheet.getRange(1, 1, sheet.getLastRow(),
                   SCHEMA.M_GEO_POINT.length).getValues();
    const headers = data[0];
    const idCol   = headers.indexOf('geo_id');

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][idCol]) === geoId) {
        const targetRow = i + 1;
        sheet.getRange(targetRow, GEO_IDX.LAST_SEEN + 1).setValue(new Date());
        const curr = Number(data[i][GEO_IDX.USAGE_COUNT]) || 0;
        sheet.getRange(targetRow, GEO_IDX.USAGE_COUNT + 1).setValue(curr + 1);
        invalidateGeoCache_();
        break;
      }
    }
  } catch (err) {
    logError('GeoService', `updateGeoStats ล้มเหลว: ${err.message}`);
  }
}

// ============================================================
// SECTION 4: Data Loaders (with Cache)
// ============================================================

function loadAllGeos_() {
  const cacheKey = 'M_GEO_ALL';
  const cache    = CacheService.getScriptCache();
  const cached   = cache.get(cacheKey);
  if (cached) { try { return JSON.parse(cached); } catch(e) {} }

  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET.M_GEO_POINT);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1,
                SCHEMA.M_GEO_POINT.length).getValues();

  const result = rows
    .filter(r => r[GEO_IDX.GEO_ID])
    .filter(r => r[GEO_IDX.STATUS] !== APP_CONST.STATUS_ARCHIVED)
    .map(r => ({
      geoId:      String(r[GEO_IDX.GEO_ID]),
      lat:        Number(r[GEO_IDX.LAT])        || 0,
      lng:        Number(r[GEO_IDX.LNG])        || 0,
      radiusM:    Number(r[GEO_IDX.RADIUS_M])   || 50,
      province:   String(r[GEO_IDX.PROVINCE]    || ''),
      district:   String(r[GEO_IDX.DISTRICT]    || ''),
      confidence: Number(r[GEO_IDX.CONFIDENCE]  || 0),
      usageCount: Number(r[GEO_IDX.USAGE_COUNT] || 0),
      // Grid Key เพื่อ Pre-filter
      gridKey: buildGridKey_(Number(r[GEO_IDX.LAT]), Number(r[GEO_IDX.LNG])),
    }));

  try { cache.put(cacheKey, JSON.stringify(result), AI_CONFIG.CACHE_TTL_SEC); }
  catch(e) {}
  return result;
}

function invalidateGeoCache_() {
  CacheService.getScriptCache().remove('M_GEO_ALL');
}
