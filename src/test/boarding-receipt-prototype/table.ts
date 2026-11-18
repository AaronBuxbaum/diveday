import { sql } from "drizzle-orm";
import type { AppDb } from "@/db/client";

/** No migration installs this table; use only in a disposable test database. */
export async function installDraftTable(db: AppDb) {
  await db.execute(sql`
    create table draft_boarding_receipt_claims (
      shop_id uuid not null, client_key text not null,
      booking_id uuid not null, trip_id uuid not null, observation_id uuid not null,
      original_actor_id uuid not null, occurred_at_raw text,
      context_kind text not null, generation_id uuid, meeting_id uuid,
      received_at timestamptz not null default now(),
      primary key (shop_id, client_key),
      check (length(client_key) between 8 and 100),
      check ((context_kind = 'asserted' and generation_id is not null and meeting_id is not null)
          or (context_kind = 'legacy_unknown' and generation_id is null and meeting_id is null))
    )
  `);
}
