import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { deleteExecutedDive, listExecutedDives, upsertExecutedDive } from "./executed-dives";
import { MARINE_LIFE_CATALOG } from "./marine-life-catalog";
import { diveSiteCreatures, diveSites, people, personRoles, trips } from "./schema";

async function logFixture() {
  const { db, shop } = await seededShopContext();
  const [owner] = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
    .limit(1);
  const [trip] = await db
    .select({ id: trips.id, plannedDives: trips.plannedDives })
    .from(trips)
    .where(eq(trips.shopId, shop.id))
    .limit(1);
  if (!owner || !trip) throw new Error("executed-dive fixture needs the seeded owner and a trip");
  return { db, shop, owner, trip };
}

describe("upsertExecutedDive", () => {
  it("records a dive and reads it back on the trip", async () => {
    const { db, shop, owner, trip } = await logFixture();

    const saved = await upsertExecutedDive(db, {
      shopId: shop.id,
      tripId: trip.id,
      diveNumber: 1,
      maxDepthMeters: 18,
      recordedByPersonId: owner.id,
    });
    expect(saved).toMatchObject({ ok: true, dive: { maxDepthMeters: 18 } });

    const listed = await listExecutedDives(db, shop.id, trip.id);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.executed.diveNumber).toBe(1);
  });

  /**
   * Two divemasters writing the same dive number at the rail is a real
   * sequence, and this used to be a select-then-insert: the loser hit
   * `executed_dives_trip_number_live_unique` and escaped as a 500.
   */
  it("lets a second write for the same dive number land on the first one's row", async () => {
    const { db, shop, owner, trip } = await logFixture();
    const write = (maxDepthMeters: number) =>
      upsertExecutedDive(db, {
        shopId: shop.id,
        tripId: trip.id,
        diveNumber: 1,
        maxDepthMeters,
        recordedByPersonId: owner.id,
      });

    const [first, second] = await Promise.all([write(18), write(21)]);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    const listed = await listExecutedDives(db, shop.id, trip.id);
    expect(listed).toHaveLength(1);
    expect([18, 21]).toContain(listed[0]?.executed.maxDepthMeters);
  });

  it("refuses a dive number the trip does not plan", async () => {
    const { db, shop, owner, trip } = await logFixture();

    expect(
      await upsertExecutedDive(db, {
        shopId: shop.id,
        tripId: trip.id,
        diveNumber: 0,
        recordedByPersonId: owner.id,
      }),
    ).toEqual({ ok: false, reason: "dive_number_out_of_range" });
    expect(
      await upsertExecutedDive(db, {
        shopId: shop.id,
        tripId: trip.id,
        diveNumber: trip.plannedDives + 1,
        recordedByPersonId: owner.id,
      }),
    ).toEqual({ ok: false, reason: "dive_number_out_of_range" });
  });

  it("refuses a transposed entry and exit time rather than storing it", async () => {
    const { db, shop, owner, trip } = await logFixture();

    expect(
      await upsertExecutedDive(db, {
        shopId: shop.id,
        tripId: trip.id,
        diveNumber: 1,
        enteredAt: new Date("2026-07-21T15:00:00.000Z"),
        exitedAt: new Date("2026-07-21T14:00:00.000Z"),
        recordedByPersonId: owner.id,
      }),
    ).toEqual({ ok: false, reason: "times_transposed" });
    expect(await listExecutedDives(db, shop.id, trip.id)).toHaveLength(0);
  });

  it("refuses a negative depth", async () => {
    const { db, shop, owner, trip } = await logFixture();

    expect(
      await upsertExecutedDive(db, {
        shopId: shop.id,
        tripId: trip.id,
        diveNumber: 1,
        maxDepthMeters: -5,
        recordedByPersonId: owner.id,
      }),
    ).toEqual({ ok: false, reason: "depth_out_of_range" });
  });

  /** A shop may only write the log of its own departure. */
  it("refuses another shop's trip", async () => {
    const { db, shop, owner, trip } = await logFixture();

    expect(
      await upsertExecutedDive(db, {
        shopId: crypto.randomUUID(),
        tripId: trip.id,
        diveNumber: 1,
        recordedByPersonId: owner.id,
      }),
    ).toEqual({ ok: false, reason: "unknown_trip" });
    expect(await listExecutedDives(db, shop.id, trip.id)).toHaveLength(0);
  });

  it("refuses a recorder who is not on this shop's roster", async () => {
    const { db, shop, trip } = await logFixture();

    expect(
      await upsertExecutedDive(db, {
        shopId: shop.id,
        tripId: trip.id,
        diveNumber: 1,
        recordedByPersonId: crypto.randomUUID(),
      }),
    ).toEqual({ ok: false, reason: "unknown_recorder" });
  });

  it("keeps only the two observed-condition fields it understands", async () => {
    const { db, shop, owner, trip } = await logFixture();

    const saved = await upsertExecutedDive(db, {
      shopId: shop.id,
      tripId: trip.id,
      diveNumber: 1,
      observedConditions: { visibility: "20m", current: "mild", surprise: "dropped" },
      recordedByPersonId: owner.id,
    });

    expect(saved).toMatchObject({
      ok: true,
      dive: { observedConditions: { visibility: "20m", current: "mild" } },
    });
  });
});

describe("deleteExecutedDive", () => {
  it("takes a dive off the log and frees its number for a fresh entry", async () => {
    const { db, shop, owner, trip } = await logFixture();
    const saved = await upsertExecutedDive(db, {
      shopId: shop.id,
      tripId: trip.id,
      diveNumber: 1,
      maxDepthMeters: 18,
      recordedByPersonId: owner.id,
    });
    if (!saved.ok) throw new Error("fixture write failed");

    expect(
      await deleteExecutedDive(db, {
        shopId: shop.id,
        tripId: trip.id,
        diveNumber: 1,
        deletedByPersonId: owner.id,
      }),
    ).toBe(true);
    expect(await listExecutedDives(db, shop.id, trip.id)).toHaveLength(0);

    // The unique index covers live rows only, so the number is available again.
    const again = await upsertExecutedDive(db, {
      shopId: shop.id,
      tripId: trip.id,
      diveNumber: 1,
      maxDepthMeters: 21,
      recordedByPersonId: owner.id,
    });
    expect(again).toMatchObject({ ok: true, dive: { maxDepthMeters: 21 } });
  });
});

/**
 * **One species the crew saw, from the site's own field guide** (issue #1190,
 * delight report D30).
 *
 * The boundary is the feature: `dive_site_creatures` is what a reef *may* show
 * you, a standing claim the shop makes about a place; this column is somebody
 * saying they saw it, once, on one dive. Drawing from the same catalog is what
 * makes the words arrive in the diver's own language; keeping them in different
 * columns is what stops the first ever rendering as the second.
 *
 * The site constraint is enforced here rather than only in the `<select>`,
 * because a constraint that lives in a form is a suggestion.
 */
describe("upsertExecutedDive — the observed species", () => {
  it("records any species DiveDay carries, not only the ones the site is known for", async () => {
    // The correction a dive-domain review made on 2026-09-04. Bounding this to
    // the site's field guide had it backwards: a guide is at most eight faces a
    // shop names because that reef shows them *reliably*, so it holds the blue
    // tang and not the eagle ray — and the eagle ray is the whole reason
    // anybody writes a sighting down.
    const { db, shop, owner, trip } = await logFixture();
    const [site] = await db
      .select({ id: diveSites.id })
      .from(diveSites)
      .where(eq(diveSites.shopId, shop.id))
      .limit(1);
    if (!site) throw new Error("seeded shop has no dive site");

    const listed = await db
      .select({ slug: diveSiteCreatures.catalogSlug })
      .from(diveSiteCreatures)
      .where(and(eq(diveSiteCreatures.shopId, shop.id), eq(diveSiteCreatures.diveSiteId, site.id)));
    const guide = new Set(listed.map((row) => row.slug));
    const offGuide = MARINE_LIFE_CATALOG.map((species) => species.slug).find(
      (slug) => !guide.has(slug),
    );
    if (!offGuide) throw new Error("this site's guide is the whole catalog");

    const saved = await upsertExecutedDive(db, {
      shopId: shop.id,
      tripId: trip.id,
      diveNumber: 1,
      actualSiteId: site.id,
      observedSpeciesSlug: offGuide,
      recordedByPersonId: owner.id,
    });
    expect(saved).toMatchObject({ ok: true, dive: { observedSpeciesSlug: offGuide } });
  });

  it("records a sighting on a dive that names no site", async () => {
    // Crews log dives with no site constantly — a shore checkout, a spot not in
    // the library yet, a drift that ended somewhere nobody named. Some of those
    // are the days with the manta in them, and a sighting is a fact about a
    // dive rather than about a row in the site library.
    const { db, shop, owner, trip } = await logFixture();
    const [species] = MARINE_LIFE_CATALOG;
    if (!species) throw new Error("the catalog is empty");
    const saved = await upsertExecutedDive(db, {
      shopId: shop.id,
      tripId: trip.id,
      diveNumber: 1,
      actualSiteId: null,
      observedSpeciesSlug: species.slug,
      recordedByPersonId: owner.id,
    });
    expect(saved).toMatchObject({ ok: true, dive: { observedSpeciesSlug: species.slug } });
  });

  it("drops a slug the catalog does not carry without losing the dive record", async () => {
    // **The ornament degrades; the safety record saves.** Entry, exit and depth
    // are what `buildIncidentExport` seals for an investigator or a treating
    // physician, and a decorative field must never be able to open a hole in
    // that document — which an early return did, on a form filled in at the
    // rail (dive-domain review, 2026-09-04).
    const { db, shop, owner, trip } = await logFixture();
    const saved = await upsertExecutedDive(db, {
      shopId: shop.id,
      tripId: trip.id,
      diveNumber: 1,
      maxDepthMeters: 18,
      observedSpeciesSlug: "mermaid",
      recordedByPersonId: owner.id,
    });
    expect(saved).toMatchObject({
      ok: true,
      dive: { maxDepthMeters: 18, observedSpeciesSlug: null },
    });
  });

  it("leaves the column null when nothing stood out", async () => {
    // The ordinary dive. Deliberately *not* an entry in `not_recorded`: a depth
    // nobody wrote down is a hole in a record that should have one, and a dive
    // where nothing stood out is just a dive. There is nothing to declare.
    const { db, shop, owner, trip } = await logFixture();
    const saved = await upsertExecutedDive(db, {
      shopId: shop.id,
      tripId: trip.id,
      diveNumber: 1,
      recordedByPersonId: owner.id,
    });
    expect(saved).toMatchObject({ ok: true, dive: { observedSpeciesSlug: null, notRecorded: [] } });
  });

  it("clears a recorded sighting when the crew takes it back", async () => {
    const { db, shop, owner, trip } = await logFixture();
    const [species] = MARINE_LIFE_CATALOG;
    if (!species) throw new Error("the catalog is empty");
    await upsertExecutedDive(db, {
      shopId: shop.id,
      tripId: trip.id,
      diveNumber: 1,
      observedSpeciesSlug: species.slug,
      recordedByPersonId: owner.id,
    });
    const cleared = await upsertExecutedDive(db, {
      shopId: shop.id,
      tripId: trip.id,
      diveNumber: 1,
      observedSpeciesSlug: null,
      recordedByPersonId: owner.id,
    });
    expect(cleared).toMatchObject({ ok: true, dive: { observedSpeciesSlug: null } });
  });
});
