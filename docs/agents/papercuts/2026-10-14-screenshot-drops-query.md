Date: 2026-10-14
Project: scripts
Symptom: node scripts/screenshot.mjs dropped the query string from the file name, so capturing /shop/blue-mantis/reports?range=year wrote shop-blue-mantis-reports-light-1280.png over the month capture of /shop/blue-mantis/reports in the same folder.
Fix: The file name keeps the query (shop-blue-mantis-reports-range-year-light-1280.png); only a fragment is dropped.
