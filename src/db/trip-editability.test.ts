import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { getMovePreflight } from "../features/move-preflight/store";
import { cancelDeparture } from "./aboard-at-sea";
import { upsertTripRequirements } from "./readiness";
import { tripStageEvents, trips } from "./schema";
import { tripDetailsAreEditable } from "./trip-editability";
import { createTrip, deleteTrip, editTripSection, listStaff, moveTrip } from "./trips";
import { editTripConditions, setTripParticipantTerms } from "./trips-record";

const ctx = fileScopedShopContext();
const HOUR = 3_600_000;
async function departure({ days = 1, returned = false } = {}) {
  const { db, shop } = ctx;
  const now = nowDate();
  const startsAt = new Date(now.getTime() - (returned ? 8 : 2) * HOUR);
  const firstEnd = new Date(now.getTime() + (returned ? -4 : 2) * HOUR);
  const windows = Array.from({ length: days }, (_, i) => ({
    dayNumber: i + 1,
    startsAt: new Date(startsAt.getTime() + i * 24 * HOUR),
    endsAt: new Date(firstEnd.getTime() + i * 24 * HOUR),
  }));
  const trip = await createTrip(db, {
    shopId: shop.id,
    title: "Lifecycle departure",
    startsAt,
    endsAt: windows[days - 1].endsAt,
    capacity: 8,
    scheduleDays: windows,
  });
  if (!trip) throw new Error("trip missing");
  const [staff] = await listStaff(db, shop.id);
  if (!staff) throw new Error("staff missing");
  const say = (stage: "home" | "heading_in" | "boarding") =>
    db.insert(tripStageEvents).values({
      shopId: shop.id,
      tripId: trip.id,
      stage,
      recordedAt: now,
      recordedByPersonId: staff.person.id,
    });
  return { db, shop, trip, staff, now, say };
}

describe("departure definition closes at final return", () => {
  it("keeps the current day's details editable before Home", async () => {
    const { db, shop, trip } = await departure();
    expect(await tripDetailsAreEditable(db, shop.id, trip.id)).toBe(true);
    expect(await editTripSection(db, shop.id, trip.id, { title: "Revised plan" })).toMatchObject({
      ok: true,
    });
  });

  it("refuses stale detail, conditions, admission and participant writes after early Home", async () => {
    const { db, shop, trip, say } = await departure();
    await say("home");
    expect(await tripDetailsAreEditable(db, shop.id, trip.id)).toBe(false);
    expect(await editTripSection(db, shop.id, trip.id, { title: "Rewritten history" })).toEqual({
      ok: false,
      reason: "finished",
    });
    expect(
      await editTripConditions(db, shop.id, trip.id, { conditionsSummary: "New forecast" }),
    ).toMatchObject({ trip: null });
    expect(
      await setTripParticipantTerms(db, shop.id, trip.id, {
        snorkelerPriceCents: 1000,
        riderPriceCents: null,
        diverCapacity: null,
      }),
    ).toEqual({ ok: false, reason: "finished" });
    expect(
      await upsertTripRequirements(db, {
        shopId: shop.id,
        tripId: trip.id,
        requiresWaiver: false,
        minimumCertificationLevel: null,
        requiredSpecialties: [],
        requiresNitrox: false,
        requiresPayment: false,
      }),
    ).toBeNull();
    const [stored] = await db.select().from(trips).where(eq(trips.id, trip.id));
    expect(stored.title).toBe(trip.title);
    expect(stored.conditionsSummary).toBeNull();
    expect(stored.snorkelerPriceCents).toBeNull();
  });

  it("refuses moving a home-marked departure without roll-call history and matches its preview", async () => {
    const { db, shop, trip, say } = await departure();
    await say("home");
    expect(
      await moveTrip(db, shop.id, trip.id, new Date(trip.startsAt.getTime() + 24 * HOUR)),
    ).toMatchObject({ ok: false, reason: "already_sailed" });
    expect(await getMovePreflight(db, shop.id, trip.id)).toMatchObject({
      blocked: "already_sailed",
    });
    expect(await deleteTrip(db, shop.id, trip.id)).toMatchObject({
      ok: false,
      reason: "already_sailed",
    });
  });

  it("preserves any crew stage history when an otherwise empty departure is deleted", async () => {
    const { db, shop, trip, say } = await departure();
    await say("boarding");
    expect(await deleteTrip(db, shop.id, trip.id)).toMatchObject({
      ok: false,
      reason: "already_sailed",
    });
  });

  it("does not close a multi-day departure at its first overnight Home", async () => {
    const { db, shop, trip, say } = await departure({ days: 2 });
    await say("home");
    expect(await tripDetailsAreEditable(db, shop.id, trip.id)).toBe(true);
    expect(await editTripSection(db, shop.id, trip.id, { title: "Second-day plan" })).toMatchObject(
      { ok: true },
    );
  });

  it("keeps the shared return grace open until its exact boundary", async () => {
    const { db, shop, trip } = await departure();
    expect(
      await tripDetailsAreEditable(
        db,
        shop.id,
        trip.id,
        new Date(trip.endsAt.getTime() + HOUR - 1),
      ),
    ).toBe(true);
    expect(
      await tripDetailsAreEditable(db, shop.id, trip.id, new Date(trip.endsAt.getTime() + HOUR)),
    ).toBe(false);
    expect(await tripDetailsAreEditable(db, "00000000-0000-4000-8000-000000000001", trip.id)).toBe(
      false,
    );
  });

  it("closes silent past departures after the shared return buffer", async () => {
    const { db, shop, trip } = await departure({ returned: true });
    expect(await tripDetailsAreEditable(db, shop.id, trip.id)).toBe(false);
  });

  it("keeps a currently late crew's Heading in editable", async () => {
    const { db, shop, trip, say } = await departure({ returned: true });
    await say("heading_in");
    // Still speaks through the current shop day, as on the staff departure page.
    expect(await tripDetailsAreEditable(db, shop.id, trip.id)).toBe(true);
  });
});

it("allows a silent postponed departure with no sailing evidence to move after its scheduled return", async () => {
  const { db, shop, trip } = await departure({ returned: true });
  expect(
    await moveTrip(db, shop.id, trip.id, new Date(nowDate().getTime() + 24 * HOUR)),
  ).toMatchObject({ ok: true });
});
it("allows cancellation of a silent unsailed departure after its scheduled return", async () => {
  const { db, shop, trip } = await departure({ returned: true });
  expect(await cancelDeparture(db, shop.id, trip.id)).toEqual({ ok: true });
});

it("allows only a narrowly scoped decompression evidence correction after Home, with fly-safe follow-through", async () => {
  const { db, shop, trip, say } = await departure();
  await say("home");
  expect(
    await editTripSection(db, shop.id, trip.id, {
      exceedsNoDecoLimits: true,
      title: "Smuggled plan edit",
    }),
  ).toMatchObject({ ok: false, reason: "finished" });
  const corrected = await editTripSection(
    db,
    shop.id,
    trip.id,
    { exceedsNoDecoLimits: true },
    { expectedExceedsNoDecoLimits: false },
  );
  expect(corrected).toMatchObject({ ok: true, trip: { exceedsNoDecoLimits: true } });
  if (!corrected.ok) throw new Error("safety correction refused");
  expect(corrected.flySafe).toBeDefined();
  const [stored] = await db.select().from(trips).where(eq(trips.id, trip.id));
  expect(stored.title).toBe(trip.title);
});

it("refuses stale unchecked safety evidence after a newer decompression record but accepts a fresh correction", async () => {
  const { db, shop, trip, say } = await departure();
  await say("home");
  expect(
    await editTripSection(
      db,
      shop.id,
      trip.id,
      { exceedsNoDecoLimits: true },
      { expectedExceedsNoDecoLimits: false },
    ),
  ).toMatchObject({ ok: true });
  expect(
    await editTripSection(
      db,
      shop.id,
      trip.id,
      { exceedsNoDecoLimits: false },
      { expectedExceedsNoDecoLimits: false },
    ),
  ).toMatchObject({ ok: false, reason: "stale_safety_record" });
  const [protectedRecord] = await db.select().from(trips).where(eq(trips.id, trip.id));
  expect(protectedRecord.exceedsNoDecoLimits).toBe(true);
  expect(
    await editTripSection(
      db,
      shop.id,
      trip.id,
      { exceedsNoDecoLimits: false },
      { expectedExceedsNoDecoLimits: true },
    ),
  ).toMatchObject({ ok: true, trip: { exceedsNoDecoLimits: false } });
});
