import { and, eq, gt, isNotNull, ne } from "drizzle-orm";
import QRCode from "qrcode";
import { describe, expect, it, vi } from "vitest";
import { issueCounterCourseForms } from "@/db/course-counter-qr";
import { createCourseForm, setCourseFormRequirements } from "@/db/course-forms";
import { bookings, people, trips } from "@/db/schema";
import { listStaff } from "@/db/trips";
import { courseFormsLinkPath } from "@/lib/booking-capabilities";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { staffSession } from "@/test/staff-session";

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("@/db/client", async (load) => ({
  ...(await load<typeof import("@/db/client")>()),
  getDb: vi.fn(),
}));
vi.mock("@/lib/session", async () =>
  (await import("@/test/staff-session")).sessionMockOverStaffSession(),
);
const { getDb } = await import("@/db/client");
const { requireStaffSession } = await import("@/lib/session");
const { issueCourseFormQrAction } = await import("./course-form-qr-action");
const ctx = fileScopedShopContext();

describe("course form QR action", () => {
  it("returns an image encoding only the selected forms-only URL", async () => {
    vi.stubEnv("APP_HOST", "https://diveday.test");
    vi.stubEnv("SECRET_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
    const { db, shop } = ctx;
    const [seat] = await db
      .select({
        id: bookings.id,
        personId: bookings.personId,
        tripId: trips.id,
        courseId: trips.courseId,
      })
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
    if (!seat?.courseId) throw new Error("course seat missing");
    const [staff] = await listStaff(db, shop.id);
    if (!staff) throw new Error("staff missing");
    await db.update(people).set({ dateOfBirth: "1990-04-02" }).where(eq(people.id, seat.personId));
    await db.update(bookings).set({ identityUnconfirmedAt: null }).where(eq(bookings.id, seat.id));
    const form = await createCourseForm(db, {
      shopId: shop.id,
      title: "Course release",
      body: "I agree to follow the instructor's plan.",
      actorPersonId: staff.person.id,
    });
    await setCourseFormRequirements(db, {
      shopId: shop.id,
      courseId: seat.courseId,
      formIds: [form.id],
      mayNarrow: true,
    });
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(requireStaffSession).mockResolvedValue(
      staffSession({ shopId: shop.id, shopSlug: shop.slug, personId: staff.person.id }),
    );
    const issued = await issueCounterCourseForms(db, {
      shopId: shop.id,
      tripId: seat.tripId,
      bookingId: seat.id,
    });
    if (!issued) throw new Error("fixture did not issue");
    const result = await issueCourseFormQrAction(shop.slug, seat.tripId, seat.id);
    if (!result.ok) throw new Error("QR action refused");
    const expected = new URL(courseFormsLinkPath(issued.token), "https://diveday.test/").toString();
    expect(result.qr).toBe(await QRCode.toDataURL(expected, { margin: 4, width: 256 }));
    expect(JSON.stringify(result)).not.toContain(issued.token);
    expect(
      await issueCourseFormQrAction(shop.slug, "00000000-0000-4000-8000-000000000000", seat.id),
    ).toEqual({ ok: false });
    await expect(issueCourseFormQrAction("another-shop", seat.tripId, seat.id)).rejects.toThrow(
      "NOT_FOUND",
    );
    vi.unstubAllEnvs();
  });
});
