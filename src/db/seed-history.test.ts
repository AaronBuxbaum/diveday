import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { DAY_MS, nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { getTripManifest } from "./manifests";
import { getMonthlyReport } from "./reporting";
import {
  bookings,
  certifications,
  diveSites,
  rollCallEvents,
  tripAssignments,
  tripDives,
  tripRequirements,
  trips as tripsTable,
} from "./schema";
import { resetDemoSchedule } from "./seed";
import { DEMO_COMPLETED_TRIP_TITLE } from "./seed-more-trips";
import { tripPrimarySiteId } from "./trip-primary-site";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`).
const ctx = fileScopedShopContext();

/**
 * The demo is a teaching surface: whatever it shows, a shop learns is normal.
 * These history trips used to be inserted with no `trip_requirements` row at
 * all, so every one of their bookings read `requirements_not_configured` —
 * blocked — while the seed wrote a `boarded` roll call for them by direct
 * insert. The result was a green "Boarded" pill beside a red "Requirements not
 * configured" on the same manifest line: a pairing `recordRollCall` refuses to
 * create, because readiness gates boarding at departure. The demo was teaching
 * exactly what the boarding gate exists to prevent.
 */
const HISTORY_DESCRIPTION = "Sailed. Kept in the log for the shop's monthly numbers.";

describe("seeded history manifests", () => {
  it("never shows a boarded diver beside a blocked readiness result", async () => {
    const { db, shop } = ctx;
    await resetDemoSchedule(db, shop.id, { history: true });

    const history = await db
      .select({ id: tripsTable.id, title: tripsTable.title })
      .from(tripsTable)
      .where(and(eq(tripsTable.shopId, shop.id), eq(tripsTable.description, HISTORY_DESCRIPTION)));
    expect(history.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const trip of history) {
      const [requirement] = await db
        .select({ tripId: tripRequirements.tripId })
        .from(tripRequirements)
        .where(eq(tripRequirements.tripId, trip.id));
      expect(requirement, `${trip.title} has no requirements row`).toBeDefined();

      const manifest = await getTripManifest(db, shop.id, trip.id);
      if (!manifest) throw new Error(`no manifest for ${trip.title}`);
      for (const diver of manifest.divers) {
        if (diver.rollCall?.state === "boarded" && diver.readiness.status !== "ready") {
          offenders.push(`${trip.title} · ${diver.fullName}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * **No Open Water diver logged on a deep wreck** (dive-domain review of the
   * demo reseed, item 1). The back-fill seats a mixed Open Water and Advanced
   * cohort with no Deep card, so it sails only sites an Open Water card
   * clears: the Duane, the Bibb and the Spiegel Grove (30 to 40 m, gated
   * Advanced Open Water and Deep) are named by no sailed day, and every sailed
   * day carries its site, so a deep wreck added to a title shows its refusal
   * beside "Boarded" in the test above instead of hiding behind a blank site.
   */
  it("seats no Open Water diver on a deep wreck, and blanks no site to hide one", async () => {
    const { db, shop } = ctx;
    await resetDemoSchedule(db, shop.id, { history: true });
    const history = await db
      .select({
        id: tripsTable.id,
        title: tripsTable.title,
        siteId: tripPrimarySiteId,
        siteMaxDepth: diveSites.maxDepthMeters,
        siteGate: diveSites.minimumCertificationLevel,
      })
      .from(tripsTable)
      .leftJoin(diveSites, eq(diveSites.id, tripPrimarySiteId))
      .where(and(eq(tripsTable.shopId, shop.id), eq(tripsTable.description, HISTORY_DESCRIPTION)));
    expect(history.length).toBeGreaterThan(0);
    expect(history.filter((trip) => /Duane|Bibb|Spiegel/.test(trip.title))).toEqual([]);
    expect(history.filter((trip) => trip.siteId === null).map((trip) => trip.title)).toEqual([]);

    const boardedOpenWater = await db
      .select({ title: tripsTable.title, maxDepth: diveSites.maxDepthMeters })
      .from(rollCallEvents)
      .innerJoin(bookings, eq(bookings.id, rollCallEvents.bookingId))
      .innerJoin(tripsTable, eq(tripsTable.id, rollCallEvents.tripId))
      // Every dive's site, not just the first: a deep second tank still refuses.
      .innerJoin(tripDives, eq(tripDives.tripId, tripsTable.id))
      .innerJoin(diveSites, eq(diveSites.id, tripDives.diveSiteId))
      .innerJoin(certifications, eq(certifications.personId, bookings.personId))
      .where(
        and(
          eq(tripsTable.shopId, shop.id),
          eq(tripsTable.description, HISTORY_DESCRIPTION),
          eq(rollCallEvents.status, "boarded"),
          eq(certifications.level, "open_water"),
        ),
      );
    expect(boardedOpenWater.length).toBeGreaterThan(0);
    // Open Water is trained to 18 m.
    expect(boardedOpenWater.filter((row) => (row.maxDepth ?? 0) > 18)).toEqual([]);
  });

  /**
   * **The completed dawn boat boards nobody the gate would refuse** (#2415).
   * Its roll call is written by direct insert, past `recordRollCall`, and it
   * used to board every seat, including divers with no card or a card nobody
   * verified: "boarded" in a state the product forbids, on the boat the demo
   * opens its record and its close-out on.
   */
  it("never boards a diver on the completed boat whom readiness would refuse", async () => {
    const { db, shop } = ctx;
    await resetDemoSchedule(db, shop.id);
    const [completed] = await db
      .select({ id: tripsTable.id })
      .from(tripsTable)
      .where(and(eq(tripsTable.shopId, shop.id), eq(tripsTable.title, DEMO_COMPLETED_TRIP_TITLE)));
    if (!completed) throw new Error("seeded completed trip missing");

    const manifest = await getTripManifest(db, shop.id, completed.id);
    if (!manifest) throw new Error("no manifest for the completed trip");
    const boarded = manifest.divers.filter((diver) => diver.rollCall?.state === "boarded");
    expect(boarded.length).toBeGreaterThan(0);
    expect(
      boarded
        .filter((diver) => diver.readiness.status !== "ready")
        .map((diver) => `${diver.fullName}: ${JSON.stringify(diver.readiness.blockers)}`),
    ).toEqual([]);
  });

  it("carries a no-show's absence forward through every after-dive checkpoint", async () => {
    // "Off the boat stays off the boat": the seed records one explicit
    // `not_boarded` at departure for a no-show and nothing after it, so the
    // carried-forward default is what every later checkpoint shows. It is the
    // only place in the demo (and therefore in the visual fleet) where that
    // state is exercised at all.
    const { db, shop } = ctx;
    await resetDemoSchedule(db, shop.id, { history: true });

    const history = await db
      .select({ id: tripsTable.id })
      .from(tripsTable)
      .where(and(eq(tripsTable.shopId, shop.id), eq(tripsTable.description, HISTORY_DESCRIPTION)));

    let carried = 0;
    for (const trip of history) {
      const afterDive = await getTripManifest(db, shop.id, trip.id, "after_dive_1");
      if (!afterDive) continue;
      carried += afterDive.divers.filter(
        (diver) => diver.rollCall?.state === "not_boarded" && diver.rollCall.implied === true,
      ).length;
    }
    expect(carried).toBeGreaterThan(0);
  });

  /**
   * The monthly report has carried a "Tax collected" tile since Stripe Tax
   * landed, and over the demo shop it read $0.00 in every month — three hundred
   * paid invoices and not a cent of tax on any of them, which from the buyer's
   * side of the screen is indistinguishable from a broken report.
   *
   * Two things had to be true and only one of them was obvious. The invoices
   * needed a `tax_cents`; they also needed their booking payments to name them
   * (`provider_ref`), because `getMonthlyReport` reads an invoice's tax through
   * the `provider_ref = orders.stripe_invoice_id` join and drops that invoice
   * from its other bucket the moment the booking has any payment row at all.
   * With a null ref the tax landed in neither, so seeding `tax_cents` alone
   * would have changed nothing on the page — which is why this asserts on the
   * report rather than on the column.
   */
  it("reports the tax it collected, without moving net revenue", async () => {
    const { db, shop } = ctx;
    await resetDemoSchedule(db, shop.id, { history: true });

    // A wide window over the whole back-fill, so this does not depend on which
    // day of the month the suite happens to run on.
    const report = await getMonthlyReport(
      db,
      shop.id,
      new Date(nowDate().getTime() - 200 * DAY_MS),
      new Date(nowDate().getTime() + DAY_MS),
      { currency: "usd", timeZone: shop.timezone ?? "UTC" },
    );

    expect(report.taxCents).toBeGreaterThan(0);
    // Tax rides on top of the listed price rather than being carved out of it,
    // so what the shop earns is untouched by collecting it. The seed puts the
    // same figure on the invoice total and on `tax_cents`, and the report
    // subtracts the latter from the former — so a tax seeded *inside* the price
    // would show up here as revenue that had quietly shrunk.
    expect(report.revenueCents).toBeGreaterThan(report.taxCents);
  });
});

/**
 * **Every boat in the back-fill had somebody driving it** (fourth review, item
 * 13): Reports listed this month's boats as "0 crew" while Safety judged "0 of
 * 0" crew sailings, the emptiest record reading cleanest.
 */
describe("seeded history crew", () => {
  it("puts a captain and a divemaster on every sailed history boat", async () => {
    const { db, shop } = ctx;
    await resetDemoSchedule(db, shop.id, { history: true });
    const history = await db
      .select({ id: tripsTable.id })
      .from(tripsTable)
      .where(
        and(
          eq(tripsTable.shopId, shop.id),
          eq(tripsTable.description, "Sailed. Kept in the log for the shop's monthly numbers."),
        ),
      );
    expect(history.length).toBeGreaterThan(0);
    const crew = await db.select().from(tripAssignments);
    for (const trip of history) {
      const roles = crew
        .filter((row) => row.tripId === trip.id)
        .map((row) => row.tripRole)
        .sort();
      expect(roles, trip.id).toEqual(["captain", "divemaster"]);
    }
  });
});
