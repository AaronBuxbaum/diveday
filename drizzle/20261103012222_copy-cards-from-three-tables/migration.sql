-- Issue #2722: the three card tables become one ledger. Ids carry over, so
-- every reference to a card (junior reviews, the agency-check "listed from"
-- pointer, undo tokens, activity rows) still names the same card. Level cards
-- go first because a specialty or nitrox row may point at one. The three
-- tables stay for one release, because the release serving while this runs
-- still reads them; the next release drops them.
INSERT INTO "cards" (
	"id", "shop_id", "person_id", "kind", "agency", "level", "identifier", "declared_identifier",
	"status", "review_note", "reviewed_at", "reviewed_by_person_id", "agency_checked_at",
	"imported_at", "imported_from_label", "self_declared_at", "issued_by_shop_at",
	"issued_from_trip_id", "issued_by_person_id", "processed_with_agency_at",
	"processed_by_person_id", "junior_status", "junior_status_verified_at",
	"junior_status_verified_by_person_id", "deleted_at", "deleted_by_person_id", "created_at"
)
SELECT
	"id", "shop_id", "person_id", 'level', "agency", "level", "identifier", "declared_identifier",
	"status", "review_note", "reviewed_at", "reviewed_by_person_id", "agency_checked_at",
	"imported_at", "imported_from_label", "self_declared_at", "issued_by_shop_at",
	"issued_from_trip_id", "issued_by_person_id", "processed_with_agency_at",
	"processed_by_person_id", "junior_status", "junior_status_verified_at",
	"junior_status_verified_by_person_id", "deleted_at", "deleted_by_person_id", "created_at"
FROM "certifications";
--> statement-breakpoint
INSERT INTO "cards" (
	"id", "shop_id", "person_id", "kind", "agency", "specialty", "identifier",
	"status", "review_note", "reviewed_at", "reviewed_by_person_id", "agency_checked_at",
	"imported_at", "imported_from_label", "self_declared_at", "issued_by_shop_at",
	"issued_from_trip_id", "issued_by_person_id", "processed_with_agency_at",
	"processed_by_person_id", "listed_from_certification_id", "deleted_at",
	"deleted_by_person_id", "created_at"
)
SELECT
	"id", "shop_id", "person_id", 'specialty', "agency", "specialty", "identifier",
	"status", "review_note", "reviewed_at", "reviewed_by_person_id", "agency_checked_at",
	"imported_at", "imported_from_label", "self_declared_at", "issued_by_shop_at",
	"issued_from_trip_id", "issued_by_person_id", "processed_with_agency_at",
	"processed_by_person_id", "listed_from_certification_id", "deleted_at",
	"deleted_by_person_id", "created_at"
FROM "specialty_certifications";
--> statement-breakpoint
INSERT INTO "cards" (
	"id", "shop_id", "person_id", "kind", "agency", "identifier",
	"status", "review_note", "reviewed_at", "reviewed_by_person_id", "agency_checked_at",
	"imported_at", "imported_from_label", "self_declared_at", "issued_by_shop_at",
	"issued_from_trip_id", "issued_by_person_id", "processed_with_agency_at",
	"processed_by_person_id", "listed_from_certification_id", "deleted_at",
	"deleted_by_person_id", "created_at"
)
SELECT
	"id", "shop_id", "person_id", 'nitrox', "agency", "identifier",
	"status", "review_note", "reviewed_at", "reviewed_by_person_id", "agency_checked_at",
	"imported_at", "imported_from_label", "self_declared_at", "issued_by_shop_at",
	"issued_from_trip_id", "issued_by_person_id", "processed_with_agency_at",
	"processed_by_person_id", "listed_from_certification_id", "deleted_at",
	"deleted_by_person_id", "created_at"
FROM "nitrox_certifications";
