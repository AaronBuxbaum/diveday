import { and, desc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { weekdaySetFrom } from "@/lib/recurrence";
import { fileScopedShopContext } from "@/test/db";
import {
  type CharterContext,
  charterContext as charterContextFor,
  markSeat,
  seatBlockerCodes,
} from "@/test/training-mark-context";
import { getTripRequirements, upsertTripRequirements } from "./readiness";
import {
  cards,
  courses,
  diveSites,
  tripAssignments,
  tripDives,
  tripRequirements,
  trips,
} from "./schema";
import { markableTrainingDives, trainingDiveReachOn } from "./training-mark-resolve";
import { createTrip } from "./trips-create";
import { duplicateTrip } from "./trips-schedule";
import { createTripSeries, rollSeriesForward } from "./trips-series";

/**
 * **A default level nobody chose** (issue #3872, Aaron on #3839 2026-11-04).
 * `insertTripInstance` writes Open Water on every non-course departure. Flagged
 * as the default, the gates read it as the site's level, so a training mark
 * lowers it for an Open Water student on a one-dive charter. A level a person
 * saved keeps standing, and an unmarked seat is still held to the default.
 */
const fileCtx = fileScopedShopContext();

/**
 * A one-dive charter at one Open Water site, its level the default; the
 * student holds no card and is enrolled on an Open Water course (no minimum,
 * certifies Open Water) whose instructor teaches the session and is aboard.
 */
async function defaultLevelCharter(
  isDefault = true,
  siteLevel: "open_water" | null = "open_water",
): Promise<CharterContext> {
  const ctx = await charterContextFor(fileCtx);
  await ctx.db
    .update(tripRequirements)
    .set({ minimumCertificationLevel: "open_water", minimumCertificationIsDefault: isDefault })
    .where(eq(tripRequirements.tripId, ctx.charter.id));
  await ctx.db
    .update(courses)
    .set({
      minimumCertificationLevel: null,
      certifiesLevel: "open_water",
      isIntroCourse: false,
      agency: "padi",
      sourceTemplateSlug: null,
    })
    .where(eq(courses.id, ctx.course.courseId));
  await ctx.db
    .delete(cards)
    .where(and(eq(cards.kind, "level"), eq(cards.personId, ctx.course.personId)));
  const [site] = await ctx.db
    .insert(diveSites)
    .values({
      shopId: ctx.shop.id,
      name: "Default level reef",
      slug: `default-level-reef-${ctx.charter.id.slice(0, 8)}`,
      minimumCertificationLevel: siteLevel,
    })
    .returning({ id: diveSites.id });
  if (!site) throw new Error("site insert failed");
  await ctx.db
    .insert(tripDives)
    .values({ tripId: ctx.charter.id, diveNumber: 1, diveSiteId: site.id });
  await ctx.db.update(trips).set({ plannedDives: 1 }).where(eq(trips.id, ctx.charter.id));
  for (const tripId of [ctx.course.tripId, ctx.charter.id]) {
    await ctx.db
      .delete(tripAssignments)
      .where(and(eq(tripAssignments.tripId, tripId), eq(tripAssignments.personId, ctx.instructor)));
    await ctx.db.insert(tripAssignments).values({
      tripId,
      personId: ctx.instructor,
      tripRole: "instructor",
      assignedByPersonId: ctx.owner,
    });
  }
  return ctx;
}

const levelCodes = async (ctx: CharterContext) =>
  (await seatBlockerCodes(ctx)).filter((code) => code.startsWith("certification_"));

const markable = (ctx: CharterContext) =>
  markableTrainingDives(ctx.db, ctx.shop.id, ctx.course.personId, {
    id: ctx.charter.id,
    startsAt: ctx.charter.startsAt,
  });

describe("a default trip level a training mark may lower (issue #3872, in-memory PGlite)", () => {
  it("boards a marked Open Water student whose charter's only level is the default, and offers the sale the mark", async () => {
    const ctx = await defaultLevelCharter();
    expect(await markable(ctx)).toHaveLength(1);
    expect(await markSeat(ctx)).toMatchObject({ ok: true });
    expect(await levelCodes(ctx)).toEqual([]);
  });

  it("still holds an unmarked uncertified diver to the default", async () => {
    const ctx = await defaultLevelCharter();
    expect(await levelCodes(ctx)).toEqual(["certification_missing"]);
  });

  const saveForm = async (
    ctx: CharterContext,
    change: {
      minimumCertificationLevel?: "open_water" | "advanced_open_water" | null;
      requiresPayment?: boolean;
    },
  ) => {
    const current = await getTripRequirements(ctx.db, ctx.shop.id, ctx.charter.id);
    if (!current) throw new Error("requirement missing");
    return upsertTripRequirements(ctx.db, {
      shopId: ctx.shop.id,
      tripId: ctx.charter.id,
      requiresWaiver: current.requiresWaiver,
      minimumCertificationLevel:
        change.minimumCertificationLevel === undefined
          ? current.minimumCertificationLevel
          : change.minimumCertificationLevel,
      requiredSpecialties: current.requiredSpecialties,
      requiresNitrox: current.requiresNitrox,
      requiresPayment: change.requiresPayment ?? current.requiresPayment,
    });
  };

  // Dock review of #3909: ticking payment at 07:10 must not re-raise Open
  // Water on four marked students nobody chose it for.
  it("keeps the default when the form is saved with the level unchanged", async () => {
    const ctx = await defaultLevelCharter();
    const saved = await saveForm(ctx, { requiresPayment: false });
    expect(saved?.minimumCertificationIsDefault).toBe(true);
    expect(await markSeat(ctx)).toMatchObject({ ok: true });
    expect(await levelCodes(ctx)).toEqual([]);
  });

  it("makes the level chosen once a person changes it, even back to Open Water", async () => {
    const ctx = await defaultLevelCharter();
    expect(
      (await saveForm(ctx, { minimumCertificationLevel: "advanced_open_water" }))
        ?.minimumCertificationIsDefault,
    ).toBe(false);
    expect(
      (await saveForm(ctx, { minimumCertificationLevel: "open_water" }))
        ?.minimumCertificationIsDefault,
    ).toBe(false);
    expect(await markSeat(ctx)).toMatchObject({ ok: true });
    expect(await levelCodes(ctx)).toEqual(["certification_missing"]);
  });

  // Attacker review of #3909: at a site with no recorded level the default is
  // the only level anyone stated, so it stays the trip's.
  it("keeps the default where the site states no level", async () => {
    const ctx = await defaultLevelCharter(true, null);
    expect(await markSeat(ctx)).toMatchObject({ ok: true });
    expect(await levelCodes(ctx)).toEqual(["certification_missing"]);
  });

  it("keeps a chosen level on a charter built that way", async () => {
    const ctx = await defaultLevelCharter(false);
    expect(await markSeat(ctx)).toMatchObject({ ok: true });
    expect(await levelCodes(ctx)).toEqual(["certification_missing"]);
  });

  it("lowers nothing on one dive with no site: the mark has no reach", async () => {
    const ctx = await defaultLevelCharter();
    await ctx.db.delete(tripDives).where(eq(tripDives.tripId, ctx.charter.id));
    expect(await trainingDiveReachOn(ctx.db, ctx.shop.id, ctx.charter.id)).toBeNull();
    expect(await markable(ctx)).toEqual([]);
    expect(await markSeat(ctx)).toMatchObject({ ok: true });
    expect(await levelCodes(ctx)).toEqual(["certification_missing"]);
  });
});

/**
 * **A two-tank charter** (issue #3910, Aaron 2026-11-05, option B). The mark
 * cannot name the training dive, so it lowers only the trip-wide default; each
 * site keeps its own stated level, unlowered. Readiness at the rail and the
 * sale read the same reach.
 */
describe("a training mark on a two-tank charter (issue #3910, in-memory PGlite)", () => {
  async function twoTank(siteLevel: "open_water" | null, isDefault = true) {
    const ctx = await defaultLevelCharter(isDefault, siteLevel);
    const [second] = await ctx.db
      .insert(diveSites)
      .values({
        shopId: ctx.shop.id,
        name: "Second tank reef",
        slug: `second-tank-reef-${ctx.charter.id.slice(0, 8)}`,
        minimumCertificationLevel: null,
      })
      .returning({ id: diveSites.id });
    if (!second) throw new Error("site insert failed");
    await ctx.db
      .insert(tripDives)
      .values({ tripId: ctx.charter.id, diveNumber: 2, diveSiteId: second.id });
    await ctx.db.update(trips).set({ plannedDives: 2 }).where(eq(trips.id, ctx.charter.id));
    return ctx;
  }

  it("boards a marked Open Water student when neither site states a level, and offers the sale the mark", async () => {
    const ctx = await twoTank(null);
    expect(await trainingDiveReachOn(ctx.db, ctx.shop.id, ctx.charter.id)).toBe("default");
    expect(await markable(ctx)).toHaveLength(1);
    expect(await markSeat(ctx)).toMatchObject({ ok: true });
    expect(await levelCodes(ctx)).toEqual([]);
  });

  it("still holds the student to a level one site states for itself", async () => {
    const ctx = await twoTank("open_water");
    expect(await markSeat(ctx)).toMatchObject({ ok: true });
    expect(await levelCodes(ctx)).toEqual(["certification_missing"]);
  });

  it("keeps a level a person chose for the day", async () => {
    const ctx = await twoTank(null, false);
    expect(await markSeat(ctx)).toMatchObject({ ok: true });
    expect(await levelCodes(ctx)).toEqual(["certification_missing"]);
  });

  it("still holds an unmarked uncertified diver to the default", async () => {
    const ctx = await twoTank(null);
    expect(await levelCodes(ctx)).toEqual(["certification_missing"]);
  });
});

describe("who writes the default flag (issue #3872)", () => {
  const departure = {
    title: "Morning Reef Dive",
    startsAt: new Date("2026-09-01T12:00:00Z"),
    endsAt: new Date("2026-09-01T16:00:00Z"),
    capacity: 6,
    plannedDives: 1,
    diveMode: "boat" as const,
  };

  it("flags the Open Water a new non-course departure starts with", async () => {
    const { db, shop } = fileCtx;
    const trip = await createTrip(db, { ...departure, shopId: shop.id });
    if (!trip) throw new Error("trip not created");
    expect(await getTripRequirements(db, shop.id, trip.id)).toMatchObject({
      minimumCertificationLevel: "open_water",
      minimumCertificationIsDefault: true,
    });
  });

  it("never flags a course session's level, which is the course's", async () => {
    const { db, shop } = fileCtx;
    const [course] = await db
      .select({ id: courses.id })
      .from(courses)
      .where(eq(courses.shopId, shop.id))
      .limit(1);
    if (!course) throw new Error("seed has no course");
    const trip = await createTrip(db, { ...departure, shopId: shop.id, courseId: course.id });
    if (!trip) throw new Error("course session not created");
    expect(await getTripRequirements(db, shop.id, trip.id)).toMatchObject({
      minimumCertificationIsDefault: false,
    });
  });

  it("refuses a default flag on any level but Open Water", async () => {
    const { db, shop } = fileCtx;
    const trip = await createTrip(db, { ...departure, shopId: shop.id });
    if (!trip) throw new Error("trip not created");
    for (const minimumCertificationLevel of ["advanced_open_water", null] as const) {
      await expect(
        db
          .update(tripRequirements)
          .set({ minimumCertificationLevel })
          .where(eq(tripRequirements.tripId, trip.id)),
      ).rejects.toThrow();
    }
  });

  // Both reviews of #3909: a copy carries its source's requirement row, so a
  // level a person chose stays chosen, and a saved gate is not lost.
  it("copies a duplicated departure's requirements, chosen or default", async () => {
    const { db, shop } = fileCtx;
    const source = await createTrip(db, { ...departure, shopId: shop.id });
    if (!source) throw new Error("trip not created");
    const fresh = await duplicateTrip(db, shop.id, source.id, new Date("2026-09-08T12:00:00Z"));
    if (!fresh) throw new Error("copy not created");
    expect(await getTripRequirements(db, shop.id, fresh.id)).toMatchObject({
      minimumCertificationIsDefault: true,
    });
    await upsertTripRequirements(db, {
      shopId: shop.id,
      tripId: source.id,
      requiresWaiver: true,
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["night"],
      requiresNitrox: true,
      requiresPayment: false,
    });
    await upsertTripRequirements(db, {
      shopId: shop.id,
      tripId: source.id,
      requiresWaiver: true,
      minimumCertificationLevel: "open_water",
      requiredSpecialties: ["night"],
      requiresNitrox: true,
      requiresPayment: false,
    });
    const copy = await duplicateTrip(db, shop.id, source.id, new Date("2026-09-15T12:00:00Z"));
    if (!copy) throw new Error("copy not created");
    expect(await getTripRequirements(db, shop.id, copy.id)).toMatchObject({
      minimumCertificationLevel: "open_water",
      minimumCertificationIsDefault: false,
      requiredSpecialties: ["night"],
      requiresNitrox: true,
    });
  });

  it("rolls a series forward with the template's requirements, chosen or default", async () => {
    const { db, shop } = fileCtx;
    const created = await createTripSeries(db, {
      shopId: shop.id,
      title: "Saturday Reef",
      capacity: 6,
      plannedDives: 1,
      frequency: "weekly",
      intervalWeeks: 1,
      weekdays: weekdaySetFrom([6]),
      anchorDate: "2030-09-07",
      endsOn: null,
      timeZone: "America/New_York",
      template: {
        startsAt: new Date("2030-09-07T11:00:00.000Z"),
        endsAt: new Date("2030-09-07T15:00:00.000Z"),
      },
    });
    const last = created?.trips.at(-1);
    if (!created || !last) throw new Error("series not created");
    expect(await getTripRequirements(db, shop.id, last.id)).toMatchObject({
      minimumCertificationIsDefault: true,
    });
    await upsertTripRequirements(db, {
      shopId: shop.id,
      tripId: last.id,
      requiresWaiver: true,
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      requiresNitrox: false,
      requiresPayment: false,
    });
    const rolled = await rollSeriesForward(
      db,
      shop.id,
      created.series.id,
      new Date("2030-10-07T12:00:00.000Z"),
    );
    expect(rolled?.created).toBeGreaterThan(0);
    const [next] = await db
      .select({ id: trips.id })
      .from(trips)
      .where(eq(trips.seriesId, created.series.id))
      .orderBy(desc(trips.startsAt))
      .limit(1);
    if (!next || next.id === last.id) throw new Error("nothing rolled");
    expect(await getTripRequirements(db, shop.id, next.id)).toMatchObject({
      minimumCertificationLevel: "advanced_open_water",
      minimumCertificationIsDefault: false,
      requiredSpecialties: ["deep"],
    });
  });
});
