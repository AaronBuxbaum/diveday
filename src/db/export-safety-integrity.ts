import { sql } from "drizzle-orm";
import type { DbExecutor } from "./client";
import {
  bookings,
  people,
  rollCallEventClaims,
  rollCallEvents,
  trips,
  unresolvedReviewDeferrals,
  unresolvedSafetyAlertDeliveries,
  unresolvedSafetyAlertOutbox,
  unresolvedSafetyScanIncidents,
} from "./schema";

/** Refuse rather than leak a foreign identifier or silently drop corrupt safety
 * evidence. Scan incidents deliberately tolerate missing referenced rows. */
export async function assertSafetyExportIntegrity(db: DbExecutor, shopId: string) {
  const result = await db.execute(sql`select count(*)::int as invalid from (select 1 where
      exists (
        select 1 from ${rollCallEventClaims} c
        left join ${trips} t on t.id = c.trip_id
        left join ${bookings} b on b.id = c.booking_id
        left join ${people} subject on subject.id = c.crew_person_id
        left join ${people} author on author.id = c.unresolved_recorded_by_person_id
        -- diveday:roll-call-both-subjects: compare each accepted claim to its seat or crew event.
        left join ${rollCallEvents} e on e.id = c.accepted_event_id
        where c.shop_id = ${shopId} and (
          t.id is null or t.shop_id <> c.shop_id or
          (c.booking_id is not null and (b.id is null or b.shop_id <> c.shop_id or b.trip_id <> c.trip_id)) or
          (c.crew_person_id is not null and (subject.id is null or subject.shop_id <> c.shop_id)) or
          (c.unresolved_recorded_by_person_id is not null and (author.id is null or author.shop_id <> c.shop_id)) or
          (c.accepted_event_id is not null and (e.id is null or e.shop_id <> c.shop_id or e.trip_id <> c.trip_id or e.subject_kind is distinct from c.subject_kind or e.booking_id is distinct from c.booking_id or e.crew_person_id is distinct from c.crew_person_id))
        )
      ) or exists (
        select 1 from ${unresolvedSafetyAlertOutbox} o
        left join ${trips} t on t.id = o.trip_id
        left join ${rollCallEventClaims} c on c.id = o.claim_id
        where o.shop_id = ${shopId} and
          (t.id is null or t.shop_id <> o.shop_id or c.id is null or c.shop_id <> o.shop_id or c.trip_id <> o.trip_id)
      ) or exists (
        select 1 from ${unresolvedSafetyAlertDeliveries} d
        join ${unresolvedSafetyAlertOutbox} o on o.id = d.outbox_id
        left join ${people} p on p.id = d.person_id
        where o.shop_id = ${shopId} and (p.id is null or p.shop_id <> o.shop_id)
      ) or exists (
        select 1 from ${unresolvedReviewDeferrals} d
        left join ${trips} t on t.id = d.trip_id
        left join ${rollCallEventClaims} c on c.id = d.claim_id
        left join ${people} p on p.id = d.actor_person_id
        where d.shop_id = ${shopId} and
          (t.id is null or t.shop_id <> d.shop_id or c.id is null or c.shop_id <> d.shop_id or c.trip_id <> d.trip_id or p.id is null or p.shop_id <> d.shop_id)
      ) or exists (
        select 1 from ${unresolvedSafetyScanIncidents} i
        where i.shop_id = ${shopId} and (
          exists (select 1 from ${trips} t where t.id = i.trip_id and t.shop_id <> i.shop_id) or
          exists (select 1 from ${rollCallEventClaims} c where c.id = i.claim_id and c.shop_id <> i.shop_id) or
          exists (select 1 from ${unresolvedSafetyAlertOutbox} o where o.id = i.outbox_id and o.shop_id <> i.shop_id)
        )
      )
    ) integrity_failure
  `);
  if (Number((result.rows[0] as { invalid: number } | undefined)?.invalid ?? 1) !== 0)
    throw new Error("Safety export has inconsistent tenant references");
}
