import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { charterContext } from "@/test/training-mark-context";
import { createCertification, getBookingReadiness, reviewCertification } from "./readiness";
import {
  certifications,
  courses,
  diveSites,
  specialtyCertifications,
  tripDives,
  tripRequirements,
  trips,
} from "./schema";
import { changeTripCrew } from "./trips-crew";

const fileCtx = fileScopedShopContext();

describe("an Advanced course seat on a Deep-gated site", () => {
  it("keeps the site gates when the instructor is rostered but the underwater group and conditions are unknown", async () => {
    const ctx = await charterContext(fileCtx);
    await ctx.db
      .update(courses)
      .set({
        agency: "padi",
        minimumCertificationLevel: "open_water",
        certifiesLevel: "advanced_open_water",
        isIntroCourse: false,
      })
      .where(eq(courses.id, ctx.course.courseId));
    const [site] = await ctx.db
      .select({ id: diveSites.id })
      .from(diveSites)
      .where(eq(diveSites.shopId, ctx.shop.id))
      .limit(1);
    if (!site) throw new Error("seeded site missing");
    await ctx.db
      .update(diveSites)
      .set({
        minimumCertificationLevel: "advanced_open_water",
        requiredSpecialties: ["deep"],
      })
      .where(and(eq(diveSites.id, site.id), eq(diveSites.shopId, ctx.shop.id)));
    await ctx.db.update(trips).set({ diveSiteId: site.id }).where(eq(trips.id, ctx.course.tripId));
    await ctx.db
      .update(tripDives)
      .set({ diveSiteId: site.id })
      .where(eq(tripDives.tripId, ctx.course.tripId));
    await ctx.db
      .update(tripRequirements)
      .set({
        minimumCertificationLevel: "open_water",
        requiredSpecialties: [],
        requiresNitrox: false,
      })
      .where(
        and(
          eq(tripRequirements.shopId, ctx.shop.id),
          eq(tripRequirements.tripId, ctx.course.tripId),
        ),
      );
    await ctx.db
      .update(certifications)
      .set({ status: "pending" })
      .where(
        and(
          eq(certifications.shopId, ctx.shop.id),
          eq(certifications.personId, ctx.course.personId),
        ),
      );
    await ctx.db
      .update(specialtyCertifications)
      .set({ status: "pending" })
      .where(
        and(
          eq(specialtyCertifications.shopId, ctx.shop.id),
          eq(specialtyCertifications.personId, ctx.course.personId),
        ),
      );
    const card = await createCertification(ctx.db, {
      shopId: ctx.shop.id,
      personId: ctx.course.personId,
      agency: "padi",
      level: "open_water",
      identifier: "FIVE-DIVE-OW",
    });
    if (!card) throw new Error("Open Water card not created");
    await reviewCertification(ctx.db, {
      shopId: ctx.shop.id,
      certificationId: card.id,
      status: "verified",
    });
    expect(
      await changeTripCrew(
        ctx.db,
        ctx.shop.id,
        ctx.course.tripId,
        { personId: ctx.instructor, operation: "assign", tripRole: "instructor" },
        { actorPersonId: ctx.owner },
      ),
    ).toBe(true);
    const readiness = await getBookingReadiness(ctx.db, ctx.shop.id, ctx.course.bookingId);
    expect(readiness?.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "certification_insufficient" }),
        expect.objectContaining({ code: "specialty_missing", params: { specialty: "deep" } }),
      ]),
    );
  });
});
