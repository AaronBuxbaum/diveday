import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { nowMs } from "@/lib/clock";
import { EMPTY_EMERGENCY_REFERENCE } from "@/lib/emergency-reference";
import {
  latestOfflineCrewRollCall,
  latestOfflineRollCall,
  OFFLINE_MANIFEST_RECORD_VERSION,
  type OfflineManifestSnapshot,
  type OfflineRollCallEvent,
  serializeManifests,
} from "@/lib/offline-manifests";
import { clientRollCallEvidenceId } from "@/lib/roll-call-causality";
import { advanceClock } from "@/test/clock";
import { manifestContext } from "../test/substrate-fixtures/db/manifests-test-fixtures";
import { getTripManifest, recordCrewRollCall, recordRollCall } from "./manifests";
import { manifestCausalContexts } from "./roll-call-causal-store";
import { rollCallEvents, tripScheduleDays } from "./schema";

vi.mock("@/lib/log", () => ({ log: vi.fn() }));
const MINUTE = 60_000;

it("keeps shared server crew reads out of the causal context transport", async () => {
  const { db, shop, reef } = await manifestContext();
  const frame = await manifestCausalContexts(db, shop.id, reef.id);
  expect(Object.keys(frame).sort()).toEqual(["contexts", "meetingDay"]);
  expect(frame.contexts).toBeInstanceOf(Map);
});

describe("unobserved opposing roll-call statements", () => {
  for (const role of ["diver", "crew"] as const) {
    for (const scenario of [
      "accurate delayed aboard",
      "fast-clock late aboard",
      "slow-clock missing",
    ] as const) {
      it(`preserves the missing evidence for ${role}: ${scenario}`, async () => {
        const { db, shop, reef, booking, staff } = await manifestContext();
        const now = nowMs();
        const initial = await getTripManifest(db, shop.id, reef.id, "after_dive_1");
        const crewId = initial?.crew[0]?.id;
        if (!crewId) throw new Error("fixture missing crew");
        const common = {
          shopId: shop.id,
          tripId: reef.id,
          recordedByPersonId: staff.id,
          checkpoint: "after_dive_1" as const,
        };
        const write = (input: {
          status: "boarded" | "not_boarded";
          source?: "offline";
          clientEventId?: string;
          offlineSnapshotSavedAt?: Date;
          occurredAt?: Date;
        }) =>
          role === "diver"
            ? recordRollCall(db, {
                ...common,
                ...input,
                bookingId: booking.booking.id,
              })
            : recordCrewRollCall(db, {
                ...common,
                ...input,
                personId: crewId,
              });
        const slow = scenario === "slow-clock missing";
        await write({ status: slow ? "boarded" : "not_boarded" });
        advanceClock(scenario === "fast-clock late aboard" ? 15 * MINUTE : MINUTE);
        await write({
          status: slow ? "not_boarded" : "boarded",
          source: "offline",
          clientEventId: "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa",
          offlineSnapshotSavedAt: new Date(now - 60 * MINUTE),
          occurredAt: new Date(now + (scenario === "fast-clock late aboard" ? 5 : -1) * MINUTE),
        });
        const manifest = await getTripManifest(db, shop.id, reef.id, "after_dive_1");
        const standing =
          role === "diver"
            ? manifest?.divers.find((row) => row.bookingId === booking.booking.id)?.rollCall
            : manifest?.crew.find((row) => row.id === crewId)?.rollCall;
        expect(standing).toMatchObject({ state: "not_boarded" });
      });
    }
  }
});

for (const role of ["diver", "crew"] as const) {
  it(`keeps transitive snapshot ancestry after a lost acknowledgement for ${role}`, async () => {
    const { db, shop, reef, booking, staff } = await manifestContext();
    const first = await getTripManifest(db, shop.id, reef.id, "after_dive_1");
    const crewId = first?.crew[0]?.id;
    if (!crewId) throw new Error("fixture missing crew");
    const common = {
      shopId: shop.id,
      tripId: reef.id,
      recordedByPersonId: staff.id,
      checkpoint: "after_dive_1" as const,
      meetingDay: 0,
    };
    const write = (input: {
      status: "boarded" | "not_boarded" | "cleared";
      clientEventId: string;
      observedEvidenceIds: string[];
      retractsEventId?: string;
    }) =>
      role === "diver"
        ? recordRollCall(db, {
            ...common,
            ...input,
            observedEvidenceIds: input.observedEvidenceIds.map(clientRollCallEvidenceId),
            bookingId: booking.booking.id,
          })
        : recordCrewRollCall(db, {
            ...common,
            ...input,
            observedEvidenceIds: input.observedEvidenceIds.map(clientRollCallEvidenceId),
            personId: crewId,
          });
    const m = "10000000-0000-4000-8000-000000000001";
    const b = "10000000-0000-4000-8000-000000000002";
    const u = "10000000-0000-4000-8000-000000000003";
    const c = "10000000-0000-4000-8000-000000000004";
    expect(
      await write({ status: "not_boarded", clientEventId: m, observedEvidenceIds: [] }),
    ).toMatchObject({ ok: true });
    const aboard = await write({ status: "boarded", clientEventId: b, observedEvidenceIds: [m] });
    if (!aboard.ok) throw new Error("fixture correction refused");
    expect(
      await write({
        status: "cleared",
        clientEventId: u,
        observedEvidenceIds: [b],
        retractsEventId: aboard.eventId,
      }),
    ).toMatchObject({ ok: true });
    expect(
      await write({ status: "boarded", clientEventId: c, observedEvidenceIds: [u] }),
    ).toMatchObject({ ok: true });
    const manifest = await getTripManifest(db, shop.id, reef.id, "after_dive_1");
    if (!manifest) throw new Error("fixture missing manifest");
    const payload = serializeManifests(
      [manifest],
      {
        slug: shop.slug,
        name: shop.name,
        timezone: shop.timezone,
        emergencyReference: EMPTY_EMERGENCY_REFERENCE,
      },
      () => "",
    );
    const copy: OfflineManifestSnapshot = {
      version: OFFLINE_MANIFEST_RECORD_VERSION,
      ...payload,
      snapshotId: crypto.randomUUID(),
      savedAt: new Date(nowMs()).toISOString(),
      expiresAt: new Date(nowMs() + 86_400_000).toISOString(),
    };
    const pending: OfflineRollCallEvent = {
      clientEventId: m,
      snapshotId: copy.snapshotId,
      snapshotSavedAt: copy.savedAt,
      tripId: reef.id,
      ...(role === "diver" ? { bookingId: booking.booking.id } : { crewPersonId: crewId }),
      checkpoint: "after_dive_1",
      status: "not_boarded",
      occurredAt: copy.savedAt,
      syncStatus: "pending",
      observedEvidenceIds: [],
      meetingDay: 0,
    };
    const local =
      role === "diver"
        ? latestOfflineRollCall(copy, [pending], booking.booking.id, "after_dive_1")
        : latestOfflineCrewRollCall(copy, [pending], crewId, "after_dive_1");
    expect(local).toMatchObject({ state: "boarded", evidenceConflict: false });
  });
}

for (const role of ["diver", "crew"] as const) {
  it(`requires explicit resolution intent for an observed conflict and preserves unseen evidence for ${role}`, async () => {
    const { db, shop, reef, booking, staff } = await manifestContext();
    const initial = await getTripManifest(db, shop.id, reef.id, "after_dive_1");
    const crewId = initial?.crew[0]?.id;
    if (!crewId) throw new Error("fixture missing crew");
    const common = {
      shopId: shop.id,
      tripId: reef.id,
      recordedByPersonId: staff.id,
      checkpoint: "after_dive_1" as const,
      meetingDay: 0,
    };
    const write = (
      status: "boarded" | "not_boarded",
      id: string,
      observedEvidenceIds: string[],
      reconcilesEvidence = false,
    ) =>
      role === "diver"
        ? recordRollCall(db, {
            ...common,
            bookingId: booking.booking.id,
            status,
            clientEventId: id,
            observedEvidenceIds: observedEvidenceIds.map(clientRollCallEvidenceId),
            reconcilesEvidence,
          })
        : recordCrewRollCall(db, {
            ...common,
            personId: crewId,
            status,
            clientEventId: id,
            observedEvidenceIds: observedEvidenceIds.map(clientRollCallEvidenceId),
            reconcilesEvidence,
          });
    const read = async () => {
      const manifest = await getTripManifest(db, shop.id, reef.id, "after_dive_1");
      return role === "diver"
        ? manifest?.divers.find((row) => row.bookingId === booking.booking.id)
        : manifest?.crew.find((row) => row.id === crewId);
    };
    const m = crypto.randomUUID(),
      a = crypto.randomUUID(),
      ordinary = crypto.randomUUID(),
      resolved = crypto.randomUUID(),
      late = crypto.randomUUID();
    await write("not_boarded", m, []);
    await write("boarded", a, []);
    await write("boarded", ordinary, [m, a]);
    expect((await read())?.rollCall).toMatchObject({
      state: "not_boarded",
      evidenceConflict: true,
    });
    await write("boarded", resolved, [m, a, ordinary], true);
    expect((await read())?.rollCallContext).toMatchObject({ conflict: false });
    expect((await read())?.rollCall).toMatchObject({ state: "boarded" });
    await write("not_boarded", late, []);
    await write("boarded", crypto.randomUUID(), [resolved], true);
    expect((await read())?.rollCall).toMatchObject({
      state: "not_boarded",
      evidenceConflict: true,
    });
  });
}

it("does not collapse a new client identity into a retained server event identity", async () => {
  const { db, shop, reef, booking, staff } = await manifestContext();
  const common = {
    shopId: shop.id,
    tripId: reef.id,
    bookingId: booking.booking.id,
    recordedByPersonId: staff.id,
    checkpoint: "after_dive_1" as const,
  };
  const legacy = await recordRollCall(db, { ...common, status: "boarded" });
  if (!legacy.ok) throw new Error("fixture legacy mark refused");
  await recordRollCall(db, {
    ...common,
    status: "not_boarded",
    clientEventId: legacy.eventId,
    observedEvidenceIds: [],
    meetingDay: 0,
  });
  const [recorded] = await db
    .select()
    .from(rollCallEvents)
    .where(eq(rollCallEvents.clientEventId, legacy.eventId));
  expect(recorded).toMatchObject({ status: "not_boarded", evidenceConflict: true });
  expect(recorded.causalFrontier).toHaveLength(2);
  const manifest = await getTripManifest(db, shop.id, reef.id, "after_dive_1");
  expect(
    manifest?.divers.find((row) => row.bookingId === booking.booking.id)?.rollCall,
  ).toMatchObject({ state: "not_boarded", evidenceConflict: true });
});

for (const role of ["diver", "crew"] as const) {
  for (const unseen of [false, true]) {
    it(`honors an opaque queued exact undo across a changed device meeting-day clock for ${role}, unseen alarm=${unseen}`, async () => {
      const { db, shop, reef, booking, staff } = await manifestContext();
      const baseTime = nowMs();
      await db.delete(tripScheduleDays).where(eq(tripScheduleDays.tripId, reef.id));
      await db.insert(tripScheduleDays).values(
        [0, 1].map((day) => ({
          tripId: reef.id,
          dayNumber: day + 1,
          startsAt: new Date(baseTime + day * 86_400_000 - 3_600_000),
          endsAt: new Date(baseTime + day * 86_400_000 + 3_600_000),
        })),
      );
      const initial = await getTripManifest(db, shop.id, reef.id, "after_dive_1");
      const crewId = initial?.crew[0]?.id;
      if (!crewId) throw new Error("fixture crew missing");
      const common = {
        shopId: shop.id,
        tripId: reef.id,
        checkpoint: "after_dive_1" as const,
        recordedByPersonId: staff.id,
      };
      const targetId = crypto.randomUUID();
      const target = {
        ...common,
        status: "not_boarded" as const,
        clientEventId: targetId,
        observedEvidenceIds: [],
        meetingDay: 0,
      };
      const first =
        role === "diver"
          ? await recordRollCall(db, { ...target, bookingId: booking.booking.id })
          : await recordCrewRollCall(db, { ...target, personId: crewId });
      expect(first).toMatchObject({ ok: true });
      advanceClock(86_400_000);
      if (unseen) {
        const later = { ...target, clientEventId: crypto.randomUUID(), meetingDay: 1 };
        expect(
          role === "diver"
            ? await recordRollCall(db, { ...later, bookingId: booking.booking.id })
            : await recordCrewRollCall(db, { ...later, personId: crewId }),
        ).toMatchObject({ ok: true });
      }
      // An older persisted queue names its exact target but has no captured
      // meeting-day/basis fields. Its clock is not evidence of the target's day.
      const undo = {
        ...common,
        status: "cleared" as const,
        source: "offline" as const,
        clientEventId: crypto.randomUUID(),
        retractsClientEventId: targetId,
        offlineSnapshotSavedAt: new Date(baseTime),
        occurredAt: new Date(nowMs()),
      };
      const result =
        role === "diver"
          ? await recordRollCall(db, { ...undo, bookingId: booking.booking.id })
          : await recordCrewRollCall(db, { ...undo, personId: crewId });
      expect(result).toMatchObject({ ok: true });
      const manifest = await getTripManifest(db, shop.id, reef.id, "after_dive_1");
      const row =
        role === "diver"
          ? manifest?.divers.find((item) => item.bookingId === booking.booking.id)
          : manifest?.crew.find((item) => item.id === crewId);
      if (unseen) expect(row?.rollCall).toMatchObject({ state: "not_boarded" });
      else expect(row?.rollCall).toBeUndefined();
      expect(
        role === "diver"
          ? await recordRollCall(db, { ...undo, bookingId: booking.booking.id })
          : await recordCrewRollCall(db, { ...undo, personId: crewId }),
      ).toMatchObject({ ok: true, duplicate: true });
      const [stored] = await db
        .select()
        .from(rollCallEvents)
        .where(eq(rollCallEvents.clientEventId, undo.clientEventId));
      expect(stored.observedEvidenceIds).toBeNull();
      expect(stored.retractsEventId).toBe(first.ok ? first.eventId : null);
    });
  }
}

for (const role of ["diver", "crew"] as const) {
  it(`keeps actual frontier attribution and undo identity after observed reversed delivery for ${role}`, async () => {
    const { db, shop, reef, booking, staff } = await manifestContext();
    const crewId = (await getTripManifest(db, shop.id, reef.id, "after_dive_1"))?.crew[0]?.id;
    if (!crewId) throw new Error("fixture missing crew");
    const common = {
      shopId: shop.id,
      tripId: reef.id,
      checkpoint: "after_dive_1" as const,
      recordedByPersonId: staff.id,
      meetingDay: 0,
    };
    const m = crypto.randomUUID(),
      b = crypto.randomUUID();
    const aboard = {
      ...common,
      status: "boarded" as const,
      clientEventId: b,
      observedEvidenceIds: [clientRollCallEvidenceId(m)],
      note: undefined,
    };
    const boardResult =
      role === "diver"
        ? await recordRollCall(db, { ...aboard, bookingId: booking.booking.id })
        : await recordCrewRollCall(db, { ...aboard, personId: crewId });
    expect(boardResult).toMatchObject({ ok: true });
    const missing = {
      ...common,
      status: "not_boarded" as const,
      clientEventId: m,
      observedEvidenceIds: [],
      note: "Original missing statement",
    };
    expect(
      role === "diver"
        ? await recordRollCall(db, { ...missing, bookingId: booking.booking.id })
        : await recordCrewRollCall(db, { ...missing, personId: crewId }),
    ).toMatchObject({ ok: true });
    const manifest = await getTripManifest(db, shop.id, reef.id, "after_dive_1");
    const row =
      role === "diver"
        ? manifest?.divers.find((item) => item.bookingId === booking.booking.id)
        : manifest?.crew.find((item) => item.id === crewId);
    expect(row?.rollCall).toMatchObject({
      state: "boarded",
      // Aboard's absent note must never inherit the superseded missing note.
      note: null,
      eventId: boardResult.ok ? boardResult.eventId : null,
    });
    const undo = {
      ...common,
      status: "cleared" as const,
      clientEventId: crypto.randomUUID(),
      observedEvidenceIds: row?.rollCallContext?.observedEvidenceIds,
      retractsEventId: row?.rollCall?.eventId,
    };
    expect(
      role === "diver"
        ? await recordRollCall(db, { ...undo, bookingId: booking.booking.id })
        : await recordCrewRollCall(db, { ...undo, personId: crewId }),
    ).toMatchObject({ ok: true });
  });
}

for (const role of ["diver", "crew"] as const) {
  it(`automatically merges compatible independent live taps without reconciliation for ${role}`, async () => {
    const { db, shop, reef, booking, staff } = await manifestContext();
    const crewId = (await getTripManifest(db, shop.id, reef.id, "after_dive_1"))?.crew[0]?.id;
    if (!crewId) throw new Error("fixture crew missing");
    const common = {
      shopId: shop.id,
      tripId: reef.id,
      recordedByPersonId: staff.id,
      checkpoint: "after_dive_1" as const,
      status: "boarded" as const,
      meetingDay: 0,
      observedEvidenceIds: [],
    };
    for (let device = 0; device < 2; device++) {
      const captured = { ...common, clientEventId: crypto.randomUUID() };
      expect(
        role === "diver"
          ? await recordRollCall(db, { ...captured, bookingId: booking.booking.id })
          : await recordCrewRollCall(db, { ...captured, personId: crewId }),
      ).toMatchObject({ ok: true });
    }
    const manifest = await getTripManifest(db, shop.id, reef.id, "after_dive_1");
    const row =
      role === "diver"
        ? manifest?.divers.find((item) => item.bookingId === booking.booking.id)
        : manifest?.crew.find((item) => item.id === crewId);
    expect(row?.rollCallContext).toMatchObject({ conflict: false, orderingUnknown: false });
    expect(row?.rollCallContext?.observedEvidenceIds).toHaveLength(2);
    expect(row?.rollCall).toMatchObject({ state: "boarded", evidenceConflict: false });
  });
}

for (const role of ["diver", "crew"] as const) {
  it(`rejects a changed tap-selected day under the same identity while accepting an unchanged retry for ${role}`, async () => {
    const { db, shop, reef, booking, staff } = await manifestContext();
    const baseTime = nowMs();
    await db.delete(tripScheduleDays).where(eq(tripScheduleDays.tripId, reef.id));
    await db.insert(tripScheduleDays).values(
      [0, 1].map((day) => ({
        tripId: reef.id,
        dayNumber: day + 1,
        startsAt: new Date(baseTime + day * 86_400_000),
        endsAt: new Date(baseTime + day * 86_400_000 + 3_600_000),
      })),
    );
    const crewId = (await getTripManifest(db, shop.id, reef.id, "after_dive_1"))?.crew[0]?.id;
    if (!crewId) throw new Error("fixture missing crew");
    const captured = {
      shopId: shop.id,
      tripId: reef.id,
      recordedByPersonId: staff.id,
      checkpoint: "after_dive_1" as const,
      status: "boarded" as const,
      clientEventId: crypto.randomUUID(),
      observedEvidenceIds: [],
      meetingDay: 0,
    };
    const write = (input: typeof captured) =>
      role === "diver"
        ? recordRollCall(db, { ...input, bookingId: booking.booking.id })
        : recordCrewRollCall(db, { ...input, personId: crewId });
    expect(await write(captured)).toMatchObject({ ok: true });
    expect(await write(captured)).toMatchObject({ ok: true, duplicate: true });
    expect(await write({ ...captured, meetingDay: 1 })).toMatchObject({
      ok: false,
      reason: "client_event_conflict",
    });
  });

  it(`rejects a changed exact undo target under the same identity while accepting an unchanged retry for ${role}`, async () => {
    const { db, shop, reef, booking, staff } = await manifestContext();
    const crewId = (await getTripManifest(db, shop.id, reef.id, "after_dive_1"))?.crew[0]?.id;
    if (!crewId) throw new Error("fixture missing crew");
    const common = {
      shopId: shop.id,
      tripId: reef.id,
      recordedByPersonId: staff.id,
      checkpoint: "after_dive_1" as const,
      meetingDay: 0,
    };
    const write = (
      input: typeof common & {
        status: "not_boarded" | "cleared";
        clientEventId: string;
        observedEvidenceIds: string[];
        retractsEventId?: string;
      },
    ) =>
      role === "diver"
        ? recordRollCall(db, { ...input, bookingId: booking.booking.id })
        : recordCrewRollCall(db, { ...input, personId: crewId });
    const m1 = crypto.randomUUID(),
      m2 = crypto.randomUUID();
    const first = await write({
      ...common,
      status: "not_boarded",
      clientEventId: m1,
      observedEvidenceIds: [],
    });
    const second = await write({
      ...common,
      status: "not_boarded",
      clientEventId: m2,
      observedEvidenceIds: [],
    });
    if (!first.ok || !second.ok) throw new Error("fixture mark refused");
    const captured = {
      ...common,
      status: "cleared" as const,
      clientEventId: crypto.randomUUID(),
      observedEvidenceIds: [clientRollCallEvidenceId(m1), clientRollCallEvidenceId(m2)],
      retractsEventId: first.eventId,
    };
    expect(await write(captured)).toMatchObject({ ok: true });
    expect(await write(captured)).toMatchObject({ ok: true, duplicate: true });
    expect(await write({ ...captured, retractsEventId: second.eventId })).toMatchObject({
      ok: false,
      reason: "client_event_conflict",
    });
  });
}
