-- Booking links become computed from their row (issue #2711, ADR 20261104-derived-booking-link-tokens).
-- A row minted before this release has only a hash, so no link can be computed for it, and the
-- new one-live-row index that follows would refuse the piles the old code kept. There are no users:
-- every existing row is deleted rather than carried across, and links already sent for demo shops
-- stop working. The next send to each booking mints a fresh row.
-- diveday:allow-destructive delete-without-where booking_capabilities: hash-only rows cannot be turned into derived links; pre-pilot, no users, demo links only (H-20260815-no-legacy)
DELETE FROM "booking_capabilities";
