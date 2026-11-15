# Demo staff and advance scheduling

Demo creation assigns portraits to the inserted cast person IDs. A schedule reset does not identify people by display name or replace their photos. Portraits are fictional, staff-directory-only assets; public crew consent is independent.

The current portrait writer only references bundled demo assets. The path travels in shop and person exports, and erasure clears it; the asset bytes remain part of the application. Any future uploader must define its storage, export and deletion lifecycle before accepting user images.

Initial demo creation builds shifts covering assigned departures and course meetings, and places days off outside those working windows. Later resets preserve existing shifts; if trips move to new dates, their crew can show a truthful coverage warning. A narrow clock-keeper move leaves shifts and days off untouched and clears acknowledgements tied to the old trip date. Full demo resets retain their existing reset-owned day-off behavior.

Schedule-board and standing-series advance assignments require a covering shift when the shop enables shift scheduling. The shared trip Crew action still needs a safe distinction between advance plans and explicit observed presence before that enforcement can be complete. A later shift deletion does not silently remove assigned crew: the trip displays the existing shift-coverage gap. Days off remain warnings, not evidence that somebody was not actually aboard.

A standing-series date skipped for missing shifts stays unassigned if somebody later adds a shift. Adding availability is not an instruction to change an existing trip's crew. Staff must resolve that date explicitly through its crew controls or reapply the standing-crew operation; its skipped count and existing staffing gaps remain the signals to review. Future horizon dates check the current shifts when materialized.

Actual day-of crew and roll-call evidence must remain recordable regardless of planned shifts. No shift check is added to those operational writes.

Real PostgreSQL concurrent shift-deletion/assignment verification and rendered desktop/mobile review remain outstanding. Schedule-board coverage is checked under a share lock; concurrency behavior has not yet been verified on PostgreSQL.
