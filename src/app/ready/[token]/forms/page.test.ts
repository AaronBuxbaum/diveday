import { and, eq, gt, isNotNull, ne } from "drizzle-orm";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { issueBookingCapability } from "@/db/booking-capabilities";
import {
  createCourseForm,
  getCourseFormsForBooking,
  listCourseForms,
  saveCourseFormVersion,
  setCourseFormRequirements,
} from "@/db/course-forms";
import { bookings, courseFormRecords, people, shops, trips } from "@/db/schema";
import { listStaff } from "@/db/trips";
import { nowDate } from "@/lib/clock";
import { seededShopContext } from "@/test/db";

/**
 * **The course-form signing page and its one action, against a real database**
 * (ADR 20261008-course-forms).
 *
 * The page is reached with a readiness link, which is the whole of its
 * authority: the token proves one enrollment and nothing wider. So every case
 * here is the link deciding what renders or what is signed — a dead token, a
 * form owed, a minor's form, a version that changed under the page, a name
 * that is not the student's — never a session.
 */

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));
vi.mock("next/server", () => ({ connection: vi.fn(async () => undefined) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/i18n/request", () => ({
  requestLocale: vi.fn(async () => "en-US"),
  requestFirstHandLocale: vi.fn(async () => null),
}));
vi.mock("@/lib/request-ip", () => ({ clientIp: vi.fn(async () => "203.0.113.9") }));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, checkRateLimit: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })) };
});

const { getDb } = await import("@/db/client");
const { checkRateLimit } = await import("@/lib/rate-limit");
const { default: CourseFormsPage } = await import("./page");
const { signCourseFormFromReady } = await import("../actions");

afterEach(() => vi.clearAllMocks());

const BODY =
  "I will follow the instructor's plan for every in-water session and tell them before any session if my health changes.";

/** A live course seat with a readiness link, and one or two forms required. */
async function enrolled(options: { forms?: number; dateOfBirth?: string } = {}) {
  const { db, shop } = await seededShopContext();
  vi.mocked(getDb).mockResolvedValue(db);
  const [seat] = await db
    .select({
      bookingId: bookings.id,
      personId: people.id,
      fullName: people.fullName,
      courseId: trips.courseId,
    })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .innerJoin(people, eq(people.id, bookings.personId))
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
  if (!seat?.courseId) throw new Error("seed has no upcoming course seat");
  await db
    .update(people)
    .set({ dateOfBirth: options.dateOfBirth ?? "1990-04-02" })
    .where(eq(people.id, seat.personId));
  await db
    .update(bookings)
    .set({ identityUnconfirmedAt: null })
    .where(eq(bookings.id, seat.bookingId));
  const [staff] = await listStaff(db, shop.id);
  if (!staff) throw new Error("demo staff missing");
  const formIds: string[] = [];
  for (let index = 0; index < (options.forms ?? 1); index++) {
    const form = await createCourseForm(db, {
      shopId: shop.id,
      title: `Course form ${index + 1}`,
      body: BODY,
      actorPersonId: staff.person.id,
    });
    formIds.push(form.id);
  }
  await setCourseFormRequirements(db, { shopId: shop.id, courseId: seat.courseId, formIds });
  const issued = await issueBookingCapability(db, {
    shopId: shop.id,
    bookingId: seat.bookingId,
    purpose: "readiness",
  });
  if (!issued) throw new Error("no readiness link");
  return { db, shop, seat, staff: staff.person, formIds, token: issued.token };
}

async function rendered(token: string, searchParams: Record<string, string> = {}) {
  try {
    return renderToStaticMarkup(
      await CourseFormsPage({
        params: Promise.resolve({ token }),
        searchParams: Promise.resolve(searchParams),
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("REDIRECT:")) return message;
    throw error;
  }
}

async function signed(token: string, fields: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);
  try {
    await signCourseFormFromReady(token, formData);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("REDIRECT:")) return message.slice("REDIRECT:".length);
    throw error;
  }
  throw new Error("action returned without redirecting");
}

async function owed(ctx: Awaited<ReturnType<typeof enrolled>>) {
  const forms = await getCourseFormsForBooking(ctx.db, ctx.shop.id, ctx.seat.bookingId);
  return forms?.outstanding ?? [];
}

describe("the course-form page", () => {
  it("shows the first owed form's words, the progress, and the student's name to type", async () => {
    const ctx = await enrolled({ forms: 2 });
    const html = await rendered(ctx.token);

    expect(html).toContain("Course form 1");
    expect(html).toContain("Form 1 of 2");
    expect(html).toContain(BODY.replace("'", "&#x27;"));
    expect(html).toContain(`As booked: ${ctx.seat.fullName}`);
    // An adult signs alone: no guardian card.
    expect(html).not.toContain('name="guardianName"');
  });

  it("asks a minor's guardian to co-sign on the same page", async () => {
    const ctx = await enrolled({ dateOfBirth: "2012-05-01" });
    const html = await rendered(ctx.token);

    expect(html).toContain('name="guardianName"');
    expect(html).toContain('name="guardianRelationship"');
    expect(html).toContain('name="guardianAcknowledged"');
  });

  it("sends a link it cannot verify back to the prep page, which explains it", async () => {
    await enrolled();
    expect(await rendered("not-a-real-token")).toBe("REDIRECT:/ready/not-a-real-token");
  });

  it("draws no form on a seat held for staff to confirm who it is", async () => {
    const ctx = await enrolled();
    await ctx.db
      .update(bookings)
      .set({ identityUnconfirmedAt: nowDate() })
      .where(eq(bookings.id, ctx.seat.bookingId));
    expect(await rendered(ctx.token)).toBe(`REDIRECT:/ready/${ctx.token}`);
  });

  it("says there is nothing left once every form is signed", async () => {
    const ctx = await enrolled();
    const [form] = await owed(ctx);
    await signed(ctx.token, {
      formVersionId: form?.versionId ?? "",
      signerName: ctx.seat.fullName,
      acknowledged: "on",
    });
    expect(await rendered(ctx.token)).toContain("Nothing left to sign for this course.");
  });
});

describe("signing a course form from the link", () => {
  it("signs the form as the student, snapshotting the words, and returns to prep", async () => {
    const ctx = await enrolled();
    const [form] = await owed(ctx);

    const to = await signed(ctx.token, {
      formVersionId: form?.versionId ?? "",
      signerName: ctx.seat.fullName,
      acknowledged: "on",
    });

    expect(to).toBe(`/ready/${ctx.token}?saved=course-forms`);
    expect(await owed(ctx)).toEqual([]);
    const [record] = await ctx.db
      .select()
      .from(courseFormRecords)
      .where(eq(courseFormRecords.bookingId, ctx.seat.bookingId));
    expect(record).toMatchObject({
      shopId: ctx.shop.id,
      personId: ctx.seat.personId,
      formTitle: "Course form 1",
      formVersion: 1,
      formBody: BODY,
      signedName: ctx.seat.fullName,
      recordedByPersonId: null,
    });
  });

  it("stays on the forms page while another is owed", async () => {
    const ctx = await enrolled({ forms: 2 });
    const [first] = await owed(ctx);

    const to = await signed(ctx.token, {
      formVersionId: first?.versionId ?? "",
      signerName: ctx.seat.fullName,
      acknowledged: "on",
    });

    expect(to).toBe(`/ready/${ctx.token}/forms?signed=1`);
    expect((await owed(ctx)).map((form) => form.title)).toEqual(["Course form 2"]);
  });

  it("refuses a name that is not the student's, and signs nothing", async () => {
    const ctx = await enrolled();
    const [form] = await owed(ctx);

    const to = await signed(ctx.token, {
      formVersionId: form?.versionId ?? "",
      signerName: "Somebody Else",
      acknowledged: "on",
    });

    expect(to).toBe(`/ready/${ctx.token}/forms?error=name`);
    expect(await owed(ctx)).toHaveLength(1);
  });

  it("refuses a signature without the agreement box", async () => {
    const ctx = await enrolled();
    const [form] = await owed(ctx);

    const to = await signed(ctx.token, {
      formVersionId: form?.versionId ?? "",
      signerName: ctx.seat.fullName,
    });

    expect(to).toBe(`/ready/${ctx.token}/forms?error=agreement`);
    expect(await owed(ctx)).toHaveLength(1);
  });

  it("refuses words the shop changed while the page was open", async () => {
    const ctx = await enrolled();
    const [stale] = await owed(ctx);
    await saveCourseFormVersion(ctx.db, {
      shopId: ctx.shop.id,
      formId: ctx.formIds[0] ?? "",
      title: "Course form 1",
      body: `${BODY} Revised.`,
      actorPersonId: ctx.staff.id,
    });

    const to = await signed(ctx.token, {
      formVersionId: stale?.versionId ?? "",
      signerName: ctx.seat.fullName,
      acknowledged: "on",
    });

    expect(to).toBe(`/ready/${ctx.token}/forms?error=version`);
    expect(await owed(ctx)).toHaveLength(1);
  });

  it("refuses a minor's form with no guardian, then takes it with one", async () => {
    const ctx = await enrolled({ dateOfBirth: "2012-05-01" });
    const [form] = await owed(ctx);
    const student = {
      formVersionId: form?.versionId ?? "",
      signerName: ctx.seat.fullName,
      acknowledged: "on",
    };

    expect(await signed(ctx.token, student)).toBe(`/ready/${ctx.token}/forms?error=guardian`);
    expect(
      await signed(ctx.token, {
        ...student,
        guardianName: ctx.seat.fullName,
        guardianRelationship: "parent",
        guardianAcknowledged: "on",
      }),
    ).toBe(`/ready/${ctx.token}/forms?error=guardian`);
    expect(await owed(ctx)).toHaveLength(1);

    expect(
      await signed(ctx.token, {
        ...student,
        guardianName: "Dana Guardian",
        guardianRelationship: "parent",
        guardianAcknowledged: "on",
      }),
    ).toBe(`/ready/${ctx.token}?saved=course-forms`);
    expect(await owed(ctx)).toEqual([]);
  });

  it("cannot sign a form for another shop's version through this link", async () => {
    const ctx = await enrolled();
    const [other] = await ctx.db
      .insert(shops)
      .values({ name: "Other Reef", slug: "other-reef-sign", timezone: "America/New_York" })
      .returning();
    if (!other) throw new Error("other shop insert failed");
    await createCourseForm(ctx.db, {
      shopId: other.id,
      title: "Their form",
      body: BODY,
      actorPersonId: ctx.staff.id,
    });
    const [foreign] = await listCourseForms(ctx.db, other.id);

    const to = await signed(ctx.token, {
      formVersionId: foreign?.versionId ?? "",
      signerName: ctx.seat.fullName,
      acknowledged: "on",
    });

    expect(to).toBe(`/ready/${ctx.token}/forms?error=version`);
    expect(await owed(ctx)).toHaveLength(1);
  });

  it("is throttled before the token is even looked at", async () => {
    const ctx = await enrolled();
    vi.mocked(checkRateLimit).mockResolvedValueOnce({ allowed: false, retryAfterMs: 1000 });

    expect(await signed(ctx.token, { formVersionId: ctx.formIds[0] ?? "" })).toBe(
      `/ready/${ctx.token}/forms?error=rate`,
    );
  });

  it("sends a dead link back to the prep page without signing", async () => {
    const ctx = await enrolled();
    const [form] = await owed(ctx);
    expect(
      await signed("dead-token", {
        formVersionId: form?.versionId ?? "",
        signerName: ctx.seat.fullName,
        acknowledged: "on",
      }),
    ).toBe("/ready/dead-token");
    expect(await owed(ctx)).toHaveLength(1);
  });
});
