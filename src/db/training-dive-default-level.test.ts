import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
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
import { markableTrainingDives } from "./training-mark-resolve";
import { createTrip } from "./trips-create";

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
async function defaultLevelCharter(isDefault = true): Promise<CharterContext> {
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
      minimumCertificationLevel: "open_water",
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

  it("keeps a level a person saved, even the same Open Water", async () => {
    const ctx = await defaultLevelCharter();
    const current = await getTripRequirements(ctx.db, ctx.shop.id, ctx.charter.id);
    if (!current) throw new Error("requirement missing");
    const saved = await upsertTripRequirements(ctx.db, {
      shopId: ctx.shop.id,
      tripId: ctx.charter.id,
      requiresWaiver: current.requiresWaiver,
      minimumCertificationLevel: "open_water",
      requiredSpecialties: current.requiredSpecialties,
      requiresNitrox: current.requiresNitrox,
      requiresPayment: current.requiresPayment,
    });
    expect(saved?.minimumCertificationIsDefault).toBe(false);
    expect(await markSeat(ctx)).toMatchObject({ ok: true });
    expect(await levelCodes(ctx)).toEqual(["certification_missing"]);
  });

  it("keeps a chosen level on a charter built that way", async () => {
    const ctx = await defaultLevelCharter(false);
    expect(await markSeat(ctx)).toMatchObject({ ok: true });
    expect(await levelCodes(ctx)).toEqual(["certification_missing"]);
  });

  it("lowers nothing on a two-dive charter: the mark cannot name the dive", async () => {
    const ctx = await defaultLevelCharter();
    await ctx.db.update(trips).set({ plannedDives: 2 }).where(eq(trips.id, ctx.charter.id));
    expect(await markable(ctx)).toEqual([]);
    expect(await markSeat(ctx)).toMatchObject({ ok: true });
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
});
