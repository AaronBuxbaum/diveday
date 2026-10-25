-- Issue #2828: Found's all-clear now goes to exactly the owners the alarm
-- reached (`missing_alert_reached_person_ids`), and an empty set means "the
-- alarm reached nobody, nothing to clear". A report whose alarm already went
-- before the column existed would read empty and its owners would never hear
-- the all-clear. For each such report still open (alarm sent, not yet found),
-- the set is filled from the shop's owners with an active login: the alarm's
-- own recipients, re-read as they stand now, since nothing recorded them then.
UPDATE "incident_reports" AS "r"
SET "missing_alert_reached_person_ids" = coalesce(
  (
    SELECT jsonb_agg(DISTINCT "p"."id"::text)
    FROM "people" AS "p"
    JOIN "person_roles" AS "pr" ON "pr"."person_id" = "p"."id" AND "pr"."role" = 'owner'
    JOIN "user_accounts" AS "ua" ON "ua"."person_id" = "p"."id" AND "ua"."status" = 'active'
    WHERE "p"."shop_id" = "r"."shop_id"
      AND "p"."deleted_at" IS NULL
      AND "p"."anonymized_at" IS NULL
  ),
  '[]'::jsonb
)
WHERE "r"."missing_alert_sent_at" IS NOT NULL
  AND "r"."missing_found_at" IS NULL
  AND "r"."missing_alert_reached_person_ids" = '[]'::jsonb;
