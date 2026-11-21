import { afterAll, beforeAll, expect, it, vi } from "vitest";
import {
  buildOfflineManifestCopies,
  readOfflineManifestRosterWithWindows,
} from "@/features/boarding/offline-manifest-snapshots";
import { listRollCallGaps } from "@/features/boarding/roll-call-gaps";
import { getDayCloseout } from "@/features/day/today/closeout-reader";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { getTripManifest, recordCrewRollCall, recordRollCall } from "./manifests";
import { crewSubject } from "./roll-call-subject";
import { boats } from "./schema";
import { seedRollCallEvidence } from "./seed-roll-call-evidence";
import { editTripSection, getTripRoster, listStaff } from "./trips";
import { upcomingTripsWithCounts } from "./trips-queries.test-support";

vi.mock("next/headers", async () => (await import("@/test/next-headers")).nextHeadersStub());
const ctx = fileScopedShopContext();
beforeAll(() => vi.stubEnv("DIVEDAY_OFFLINE_ROLL_CALL_WITNESS", "1"));
afterAll(() => vi.unstubAllEnvs());

it("reconciles a current crew witness, then requires a fresh online recount after a boat change", async () => {
  const { db, shop } = ctx;
  const trip = (await upcomingTripsWithCounts(db, shop.id, new Date(0))).find((row) =>
    row.title.startsWith("Two-Tank Reef — Molasses"),
  );
  const owner = (await listStaff(db, shop.id)).find((member) => member.roles.includes("owner"));
  if (!trip || !owner) throw new Error("fixture missing");
  const saved = (await buildOfflineManifestCopies(db, shop, owner.person.id, [trip.id]))
    .payloads[0];
  const crew = (await getTripManifest(db, shop.id, trip.id, "departure"))?.crew[0];
  if (!saved?.snapshotId || !crew) throw new Error("snapshot missing");
  const witness = saved.rollCallWitnesses?.[`crew:${crew.id}:departure`];
  if (!witness) throw new Error("witness missing");
  const input = {
    shopId: shop.id,
    tripId: trip.id,
    personId: crew.id,
    recordedByPersonId: owner.person.id,
    checkpoint: "departure" as const,
    status: "boarded" as const,
    source: "offline" as const,
    clientEventId: crypto.randomUUID(),
    meetingDay: saved.rollCallMeetingDay ?? 0,
    offlineSnapshotId: saved.snapshotId,
    offlineErasureEpochToken: saved.erasureEpochToken,
    offlineSnapshotSavedAt: nowDate(),
    observedEvidenceIds: [],
    rollCallWitness: witness,
  };
  expect(await recordCrewRollCall(db, input)).toMatchObject({ ok: true });
  expect(await recordCrewRollCall(db, input)).toMatchObject({ ok: true, duplicate: true });
  const [boat] = await db
    .insert(boats)
    .values({ shopId: shop.id, name: "Replacement", capacity: 200 })
    .returning();
  if (!boat) throw new Error("boat missing");
  expect(await editTripSection(db, shop.id, trip.id, { boatId: boat.id })).toMatchObject({
    ok: true,
  });
  expect(await recordCrewRollCall(db, input)).toMatchObject({
    ok: false,
    reason: "review_required",
  });
  const crewGaps = await listRollCallGaps(
    db,
    shop.id,
    new Date(trip.endsAt.getTime() + 60_000),
    [trip.id],
    { historical: true },
  );
  expect(crewGaps.some((gap) => gap.awaiting > 0)).toBe(true);
  const current = await readOfflineManifestRosterWithWindows(db, shop.id, trip.id);
  const proof = current?.manifests
    .find((manifest) => manifest.checkpoint === "departure")
    ?.crew.find((member) => member.id === crew.id)?.rollCallContext?.liveRecountProof;
  if (!proof) throw new Error("recount proof missing");
  const live = {
    shopId: shop.id,
    tripId: trip.id,
    personId: crew.id,
    recordedByPersonId: owner.person.id,
    checkpoint: "departure" as const,
    status: "boarded" as const,
    source: "live" as const,
  };
  expect(await recordCrewRollCall(db, live)).toMatchObject({
    ok: false,
    reason: "review_required",
  });
  expect(await recordCrewRollCall(db, { ...live, liveRecountProof: proof })).toMatchObject({
    ok: true,
  });
  expect(
    await recordCrewRollCall(db, { ...live, status: "not_boarded", liveRecountProof: proof }),
  ).toMatchObject({ ok: false, reason: "review_required" });
  expect(
    (await getTripManifest(db, shop.id, trip.id, "departure"))?.crew.find(
      (member) => member.id === crew.id,
    ),
  ).toMatchObject({ recountRequired: false, rollCall: { state: "boarded" } });
});

it("holds an invalidated passenger mark until a current witnessed recount", async () => {
  const { db, shop } = ctx;
  const trip = (await upcomingTripsWithCounts(db, shop.id, new Date(0))).find((row) =>
    row.title.startsWith("Two-Tank Reef — Molasses"),
  );
  const owner = (await listStaff(db, shop.id)).find((member) => member.roles.includes("owner"));
  if (!trip || !owner) throw new Error("fixture missing");
  const [seat] = await getTripRoster(db, shop.id, trip.id);
  if (!seat) throw new Error("seat missing");
  const live = {
    shopId: shop.id,
    tripId: trip.id,
    bookingId: seat.booking.id,
    recordedByPersonId: owner.person.id,
    checkpoint: "departure" as const,
    status: "not_boarded" as const,
    source: "live" as const,
  };
  expect(await recordRollCall(db, live)).toMatchObject({ ok: true });
  const saved = (await buildOfflineManifestCopies(db, shop, owner.person.id, [trip.id]))
    .payloads[0];
  if (!saved?.snapshotId) throw new Error("snapshot missing");
  const witness = saved.rollCallWitnesses?.[`seat:${seat.booking.id}:departure`];
  const context = saved.manifests
    .find((manifest) => manifest.checkpoint === "departure")
    ?.divers.find((diver) => diver.bookingId === seat.booking.id)?.rollCallContext;
  if (!witness || !context) throw new Error("witness missing");
  const input = {
    ...live,
    status: "boarded" as const,
    source: "offline" as const,
    physicalPresenceOnly: true,
    clientEventId: crypto.randomUUID(),
    meetingDay: saved.rollCallMeetingDay ?? 0,
    offlineSnapshotId: saved.snapshotId,
    offlineErasureEpochToken: saved.erasureEpochToken,
    offlineSnapshotSavedAt: nowDate(),
    observedEvidenceIds: context.observedEvidenceIds,
    rollCallWitness: witness,
  };
  expect(await recordRollCall(db, { ...input, rollCallWitness: "invalid" })).toMatchObject({
    ok: false,
    reason: "review_required",
  });
  expect(await recordRollCall(db, { ...input, rollCallWitness: undefined })).toMatchObject({
    ok: false,
    reason: "review_required",
  });
  expect(await recordRollCall(db, { ...input, meetingDay: input.meetingDay + 1 })).toMatchObject({
    ok: false,
    reason: "review_required",
  });
  expect(await recordRollCall(db, { ...input, observedEvidenceIds: [] })).toMatchObject({
    ok: false,
    reason: "review_required",
  });
  expect(await recordRollCall(db, input)).toMatchObject({ ok: true });
  const [boat] = await db
    .insert(boats)
    .values({ shopId: shop.id, name: "Replacement", capacity: 200 })
    .returning();
  if (!boat) throw new Error("boat missing");
  expect(await editTripSection(db, shop.id, trip.id, { boatId: boat.id })).toMatchObject({
    ok: true,
  });
  expect(await recordRollCall(db, input)).toMatchObject({ ok: false, reason: "review_required" });
  expect(
    (await getTripManifest(db, shop.id, trip.id, "departure"))?.divers.find(
      (diver) => diver.bookingId === seat.booking.id,
    ),
  ).toMatchObject({ recountRequired: true, rollCall: undefined });
  const gaps = await listRollCallGaps(
    db,
    shop.id,
    new Date(trip.endsAt.getTime() + 60_000),
    [trip.id],
    { historical: true },
  );
  expect(gaps.some((gap) => gap.awaiting > 0)).toBe(true);
  expect(await listRollCallGaps(db, shop.id, nowDate(), undefined, { historical: true })).toEqual(
    [],
  );
  const closeout = await getDayCloseout(
    db,
    shop.id,
    shop.timezone,
    new Date(trip.endsAt.getTime() + 60_000),
  );
  expect(
    closeout.departures.find((departure) => departure.tripId === trip.id)?.uncounted,
  ).toBeGreaterThan(0);
  expect(await recordRollCall(db, live)).toMatchObject({ ok: false, reason: "review_required" });
  const current = await readOfflineManifestRosterWithWindows(db, shop.id, trip.id);
  const proof = current?.manifests
    .find((manifest) => manifest.checkpoint === "departure")
    ?.divers.find((diver) => diver.bookingId === seat.booking.id)
    ?.rollCallContext?.liveRecountProof;
  if (!proof) throw new Error("recount proof missing");
  expect(
    await recordRollCall(db, { ...live, liveRecountProof: { ...proof, witness: "invalid" } }),
  ).toMatchObject({ ok: false, reason: "review_required" });
  expect(
    await recordRollCall(db, {
      ...live,
      liveRecountProof: { ...proof, meetingDay: proof.meetingDay + 1 },
    }),
  ).toMatchObject({ ok: false, reason: "review_required" });
  expect(await recordRollCall(db, { ...live, liveRecountProof: proof })).toMatchObject({
    ok: true,
  });
  expect(await recordRollCall(db, { ...live, liveRecountProof: proof })).toMatchObject({
    ok: false,
    reason: "review_required",
  });
});

it("carries an earlier-day missing observation until the passenger and crew are seen again", async () => {
  const { db, shop } = ctx;
  const trip = (await upcomingTripsWithCounts(db, shop.id, new Date(0))).find((row) =>
    row.title.startsWith("Two-Tank Reef — Molasses"),
  );
  const owner = (await listStaff(db, shop.id)).find((member) => member.roles.includes("owner"));
  if (!trip || !owner) throw new Error("fixture missing");
  const now = nowDate().getTime();
  expect(
    await editTripSection(db, shop.id, trip.id, {
      scheduleDays: [
        {
          dayNumber: 1,
          startsAt: new Date(now - 172_800_000),
          endsAt: new Date(now - 169_200_000),
        },
        { dayNumber: 2, startsAt: new Date(now - 3_600_000), endsAt: new Date(now + 3_600_000) },
      ],
    }),
  ).toMatchObject({ ok: true });
  const [seat] = await getTripRoster(db, shop.id, trip.id);
  const crew = (await getTripManifest(db, shop.id, trip.id, "after_dive_1"))?.crew[0];
  if (!seat || !crew) throw new Error("subjects missing");
  const base = {
    shopId: shop.id,
    tripId: trip.id,
    recordedByPersonId: owner.person.id,
    checkpoint: "after_dive_1" as const,
    status: "not_boarded" as const,
    source: "offline" as const,
    meetingDay: 0,
    occurredAt: new Date(now - 170_000_000),
  };
  await seedRollCallEvidence(db, [
    { ...base, bookingId: seat.booking.id },
    { ...base, ...crewSubject(crew.id) },
  ]);
  const pending = await getTripManifest(db, shop.id, trip.id, "after_dive_1");
  expect(pending?.divers.find((diver) => diver.bookingId === seat.booking.id)).toMatchObject({
    recountRequired: true,
    rollCall: undefined,
  });
  expect(pending?.crew.find((member) => member.id === crew.id)).toMatchObject({
    recountRequired: true,
    rollCall: undefined,
  });
  const current = await readOfflineManifestRosterWithWindows(db, shop.id, trip.id);
  const page = current?.manifests.find((manifest) => manifest.checkpoint === "after_dive_1");
  const seatProof = page?.divers.find((diver) => diver.bookingId === seat.booking.id)
    ?.rollCallContext?.liveRecountProof;
  const crewProof = page?.crew.find((member) => member.id === crew.id)?.rollCallContext
    ?.liveRecountProof;
  if (!seatProof || !crewProof) throw new Error("current proofs missing");
  expect(
    await recordRollCall(db, {
      shopId: shop.id,
      tripId: trip.id,
      bookingId: seat.booking.id,
      recordedByPersonId: owner.person.id,
      checkpoint: "after_dive_1",
      status: "boarded",
      source: "live",
      liveRecountProof: seatProof,
    }),
  ).toMatchObject({ ok: true });
  expect(
    await recordCrewRollCall(db, {
      shopId: shop.id,
      tripId: trip.id,
      personId: crew.id,
      recordedByPersonId: owner.person.id,
      checkpoint: "after_dive_1",
      status: "boarded",
      source: "live",
      liveRecountProof: crewProof,
    }),
  ).toMatchObject({ ok: true });
  const resolved = await getTripManifest(db, shop.id, trip.id, "after_dive_1");
  expect(resolved?.divers.find((diver) => diver.bookingId === seat.booking.id)).toMatchObject({
    recountRequired: false,
    rollCall: { state: "boarded" },
  });
  expect(resolved?.crew.find((member) => member.id === crew.id)).toMatchObject({
    recountRequired: false,
    rollCall: { state: "boarded" },
  });
});
