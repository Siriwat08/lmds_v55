/**
 * VERSION: 001
 * FILE: 16_GeoDictionaryBuilder.gs
 * LMDS V5.0 — Geo Dictionary Builder
 * ===================================================
 * หน้าที่: สร้าง Dictionary จังหวัด/เขต/ตำบล/รหัสไปรษณีย์
 *          จากชีต SYS_TH_GEO เพื่อให้ Module อื่นเรียกใช้
 *          แบบ Fast Lookup โดยไม่ต้อง Query Sheet ทุกครั้ง
 * ===================================================
 */

// ============================================================
// SECTION 1: Index ของชีต SYS_TH_GEO (0-based)
// ============================================================

const TH_GEO_IDX = {
  SUB_DISTRICT: 0,  // แขวง/ตำบล
  DISTRICT:     1,  // เขต/อำเภอ
  PROVINCE:     2,  // จังหวัด
  POSTCODE:     3,  // รหัสไปรษณีย์
  REGION:       4,  // ภูมิภาค
};

// ============================================================
// SECTION 2: Entry Point — สร้าง/รีเฟรช Dictionary
// ============================================================

/**
 * buildGeoDictionary — โหลด SYS_TH_GEO และสร้าง Lookup Maps
 * บันทึกลง CacheService เพื่อ Module อื่นเรียกใช้ได้เลย
 * เรียกครั้งแรกหลัง Import ข้อมูล SYS_TH_GEO
 */
function buildGeoDictionary() {
  const ss     = SpreadsheetApp.getActiveSpreadsheet();
  const sheet  = ss.getSheetByName(SHEET.SYS_TH_GEO);

  if (!sheet || sheet.getLastRow() < 2) {
    logWarn('GeoDictBuilder',
      'SYS_TH_GEO ว่างอยู่ — กรุณา Import ข้อมูลภูมิศาสตร์ไทยก่อน');
    SpreadsheetApp.getUi().alert(
      '⚠️ SYS_TH_GEO ยังไม่มีข้อมูล\n' +
      'กรุณา Import ข้อมูลภูมิศาสตร์ไทย (จังหวัด/ตำบล/ไปรษณีย์) ลงชีต SYS_TH_GEO ก่อน'
    );
    return;
  }

  logInfo('GeoDictBuilder', 'เริ่มสร้าง Geo Dictionary');

  // [RULE 6] อ่านทั้งหมดในครั้งเดียว
  const totalRows = sheet.getLastRow() - 1;
  const allData   = sheet.getRange(2, 1, totalRows, 5).getValues();

  // สร้าง 3 Lookup Maps
  const postcodeMap  = {};  // postcode → { province, district, subDistrict }
  const provinceSet  = new Set();
  const districtMap  = {};  // province → [districts]

  allData.forEach(row => {
    const subDist  = String(row[TH_GEO_IDX.SUB_DISTRICT] || '').trim();
    const district = String(row[TH_GEO_IDX.DISTRICT]     || '').trim();
    const province = String(row[TH_GEO_IDX.PROVINCE]     || '').trim();
    const postcode = String(row[TH_GEO_IDX.POSTCODE]     || '').trim();

    if (!province) return;

    // สร้าง postcode → location map
    if (postcode && !postcodeMap[postcode]) {
      postcodeMap[postcode] = { province, district, subDistrict: subDist };
    }

    // สร้าง province set
    provinceSet.add(province);

    // สร้าง province → districts map
    if (!districtMap[province]) districtMap[province] = new Set();
    if (district) districtMap[province].add(district);
  });

  // แปลง Set เป็น Array เพื่อ JSON.stringify ได้
  const districtMapArr = {};
  Object.keys(districtMap).forEach(prov => {
    districtMapArr[prov] = [...districtMap[prov]];
  });

  // บันทึกลง CacheService (6 ชั่วโมง)
  const cache = CacheService.getScriptCache();
  try {
    cache.put('TH_GEO_POSTCODE',  JSON.stringify(postcodeMap),  AI_CONFIG.CACHE_TTL_SEC);
    cache.put('TH_GEO_PROVINCES', JSON.stringify([...provinceSet]), AI_CONFIG.CACHE_TTL_SEC);
    cache.put('TH_GEO_DISTRICTS', JSON.stringify(districtMapArr),   AI_CONFIG.CACHE_TTL_SEC);
  } catch (e) {
    logWarn('GeoDictBuilder', 'ข้อมูลใหญ่เกิน Cache — ใช้ Query โดยตรงแทน');
  }

  logInfo('GeoDictBuilder',
    `สร้าง Dictionary เสร็จ — ${totalRows} แถว ` +
    `${provinceSet.size} จังหวัด ${Object.keys(postcodeMap).length} ไปรษณีย์`
  );

  SpreadsheetApp.getUi().alert(
    `✅ สร้าง Geo Dictionary เสร็จ!\n\n` +
    `  จำนวนแถว:     ${totalRows}\n` +
    `  จังหวัด:       ${provinceSet.size}\n` +
    `  รหัสไปรษณีย์: ${Object.keys(postcodeMap).length}`
  );
}

// ============================================================
// SECTION 3: Lookup Functions (ใช้ได้จากทุก Module)
// ============================================================

/**
 * lookupByPostcode — ค้นหาจังหวัด/เขต/ตำบล จากรหัสไปรษณีย์
 * @param {string} postcode
 * @return {{ province, district, subDistrict } | null}
 */
function lookupByPostcode(postcode) {
  const clean = String(postcode || '').trim().replace(/[^0-9]/g, '');
  if (clean.length !== 5) return null;

  const cached = getCachedPostcodeMap_();
  return cached[clean] || null;
}

/**
 * lookupProvinceFromAddress — ค้นหาจังหวัดจากที่อยู่ดิบ
 * วิธีการ: ค้นหาชื่อจังหวัดใน String ที่อยู่
 * @param {string} rawAddress
 * @return {string} ชื่อจังหวัด หรือ ''
 */
function lookupProvinceFromAddress(rawAddress) {
  if (!rawAddress) return '';

  const addr      = String(rawAddress).trim();
  const provinces = getCachedProvinces_();

  // ค้นหาชื่อจังหวัดใน Address โดยตรง
  for (const province of provinces) {
    if (addr.includes(province)) return province;
  }

  // ค้นหารูปแบบย่อ "จ.เชียงใหม่"
  const shortMatch = addr.match(/จ\.([^\s,]+)/);
  if (shortMatch) {
    const short = shortMatch[1];
    const found = provinces.find(p => p.includes(short) || short.includes(p.substring(0, 3)));
    if (found) return found;
  }

  // ค้นหาจากรหัสไปรษณีย์ใน Address
  const postcodeMatch = addr.match(/\b[0-9]{5}\b/);
  if (postcodeMatch) {
    const loc = lookupByPostcode(postcodeMatch[0]);
    if (loc) return loc.province;
  }

  return '';
}

/**
 * isValidProvince — ตรวจสอบว่าเป็นชื่อจังหวัดจริงในระบบ
 * @param {string} provinceName
 * @return {boolean}
 */
function isValidProvince(provinceName) {
  if (!provinceName) return false;
  const provinces = getCachedProvinces_();
  return provinces.includes(provinceName.trim());
}

// ============================================================
// SECTION 4: Internal Cache Getters
// ============================================================

/**
 * getCachedPostcodeMap_ — ดึง Postcode Map จาก Cache หรือสร้างใหม่
 * @return {Object} postcode → { province, district, subDistrict }
 */
function getCachedPostcodeMap_() {
  const cache  = CacheService.getScriptCache();
  const cached = cache.get('TH_GEO_POSTCODE');
  if (cached) {
    try { return JSON.parse(cached); } catch(e) {}
  }
  // Cache หมดอายุ — Query จาก Sheet โดยตรง
  return buildPostcodeMapFromSheet_();
}

/**
 * getCachedProvinces_ — ดึงรายชื่อจังหวัดทั้งหมด
 * @return {string[]}
 */
function getCachedProvinces_() {
  const cache  = CacheService.getScriptCache();
  const cached = cache.get('TH_GEO_PROVINCES');
  if (cached) {
    try { return JSON.parse(cached); } catch(e) {}
  }
  return buildProvincesFromSheet_();
}

/**
 * buildPostcodeMapFromSheet_ — Query ตรงจาก SYS_TH_GEO
 * @return {Object}
 */
function buildPostcodeMapFromSheet_() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET.SYS_TH_GEO);
  if (!sheet || sheet.getLastRow() < 2) return {};

  const data   = sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).getValues();
  const result = {};

  data.forEach(row => {
    const postcode = String(row[TH_GEO_IDX.POSTCODE] || '').trim();
    if (postcode && !result[postcode]) {
      result[postcode] = {
        province:    String(row[TH_GEO_IDX.PROVINCE]     || '').trim(),
        district:    String(row[TH_GEO_IDX.DISTRICT]     || '').trim(),
        subDistrict: String(row[TH_GEO_IDX.SUB_DISTRICT] || '').trim(),
      };
    }
  });

  return result;
}

/**
 * buildProvincesFromSheet_ — Query ตรงจาก SYS_TH_GEO
 * @return {string[]}
 */
function buildProvincesFromSheet_() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET.SYS_TH_GEO);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const data      = sheet.getRange(2, TH_GEO_IDX.PROVINCE + 1,
                     sheet.getLastRow() - 1, 1).getValues();
  const provinceSet = new Set();

  data.forEach(row => {
    const province = String(row[0] || '').trim();
    if (province) provinceSet.add(province);
  });

  return [...provinceSet];
}

/**
 * invalidateGeoDictCache — ล้าง Cache ของ Geo Dictionary
 * เรียกหลัง Import SYS_TH_GEO ใหม่
 */
function invalidateGeoDictCache() {
  CacheService.getScriptCache().removeAll([
    'TH_GEO_POSTCODE',
    'TH_GEO_PROVINCES',
    'TH_GEO_DISTRICTS',
  ]);
  logInfo('GeoDictBuilder', 'ล้าง Geo Dictionary Cache เรียบร้อย');
}
