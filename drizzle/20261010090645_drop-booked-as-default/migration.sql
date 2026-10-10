-- Contract half of ADR 20261007-participant-types (issue #2222). The release that writes booked_as on every booking insert (commit 1f673f8d) merged 2026-10-07; production deploys from main, so it is the one serving.
-- diveday:allow-destructive drop-default bookings.booked_as: the serving release names booked_as on every insert (createBookingRecord, the seeds and every fixture), so no live insert relies on the default
ALTER TABLE "bookings" ALTER COLUMN "booked_as" DROP DEFAULT;
