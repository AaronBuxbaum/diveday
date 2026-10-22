import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { listDateRequestsForStaff } from "@/db/course-inquiries";
import { getCourseBySlug } from "@/db/courses";
import { courses, shops } from "@/db/schema";
import { diverTranslator } from "@/i18n/messages";
import { nowDate } from "@/lib/clock";
import type { InquiryFormState } from "@/lib/course-inquiry";
import { fileScopedShopContext } from "@/test/db";
import { nextHeadersStub } from "@/test/next-headers";

const ctx = fileScopedShopContext();

/**
 * **The acknowledgment a diver gets for a date request** (third UX review,
 * item 13) goes to whatever address was typed into a public form. The IP
 * bucket bounds how often one sender can submit; it does not bound how often
 * one inbox is written to in the shop's name. A second bucket, per address,
 * drops the acknowledgment past two a day and never the request itself.
 */

const hoisted = vi.hoisted(() => ({ afterTasks: [] as Promise<unknown>[] }));

vi.mock("next/server", () => ({
  after: vi.fn((task: () => unknown) => {
    hoisted.afterTasks.push(Promise.resolve().then(task));
  }),
}));
vi.mock("next/headers", () => nextHeadersStub());
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/request-ip", () => ({ clientIp: vi.fn(async () => "203.0.113.9") }));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, checkRateLimit: vi.fn() };
});
vi.mock("@/db/notifications", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/notifications")>();
  return { ...actual, sendNotification: vi.fn(async () => ({ status: "sent" as const })) };
});

const { getDb } = await import("@/db/client");
const { checkRateLimit, RATE_LIMITS, rateLimitKey } = await import("@/lib/rate-limit");
const { sendNotification } = await import("@/db/notifications");
const { submitInquiryAction } = await import("./inquiry");

let db: AppDb;

function requestForm(email: string): FormData {
  const form = new FormData();
  form.set("interest", "A night dive");
  form.set("name", "Ana Ruiz");
  form.set("email", email);
  form.set("preferredDate", "2030-09-07");
  return form;
}

async function submit(form: FormData, courseSlug: string | null = null): Promise<InquiryFormState> {
  const state = await submitInquiryAction("blue-mantis", courseSlug, {}, form);
  await Promise.all(hoisted.afterTasks);
  return state;
}

const sentKinds = () =>
  vi.mocked(sendNotification).mock.calls.map(([, message]) => (message as { kind: string }).kind);

beforeEach(async () => {
  hoisted.afterTasks.length = 0;
  db = ctx.db;
  vi.mocked(getDb).mockReset().mockResolvedValue(db);
  vi.mocked(sendNotification).mockClear();
  vi.mocked(checkRateLimit).mockReset().mockResolvedValue({ allowed: true, retryAfterMs: 0 });
});

describe("course date requests without a shop notification address (issue 2860)", () => {
  const email = "course-date-2860@example.com";
  const t = diverTranslator("en-US");
  const contactCases = [
    { contactEmail: null, contactPhone: null, confirmed: false, nudge: false },
    { contactEmail: null, contactPhone: "+1 305 555 0134", confirmed: false, nudge: false },
    { contactEmail: "desk@example.com", contactPhone: null, confirmed: true, nudge: true },
    { contactEmail: "unverified@example.com", contactPhone: null, confirmed: false, nudge: false },
  ];

  it.each(contactCases)(
    "retains a staff-visible request with $contactEmail, $contactPhone, confirmed=$confirmed",
    async ({ contactEmail, contactPhone, confirmed, nudge }) => {
      await db
        .update(shops)
        .set({
          contactEmail,
          contactPhone,
          contactEmailConfirmedAt: confirmed ? nowDate() : null,
          dateRequestsEnabled: false,
        })
        .where(eq(shops.id, ctx.shop.id));

      expect(await submit(requestForm(email), "open-water-diver")).toEqual({ success: true });
      const page = await listDateRequestsForStaff(db, ctx.shop.id);
      expect(page.rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            courseTitle: "Open Water Diver",
            email,
            name: "Ana Ruiz",
            preferredDate: "2030-09-07",
            interest: null,
          }),
        ]),
      );
      expect(sentKinds().filter((kind) => kind === "course_inquiry")).toHaveLength(nudge ? 1 : 0);
      expect(sentKinds()).toContain("course_inquiry_received");
      if (nudge) {
        expect(sendNotification).toHaveBeenCalledWith(
          db,
          expect.objectContaining({
            kind: "course_inquiry",
            to: contactEmail,
            shopId: ctx.shop.id,
          }),
        );
      }
    },
  );

  it("accepts a phone-only diver and sends no email when the shop has no address", async () => {
    await db
      .update(shops)
      .set({ contactEmail: null, contactEmailConfirmedAt: null })
      .where(eq(shops.id, ctx.shop.id));
    const form = requestForm(email);
    form.delete("email");
    form.set("phone", "+1 305 555 0199");

    expect(await submit(form, "open-water-diver")).toEqual({ success: true });
    expect((await listDateRequestsForStaff(db, ctx.shop.id)).rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          courseTitle: "Open Water Diver",
          email: null,
          phone: "+1 305 555 0199",
        }),
      ]),
    );
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("still refuses an IP that has exhausted its request allowance before reading the database", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, retryAfterMs: 60_000 });
    expect(await submit(requestForm(email), "open-water-diver")).toEqual({
      error: t("common.rateLimited"),
    });
    expect(getDb).not.toHaveBeenCalled();
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("still requires a reply path", async () => {
    const form = requestForm(email);
    form.delete("email");
    expect(await submit(form, "open-water-diver")).toEqual({
      error: t("inquiry.errors.contactRequired"),
    });
    expect(getDb).not.toHaveBeenCalled();
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("still refuses a course hidden before the request arrives", async () => {
    const course = await getCourseBySlug(db, ctx.shop.id, "open-water-diver");
    if (!course) throw new Error("seeded Open Water Diver missing");
    await db.update(courses).set({ isActive: false }).where(eq(courses.id, course.id));

    expect(await submit(requestForm(email), "open-water-diver")).toEqual({
      error: t("inquiry.errors.unavailable"),
    });
    expect(
      (await listDateRequestsForStaff(db, ctx.shop.id)).rows.map((row) => row.email),
    ).not.toContain(email);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("never accepts another shop's course or exposes a retained request in that shop's inbox", async () => {
    const [other] = await db
      .insert(shops)
      .values({ name: "Other Reef", slug: "other-reef-2860", timezone: "America/New_York" })
      .returning();
    await db
      .insert(courses)
      .values({ shopId: other.id, slug: "other-course-2860", title: "Other course" });

    expect(await submit(requestForm(email), "other-course-2860")).toEqual({
      error: t("inquiry.errors.unavailable"),
    });
    expect(sendNotification).not.toHaveBeenCalled();
    expect(await submit(requestForm(email), "open-water-diver")).toEqual({ success: true });
    expect((await listDateRequestsForStaff(db, other.id)).rows).toEqual([]);
    expect(
      (await listDateRequestsForStaff(db, ctx.shop.id)).rows.map((row) => row.email),
    ).toContain(email);
  });
});

describe("submitInquiryAction, the diver's acknowledgment", () => {
  it("spends the per-address bucket on the address as typed, whatever its case", async () => {
    expect(await submit(requestForm("Ana@Example.com"))).toEqual({ success: true });
    expect(checkRateLimit).toHaveBeenCalledWith(
      rateLimitKey("course-inquiry-ack", "ana@example.com"),
      RATE_LIMITS.courseInquiryAck,
    );
    expect(sentKinds()).toContain("interest_received_ack");
  });

  it("drops the acknowledgment once that address has had its share, and keeps the request", async () => {
    vi.mocked(checkRateLimit).mockImplementation(async (_key, config) =>
      config === RATE_LIMITS.courseInquiryAck
        ? { allowed: false, retryAfterMs: 60_000 }
        : { allowed: true, retryAfterMs: 0 },
    );
    expect(await submit(requestForm("ana@example.com"))).toEqual({ success: true });
    expect(sentKinds()).not.toContain("interest_received_ack");
  });
});
