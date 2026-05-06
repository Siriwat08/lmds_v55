/**
 * VERSION: 001
 * FILE: 14_Utils.gs
 * LMDS V5.0 — Utility Functions
 * ===================================================
 * หน้าที่: ฟังก์ชันคณิตศาสตร์ที่ใช้ทั่วระบบ
 *   - Levenshtein Distance
 *   - Dice Coefficient (Bigram)
 *   - Haversine Distance (GPS)
 *   - UUID / Hash
 * ===================================================
 */

// ============================================================
// SECTION 1: String Similarity
// ============================================================

/**
 * levenshteinDistance — คำนวณระยะห่างระหว่าง 2 String
 * ใช้ Dynamic Programming — O(n*m)
 * @param {string} strA
 * @param {string} strB
 * @return {number} จำนวน Edit Operations ขั้นต่ำ
 */
function levenshteinDistance(strA, strB) {
  const lenA = strA.length;
  const lenB = strB.length;
  if (lenA === 0) return lenB;
  if (lenB === 0) return lenA;
  if (strA === strB) return 0;

  // สร้าง Matrix ขนาด (lenA+1) x (lenB+1)
  const matrix = [];
  for (let i = 0; i <= lenA; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= lenB; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= lenA; i++) {
    for (let j = 1; j <= lenB; j++) {
      const cost = strA[i - 1] === strB[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j]     + 1,    // ลบ
        matrix[i][j - 1]     + 1,    // แทรก
        matrix[i - 1][j - 1] + cost  // แทนที่
      );
    }
  }
  return matrix[lenA][lenB];
}

/**
 * diceCoefficient — คำนวณ Dice Similarity ด้วย Bigram
 * เหมาะกับชื่อภาษาไทยที่มี Bigram ซ้ำกัน
 * @param {string} strA
 * @param {string} strB
 * @return {number} 0.0 – 1.0
 */
function diceCoefficient(strA, strB) {
  if (!strA || !strB) return 0;
  if (strA === strB) return 1;
  if (strA.length < 2 || strB.length < 2) return 0;

  const bigramsA = buildBigramSet_(strA);
  const bigramsB = buildBigramSet_(strB);
  let intersection = 0;

  bigramsA.forEach(bg => {
    if (bigramsB.has(bg)) intersection++;
  });

  return (2 * intersection) / (bigramsA.size + bigramsB.size);
}

/**
 * buildBigramSet_ — สร้าง Set ของ Bigram จาก String
 * @param {string} str
 * @return {Set<string>}
 */
function buildBigramSet_(str) {
  const set = new Set();
  for (let i = 0; i < str.length - 1; i++) {
    set.add(str.substring(i, i + 2));
  }
  return set;
}

// ============================================================
// SECTION 2: GPS Distance
// ============================================================

/**
 * haversineDistanceM — คำนวณระยะทางระหว่าง 2 พิกัด GPS
 * ใช้สูตร Haversine — คืนค่าเป็น เมตร
 * @param {number} lat1
 * @param {number} lng1
 * @param {number} lat2
 * @param {number} lng2
 * @return {number} ระยะทางหน่วยเมตร
 */
function haversineDistanceM(lat1, lng1, lat2, lng2) {
  const earthRadiusM = 6371000;
  const toRad        = Math.PI / 180;

  const diffLat = (lat2 - lat1) * toRad;
  const diffLng = (lng2 - lng1) * toRad;

  const sinHalfLat = Math.sin(diffLat / 2);
  const sinHalfLng = Math.sin(diffLng / 2);

  const aVal =
    sinHalfLat * sinHalfLat +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) *
    sinHalfLng * sinHalfLng;

  const centralAngle = 2 * Math.atan2(Math.sqrt(aVal), Math.sqrt(1 - aVal));
  return earthRadiusM * centralAngle;
}

/**
 * haversineDistanceKm — คืนระยะทางหน่วย กิโลเมตร
 * @param {number} lat1
 * @param {number} lng1
 * @param {number} lat2
 * @param {number} lng2
 * @return {number}
 */
function haversineDistanceKm(lat1, lng1, lat2, lng2) {
  return haversineDistanceM(lat1, lng1, lat2, lng2) / 1000;
}

// ============================================================
// SECTION 3: Short UUID Generator
// ============================================================

/**
 * generateShortId — สร้าง ID สั้น 12 ตัวอักษร (uppercase)
 * @param {string} prefix - คำนำหน้า เช่น 'P', 'G', 'D'
 * @return {string}
 */
function generateShortId(prefix) {
  const raw = Utilities.getUuid().replace(/-/g, '').toUpperCase();
  return (prefix || '') + raw.substring(0, 12);
}

/**
 * generateMd5Hash — สร้าง MD5 Hash สำหรับ Cache Key
 * @param {string} input
 * @return {string} hex string
 */
function generateMd5Hash(input) {
  const rawBytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.MD5,
    String(input)
  );
  return rawBytes.map(b => {
    const hex = (b < 0 ? b + 256 : b).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('');
}

// ============================================================
// SECTION 4: Date Utilities
// ============================================================

/**
 * toThaiDateStr — แปลง Date เป็น String รูปแบบไทย
 * @param {Date} date
 * @return {string} เช่น "15/05/2568"
 */
function toThaiDateStr(date) {
  if (!date) return '';
  const d = new Date(date);
  const day   = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year  = d.getFullYear() + 543;
  return `${day}/${month}/${year}`;
}

/**
 * isValidLatLng — ตรวจสอบว่าพิกัดอยู่ในประเทศไทย
 * @param {number} lat
 * @param {number} lng
 * @return {boolean}
 */
function isValidLatLng(lat, lng) {
  const numLat = Number(lat);
  const numLng = Number(lng);
  if (isNaN(numLat) || isNaN(numLng)) return false;
  if (numLat === 0 && numLng === 0)   return false;
  // กรอบคร่าวของประเทศไทย
  return numLat >= 5.5 && numLat <= 20.5 &&
         numLng >= 97.5 && numLng <= 105.7;
}

/**
 * parseLatLng — แปลง String "lat,lng" หรือ "lat/lng" เป็น Object
 * @param {string} latLngStr - เช่น "13.7563,100.5018"
 * @return {{ lat: number, lng: number } | null}
 */
function parseLatLng(latLngStr) {
  if (!latLngStr) return null;
  const cleaned = String(latLngStr).trim();
  const parts   = cleaned.split(/[,\/]/);
  if (parts.length < 2) return null;
  const lat = parseFloat(parts[0].trim());
  const lng = parseFloat(parts[1].trim());
  if (isNaN(lat) || isNaN(lng)) return null;
  return { lat, lng };
}


// ============================================================
// SECTION 5: Phase 2 Hardening Helpers
// ============================================================

function toSafeString_(value) {
  return String(value == null ? '' : value).trim();
}

function safeNumber_(value, fallback) {
  const num = Number(value);
  return isNaN(num) ? (fallback || 0) : num;
}

function uniqueNonEmptyStrings_(values) {
  const seen = new Set();
  const result = [];
  (values || []).forEach(value => {
    const text = toSafeString_(value);
    if (!text || seen.has(text)) return;
    seen.add(text);
    result.push(text);
  });
  return result;
}

function normalizeJoinKey_(value) {
  return (typeof normalizeForCompare === 'function')
    ? normalizeForCompare(toSafeString_(value))
    : toSafeString_(value).toLowerCase();
}

function dedupeObjectsByKey_(items, keyFn) {
  const out = [];
  const seen = new Set();
  (items || []).forEach(item => {
    const key = toSafeString_(keyFn(item));
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(item);
  });
  return out;
}

function getCacheJson_(cacheKey) {
  try {
    const raw = CacheService.getScriptCache().get(cacheKey);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

function putCacheJson_(cacheKey, value, ttlSec) {
  try {
    CacheService.getScriptCache().put(cacheKey, JSON.stringify(value), ttlSec || AI_CONFIG.CACHE_TTL_SEC);
  } catch (err) {}
}

function chunkArray_(items, size) {
  const result = [];
  const chunkSize = Math.max(1, Number(size) || 1);
  for (let i = 0; i < items.length; i += chunkSize) {
    result.push(items.slice(i, i + chunkSize));
  }
  return result;
}
