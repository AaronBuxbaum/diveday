import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { DAY_MS, nowDate } from "@/lib/clock";
import { seededShopContext } from "@/test/db";
import { getTripManifest } from "./manifests";
import { getMonthlyReport } from "./reporting";
import { tripRequirements, trips as tripsTable } from "./schema";
import { resetDemoSchedule } from "./seed";

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
describe("seeded history manifests", () => {
  const HISTORY_DESCRIPTION = "Sailed. Kept in the log for the shop's monthly numbers.";

  it("never shows a boarded diver beside a blocked readiness result", async () => {
    const { db, shop } = await seededShopContext();
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

  it("carries a no-show's absence forward through every after-dive checkpoint", async () => {
    // "Off the boat stays off the boat": the seed records one explicit
    // `not_boarded` at departure for a no-show and nothing after it, so the
    // carried-forward default is what every later checkpoint shows. It is the
    // only place in the demo (and therefore in the visual fleet) where that
    // state is exercised at all.
    const { db, shop } = await seededShopContext();
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
    const { db, shop } = await seededShopContext();
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
