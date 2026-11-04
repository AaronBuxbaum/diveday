-- Issue #3732: the last copy of the three card tables the ledger replaced, one
-- release after the first (20261103012222_copy-cards-from-three-tables). A card
-- the release serving during that migration wrote went only to the old tables;
-- this copies every row whose id is not in "cards" yet, with the same column
-- mapping, so no gate misses it once the tables drop in the next migration.
-- A diver erased since is copied already erased, as erasure treats a ledger
-- row: the number and notes redacted, the card archived by the system.
INSERT INTO "cards" (
	"id", "shop_id", "person_id", "kind", "agency", "level", "identifier", "declared_identifier",
	"status", "review_note", "reviewed_at", "reviewed_by_person_id", "agency_checked_at",
	"imported_at", "imported_from_label", "self_declared_at", "issued_by_shop_at",
	"issued_from_trip_id", "issued_by_person_id", "processed_with_agency_at",
	"processed_by_person_id",
	"junior_status", "junior_status_verified_at", "junior_status_verified_by_person_id",
	"deleted_at", "deleted_by_person_id", "deletion_kind", "created_at"
)
SELECT
	t."id", t."shop_id", t."person_id", 'level', t."agency", t."level",
	CASE WHEN p."anonymized_at" IS NOT NULL THEN 'redacted-' || gen_random_uuid()::text ELSE t."identifier" END, CASE WHEN p."anonymized_at" IS NOT NULL THEN NULL ELSE t."declared_identifier" END,
	t."status", CASE WHEN p."anonymized_at" IS NOT NULL THEN NULL ELSE t."review_note" END, t."reviewed_at", t."reviewed_by_person_id", t."agency_checked_at", t."imported_at", CASE WHEN p."anonymized_at" IS NOT NULL THEN NULL ELSE t."imported_from_label" END, t."self_declared_at", t."issued_by_shop_at", t."issued_from_trip_id", t."issued_by_person_id", t."processed_with_agency_at", t."processed_by_person_id",
	CASE WHEN p."anonymized_at" IS NOT NULL THEN NULL ELSE t."junior_status" END, CASE WHEN p."anonymized_at" IS NOT NULL THEN NULL ELSE t."junior_status_verified_at" END, CASE WHEN p."anonymized_at" IS NOT NULL THEN NULL ELSE t."junior_status_verified_by_person_id" END,
	CASE WHEN p."anonymized_at" IS NOT NULL THEN coalesce(t."deleted_at", p."anonymized_at") ELSE t."deleted_at" END, t."deleted_by_person_id", CASE WHEN p."anonymized_at" IS NOT NULL THEN 'system'::"card_deletion_kind" END, t."created_at"
FROM "certifications" t
JOIN "people" p ON p."id" = t."person_id"
WHERE NOT EXISTS (SELECT 1 FROM "cards" c WHERE c."id" = t."id");

--> statement-breakpoint
INSERT INTO "cards" (
	"id", "shop_id", "person_id", "kind", "agency", "specialty", "identifier",
	"status", "review_note", "reviewed_at", "reviewed_by_person_id", "agency_checked_at",
	"imported_at", "imported_from_label", "self_declared_at", "issued_by_shop_at",
	"issued_from_trip_id", "issued_by_person_id", "processed_with_agency_at",
	"processed_by_person_id",
	"listed_from_certification_id", "deleted_at", "deleted_by_person_id", "deletion_kind", "created_at"
)
SELECT
	t."id", t."shop_id", t."person_id", 'specialty', t."agency", t."specialty", CASE WHEN p."anonymized_at" IS NOT NULL THEN 'redacted-' || gen_random_uuid()::text ELSE t."identifier" END,
	t."status", CASE WHEN p."anonymized_at" IS NOT NULL THEN NULL ELSE t."review_note" END, t."reviewed_at", t."reviewed_by_person_id", t."agency_checked_at", t."imported_at", CASE WHEN p."anonymized_at" IS NOT NULL THEN NULL ELSE t."imported_from_label" END, t."self_declared_at", t."issued_by_shop_at", t."issued_from_trip_id", t."issued_by_person_id", t."processed_with_agency_at", t."processed_by_person_id",
	t."listed_from_certification_id", CASE WHEN p."anonymized_at" IS NOT NULL THEN coalesce(t."deleted_at", p."anonymized_at") ELSE t."deleted_at" END, t."deleted_by_person_id", CASE WHEN p."anonymized_at" IS NOT NULL THEN 'system'::"card_deletion_kind" END, t."created_at"
FROM "specialty_certifications" t
JOIN "people" p ON p."id" = t."person_id"
WHERE NOT EXISTS (SELECT 1 FROM "cards" c WHERE c."id" = t."id");

--> statement-breakpoint
INSERT INTO "cards" (
	"id", "shop_id", "person_id", "kind", "agency", "identifier",
	"status", "review_note", "reviewed_at", "reviewed_by_person_id", "agency_checked_at",
	"imported_at", "imported_from_label", "self_declared_at", "issued_by_shop_at",
	"issued_from_trip_id", "issued_by_person_id", "processed_with_agency_at",
	"processed_by_person_id",
	"listed_from_certification_id", "deleted_at", "deleted_by_person_id", "deletion_kind", "created_at"
)
SELECT
	t."id", t."shop_id", t."person_id", 'nitrox', t."agency", CASE WHEN p."anonymized_at" IS NOT NULL THEN 'redacted-' || gen_random_uuid()::text ELSE t."identifier" END,
	t."status", CASE WHEN p."anonymized_at" IS NOT NULL THEN NULL ELSE t."review_note" END, t."reviewed_at", t."reviewed_by_person_id", t."agency_checked_at", t."imported_at", CASE WHEN p."anonymized_at" IS NOT NULL THEN NULL ELSE t."imported_from_label" END, t."self_declared_at", t."issued_by_shop_at", t."issued_from_trip_id", t."issued_by_person_id", t."processed_with_agency_at", t."processed_by_person_id",
	t."listed_from_certification_id", CASE WHEN p."anonymized_at" IS NOT NULL THEN coalesce(t."deleted_at", p."anonymized_at") ELSE t."deleted_at" END, t."deleted_by_person_id", CASE WHEN p."anonymized_at" IS NOT NULL THEN 'system'::"card_deletion_kind" END, t."created_at"
FROM "nitrox_certifications" t
JOIN "people" p ON p."id" = t."person_id"
WHERE NOT EXISTS (SELECT 1 FROM "cards" c WHERE c."id" = t."id");
