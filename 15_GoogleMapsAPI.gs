/**
 * VERSION: 001
 * FILE: 15_GoogleMapsAPI.gs
 * LMDS V5.0 — Google Maps API Service
 * ===================================================
 * หน้าที่: Geocoding / Reverse Geocoding ผ่าน Maps Service
 *   - Hybrid Cache 2 ชั้น: CacheService (RAM) + MAPS_CACHE (Sheet)
 *   - ไม่ต้องจ่ายเงิน Google Cloud — ใช้ Apps Script Maps Service
 * อ้างอิง: Google_Maps_Amit_Agarwal.md
 * ===================================================
 */

// ============================================================
// SECTION 1: Geocoding (Address → LatLng)
// ============================================================

/**
 * geocodeAddress — แปลงที่อยู่เป็นพิกัด GPS
 * Hybrid Cache: RAM 6 ชม. → Sheet ถาวร → Maps API
 * @param {string} address - ที่อยู่ที่ต้องการค้นหา
 * @return {{ lat: number, lng: number, resolvedAddr: string } | null}
 */
function geocodeAddress(address) {
  if (!address || String(address).trim().length < 5) return null;

  const cleanAddr = String(address).trim();
  const cacheKey  = 'GEO_' + generateMd5Hash(cleanAddr);

  // ชั้น 1: CacheService (RAM)
  const ramCache   = CacheService.getScriptCache();
  const ramCached  = ramCache.get(cacheKey);
  if (ramCached) {
    try { return JSON.parse(ramCached); } catch(e) {}
  }

  // ชั้น 2: Sheet Cache (ถาวร)
  const sheetResult = getFromSheetCache_(cacheKey);
  if (sheetResult) {
    ramCache.put(cacheKey, JSON.stringify(sheetResult), AI_CONFIG.CACHE_TTL_SEC);
    return sheetResult;
  }

  // ชั้น 3: เรียก Maps API จริง
  let result = null;
  let retries = 0;

  while (retries < APP_CONST.MAX_RETRIES) {
    try {
      const geoResult = Maps.newGeocoder()
                            .setLanguage('th')
                            .setRegion('TH')
                            .geocode(cleanAddr);

      if (geoResult.status === 'OK' && geoResult.results.length > 0) {
        const loc = geoResult.results[0].geometry.location;
        result = {
          lat:          loc.lat,
          lng:          loc.lng,
          resolvedAddr: geoResult.results[0].formatted_address || cleanAddr,
        };
      }
      break;

    } catch (apiErr) {
      retries++;
      if (retries < APP_CONST.MAX_RETRIES) {
        Utilities.sleep(1000 * retries); // รอเพิ่มขึ้นทีละ 1 วินาที
      } else {
        logError('MapsAPI', `geocodeAddress ล้มเหลว (${retries}x): ${apiErr.message}`);
      }
    }
  }

  // บันทึก Cache ถ้าเจอผล
  if (result) {
    ramCache.put(cacheKey, JSON.stringify(result), AI_CONFIG.CACHE_TTL_SEC);
    saveToSheetCache_(cacheKey, cleanAddr, result);
  }

  return result;
}

// ============================================================
// SECTION 2: Reverse Geocoding (LatLng → Address)
// ============================================================

/**
 * reverseGeocode — แปลงพิกัด GPS เป็นที่อยู่
 * @param {number} lat
 * @param {number} lng
 * @return {{ resolvedAddr: string, province: string, district: string } | null}
 */
function reverseGeocode(lat, lng) {
  if (!isValidLatLng(lat, lng)) return null;

  const cacheKey  = 'RGEO_' + generateMd5Hash(`${lat},${lng}`);
  const ramCache  = CacheService.getScriptCache();
  const ramCached = ramCache.get(cacheKey);
  if (ramCached) {
    try { return JSON.parse(ramCached); } catch(e) {}
  }

  // Reverse geocode ใช้เฉพาะ RAM cache เพราะ MAPS_CACHE schema ปัจจุบัน
  // ถูกออกแบบมาสำหรับ geocode (lat/lng/resolvedAddr) เป็นหลัก
  let result  = null;
  let retries = 0;

  while (retries < APP_CONST.MAX_RETRIES) {
    try {
      const geoResult = Maps.newGeocoder()
                            .setLanguage('th')
                            .reverseGeocode(lat, lng);

      if (geoResult.status === 'OK' && geoResult.results.length > 0) {
        const components = geoResult.results[0].address_components || [];
        result = {
          resolvedAddr: geoResult.results[0].formatted_address || '',
          province:     extractAddrComponent_(components, 'administrative_area_level_1'),
          district:     extractAddrComponent_(components, 'administrative_area_level_2'),
        };
      }
      break;

    } catch (apiErr) {
      retries++;
      if (retries < APP_CONST.MAX_RETRIES) {
        Utilities.sleep(1000 * retries);
      } else {
        logError('MapsAPI', `reverseGeocode ล้มเหลว: ${apiErr.message}`);
      }
    }
  }

  if (result) {
    ramCache.put(cacheKey, JSON.stringify(result), AI_CONFIG.CACHE_TTL_SEC);
  }

  return result;
}

/**
 * extractAddrComponent_ — ดึงค่าจาก Address Component ตาม Type
 * @param {Array} components
 * @param {string} typeName
 * @return {string}
 */
function extractAddrComponent_(components, typeName) {
  const comp = components.find(c => c.types && c.types.includes(typeName));
  return comp ? (comp.long_name || '') : '';
}

// ============================================================
// SECTION 3: Distance & Duration
// ============================================================

/**
 * getRouteDistanceKm — ระยะทางบนถนนจริง (ไม่ใช่เส้นตรง)
 * @param {string} originAddr
 * @param {string} destAddr
 * @return {number} กิโลเมตร หรือ -1 ถ้าล้มเหลว
 */
function getRouteDistanceKm(originAddr, destAddr) {
  try {
    const directions = Maps.newDirectionFinder()
      .setOrigin(originAddr)
      .setDestination(destAddr)
      .setMode(Maps.DirectionFinder.Mode.DRIVING)
      .getDirections();

    if (directions.status === 'OK' &&
        directions.routes && directions.routes.length > 0) {
      const legs        = directions.routes[0].legs;
      const totalMeters = legs.reduce((sum, leg) => sum + leg.distance.value, 0);
      return Math.round(totalMeters / 100) / 10; // เมตร → กิโลเมตร 1 ทศนิยม
    }
  } catch (err) {
    logError('MapsAPI', `getRouteDistanceKm ล้มเหลว: ${err.message}`);
  }
  return -1;
}

// ============================================================
// SECTION 4: Sheet Cache (Persistent)
// ============================================================

/**
 * getFromSheetCache_ — ดึงข้อมูลจาก MAPS_CACHE Sheet
 * @param {string} cacheKey
 * @return {Object | null}
 */
function getFromSheetCache_(cacheKey) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET.MAPS_CACHE);
  if (!sheet || sheet.getLastRow() < 2) return null;

  const data    = sheet.getRange(2, 1, sheet.getLastRow() - 1,
                   SCHEMA.MAPS_CACHE.length).getValues();
  const keyCol  = 0; // cache_key index
  const latCol  = 2;
  const lngCol  = 3;
  const addrCol = 4;
  const hitCol  = 7;

  for (let i = 0; i < data.length; i++) {
    if (String(data[i][keyCol]).trim() === cacheKey) {
      // อัปเดต hit_count
      sheet.getRange(i + 2, hitCol + 1)
           .setValue(Number(data[i][hitCol] || 0) + 1);

      return {
        lat:          Number(data[i][latCol])  || 0,
        lng:          Number(data[i][lngCol])  || 0,
        resolvedAddr: String(data[i][addrCol]) || '',
      };
    }
  }
  return null;
}

/**
 * saveToSheetCache_ — บันทึกผลใน MAPS_CACHE Sheet
 * @param {string} cacheKey
 * @param {string} inputAddr
 * @param {Object} result  — { lat, lng, resolvedAddr }
 */
function saveToSheetCache_(cacheKey, inputAddr, result) {
  try {
    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET.MAPS_CACHE);
    if (!sheet) return;

    const lastRow = sheet.getLastRow();
    if (lastRow >= 2) {
      const keyValues = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      for (let i = 0; i < keyValues.length; i++) {
        if (toSafeString_(keyValues[i][0]) === cacheKey) {
          const targetRow = i + 2;
          const currentHit = safeNumber_(sheet.getRange(targetRow, 8).getValue(), 0);
          sheet.getRange(targetRow, 2, 1, 7).setValues([[
            inputAddr,
            result.lat || 0,
            result.lng || 0,
            result.resolvedAddr || '',
            'maps_api',
            new Date(),
            currentHit + 1,
          ]]);
          return;
        }
      }
    }

    sheet.appendRow([
      cacheKey,
      inputAddr,
      result.lat || 0,
      result.lng || 0,
      result.resolvedAddr || '',
      'maps_api',
      new Date(),
      1,
    ]);
  } catch (err) {
    logError('MapsAPI', `saveToSheetCache_ ล้มเหลว: ${err.message}`);
  }
}

/**
 * clearMapsCache — ล้าง MAPS_CACHE Sheet ทั้งหมด (Admin Tool)
 * เรียกผ่าน Script Editor โดยตรง
 */
function clearMapsCache() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET.MAPS_CACHE);
  if (!sheet || sheet.getLastRow() < 2) return;

  // [RULE 4] ใช้ deleteRows แทน clearContent เพราะเป็น Cache (ไม่ใช่ Master)
  sheet.deleteRows(2, sheet.getLastRow() - 1);
  logInfo('MapsAPI', 'ล้าง MAPS_CACHE เรียบร้อย (RAM cache จะหมดอายุเองตาม TTL)');
}
