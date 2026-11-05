-- The drops layer 8 of #3721 owed: the weekly digest's and the bookkeeper's
-- stop links are capabilities now, the previous release stopped declaring
-- these columns and cleared them. Dropping a column drops its unique index.
-- diveday:allow-destructive drop-column weekly_digest_sends.unsubscribe_token_hash: the Monday email's unsubscribe link is a weekly_digest_unsubscribe capability (#3721); no schema declares it since layer 8 and the previous release cleared it; pre-pilot, no users (H-20260815-no-legacy) (issue #3721)
ALTER TABLE "weekly_digest_sends" DROP COLUMN "unsubscribe_token_hash";--> statement-breakpoint
-- diveday:allow-destructive drop-column shops.bookkeeper_stop_token_hash: the month-end stop link is a bookkeeper_stop capability (#3721); no schema declares it since layer 8 and the previous release cleared it; pre-pilot, no users (H-20260815-no-legacy) (issue #3721)
ALTER TABLE "shops" DROP COLUMN "bookkeeper_stop_token_hash";
