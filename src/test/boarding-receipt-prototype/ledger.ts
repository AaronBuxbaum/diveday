import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { AppDb, DbExecutor } from "@/db/client";

/**
 * Scratch-database experiment only. This is not a production receipt, signed
 * context, authorization check, migration, device acknowledgement or reset fix.
 * Its callers use synthetic identities; do not import it from an app path.
 */
export type ScratchIntent = {
  shopId: string;
  generationId: string;
  tripId: string;
  bookingId: string;
  actorId: string;
  eventId: string;
  meeting: { kind: "known"; id: string } | { kind: "unknown" };
  /** Untrusted asserted event time, compared literally, not server time. */
  occurredAt: string;
};

type ScratchReceipt = {
  generation_id: string;
  trip_id: string;
  booking_id: string;
  actor_id: string;
  meeting_kind: string;
  meeting_id: string | null;
  occurred_at: string;
  observation_id: string | null;
};

type ScratchOutcome =
  | { ok: true; replay: boolean; observationId: string }
  | { ok: false; reason: "key_reused" | "unavailable" };

/** Create only in a disposable test database; no application schema is changed. */
export async function createScratchLedger(db: AppDb): Promise<void> {
  await db.execute(sql`
    create table scratch_observation (
      id text primary key,
      shop_id text not null,
      generation_id text not null,
      trip_id text not null,
      booking_id text not null,
      meeting_scope text not null,
      state text not null check (state in ('open', 'applied', 'dismissed'))
    )
  `);
  await db.execute(sql`
    create unique index scratch_observation_one_open
    on scratch_observation (shop_id, generation_id, trip_id, booking_id, meeting_scope)
    where state = 'open'
  `);
  await db.execute(sql`
    create table scratch_receipt (
      shop_id text not null,
      event_id text not null,
      generation_id text not null,
      trip_id text not null,
      booking_id text not null,
      actor_id text not null,
      meeting_kind text not null,
      meeting_id text,
      occurred_at text not null,
      received_at timestamptz not null default now(),
      observation_id text,
      primary key (shop_id, event_id),
      check ((meeting_kind = 'known' and meeting_id is not null) or
             (meeting_kind = 'unknown' and meeting_id is null))
    )
  `);
}

function matchesReceipt(row: ScratchReceipt, input: ScratchIntent): boolean {
  return (
    row.generation_id === input.generationId &&
    row.trip_id === input.tripId &&
    row.booking_id === input.bookingId &&
    row.actor_id === input.actorId &&
    row.meeting_kind === input.meeting.kind &&
    row.meeting_id === (input.meeting.kind === "known" ? input.meeting.id : null) &&
    row.occurred_at === input.occurredAt
  );
}

async function findReceipt(tx: DbExecutor, input: ScratchIntent): Promise<ScratchReceipt | null> {
  const result = await tx.execute(sql`
    select generation_id, trip_id, booking_id, actor_id, meeting_kind, meeting_id,
           occurred_at, observation_id
    from scratch_receipt where shop_id = ${input.shopId} and event_id = ${input.eventId}
  `);
  return (result.rows[0] as ScratchReceipt | undefined) ?? null;
}

class ScratchKeyCollision extends Error {}
class ScratchUnavailable extends Error {}

type ScratchHooks = {
  /** Test barriers only; never a production authorization or persistence hook. */
  afterFirstLookup?: () => Promise<void>;
  afterReservation?: () => Promise<void>;
  afterLink?: () => Promise<void>;
};

/**
 * A success here means only that this synthetic transaction committed. A real
 * caller needs verified identity, revocation/erasure ordering and device retention.
 * `replay: false` means a new receipt, not necessarily a new observation.
 */
export async function recordScratchReceipt(
  db: AppDb,
  input: ScratchIntent,
  hooks: ScratchHooks = {},
): Promise<ScratchOutcome> {
  try {
    return await db.transaction(async (tx): Promise<ScratchOutcome> => {
      // This bounds individual database lock waits, not the whole request.
      await tx.execute(sql`set local lock_timeout = '2s'`);
      const prior = await findReceipt(tx, input);
      if (hooks.afterFirstLookup) await hooks.afterFirstLookup();
      if (prior) {
        if (!matchesReceipt(prior, input)) throw new ScratchKeyCollision();
        if (!prior.observation_id) throw new ScratchUnavailable();
        return { ok: true, replay: true, observationId: prior.observation_id };
      }
      const meetingId = input.meeting.kind === "known" ? input.meeting.id : null;
      // Reserve the event key before creating or joining any projection. A
      // concurrent winner's uncommitted row blocks this insert, then a fresh
      // READ COMMITTED statement can examine its committed immutable intent.
      const reserved = await tx.execute(sql`
        insert into scratch_receipt
          (shop_id, event_id, generation_id, trip_id, booking_id, actor_id,
           meeting_kind, meeting_id, occurred_at, observation_id)
        values (${input.shopId}, ${input.eventId}, ${input.generationId}, ${input.tripId},
                ${input.bookingId}, ${input.actorId}, ${input.meeting.kind}, ${meetingId},
                ${input.occurredAt}, null)
        on conflict do nothing returning event_id
      `);
      if (reserved.rows.length === 0) {
        const raced = await findReceipt(tx, input);
        if (!raced) throw new ScratchUnavailable();
        if (!matchesReceipt(raced, input)) throw new ScratchKeyCollision();
        if (!raced.observation_id) throw new ScratchUnavailable();
        return { ok: true, replay: true, observationId: raced.observation_id };
      }
      if (hooks.afterReservation) await hooks.afterReservation();
      // Unknown meeting identity cannot be coalesced with another event.
      const meetingScope =
        input.meeting.kind === "known" ? `known:${input.meeting.id}` : `unknown:${input.eventId}`;
      const candidateId = randomUUID();
      const created = await tx.execute(sql`
        insert into scratch_observation
          (id, shop_id, generation_id, trip_id, booking_id, meeting_scope, state)
        values (${candidateId}, ${input.shopId}, ${input.generationId}, ${input.tripId},
                ${input.bookingId}, ${meetingScope}, 'open')
        on conflict do nothing returning id
      `);
      let observationId = (created.rows[0] as { id: string } | undefined)?.id;
      if (!observationId) {
        const open = await tx.execute(sql`
          select id from scratch_observation
          where shop_id = ${input.shopId} and generation_id = ${input.generationId}
            and trip_id = ${input.tripId} and booking_id = ${input.bookingId}
            and meeting_scope = ${meetingScope} and state = 'open'
          for update
        `);
        observationId = (open.rows[0] as { id: string } | undefined)?.id;
        // Roll back the reservation rather than committing an incomplete key.
        if (!observationId) throw new ScratchUnavailable();
      }
      const linked = await tx.execute(sql`
        update scratch_receipt set observation_id = ${observationId}
        where shop_id = ${input.shopId} and event_id = ${input.eventId}
          and observation_id is null
        returning observation_id
      `);
      if (linked.rows.length !== 1) throw new ScratchUnavailable();
      if (hooks.afterLink) await hooks.afterLink();
      return { ok: true, replay: false, observationId };
    });
  } catch (error) {
    if (error instanceof ScratchKeyCollision) return { ok: false, reason: "key_reused" };
    if (error instanceof ScratchUnavailable) return { ok: false, reason: "unavailable" };
    throw error;
  }
}
