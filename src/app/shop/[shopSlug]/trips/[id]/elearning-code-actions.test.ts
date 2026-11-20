import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { courseCodesByBooking, recordCourseCodes } from "@/db/course-codes";
import { courseElearningCodes, trips } from "@/db/schema";
import { getTripRoster, listStaff } from "@/db/trips";
import { upcomingTripsWithCounts } from "@/db/trips-queries.test-support";
import { fileScopedShopContext } from "@/test/db";
import { staffSession } from "@/test/staff-session";

const ctx = fileScopedShopContext();

/**
 * **Handing a student an eLearning code from the roster, and taking it back** (ADR
 * 20261120-course-elearning-codes). Any live staffer; the writer refuses a fun dive's seat and says
 * so when the stock is empty.
 */

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("../../../../../features/session/rules", () => ({ requireShopSurface: vi.fn() }));

const { getDb } = await import("@/db/client");
const { requireShopSurface } = await import("../../../../../features/session/rules");
const { setElearningCodeAction } = await import("./elearning-code-actions");

async function context() {
  const { db, shop } = ctx;
  vi.mocked(getDb).mockResolvedValue(db);
  const [staff] = await listStaff(db, shop.id);
  if (!staff) throw new Error("the seeded shop has no staff");
  vi.mocked(requireShopSurface).mockResolvedValue({
    session: staffSession({ shopId: shop.id, shopSlug: shop.slug, personId: staff.person.id }),
  } as never);
  const upcoming = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const session = upcoming.find((trip) => trip.title.startsWith("Advanced Open Water Diver"));
  if (!session) throw new Error("the seeded shop is missing a course session");
  const [student] = await getTripRoster(db, shop.id, session.id);
  const [trip] = await db.select().from(trips).where(eq(trips.id, session.id));
  if (!student || !trip?.courseId) throw new Error("the course session has no student");
  await db.delete(courseElearningCodes).where(eq(courseElearningCodes.shopId, shop.id));
  return { db, shop, tripId: session.id, bookingId: student.booking.id, courseId: trip.courseId };
}

const post = (bookingId: string, give: boolean) => {
  const form = new FormData();
  form.set("bookingId", bookingId);
  form.set("give", String(give));
  return form;
};

const redirected = async (run: Promise<unknown>) => {
  try {
    await run;
  } catch (error) {
    return (error as Error).message;
  }
  return "";
};

describe("setElearningCodeAction", () => {
  it("hands the student the oldest code, and takes it back into stock", async () => {
    const { db, shop, tripId, bookingId, courseId } = await context();
    await recordCourseCodes(db, { shopId: shop.id, courseId, text: "AAA1 BBB2" });

    const given = await redirected(
      setElearningCodeAction(shop.slug, tripId, post(bookingId, true)),
    );
    expect(given).toContain("notice=code-given");
    const held = await courseCodesByBooking(db, { shopId: shop.id, bookingIds: [bookingId] });
    expect(held.get(bookingId)).toBe("AAA1");

    const released = await redirected(
      setElearningCodeAction(shop.slug, tripId, post(bookingId, false)),
    );
    expect(released).toContain("notice=code-released");
    expect(
      (await courseCodesByBooking(db, { shopId: shop.id, bookingIds: [bookingId] })).size,
    ).toBe(0);
  });

  it("says so when the stock is empty and writes nothing", async () => {
    const { db, shop, tripId, bookingId } = await context();
    const outcome = await redirected(
      setElearningCodeAction(shop.slug, tripId, post(bookingId, true)),
    );
    expect(outcome).toContain("notice=code-none-left");
    expect(
      (await courseCodesByBooking(db, { shopId: shop.id, bookingIds: [bookingId] })).size,
    ).toBe(0);
  });
});
