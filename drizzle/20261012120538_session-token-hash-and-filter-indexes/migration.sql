CREATE INDEX "account_sessions_expires_idx" ON "account_sessions" ("expires_at");--> statement-breakpoint
CREATE INDEX "trip_assignments_person_idx" ON "trip_assignments" ("person_id");--> statement-breakpoint
CREATE INDEX "gear_reservations_shop_checked_out_idx" ON "gear_reservations" ("shop_id","checked_out_at");--> statement-breakpoint
-- Code review 2026-10-11, item 40: account_sessions.token now holds the SHA-256 of
-- the cookie's token (src/lib/session-token-hash.ts), so a row written before this
-- holds a raw token no lookup can match. Expired rather than hashed in place:
-- every staffer signs in once more, and any raw token a copy of this table ever
-- held stops opening anything. Pre-pilot, no users (H-20260815-no-legacy).
-- diveday:allow-destructive delete-without-where account_sessions: signs every staffer out once so no raw session token survives; pre-pilot, no users (H-20260815-no-legacy)
DELETE FROM "account_sessions";
