-- An adult party member's address gets the normal links now, and a minor's gets none
-- (ux-over-hardening, 2026-11-06), so nothing mints the `party_waiver_link` door any more. The
-- next migration drops the enum value, and its type change refuses any row still carrying it. A
-- live door stops opening its release: the member's own confirmation and reminders carry the
-- readiness link instead. Pre-pilot, no users (H-20260815-no-legacy).
-- Compared as text: a value added earlier in the same transaction cannot be named as an enum literal.
DELETE FROM "capabilities" WHERE "purpose"::text = 'party_waiver_link';
