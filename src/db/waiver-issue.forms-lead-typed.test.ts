import { and, eq, gt, isNotNull, ne } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nowDate } from "@/lib/clock";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { fileScopedShopContext } from "@/test/db";
import { createCourseForm, setCourseFormRequirements } from "./course-forms";
import { bookingCapabilities, bookings, people, trips } from "./schema";
import { listStaff } from "./trips";
import { issueAndDeliverWaiver } from "./waiver-issue";
import { completeWaiver, issueWaiverRequest } from "./waivers";

const ctx = fileScopedShopContext({ realShop: true });

afterEach(() => vi.unstubAllEnvs());

/** A course seat whose release is signed and whose course form is owed. */
async function signedCourseSeat() {
  const { db, shop } = ctx;
  const [seat] = await db
    .select({ bookingId: bookings.id, personId: bookings.personId, courseId: trips.courseId })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(bookings.shopId, shop.id),
        isNotNull(trips.courseId),
        ne(bookings.status, "cancelled"),
        ne(trips.status, "cancelled"),
        gt(trips.startsAt, nowDate()),
      ),
    )
    .limit(1);
  if (!seat?.courseId) throw new Error("demo course seat missing");
  await db
    .update(people)
    .set({ fullName: "Nora Quinn", email: "delivered@dive.day", dateOfBirth: "1990-04-02" })
    .where(eq(people.id, seat.personId));
  await db
    .update(bookings)
    .set({ identityUnconfirmedAt: null })
    .where(eq(bookings.id, seat.bookingId));
  const [staff] = await listStaff(db, shop.id);
  if (!staff) throw new Error("demo staff missing");
  const form = await createCourseForm(db, {
    shopId: shop.id,
    title: "Course release",
    body: "I will follow the instructor's plan for every in-water session of this course.",
    actorPersonId: staff.person.id,
  });
  await setCourseFormRequirements(db, {
    mayNarrow: true,
    shopId: shop.id,
    courseId: seat.courseId,
    formIds: [form.id],
  });
  const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: seat.bookingId });
  if (issued.ok) {
    const completed = await completeWaiver(db, issued.key, {
      signerName: "Nora Quinn",
      agreed: true,
      medicalAnswers: emptyMedicalAnswers(RSTC_QUESTIONNAIRE),
    });
    expect(completed).toMatchObject({ ok: true });
  }
  return { db, shop, bookingId: seat.bookingId };
}

async function formsLinks(bookingId: string) {
  return ctx.db
    .select({ id: bookingCapabilities.id })
    .from(bookingCapabilities)
    .where(
      and(
        eq(bookingCapabilities.bookingId, bookingId),
        eq(bookingCapabilities.purpose, "course_forms"),
      ),
    );
}

describe("the course-forms link and a lead-typed minor's address (issue #4033)", () => {
  it("sends no forms link to an address the party's lead typed", async () => {
    vi.stubEnv("APP_HOST", "https://diveday.test");
    const { db, shop, bookingId } = await signedCourseSeat();
    await db
      .update(bookings)
      .set({ contactTypedByLeadAt: nowDate(), claimedAt: null })
      .where(eq(bookings.id, bookingId));

    const result = await issueAndDeliverWaiver(db, shop.id, bookingId, { channel: "email" });

    expect(result).toMatchObject({ ok: true, delivery: "guardian_needed", token: null });
    expect(await formsLinks(bookingId)).toEqual([]);
  });

  it("still hands the desk a copied forms link", async () => {
    vi.stubEnv("APP_HOST", "https://diveday.test");
    const { db, shop, bookingId } = await signedCourseSeat();
    await db
      .update(bookings)
      .set({ contactTypedByLeadAt: nowDate(), claimedAt: null })
      .where(eq(bookings.id, bookingId));

    const result = await issueAndDeliverWaiver(db, shop.id, bookingId, { channel: "link" });

    expect(result).toMatchObject({ ok: true, delivery: "link_only" });
    expect(await formsLinks(bookingId)).toHaveLength(1);
  });
});
