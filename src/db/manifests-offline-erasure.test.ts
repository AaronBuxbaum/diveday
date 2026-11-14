import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { signOfflineErasureEpoch } from "@/lib/offline-erasure-epoch";
import { fileScopedShopContext } from "@/test/db";
import { anonymizeDiver } from "../features/anonymize/store";
import {
  deferredOfflineNoteDisposition,
  getTripManifest,
  recordCrewRollCall,
  recordRollCall,
} from "./manifests";
import { people, rollCallEvents, shops } from "./schema";
import { getTripRoster, listStaff, upcomingTripsWithCounts } from "./trips";

const context = fileScopedShopContext();

async function fixture() {
  const { db, shop } = context;
  const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const trip = trips.find((candidate) => candidate.title.startsWith("Two-Tank Reef — Molasses"));
  if (!trip) throw new Error("demo reef trip missing");
  const [erased, other] = await getTripRoster(db, shop.id, trip.id);
  const owner = (await listStaff(db, shop.id)).find((entry) => entry.roles.includes("owner"));
  const manifest = await getTripManifest(db, shop.id, trip.id);
  const crew = manifest?.crew[0];
  if (!erased || !other || !owner || !crew) throw new Error("roll-call fixture missing");
  if (erased.booking.personId === other.booking.personId) {
    throw new Error("roll-call fixture needs two different divers");
  }
  const issuedEpoch = shop.offlineErasureEpoch;
  /** A sync from a snapshot the device saved before anything below was erased. */
  const staleSnapshot = () => {
    const snapshotId = randomUUID();
    const occurredAt = nowDate();
    return {
      source: "offline" as const,
      clientEventId: randomUUID(),
      offlineSnapshotSavedAt: new Date(occurredAt.getTime() - 1_000),
      offlineSnapshotId: snapshotId,
      offlineErasureEpochToken: signOfflineErasureEpoch({
        shopId: shop.id,
        tripId: trip.id,
        snapshotId,
        epoch: issuedEpoch,
        snapshotRevision: 1,
      }),
      occurredAt,
    };
  };
  const eraseDiver = async () => {
    const result = await anonymizeDiver(db, {
      shopId: shop.id,
      personId: erased.booking.personId,
      actorPersonId: owner.person.id,
    });
    expect(result).toMatchObject({ ok: true, alreadyAnonymized: false });
  };
  const diverNote = async (clientEventId: string) => {
    const [event] = await db
      .select({
        note: rollCallEvents.note,
        status: rollCallEvents.status,
        occurredAt: rollCallEvents.occurredAt,
      })
      .from(rollCallEvents)
      .where(eq(rollCallEvents.clientEventId, clientEventId));
    return event;
  };
  const crewNote = async (clientEventId: string) => {
    const [event] = await db
      .select({
        note: rollCallEvents.note,
        status: rollCallEvents.status,
        occurredAt: rollCallEvents.occurredAt,
      })
      .from(rollCallEvents)
      .where(eq(rollCallEvents.clientEventId, clientEventId));
    return event;
  };
  return {
    db,
    shop,
    trip,
    erased,
    other,
    owner: owner.person,
    crew,
    staleSnapshot,
    eraseDiver,
    diverNote,
    crewNote,
  };
}

/**
 * Erasure removes the erased person's own data (ADR 20260802-diver-data-erasure,
 * amendment 2026-11-01), so a stale offline note is dropped only when it is
 * that person's own: their roll-call note, or their own crew row (issue #3569).
 */
describe("offline roll-call notes after erasure", () => {
  it("disposes a deferred note for the erased subject without discarding another person's note", async () => {
    const f = await fixture();
    const sync = f.staleSnapshot();
    await f.eraseDiver();
    const common = {
      shopId: f.shop.id,
      tripId: f.trip.id,
      snapshotId: sync.offlineSnapshotId,
      token: sync.offlineErasureEpochToken,
      note: "Last seen near the ladder.",
    };
    expect(
      await deferredOfflineNoteDisposition(f.db, {
        ...common,
        subject: { bookingId: f.erased.booking.id },
      }),
    ).toBe("discarded_erasure_cutoff");
    expect(
      await deferredOfflineNoteDisposition(f.db, {
        ...common,
        subject: { bookingId: f.other.booking.id },
      }),
    ).toBeUndefined();
  });
  it("drops a pre-erasure note on the erased diver's own booking and keeps the mark", async () => {
    const f = await fixture();
    await f.eraseDiver();
    const sync = f.staleSnapshot();

    const result = await recordRollCall(f.db, {
      shopId: f.shop.id,
      tripId: f.trip.id,
      bookingId: f.erased.booking.id,
      recordedByPersonId: f.owner.id,
      status: "not_boarded",
      checkpoint: "after_dive_1",
      ...sync,
      note: "Seen at the ladder.",
    });

    expect(result).toMatchObject({ ok: true, noteDisposition: "discarded_erasure_cutoff" });
    expect(await f.diverNote(sync.clientEventId)).toEqual({
      note: null,
      status: "not_boarded",
      occurredAt: sync.occurredAt,
    });
  });

  it("keeps a pre-erasure note on another diver when somebody else was erased", async () => {
    const f = await fixture();
    await f.eraseDiver();
    const sync = f.staleSnapshot();

    const result = await recordRollCall(f.db, {
      shopId: f.shop.id,
      tripId: f.trip.id,
      bookingId: f.other.booking.id,
      recordedByPersonId: f.owner.id,
      status: "not_boarded",
      checkpoint: "after_dive_1",
      ...sync,
      note: "Last seen at the mooring line.",
    });

    expect(result).toMatchObject({ ok: true });
    expect(result).not.toHaveProperty("noteDisposition");
    expect(await f.diverNote(sync.clientEventId)).toEqual({
      note: "Last seen at the mooring line.",
      status: "not_boarded",
      occurredAt: sync.occurredAt,
    });
  });

  it("keeps a pre-erasure crew note when the erased person is somebody else", async () => {
    const f = await fixture();
    await f.eraseDiver();
    const sync = f.staleSnapshot();

    const result = await recordCrewRollCall(f.db, {
      shopId: f.shop.id,
      tripId: f.trip.id,
      personId: f.crew.id,
      recordedByPersonId: f.owner.id,
      status: "not_boarded",
      checkpoint: "after_dive_1",
      ...sync,
      note: "Last seen at the mooring line.",
    });

    expect(result).toMatchObject({ ok: true });
    expect(result).not.toHaveProperty("noteDisposition");
    expect(await f.crewNote(sync.clientEventId)).toEqual({
      note: "Last seen at the mooring line.",
      status: "not_boarded",
      occurredAt: sync.occurredAt,
    });
  });

  it("drops a pre-erasure note on an erased crew member's own row and keeps the mark", async () => {
    const f = await fixture();
    // `anonymizeDiver` refuses a current staff member, so this writes what a
    // committed erasure of this person leaves behind: the record marked and
    // the shop's epoch advanced in the same commit.
    await f.db
      .update(people)
      .set({ anonymizedAt: nowDate(), deletedAt: nowDate() })
      .where(eq(people.id, f.crew.id));
    await f.db
      .update(shops)
      .set({ offlineErasureEpoch: f.shop.offlineErasureEpoch + 1 })
      .where(eq(shops.id, f.shop.id));
    const sync = f.staleSnapshot();

    const result = await recordCrewRollCall(f.db, {
      shopId: f.shop.id,
      tripId: f.trip.id,
      personId: f.crew.id,
      recordedByPersonId: f.owner.id,
      status: "not_boarded",
      checkpoint: "after_dive_1",
      ...sync,
      note: "Seen at the ladder.",
    });

    expect(result).toMatchObject({ ok: true, noteDisposition: "discarded_erasure_cutoff" });
    expect(await f.crewNote(sync.clientEventId)).toEqual({
      note: null,
      status: "not_boarded",
      occurredAt: sync.occurredAt,
    });
  });

  it("still drops a note whose snapshot token does not verify", async () => {
    const f = await fixture();
    const sync = { ...f.staleSnapshot(), offlineErasureEpochToken: "not-a-signed-epoch" };

    const result = await recordRollCall(f.db, {
      shopId: f.shop.id,
      tripId: f.trip.id,
      bookingId: f.other.booking.id,
      recordedByPersonId: f.owner.id,
      status: "not_boarded",
      checkpoint: "after_dive_1",
      ...sync,
      note: "Last seen at the mooring line.",
    });

    expect(result).toMatchObject({ ok: true, noteDisposition: "discarded_unverified_snapshot" });
    expect((await f.diverNote(sync.clientEventId))?.note).toBeNull();
  });
});
