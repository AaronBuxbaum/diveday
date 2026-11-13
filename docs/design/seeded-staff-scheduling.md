# Demo staff and advance scheduling

Demo creation assigns portraits to the inserted cast person IDs. A schedule reset does not identify people by display name or replace their photos. Portraits are fictional, staff-directory-only assets; public crew consent is independent.

The demo reset builds shifts covering assigned departures and course meetings, and places days off outside those working windows. The demo clock keeper extends the affected crew's rota when it moves an assigned departure. These are demo-only construction steps, not repairs to real operating history.

Advance assignments, including standing-series propagation, require a covering shift when the shop enables shift scheduling. A later shift deletion does not silently remove assigned crew: the trip displays the existing shift-coverage gap. Days off remain warnings, not evidence that somebody was not actually aboard.

A standing-series date skipped for missing shifts stays unassigned if somebody later adds a shift. Adding availability is not an instruction to change an existing trip's crew. Staff must resolve that date explicitly through its crew controls or reapply the standing-crew operation; its skipped count and existing staffing gaps remain the signals to review. Future horizon dates check the current shifts when materialized.

Actual day-of crew and roll-call evidence must remain recordable regardless of planned shifts. No shift check is added to those operational writes.

Real PostgreSQL concurrent shift-deletion/assignment verification and rendered desktop/mobile review remain outstanding. Full shift coverage is checked under a share lock during advance assignment; a deletion afterward creates a warning, not silent crew removal.
