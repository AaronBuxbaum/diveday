// @vitest-environment node
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { assignGear, listAvailableGear } from "./gear";
import { saveRentalGearRequest } from "./gear-requests";
import { recordRollCall } from "./manifests";
import { getTodayWork } from "./today";
import { getTripRoster, listStaff, upcomingTripsWithCounts } from "./trips";
import { completeWaiver, issueWaiverRequest } from "./waivers";

const clearAnswers = { questionnaireId: "rstc", questionnaireVersion: 1, responses: {} };

describe("today's work queue (in-memory PGlite)", () => {
  it("puts the seeded departure that sails today on the board with live readiness counts", async () => {
    const { db, shop } = await seededShopContext();

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);

    expect(work.departures).toHaveLength(1);
    const [departure] = work.departures;
    expect(departure?.title).toBe("Two-Tank Reef — Molasses & French");
    expect(departure?.booked).toBe(9);
    expect(departure?.capacity).toBe(12);
    // Nobody has signed a waiver in the fresh seed, so nobody is clear yet.
    expect(departure?.ready).toBe(0);
    expect(departure?.blocked).toBe(9);
    expect(departure?.boarded).toBe(0);
    expect(work.nextDeparture).toBeNull();
  });

  it("collapses a boat's identical blockers so one busy trip cannot bury the rest", async () => {
    const { db, shop } = await seededShopContext();

    const trips = await upcomingTripsWithCounts(db, shop.id);
    const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
    if (!reef) throw new Error("demo reef trip missing");
    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    const [departure] = work.departures;
    if (!departure) throw new Error("expected today's departure");
    // Scoped to today's boat: the shop has other trips on the books, and their
    // blockers are their own rows. What must not happen is this boat's nine
    // blocked divers each claiming a line of the queue.
    const blockerRows = work.actions.filter((action) =>
      action.id.startsWith(`blockers:${reef.id}:`),
    );

    expect(departure.blocked).toBe(9);
    expect(blockerRows.length).toBeGreaterThan(0);
    expect(blockerRows.length).toBeLessThan(departure.blocked);
    expect(new Set(blockerRows.map((action) => action.id)).size).toBe(blockerRows.length);
  });

  it("drops a diver out of the queue once their evidence clears", async () => {
    const { db, shop } = await seededShopContext();
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
    if (!reef) throw new Error("demo reef trip missing");
    const [entry] = await getTripRoster(db, reef.id);
    if (!entry) throw new Error("demo booking missing");

    const before = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    const waiverRow = (work: Awaited<ReturnType<typeof getTodayWork>>) =>
      work.actions.find((action) => action.id === `blockers:${reef.id}:waiver_not_sent`);
    expect(waiverRow(before)?.subject).toBe("9 divers");
    expect(waiverRow(before)?.detail).toBe(
      "Waiver has not been sent. Diego Alvarez, Ines Costa and 7 others.",
    );

    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: entry.booking.id });
    if (!issued.ok) throw new Error("expected a waiver link");
    await completeWaiver(db, issued.token, {
      signerName: entry.person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
    });

    const after = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    expect(waiverRow(after)?.subject).toBe("8 divers");
    expect(after.departures[0]?.ready).toBe(1);
    expect(after.departures[0]?.blocked).toBe(8);
  });

  it("counts a boarded diver on today's board", async () => {
    const { db, shop } = await seededShopContext();
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
    if (!reef) throw new Error("demo reef trip missing");
    const [entry] = await getTripRoster(db, reef.id);
    const [staff] = await listStaff(db, shop.id);
    if (!entry || !staff) throw new Error("demo fixture missing");

    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: entry.booking.id });
    if (!issued.ok) throw new Error("expected a waiver link");
    await completeWaiver(db, issued.token, {
      signerName: entry.person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
    });
    await recordRollCall(db, {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: entry.booking.id,
      recordedByPersonId: staff.person.id,
      status: "boarded",
    });

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    expect(work.departures[0]?.boarded).toBe(1);
  });

  it("flags a rental request with nothing packed, and clears it once gear is assigned", async () => {
    const { db, shop } = await seededShopContext();
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
    if (!reef) throw new Error("demo reef trip missing");
    const [entry] = await getTripRoster(db, reef.id);
    if (!entry) throw new Error("demo booking missing");

    await saveRentalGearRequest(db, {
      shopId: shop.id,
      bookingId: entry.booking.id,
      bcd: true,
      regulator: true,
      wetsuit: true,
      maskFins: true,
      weights: true,
      tank: true,
      diveComputer: false,
    });

    const flagged = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    const gearAction = flagged.actions.find((action) => action.id === `gear:${reef.id}`);
    expect(gearAction?.actionLabel).toBe("Pack gear");
    expect(gearAction?.detail).toContain("1 diver has");

    const [item] = await listAvailableGear(db, shop.id);
    if (!item) throw new Error("expected available gear in the seed");
    await assignGear(db, {
      shopId: shop.id,
      bookingId: entry.booking.id,
      gearItemId: item.id,
    });

    const cleared = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    expect(cleared.actions.some((action) => action.id === `gear:${reef.id}`)).toBe(false);
  });

  it("never looks past its one-week horizon", async () => {
    const { db, shop } = await seededShopContext();

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    const horizon = Date.now() + 7 * 24 * 60 * 60 * 1000;

    for (const action of work.actions) {
      expect(action.dueAt?.getTime() ?? 0).toBeLessThanOrEqual(horizon);
    }
  });

  it("points every action at a route inside this shop", async () => {
    const { db, shop } = await seededShopContext();

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);

    expect(work.actions.length).toBeGreaterThan(0);
    for (const action of work.actions) {
      expect(action.href.startsWith(`/shop/${shop.slug}/`)).toBe(true);
      expect(action.actionLabel).toBeTruthy();
      expect(action.detail).toBeTruthy();
    }
  });
});
