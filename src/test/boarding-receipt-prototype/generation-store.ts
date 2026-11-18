import { sql } from "drizzle-orm";
import type { AppDb, DbExecutor } from "@/db/client";

/** Disposable test tables only. No migration or production caller installs them.
 * This model does not authenticate an actor, implement erasure, preserve real
 * bookings, coordinate old writers, or issue a server/device receipt. The
 * prototype writer preserves prior rows; the scratch schema does not enforce
 * append-only storage, and the synthetic erased flag is not actual erasure.
 */
export type PrototypeContext = {
  shopId: string;
  actorId: string;
  tripId: string;
  bookingId: string;
  generationId: string;
  meetingId: string;
};
export type PrototypeEvent = PrototypeContext & { eventId: string };

export async function installGenerationPrototype(db: AppDb) {
  await db.execute(sql`create table draft_gen_generation (
    shop_id uuid not null, generation_id uuid not null, trip_id uuid not null,
    primary key(shop_id, generation_id), unique(shop_id, generation_id, trip_id))`);
  await db.execute(sql`create table draft_gen_context (
    shop_id uuid not null, generation_id uuid not null, trip_id uuid not null,
    booking_id uuid not null, meeting_id uuid not null,
    primary key(shop_id, generation_id, booking_id, meeting_id),
    foreign key(shop_id, generation_id, trip_id)
      references draft_gen_generation(shop_id, generation_id, trip_id))`);
  await db.execute(sql`create table draft_gen_head (
    shop_id uuid not null, trip_id uuid not null, generation_id uuid not null,
    primary key(shop_id, trip_id))`);
  await db.execute(sql`create table draft_gen_actor (
    shop_id uuid not null, actor_id uuid not null, active boolean not null,
    primary key(shop_id, actor_id))`);
  await db.execute(sql`create table draft_gen_subject (
    shop_id uuid not null, booking_id uuid not null, erased boolean not null,
    primary key(shop_id, booking_id))`);
  await db.execute(sql`create table draft_gen_observation (
    shop_id uuid not null, event_id uuid not null, actor_id uuid not null,
    trip_id uuid not null, booking_id uuid not null, generation_id uuid not null,
    meeting_id uuid not null, primary key(shop_id, event_id))`);
}
export async function seedGenerationPrototype(db: AppDb, c: PrototypeContext) {
  await db.execute(
    sql`insert into draft_gen_generation values (${c.shopId}, ${c.generationId}, ${c.tripId})`,
  );
  await db.execute(
    sql`insert into draft_gen_context values (${c.shopId}, ${c.generationId}, ${c.tripId}, ${c.bookingId}, ${c.meetingId})`,
  );
  await db.execute(
    sql`insert into draft_gen_head values (${c.shopId}, ${c.tripId}, ${c.generationId})`,
  );
  await db.execute(sql`insert into draft_gen_actor values (${c.shopId}, ${c.actorId}, true)`);
  await db.execute(sql`insert into draft_gen_subject values (${c.shopId}, ${c.bookingId}, false)`);
}
/** Adds another test-only subject/meeting to the same synthetic generation. */
export async function addPrototypeContext(db: AppDb, c: PrototypeContext) {
  await db.execute(
    sql`insert into draft_gen_context values (${c.shopId}, ${c.generationId}, ${c.tripId}, ${c.bookingId}, ${c.meetingId})`,
  );
  await db.execute(
    sql`insert into draft_gen_subject values (${c.shopId}, ${c.bookingId}, false) on conflict do nothing`,
  );
}
/** Called inside a test-owned transaction to stage a reset pointer rotation. */
export async function rotatePrototypeGeneration(
  tx: DbExecutor,
  old: PrototypeContext,
  next: PrototypeContext,
) {
  await tx.execute(sql`set local lock_timeout = '5s'`);
  await tx.execute(sql`set local statement_timeout = '10s'`);
  if (
    old.shopId !== next.shopId ||
    old.tripId !== next.tripId ||
    old.generationId === next.generationId
  )
    throw new Error("invalid prototype rotation");
  await tx.execute(
    sql`insert into draft_gen_generation values (${next.shopId}, ${next.generationId}, ${next.tripId})`,
  );
  await tx.execute(
    sql`insert into draft_gen_context values (${next.shopId}, ${next.generationId}, ${next.tripId}, ${next.bookingId}, ${next.meetingId})`,
  );
  const changed =
    await tx.execute(sql`update draft_gen_head set generation_id = ${next.generationId}
    where shop_id = ${old.shopId} and trip_id = ${old.tripId} and generation_id = ${old.generationId} returning generation_id`);
  if (changed.rows.length !== 1) throw new Error("stale prototype head");
}
export async function setPrototypeErased(db: AppDb, shopId: string, bookingId: string) {
  await db.execute(
    sql`update draft_gen_subject set erased = true where shop_id = ${shopId} and booking_id = ${bookingId}`,
  );
}
export async function capturePrototypeSighting(
  db: AppDb,
  e: PrototypeEvent,
): Promise<"recorded" | "replayed" | "key_reused" | "unavailable"> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local lock_timeout = '5s'`);
    await tx.execute(sql`set local statement_timeout = '10s'`);
    // Synthetic authorization rows are intentionally separate from the reset
    // head. Locks model ordering only, not the application's real auth paths.
    const actor = await tx.execute(
      sql`select active from draft_gen_actor where shop_id = ${e.shopId} and actor_id = ${e.actorId} for share`,
    );
    if (!(actor.rows[0] as { active?: boolean } | undefined)?.active) return "unavailable";
    const subject = await tx.execute(
      sql`select erased from draft_gen_subject where shop_id = ${e.shopId} and booking_id = ${e.bookingId} for share`,
    );
    if ((subject.rows[0] as { erased?: boolean } | undefined)?.erased !== false)
      return "unavailable";
    const original = await tx.execute(
      sql`select generation_id from draft_gen_context where shop_id = ${e.shopId} and generation_id = ${e.generationId} and trip_id = ${e.tripId} and booking_id = ${e.bookingId} and meeting_id = ${e.meetingId}`,
    );
    if (original.rows.length !== 1) return "unavailable";
    const inserted = await tx.execute(
      sql`insert into draft_gen_observation values (${e.shopId}, ${e.eventId}, ${e.actorId}, ${e.tripId}, ${e.bookingId}, ${e.generationId}, ${e.meetingId}) on conflict do nothing returning event_id`,
    );
    if (inserted.rows.length === 1) return "recorded";
    const found = await tx.execute(
      sql`select actor_id, trip_id, booking_id, generation_id, meeting_id from draft_gen_observation where shop_id = ${e.shopId} and event_id = ${e.eventId}`,
    );
    const row = found.rows[0] as
      | {
          actor_id: string;
          trip_id: string;
          booking_id: string;
          generation_id: string;
          meeting_id: string;
        }
      | undefined;
    return row &&
      row.actor_id === e.actorId &&
      row.trip_id === e.tripId &&
      row.booking_id === e.bookingId &&
      row.generation_id === e.generationId &&
      row.meeting_id === e.meetingId
      ? "replayed"
      : "key_reused";
  });
}
