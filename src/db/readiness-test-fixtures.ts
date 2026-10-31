import { and, eq } from "drizzle-orm";
import type { fileScopedShopContext } from "@/test/db";
import { createCertification, reviewCertification, upsertTripRequirements } from "./readiness";
import { type DiveSpecialty, diveSites } from "./schema";
import { getTripRoster, listTripDives, upcomingTripsWithCounts } from "./trips";

/**
 * **What the readiness tests share**: the seeded two-tank reef trip with its
 * first seat, the site-gate setup that isolates one dive's site, and a verified
 * Open Water card. Each `readiness*.test.ts` file runs against its own database
 * (`fileScopedShopContext`) and binds these to it with `readinessFixturesFor`.
 */
export function readinessFixturesFor(ctx: ReturnType<typeof fileScopedShopContext>) {
  async function readinessContext() {
    const { db, shop } = ctx;
    const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
    const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
    if (!reef) throw new Error("demo reef trip missing");
    const [rosterEntry] = await getTripRoster(db, shop.id, reef.id);
    if (!rosterEntry) throw new Error("demo booking missing");
    return { db, shop, reef, rosterEntry };
  }

  /**
   * Isolates the site gate on the seeded two-tank trip: the trip's own
   * requirement demands nothing, every site the shop owns demands nothing, and
   * then only the site of *dive two* is given a requirement. Anything the
   * readiness engine then reports came from a site that is not the trip's
   * primary one — which is exactly the site the gate used to never read.
   */
  async function withSecondSiteRequirement(requirement: {
    minimumCertificationLevel?: "advanced_open_water" | "rescue";
    requiredSpecialties?: DiveSpecialty[];
    requiresNitrox?: boolean;
  }) {
    const { db, shop, reef, rosterEntry } = await readinessContext();
    await upsertTripRequirements(db, {
      shopId: shop.id,
      tripId: reef.id,
      requiresWaiver: false,
      minimumCertificationLevel: null,
      requiredSpecialties: [],
      requiresNitrox: false,
      requiresPayment: false,
    });
    await db
      .update(diveSites)
      .set({ minimumCertificationLevel: null, requiredSpecialties: [], requiresNitrox: false })
      .where(eq(diveSites.shopId, shop.id));

    const dives = await listTripDives(db, shop.id, reef.id);
    const secondSiteId = dives
      .map(({ dive }) => dive.diveSiteId)
      .find((id) => id && id !== reef.diveSite?.id);
    if (!secondSiteId) throw new Error("seeded two-tank trip should visit a second site");
    if (Object.keys(requirement).length > 0) {
      await db
        .update(diveSites)
        .set(requirement)
        .where(and(eq(diveSites.shopId, shop.id), eq(diveSites.id, secondSiteId)));
    }
    return { db, shop, reef, rosterEntry, secondSiteId };
  }

  /** A verified Open Water card, so a raised level reads "insufficient", not "missing". */
  async function verifiedOpenWaterCard(
    db: Awaited<ReturnType<typeof readinessContext>>["db"],
    shopId: string,
    personId: string,
  ) {
    const card = await createCertification(db, {
      shopId,
      personId,
      agency: "padi",
      level: "open_water",
      identifier: `PADI-SITE-GATE-${personId.slice(0, 8)}`,
    });
    if (!card) throw new Error("expected certification to insert");
    await reviewCertification(db, { shopId, certificationId: card.id, status: "verified" });
  }

  return { readinessContext, withSecondSiteRequirement, verifiedOpenWaterCard };
}
