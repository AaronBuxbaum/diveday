import { and, eq, inArray } from "drizzle-orm";
import { expect, it } from "vitest";
import {
  issueOfflineManifestSnapshot,
  readOfflineManifestRoster,
} from "@/features/offline-manifest-snapshots";
import { nowDate } from "@/lib/clock";
import { maxRecordedDiveNumber } from "@/lib/manifests";
import { canonicalRollCallEvidenceId } from "@/lib/roll-call-causality";
import { manifestContext } from "@/test/substrate-fixtures/db/manifests-test-fixtures";
import { aboardAtSeaBookingIds } from "./aboard-at-sea";
import { getTripManifest, recordCrewRollCall, recordRollCall } from "./manifests";
import { recordedRollCallRows } from "./roll-call-history";
import { bookings, rollCallEvents, tripAssignments, trips } from "./schema";
import { seedRollCallEvidence } from "./seed-roll-call-evidence";

type Mark = Omit<
  Parameters<typeof recordRollCall>[1],
  "shopId" | "tripId" | "bookingId" | "recordedByPersonId"
>;
async function scenario(role: "diver" | "crew") {
  const { db, shop, reef, booking, staff } = await manifestContext();
  const now = nowDate();
  let bookingId = booking.booking.id;
  if (role === "crew") {
    await db
      .insert(tripAssignments)
      .values({ tripId: reef.id, personId: staff.id })
      .onConflictDoNothing();
    const existing = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(eq(bookings.tripId, reef.id), eq(bookings.personId, staff.id)));
    const seat =
      existing[0] ??
      (
        await db
          .insert(bookings)
          .values({
            shopId: shop.id,
            tripId: reef.id,
            personId: staff.id,
            bookedAs: "diver",
            status: "booked",
          })
          .returning({ id: bookings.id })
      )[0];
    if (!seat) throw new Error("crew seat missing");
    bookingId = seat.id;
  }
  await db
    .update(trips)
    .set({
      startsAt: new Date(now.getTime() - 3_600_000),
      endsAt: new Date(now.getTime() + 3_600_000),
    })
    .where(eq(trips.id, reef.id));
  const common = { shopId: shop.id, tripId: reef.id, recordedByPersonId: staff.id };
  const subject =
    role === "diver" ? { bookingId } : { subjectKind: "crew" as const, crewPersonId: staff.id };
  const write = (input: Mark) =>
    role === "diver"
      ? recordRollCall(db, { ...common, ...input, bookingId })
      : recordCrewRollCall(db, { ...common, ...input, personId: staff.id });
  const view = async (checkpoint: "departure" | "after_dive_1") => {
    const manifest = await getTripManifest(db, shop.id, reef.id, checkpoint);
    const row =
      role === "diver"
        ? manifest?.divers.find((value) => value.bookingId === bookingId)
        : manifest?.crew.find((value) => value.id === staff.id);
    return { manifest, row, context: row?.rollCallContext };
  };
  const observed = async (
    status: "boarded" | "not_boarded",
    checkpoint: "departure" | "after_dive_1",
  ) => {
    const shown = await view(checkpoint);
    const clientEventId = crypto.randomUUID();
    const result = await write({
      status,
      checkpoint,
      clientEventId,
      observedEvidenceIds: shown.context?.observedEvidenceIds ?? [],
      meetingDay: 0,
    });
    expect(result).toMatchObject({ ok: true });
    return clientEventId;
  };
  const legacy = async (
    checkpoint: "departure" | "after_dive_1",
    retractsClientEventId?: string,
  ): Promise<Mark> => {
    const read = await readOfflineManifestRoster(db, shop.id, reef.id);
    if (!read) throw new Error("saved roster missing");
    const issued = await issueOfflineManifestSnapshot(db, shop.id, reef.id, read);
    if (!issued.ok) throw new Error("saved identity missing");
    return {
      checkpoint,
      status: "cleared",
      source: "offline",
      clientEventId: crypto.randomUUID(),
      occurredAt: now,
      offlineSnapshotSavedAt: now,
      offlineSnapshotId: issued.snapshotId,
      offlineErasureEpochToken: issued.erasureEpochToken,
      ...(retractsClientEventId ? { retractsClientEventId } : {}),
    };
  };
  const retainedUndo = (checkpoint: "departure" | "after_dive_1") =>
    seedRollCallEvidence(db, {
      ...common,
      ...subject,
      checkpoint,
      status: "cleared",
      occurredAt: now,
      meetingDay: 0,
    });
  const held = () =>
    aboardAtSeaBookingIds(db, { shopId: shop.id, tripId: reef.id, now, bookingIds: [bookingId] });
  const history = () => recordedRollCallRows(db, shop.id, [reef.id]);
  return { db, shop, reef, bookingId, write, view, observed, legacy, retainedUndo, held, history };
}

for (const role of ["diver", "crew"] as const) {
  it(`retries an unchanged retained ${role} client-target undo without manufacturing captured context`, async () => {
    const f = await scenario(role);
    const targetInput = { ...(await f.legacy("departure")), status: "not_boarded" as const };
    expect(await f.write(targetInput)).toMatchObject({ ok: true });
    const retry = await f.legacy("departure", targetInput.clientEventId);
    expect(await f.write(retry)).toMatchObject({ ok: true });
    const targetId = targetInput.clientEventId;
    const retryId = retry.clientEventId;
    if (!targetId || !retryId) throw new Error("retained client identities missing");
    const selected = and(
      eq(rollCallEvents.shopId, f.shop.id),
      eq(rollCallEvents.tripId, f.reef.id),
      inArray(rollCallEvents.clientEventId, [
        targetInput.clientEventId as string,
        retry.clientEventId as string,
      ]),
    );
    // Retained pre-causal rows have no captured context or observed basis.
    // The exact validated FK survives initialization; clocks prove nothing.
    await f.db
      .update(rollCallEvents)
      .set({ captureContext: null, observedEvidenceIds: null })
      .where(selected);
    const read = () =>
      f.db.select().from(rollCallEvents).where(selected).orderBy(rollCallEvents.seq);
    const before = await read();
    expect(before).toHaveLength(2);
    expect(await f.write(retry)).toMatchObject({ ok: true, duplicate: true });
    expect(await f.write({ ...retry, retractsClientEventId: crypto.randomUUID() })).toMatchObject({
      ok: false,
      reason: "client_event_conflict",
    });
    expect(await read()).toEqual(before);
  });

  it(`keeps ${role} ashore uncertain after a signed untargeted legacy undo until a fresh ordinary confirmation`, async () => {
    const f = await scenario(role);
    const original = await f.observed("not_boarded", "departure");
    expect((await f.held()).has(f.bookingId)).toBe(false);
    const queued = await f.legacy("departure");
    expect(await f.write(queued)).toMatchObject({ ok: true });
    expect(await f.write(queued)).toMatchObject({ ok: true, duplicate: true });
    expect((await f.held()).get(f.bookingId)).toBe("uncounted");
    const uncertain = await f.view("departure");
    expect(uncertain.row?.rollCall?.state).not.toBe("boarded");
    expect(uncertain.context?.conflict).toBe(false);
    expect(uncertain.context?.observedEvidenceIds).toContain(`client:${original}`);
    expect(uncertain.context?.observedEvidenceIds).toContain(`client:${queued.clientEventId}`);
    // Ordinary confirmation names the displayed uncertainty, not an invented
    // undo target or a reconciliation of genuinely conflicting statuses.
    await f.observed("not_boarded", "departure");
    expect((await f.held()).has(f.bookingId)).toBe(false);
    expect((await f.view("departure")).context?.conflict).toBe(false);
  });

  it(`honors an exact legacy ${role} undo without withdrawing another compatible ashore report`, async () => {
    const f = await scenario(role);
    const target = await f.observed("not_boarded", "departure");
    const independent = crypto.randomUUID();
    expect(
      await f.write({
        status: "not_boarded",
        checkpoint: "departure",
        clientEventId: independent,
        meetingDay: 0,
        observedEvidenceIds: [],
      }),
    ).toMatchObject({ ok: true });
    expect(await f.write(await f.legacy("departure", target))).toMatchObject({ ok: true });
    expect((await f.held()).has(f.bookingId)).toBe(false);
    const after = await f.view("departure");
    expect(after.context?.conflict).toBe(false);
    expect(after.context?.observedEvidenceIds).not.toContain(`client:${target}`);
    expect(after.context?.observedEvidenceIds).toContain(`client:${independent}`);
  });

  it(`retains actual after-dive ${role} missing evidence across an old untargeted withdrawal`, async () => {
    const f = await scenario(role);
    await f.observed("not_boarded", "after_dive_1");
    await f.retainedUndo("after_dive_1");
    expect((await f.view("after_dive_1")).row?.rollCall?.state).toBe("not_boarded");
    expect((await f.held()).get(f.bookingId)).toBe("on_the_water");
  });

  it(`keeps an unwithdrawn after-dive ${role} positive in the plan floor when an old undo has no target`, async () => {
    const f = await scenario(role);
    await f.observed("boarded", "after_dive_1");
    await f.retainedUndo("after_dive_1");
    const shown = await f.view("after_dive_1");
    expect(shown.row?.rollCall).toBeUndefined();
    expect(shown.context?.conflict).toBe(false);
    expect(maxRecordedDiveNumber(await f.history())).toBe(1);
    const raw = await f.db
      .select()
      .from(rollCallEvents)
      .where(eq(rollCallEvents.tripId, f.reef.id));
    expect(
      raw.some(
        (row) =>
          row.statementStatus === "boarded" &&
          shown.context?.observedEvidenceIds.includes(canonicalRollCallEvidenceId(row)),
      ),
    ).toBe(true);
  });

  it(`lets a genuine exact ${role} undo release that checkpoint's plan floor`, async () => {
    const f = await scenario(role);
    const target = await f.observed("boarded", "after_dive_1");
    expect(maxRecordedDiveNumber(await f.history())).toBe(1);
    expect(await f.write(await f.legacy("after_dive_1", target))).toMatchObject({ ok: true });
    expect(maxRecordedDiveNumber(await f.history())).toBe(0);
  });
}
