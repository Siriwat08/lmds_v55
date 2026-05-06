/**
 * VERSION: 001
 * FILE: 05_NormalizeService.gs
 * LMDS V5.0 — Thai Name & Place Normalization Service
 * ===================================================
 * หน้าที่: ล้างชื่อบุคคลและสถานที่ภาษาไทย
 *          - ตัดยศ/ตำแหน่ง/คำนำหน้า
 *          - จับ บจก./หจก. และนิติบุคคลออก
 *          - ดึงเบอร์โทรและ Note พิเศษออกมา
 * อ้างอิง: gemini.md — Dictionary ชุดสมบูรณ์
 * ===================================================
 */

// ============================================================
// SECTION 1: Dictionary — คำนำหน้าและยศทหาร/ตำรวจ
// เรียงจากยาวไปสั้นเพื่อ Greedy Match
// ============================================================

const PERSON_PREFIX_LIST = [
  // ยศทหารบก
  'พลเอก', 'พลโท', 'พลตรี', 'พันเอก', 'พันโท', 'พันตรี',
  'ร้อยเอก', 'ร้อยโท', 'ร้อยตรี',
  'จ่าสิบเอก', 'จ่าสิบโท', 'จ่าสิบตรี',
  'สิบเอก', 'สิบโท', 'สิบตรี', 'พลทหาร',
  // ยศทหารเรือ
  'พลเรือเอก', 'พลเรือโท', 'พลเรือตรี',
  'นาวาเอก', 'นาวาโท', 'นาวาตรี',
  'เรือเอก', 'เรือโท', 'เรือตรี',
  // ยศทหารอากาศ
  'พลอากาศเอก', 'พลอากาศโท', 'พลอากาศตรี',
  'นาวาอากาศเอก', 'นาวาอากาศโท', 'นาวาอากาศตรี',
  'เรืออากาศเอก', 'เรืออากาศโท', 'เรืออากาศตรี',
  // ยศตำรวจ
  'พลตำรวจเอก', 'พลตำรวจโท', 'พลตำรวจตรี',
  'พันตำรวจเอก', 'พันตำรวจโท', 'พันตำรวจตรี',
  'ร้อยตำรวจเอก', 'ร้อยตำรวจโท', 'ร้อยตำรวจตรี',
  'สิบตำรวจเอก', 'สิบตำรวจโท', 'สิบตำรวจตรี',
  'พลตำรวจ', 'ผู้กำกับ', 'รองผู้กำกับ',
  // ตำแหน่งวิชาการ
  'ศาสตราจารย์', 'รองศาสตราจารย์', 'ผู้ช่วยศาสตราจารย์',
  'ดร.', 'ดร',
  // คำนำหน้าทั่วไป
  'นายแพทย์', 'แพทย์หญิง', 'ทันตแพทย์', 'เภสัชกร',
  'วิศวกร', 'สถาปนิก',
  'นาย', 'นาง', 'นางสาว', 'น.ส.',
  'คุณ', 'ครู', 'อาจารย์',
  // ตัวย่อ
  'พ.อ.', 'พ.ต.', 'ร.อ.', 'ร.ต.', 'ส.อ.',
  'พ.ต.อ.', 'พ.ต.ท.', 'พ.ต.ต.',
  'ร.ต.อ.', 'ร.ต.ท.', 'ร.ต.ต.',
];

// ============================================================
// SECTION 2: Dictionary — ประเภทนิติบุคคล / ร้านค้าขนาดใหญ่
// ============================================================

const COMPANY_SUFFIX_LIST = [
  'จำกัด(มหาชน)', 'จำกัด (มหาชน)', 'มหาชน',
  'จำกัด', 'จก.', '(จำกัด)',
  'บริษัท', 'บจก.', 'บจ.', 'บมจ.',
  'ห้างหุ้นส่วนจำกัด', 'หจก.', 'หจ.',
  'ห้างหุ้นส่วนสามัญ', 'หสน.',
  'ร้าน', 'ร้านค้า', 'กิจการ',
  'หจก', 'บจก', 'บมจ',
];

const CHAIN_STORE_LIST = [
  'ไทวัสดุ', 'โฮมโปร', 'โกลบอลเฮ้าส์', 'สยามโกลบอล',
  'แพลนท์ปูน', 'ปูนซีเมนต์', 'ศูนย์บริการ',
  'ไซต์งาน', 'โครงการ', 'หน่วยงาน',
  'วัสดุภัณฑ์', 'วัสดุก่อสร้าง',
];

// ============================================================
// SECTION 3: Dictionary — หมายเหตุการจัดส่ง
// (ดึงออกมาเป็น Note ไม่ใช่ส่วนหนึ่งของชื่อ)
// ============================================================

const DELIVERY_NOTE_LIST = [
  'ฝากป้อม', 'ฝากรปภ', 'ฝากยาม', 'ฝากรักษาความปลอดภัย',
  'COD', 'เก็บเงินปลายทาง',
  'ห้ามโยน', 'ระวังแตก', 'ระวังหัก', 'บอบบาง',
  'แช่เย็น', 'เก็บในที่เย็น',
  'ส่งด่วน', 'ด่วนมาก', 'ด่วนพิเศษ',
  'ส่งก่อน', 'ส่งหลัง',
  'นัดส่ง', 'โทรก่อนส่ง', 'โทรนัด',
  'ชั้น', 'ห้อง', 'อาคาร',
];

// ============================================================
// SECTION 4: Regex Patterns
// ============================================================

// ดึงเบอร์โทรออก: 0x-xxxx-xxxx, 0xxxxxxxxx, +66x-xxx-xxxx
const PHONE_PATTERN = /(?:\+66|0)[0-9]{1,2}[-.\s]?[0-9]{3,4}[-.\s]?[0-9]{4}/g;

// ดึงเลขพัสดุ/เลขคำสั่งซื้อออก (ตัวเลข 8+ หลัก)
const DOC_NO_PATTERN = /\b[0-9]{8,}\b/g;

// ดึง # หรือ No. ตามด้วยตัวเลข
const REF_NO_PATTERN = /#[0-9]+|No\.?\s*[0-9]+/gi;

// ============================================================
// SECTION 5: normalizePersonNameFull — ฟังก์ชันหลัก
// ============================================================

/**
 * runNormalize — Entry Point เรียกจาก Menu / Pipeline
 * ประมวลผล Normalize กับ Source Rows ทั้งหมด
 */
function runNormalize() {
  logInfo('NormalizeService', 'เริ่ม Normalize Source Rows');
  // runLoadSource() เรียกก่อนแล้ว ใน runFullPipeline
  // ฟังก์ชันนี้สามารถขยายได้ในอนาคตเพื่อ Re-normalize
  logInfo('NormalizeService', 'Normalize เสร็จสิ้น (ทำงานใน processOneRow)');
}

/**
 * normalizePersonNameFull — ล้างชื่อบุคคลแบบสมบูรณ์
 * @param {string} rawName - ชื่อดิบจากระบบ
 * @return {{
 *   cleanName: string,       ชื่อที่ล้างแล้ว
 *   isCompany: boolean,      เป็นนิติบุคคลหรือไม่
 *   extractedPhone: string,  เบอร์โทรที่พบ
 *   extractedDocNo: string,  เลขเอกสารที่พบ
 *   deliveryNotes: string[], หมายเหตุการจัดส่ง
 *   originalName: string     ชื่อดิบต้นฉบับ
 * }}
 */
function normalizePersonNameFull(rawName) {
  const original    = String(rawName || '').trim();
  let working       = original;
  const notes       = [];
  let extractedPhone = '';
  let extractedDoc   = '';
  let isCompany      = false;

  if (!working) {
    return buildNormResult_(original, '', false, '', '', []);
  }

  // --- ขั้นตอน 1: ดึงเบอร์โทรออก ---
  const phoneMatches = working.match(PHONE_PATTERN);
  if (phoneMatches) {
    extractedPhone = phoneMatches[0].replace(/[-.\s]/g, '');
    working = working.replace(PHONE_PATTERN, '').trim();
  }

  // --- ขั้นตอน 2: ดึงเลขเอกสาร/พัสดุออก ---
  const docMatches = working.match(DOC_NO_PATTERN);
  if (docMatches) {
    extractedDoc = docMatches.join(',');
    working = working.replace(DOC_NO_PATTERN, '').trim();
  }
  const refMatches = working.match(REF_NO_PATTERN);
  if (refMatches) {
    if (!extractedDoc) extractedDoc = refMatches.join(',');
    working = working.replace(REF_NO_PATTERN, '').trim();
  }

  // --- ขั้นตอน 3: ดึง Delivery Notes ออก ---
  DELIVERY_NOTE_LIST.forEach(noteWord => {
    if (working.includes(noteWord)) {
      notes.push(noteWord);
      working = working.replace(noteWord, '').trim();
    }
  });

  // --- ขั้นตอน 4: ตรวจสอบนิติบุคคล ---
  const hasCompanySuffix = COMPANY_SUFFIX_LIST.some(s => working.includes(s));
  const hasChainStore    = CHAIN_STORE_LIST.some(s => working.includes(s));

  if (hasCompanySuffix || hasChainStore) {
    isCompany = true;
    // ตัด Suffix นิติบุคคลออก (เก็บชื่อหลักไว้)
    COMPANY_SUFFIX_LIST.forEach(suffix => {
      working = working.replace(suffix, '').trim();
    });
  }

  // --- ขั้นตอน 5: ตัดคำนำหน้า (เรียงยาวไปสั้น Greedy Match) ---
  if (!isCompany) {
    const sortedPrefix = PERSON_PREFIX_LIST.slice().sort(
      (a, b) => b.length - a.length
    );
    for (const prefix of sortedPrefix) {
      if (working.startsWith(prefix)) {
        working = working.substring(prefix.length).trim();
        break; // ตัดได้แล้ว 1 ตัว หยุด
      }
    }
  }

  // --- ขั้นตอน 6: ล้างช่องว่างและอักขระพิเศษ ---
  working = working.replace(/\s+/g, ' ')
                   .replace(/[^\u0E00-\u0E7Fa-zA-Z0-9\s]/g, '')
                   .trim();

  return buildNormResult_(
    original, working, isCompany,
    extractedPhone, extractedDoc, notes
  );
}

/**
 * buildNormResult_ — สร้าง Object ผลลัพธ์ Normalize
 */
function buildNormResult_(original, cleanName, isCompany,
                           phone, docNo, notes) {
  return {
    cleanName:      cleanName,
    isCompany:      isCompany,
    extractedPhone: phone,
    extractedDocNo: docNo,
    deliveryNotes:  notes,
    originalName:   original,
  };
}

// ============================================================
// SECTION 6: normalizePlaceName — ล้างชื่อสถานที่
// ============================================================

/**
 * normalizePlaceName — ล้างชื่อสถานที่
 * ตัดคำซ้ำซ้อน ชั้น ห้อง และข้อมูลไม่เกี่ยวข้องออก
 * @param {string} rawPlace - ชื่อสถานที่ดิบ
 * @return {{ cleanPlace: string, placeType: string, notes: string[] }}
 */
function normalizePlaceName(rawPlace) {
  let working = String(rawPlace || '').trim();
  const notes = [];
  let placeType = 'other';

  if (!working) {
    return { cleanPlace: '', placeType: placeType, notes: [] };
  }

  // ตรวจจับประเภทสถานที่
  if (/คอนโด|คอนโดมิเนียม|Condo|อาคารชุด/i.test(working)) {
    placeType = 'condo';
  } else if (/ห้างสรรพสินค้า|ห้าง|Mall|Plaza|Center|Centre/i.test(working)) {
    placeType = 'mall';
  } else if (/บ้าน|หมู่บ้าน|Village|Moo\s*[0-9]/i.test(working)) {
    placeType = 'house';
  } else if (/ไซต์งาน|โครงการ|ก่อสร้าง|Site/i.test(working)) {
    placeType = 'site';
  }

  // ดึง Delivery Notes ออก
  DELIVERY_NOTE_LIST.forEach(noteWord => {
    if (working.includes(noteWord)) {
      notes.push(noteWord);
      working = working.replace(noteWord, '').trim();
    }
  });

  // ล้างช่องว่างซ้ำ
  working = working.replace(/\s+/g, ' ').trim();

  return { cleanPlace: working, placeType: placeType, notes: notes };
}

// ============================================================
// SECTION 7: Phonetic Key สำหรับ Fuzzy Match ภาษาไทย
// ============================================================

/**
 * buildThaiPhoneticKey — สร้าง Phonetic Key จากชื่อไทย
 * ใช้สำหรับ Pre-filter ก่อนคำนวณ Levenshtein
 * @param {string} thaiName
 * @return {string} Phonetic Key (พยัญชนะต้น + สระ)
 */
function buildThaiPhoneticKey(thaiName) {
  if (!thaiName) return '';
  // ดึงเฉพาะพยัญชนะ (อักษรสระไทย 0E30-0E4E ออก)
  return thaiName.replace(/[\u0E30-\u0E4E\u0E47-\u0E4E\s]/g, '')
                 .substring(0, 6);
}

/**
 * normalizeForCompare — แปลงชื่อให้เปรียบเทียบได้ง่ายขึ้น
 * ใช้ก่อนส่งเข้า Levenshtein / Dice
 * @param {string} name
 * @return {string}
 */
function normalizeForCompare(name) {
  return String(name || '')
    .trim()
    .replace(/\s+/g, '')       // ลบช่องว่าง
    .replace(/[.\-_]/g, '')    // ลบจุด ขีด
    .toLowerCase();
}
