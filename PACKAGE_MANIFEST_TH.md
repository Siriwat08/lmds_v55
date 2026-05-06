# PACKAGE MANIFEST — LMDS Production Hardening Phase 2

## เนื้อหาในแพ็กเกจ
- `src/` ชุด source code Apps Script หลัง hardening phase 2
- `docs/PRODUCTION_HARDENING_PHASE2_TH.md` สรุปงานที่ทำ
- `docs/MIGRATION_GUIDE_PHASE2_TH.md` คู่มือ migration
- `docs/TEST_CHECKLIST_PHASE2_TH.md` checklist ทดสอบก่อนขึ้น production

## ไฟล์ source ที่มีการเปลี่ยนแปลงหลัก
- 00_App.gs
- 01_Config.gs
- 03_SetupSheets.gs
- 04_SourceRepository.gs
- 06_PersonService.gs
- 07_PlaceService.gs
- 09_DestinationService.gs
- 14_Utils.gs
- 15_GoogleMapsAPI.gs
- 17_SearchService.gs
- 18_ServiceSCG.gs
- 19_Hardening.gs (new)

## การตรวจสอบก่อนแพ็ก
- syntax check แบบรวมทุกไฟล์: ผ่าน
- มี migration helper และ preflight audit เพิ่มแล้ว
- มี config ใหม่สำหรับ batch / shipment cap / lookup cap แล้ว
