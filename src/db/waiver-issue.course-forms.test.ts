import type { SendEmailCommand } from "@aws-sdk/client-sesv2";
import { and, eq, gt, isNotNull, isNull, ne } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nowDate } from "@/lib/clock";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { fileScopedShopContext } from "@/test/db";
import { revokeBookingCapabilities, verifyBookingCapability } from "./booking-capabilities";
import {
  createCourseForm,
  getCourseFormsForBooking,
  setCourseFormRequirements,
  signCourseForm,
} from "./course-forms";
import { bookingCapabilities, bookings, people, trips } from "./schema";
import { listStaff } from "./trips";
import { issueAndDeliverWaiver } from "./waiver-issue";
import { completeWaiver, issueWaiverRequest } from "./waivers";

const { sesSend } = vi.hoisted(() => ({ sesSend: vi.fn() }));
vi.mock("@aws-sdk/client-sesv2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aws-sdk/client-sesv2")>();
  return {
    ...actual,
    SESv2Client: vi.fn().mockImplementation(function SESv2Client() {
      return { send: sesSend };
    }),
  };
});

// One seeded database for the file and a rolled-back transaction per test
// (`fileScopedShopContext` in src/test/db.ts); tests roll back; demo shops send no mail.
const ctx = fileScopedShopContext({ realShop: true });

afterEach(() => {
  vi.unstubAllEnvs();
  sesSend.mockReset();
});

/**
 * **One "send the waiver" covers the course's forms** (ADR
 * 20261008-course-forms). A student whose release is signed but whose
 * course still asks for a form must not read as "nothing to send": the same
 * act hands over their forms page, on the same channel, by the same rules.
 */
describe("issueAndDeliverWaiver with course forms owed", () => {
  async function courseSeat() {
    const { db, shop } = ctx;
    // A seat the seed already holds on a course session: booking one fresh
    // would meet the course's prerequisite gate, which is not this test's.
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
    const trip = { courseId: seat.courseId };
    const outcome = { bookingId: seat.bookingId };
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
      courseId: trip.courseId,
      formIds: [form.id],
    });
    const issued = await issueWaiverRequest(db, {
      shopId: shop.id,
      bookingId: outcome.bookingId,
    });
    // The seed may already hold this diver's signed release; either way the
    // release is signed before the send under test.
    if (issued.ok) {
      const completed = await completeWaiver(db, issued.key, {
        signerName: "Nora Quinn",
        agreed: true,
        medicalAnswers: emptyMedicalAnswers(RSTC_QUESTIONNAIRE),
      });
      expect(completed).toMatchObject({ ok: true });
    } else {
      expect(issued.reason).toBe("already_completed");
    }
    return { db, shop, bookingId: outcome.bookingId };
  }

  it("hands over the forms page when the release is already signed", async () => {
    vi.stubEnv("APP_HOST", "https://diveday.test");
    const { db, shop, bookingId } = await courseSeat();

    const result = await issueAndDeliverWaiver(db, shop.id, bookingId, { channel: "link" });

    expect(result).toMatchObject({ ok: true, bookingId, delivery: "link_only" });
    if (!result.ok) throw new Error("unreachable");
    expect(result.path).toBe(`/ready/${result.token}/forms`);
    // A forms-only link for this very booking: it is not a readiness link,
    // so whoever it is handed to cannot open the diver's trip prep with it.
    expect(
      await verifyBookingCapability(db, { token: result.token ?? "", purpose: "course_forms" }),
    ).toMatchObject({ bookingId, shopId: shop.id });
    expect(
      await verifyBookingCapability(db, { token: result.token ?? "", purpose: "readiness" }),
    ).toBeNull();
  });

  it("sends no forms link to an address the party's lead typed for a minor", async () => {
    vi.stubEnv("APP_HOST", "https://diveday.test");
    const { db, shop, bookingId } = await courseSeat();
    await db
      .update(bookings)
      .set({ contactTypedByLeadAt: nowDate(), claimedAt: null })
      .where(eq(bookings.id, bookingId));

    const result = await issueAndDeliverWaiver(db, shop.id, bookingId, { channel: "email" });

    expect(result).toMatchObject({ ok: true, delivery: "guardian_needed", token: null });
    const minted = await db
      .select({ id: bookingCapabilities.id })
      .from(bookingCapabilities)
      .where(
        and(
          eq(bookingCapabilities.bookingId, bookingId),
          eq(bookingCapabilities.purpose, "course_forms"),
        ),
      );
    expect(minted).toEqual([]);
  });

  it("hands back the same forms link on a second send while it is live", async () => {
    vi.stubEnv("APP_HOST", "https://diveday.test");
    vi.stubEnv("SECRET_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
    const { db, shop, bookingId } = await courseSeat();

    const first = await issueAndDeliverWaiver(db, shop.id, bookingId, { channel: "link" });
    const second = await issueAndDeliverWaiver(db, shop.id, bookingId, { channel: "link" });

    if (!first.ok || !second.ok) throw new Error("expected two forms links");
    expect(second.token).toBe(first.token);
    const live = await db
      .select({ id: bookingCapabilities.id })
      .from(bookingCapabilities)
      .where(
        and(
          eq(bookingCapabilities.bookingId, bookingId),
          eq(bookingCapabilities.purpose, "course_forms"),
          isNull(bookingCapabilities.revokedAt),
        ),
      );
    expect(live).toHaveLength(1);
  });

  it("mints a fresh forms link once the live one is revoked", async () => {
    vi.stubEnv("APP_HOST", "https://diveday.test");
    vi.stubEnv("SECRET_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
    const { db, shop, bookingId } = await courseSeat();
    const first = await issueAndDeliverWaiver(db, shop.id, bookingId, { channel: "link" });
    await revokeBookingCapabilities(db, { shopId: shop.id, bookingId, purpose: "course_forms" });

    const second = await issueAndDeliverWaiver(db, shop.id, bookingId, { channel: "link" });

    if (!first.ok || !second.ok) throw new Error("expected two forms links");
    expect(second.token).not.toBe(first.token);
    const dead = await db
      .select({ revoked: isNotNull(bookingCapabilities.revokedAt) })
      .from(bookingCapabilities)
      .where(
        and(
          eq(bookingCapabilities.bookingId, bookingId),
          eq(bookingCapabilities.purpose, "course_forms"),
          isNotNull(bookingCapabilities.revokedAt),
        ),
      );
    expect(dead).toEqual([{ revoked: true }]);
  });

  it("emails the forms link with its own words, never 'your link expired'", async () => {
    vi.stubEnv("APP_HOST", "https://diveday.example");
    vi.stubEnv("SES_AWS_REGION", "us-east-1");
    vi.stubEnv("SES_AWS_ACCESS_KEY_ID", "AKIA_TEST");
    vi.stubEnv("SES_AWS_SECRET_ACCESS_KEY", "test-secret");
    vi.stubEnv("SES_FROM_EMAIL", "shop@diveday.example");
    sesSend.mockResolvedValue({ MessageId: "ses-course-forms" });
    const { db, shop, bookingId } = await courseSeat();

    const result = await issueAndDeliverWaiver(db, shop.id, bookingId);

    expect(result).toMatchObject({ ok: true, delivery: "sent" });
    const command = sesSend.mock.calls.at(-1)?.[0] as SendEmailCommand | undefined;
    const subject = command?.input.Content?.Simple?.Subject?.Data ?? "";
    const text = command?.input.Content?.Simple?.Body?.Text?.Data ?? "";
    expect(subject).toContain("Course forms to sign");
    expect(text).toContain("/forms");
    expect(text).not.toContain("expired");
  });

  it("reports the release as signed once the forms are signed too", async () => {
    const { db, shop, bookingId } = await courseSeat();
    const forms = await getCourseFormsForBooking(db, shop.id, bookingId);
    const [form] = forms?.outstanding ?? [];
    const signed = await signCourseForm(db, {
      shopId: shop.id,
      bookingId,
      formVersionId: form?.versionId ?? "",
      signerName: "Nora Quinn",
      agreed: true,
    });
    expect(signed).toMatchObject({ ok: true });

    expect(await issueAndDeliverWaiver(db, shop.id, bookingId)).toMatchObject({
      ok: false,
      reason: "already_completed",
    });
  });
});
