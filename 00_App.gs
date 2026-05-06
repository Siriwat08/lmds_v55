/**
 * VERSION: 001
 * FILE: 00_App.gs
 * LMDS V5.0 — Logistics Master Data System
 * ===================================================
 * หน้าที่: จุดเริ่มต้นระบบ สร้าง Custom Menu และ onOpen Trigger
 * ===================================================
 */

const APP_VERSION = '5.2.000-PH2';
const APP_NAME    = 'LMDS V5.2 PH2';

// ============================================================
// SECTION 1: onOpen Trigger — สร้างเมนูเมื่อเปิด Spreadsheet
// ============================================================

/**
 * onOpen — ทำงานอัตโนมัติเมื่อเปิด Spreadsheet
 * สร้าง Custom Menu แบ่งตาม 2 กลุ่มหลัก
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();

  ui.createMenu(`🚚 ${APP_NAME}`)

    // -----------------------------------------------
    // กลุ่ม 1: ล้างข้อมูล → สร้าง Master Data
    // -----------------------------------------------
    .addSubMenu(
      ui.createMenu('🟩 กลุ่ม 1: ล้างข้อมูล & Master')
        .addItem('▶️ รัน Full Pipeline (ทั้งหมด)', 'runFullPipeline')
        .addSeparator()
        .addItem('Step 1 — โหลดข้อมูลดิบจากแหล่ง', 'runLoadSource')
        .addItem('Step 2 — Normalize ชื่อ/ที่อยู่', 'runNormalize')
        .addItem('Step 3 — Match Engine', 'runMatchEngine')
        .addSeparator()
        .addItem('📋 เปิด Review Queue', 'openReviewQueue')
        .addItem('📊 รายงาน Data Quality', 'generateQualityReport')
    )

    // -----------------------------------------------
    // กลุ่ม 2: งานประจำวัน → ดึง API + จับคู่พิกัด
    // -----------------------------------------------
    .addSubMenu(
      ui.createMenu('🟦 กลุ่ม 2: งานประจำวัน (SCG)')
        .addItem('📥 ดึงข้อมูล SCG API', 'fetchDataFromSCGJWD')
        .addItem('📍 จับคู่พิกัด Manual', 'applyMasterCoordinatesToDailyJob')
        .addSeparator()
        .addItem('🗑️ ล้างข้อมูลทั้งหมด', 'clearAllSCGSheets_UI')
    )

    .addSeparator()

    // -----------------------------------------------
    // ระบบ: Setup และ Admin
    // -----------------------------------------------
    .addSubMenu(
      ui.createMenu('🔧 ระบบ & ตั้งค่า')
        .addItem('⚙️ ตั้งค่า API Key', 'setupEnvironment')
        .addItem('🏗️ สร้างชีตทั้งหมด', 'setupAllSheets')
        .addItem('🛡️ PH2 Preflight Audit', 'runPhase2PreflightAudit')
        .addItem('🚀 PH2 Migration Helper', 'migrateProductionHardeningPhase2')
        .addItem('✅ ตรวจสอบ System Integrity', 'checkSystemIntegrity')
        .addItem('📖 ดู Version Info', 'showVersionInfo')
    )

    .addToUi();
}

// ============================================================
// SECTION 2: Full Pipeline — รันกลุ่ม 1 ทั้งหมด
// ============================================================

/**
 * runFullPipeline — รันกระบวนการกลุ่ม 1 ตามลำดับ
 * Step 1: Load Source → Step 2: Normalize → Step 3: Match
 */
function runFullPipeline() {
  const ui = SpreadsheetApp.getUi();

  const confirm = ui.alert(
    '▶️ ยืนยัน Full Pipeline',
    'จะรันกระบวนการทั้งหมด:\n' +
    '  1. โหลดข้อมูลดิบจากชีต SCGนครหลวงJWDภูมิภาค\n' +
    '  2. Normalize ชื่อบุคคล / ชื่อสถานที่\n' +
    '  3. Match Engine (สร้าง/อัปเดต Master Data)\n\n' +
    'ใช้เวลาประมาณ 5–15 นาที กรุณาอย่าปิดหน้าต่าง',
    ui.ButtonSet.YES_NO
  );

  if (confirm !== ui.Button.YES) return;

  const startTime = new Date();
  logInfo('App', `Full Pipeline เริ่มต้น — v${APP_VERSION}`);
  SpreadsheetApp.getActiveSpreadsheet()
                .toast('กำลังรัน Full Pipeline...', APP_NAME, -1);

  try {
    // Step 1: โหลดข้อมูลดิบ
    SpreadsheetApp.getActiveSpreadsheet()
                  .toast('Step 1/3: กำลังโหลดข้อมูลดิบ...', APP_NAME, 10);
    runLoadSource();

    // Step 2: Normalize
    SpreadsheetApp.getActiveSpreadsheet()
                  .toast('Step 2/3: กำลัง Normalize...', APP_NAME, 10);
    runNormalize();

    // Step 3: Match Engine
    SpreadsheetApp.getActiveSpreadsheet()
                  .toast('Step 3/3: กำลัง Match...', APP_NAME, 10);
    runMatchEngine();

    const elapsedSec = Math.round((new Date() - startTime) / 1000);
    logInfo('App', `Full Pipeline สำเร็จ — ใช้เวลา ${elapsedSec} วินาที`);
    ui.alert(`✅ Full Pipeline สำเร็จ!\nใช้เวลา: ${elapsedSec} วินาที`);

  } catch (err) {
    logError('App', 'Full Pipeline ล้มเหลว: ' + err.message);
    ui.alert('❌ Pipeline ล้มเหลว:\n' + err.message);
  }
}

// ============================================================
// SECTION 3: Navigation Helpers
// ============================================================

/**
 * openReviewQueue — เปิดชีต Q_REVIEW ให้ผู้ใช้ตรวจสอบ
 */
function openReviewQueue() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET.Q_REVIEW);

  if (sheet) {
    ss.setActiveSheet(sheet);
    SpreadsheetApp.getActiveSpreadsheet()
                  .toast('กำลังแสดง Review Queue', APP_NAME, 3);
  } else {
    SpreadsheetApp.getUi()
                  .alert('❌ ไม่พบชีต Q_REVIEW\nกรุณารัน "สร้างชีตทั้งหมด" ก่อน');
  }
}

// ============================================================
// SECTION 4: System Tools
// ============================================================

/**
 * checkSystemIntegrity — ตรวจสอบความสมบูรณ์ของระบบ
 * ตรวจ: ชีตครบไหม, API Key ถูกต้องไหม
 */
function checkSystemIntegrity() {
  const ui      = SpreadsheetApp.getUi();
  const ss      = SpreadsheetApp.getActiveSpreadsheet();
  const errors  = [];
  const warns   = [];

  // ตรวจสอบชีตที่จำเป็นทั้งหมด
  const requiredSheets = [
    SHEET.M_PERSON, SHEET.M_PERSON_ALIAS,
    SHEET.M_PLACE,  SHEET.M_PLACE_ALIAS,
    SHEET.M_GEO_POINT, SHEET.M_DESTINATION,
    SHEET.FACT_DELIVERY, SHEET.Q_REVIEW,
    SHEET.SYS_LOG, SHEET.SYS_CONFIG,
    SHEET.MAPS_CACHE, SHEET.RPT_QUALITY,
    SHEET.DAILY_JOB, SHEET.INPUT,
    SHEET.EMPLOYEE, SHEET.SOURCE,
  ];

  requiredSheets.forEach(name => {
    if (!ss.getSheetByName(name)) {
      errors.push(`ไม่พบชีต: ${name}`);
    }
  });

  // ตรวจสอบ API Key
  try {
    const apiKey = PropertiesService.getScriptProperties()
                                    .getProperty('GEMINI_API_KEY');
    if (!apiKey || apiKey.length < 20) {
      warns.push('GEMINI_API_KEY ยังไม่ได้ตั้งค่า หรือไม่ถูกต้อง');
    }
  } catch (e) {
    warns.push('ไม่สามารถอ่าน GEMINI_API_KEY ได้: ' + e.message);
  }

  // สรุปผล
  if (errors.length === 0 && warns.length === 0) {
    ui.alert(`✅ System Integrity: ปกติทุกอย่าง!\nVersion: ${APP_VERSION}\nPhase: Production Hardening Phase 2`);
    return;
  }

  let msg = '';
  if (errors.length > 0) {
    msg += `❌ พบ Error ${errors.length} รายการ:\n`;
    msg += errors.map(e => '  • ' + e).join('\n') + '\n\n';
  }
  if (warns.length > 0) {
    msg += `⚠️ พบ Warning ${warns.length} รายการ:\n`;
    msg += warns.map(w => '  • ' + w).join('\n');
  }

  ui.alert(msg);
}

/**
 * setupEnvironment — ตั้งค่า Gemini API Key ผ่าน PropertiesService
 * [RULE 5] API Key ต้องเก็บใน Properties เท่านั้น ห้าม hardcode
 */
function setupEnvironment() {
  const ui = SpreadsheetApp.getUi();

  const result = ui.prompt(
    '⚙️ ตั้งค่า Gemini API Key',
    'กรุณาใส่ Gemini API Key:\n(ได้จาก https://aistudio.google.com/app/apikey)',
    ui.ButtonSet.OK_CANCEL
  );

  if (result.getSelectedButton() !== ui.Button.OK) return;

  const inputKey = result.getResponseText().trim();
  if (!inputKey || inputKey.length < 20) {
    ui.alert('❌ API Key ไม่ถูกต้อง กรุณาตรวจสอบใหม่\n(ควรมีความยาวมากกว่า 20 ตัวอักษร)');
    return;
  }

  PropertiesService.getScriptProperties()
                   .setProperty('GEMINI_API_KEY', inputKey);
  logInfo('App', 'ตั้งค่า GEMINI_API_KEY สำเร็จ');
  ui.alert('✅ บันทึก API Key เรียบร้อยแล้วครับ!');
}

/**
 * showVersionInfo — แสดงข้อมูล Version และ Module ทั้งหมด
 */
function showVersionInfo() {
  const ui  = SpreadsheetApp.getUi();
  const msg =
    `🚚 ${APP_NAME}\n` +
    `Version: ${APP_VERSION}\n\n` +
    `📦 Modules:\n` +
    `  00_App.gs            v001\n` +
    `  01_Config.gs         v001\n` +
    `  02_Schema.gs         v001\n` +
    `  03_SetupSheets.gs    v001\n` +
    `  04_SourceRepository  (next batch)\n` +
    `  05_NormalizeService  (next batch)\n` +
    `  06_PersonService     (next batch)\n` +
    `  07-18...             (upcoming)\n\n` +
    `Architecture:\n` +
    `  กลุ่ม 1: Cleansing & Master DB (Module 00–14)\n` +
    `  กลุ่ม 2: Daily Ops & Search (Module 15–18)`;

  ui.alert(msg);
}
