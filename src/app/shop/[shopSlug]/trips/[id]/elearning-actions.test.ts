import { eq, ne } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { bookings, courses, people, trips } from "@/db/schema";
import { getTripRoster, listStaff, upcomingTripsWithCounts } from "@/db/trips";
import { seededShopContext } from "@/test/db";
import { staffSession } from "@/test/staff-session";

/**
 * **A course student's materials, ticked from PADI's own eLearning page**
 * (H-106).
 *
 * The extension hands back whatever PADI's page showed; the verdict is the
 * server's, from the seat, student and course as the database holds them.
 * These are about what that page text can and cannot do: tick the one seat it
 * names, on this course, finished, and nothing else.
 */

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/session", () => ({ requireShopSurface: vi.fn() }));

const { getDb } = await import("@/db/client");
const { requireShopSurface } = await import("@/lib/session");
const { elearningCheckAction } = await import("./elearning-actions");

const EMAIL = "lena.ortiz@example.com";
const PAGE = `Lena Ortiz\t${EMAIL}\tAdvanced Open Water Diver Online\tComplete`;

async function context() {
  const { db, shop } = await seededShopContext();
  vi.mocked(getDb).mockResolvedValue(db);
  const [staff] = await listStaff(db, shop.id);
  if (!staff) throw new Error("the seeded shop has no staff");
  vi.mocked(requireShopSurface).mockResolvedValue({
    session: staffSession({ shopId: shop.id, shopSlug: shop.slug, personId: staff.person.id }),
  } as never);
  const upcoming = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const session = upcoming.find((trip) => trip.title.startsWith("Advanced Open Water Diver"));
  const funDive = upcoming.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
  if (!session || !funDive) throw new Error("the seeded shop is missing a course session");
  const [student] = await getTripRoster(db, shop.id, session.id);
  const [diver] = await getTripRoster(db, shop.id, funDive.id);
  if (!student || !diver) throw new Error("the seeded departures have empty rosters");
  const [trip] = await db.select().from(trips).where(eq(trips.id, session.id));
  if (!trip?.courseId) throw new Error("the course session has no course");
  await db
    .update(courses)
    .set({ agency: "padi", title: "PADI Advanced Open Water Diver" })
    .where(eq(courses.id, trip.courseId));
  await db
    .update(people)
    .set({ fullName: "Lena Ortiz", email: EMAIL })
    .where(eq(people.id, student.person.id));
  await db
    .update(bookings)
    .set({ courseMaterialsDoneAt: null, courseMaterialsDoneByPersonId: null })
    .where(eq(bookings.id, student.booking.id));
  return {
    db,
    shop,
    staffId: staff.person.id,
    tripId: session.id,
    courseId: trip.courseId,
    bookingId: student.booking.id,
    funDive: { tripId: funDive.id, bookingId: diver.booking.id },
  };
}

function check(bookingId: string, pageText: string | null, intent?: "undo") {
  const formData = new FormData();
  formData.set("bookingId", bookingId);
  if (pageText !== null) formData.set("pageText", pageText);
  if (intent) formData.set("intent", intent);
  return formData;
}

async function tick(db: Awaited<ReturnType<typeof context>>["db"], bookingId: string) {
  const [row] = await db
    .select({
      at: bookings.courseMaterialsDoneAt,
      by: bookings.courseMaterialsDoneByPersonId,
    })
    .from(bookings)
    .where(eq(bookings.id, bookingId));
  return row;
}

describe("elearningCheckAction", () => {
  it("ticks the materials, stamped with this staffer, when PADI shows the course finished", async () => {
    const { db, shop, staffId, tripId, bookingId } = await context();

    const result = await elearningCheckAction(shop.slug, tripId, null, check(bookingId, PAGE));

    expect(result).toMatchObject({ ok: true, verdict: "complete", undo: { bookingId } });
    const row = await tick(db, bookingId);
    expect(row?.at).toBeInstanceOf(Date);
    expect(row?.by).toBe(staffId);
  });

  it("takes the tick back on Undo", async () => {
    const { db, shop, tripId, bookingId } = await context();
    await elearningCheckAction(shop.slug, tripId, null, check(bookingId, PAGE));

    const result = await elearningCheckAction(
      shop.slug,
      tripId,
      null,
      check(bookingId, null, "undo"),
    );

    expect(result).toEqual({ ok: true, verdict: "undone" });
    expect((await tick(db, bookingId))?.at).toBeNull();
  });

  it("leaves a colleague's earlier tick exactly as it was", async () => {
    const { db, shop, tripId, bookingId } = await context();
    const earlier = new Date("2026-10-01T09:00:00Z");
    const [other] = await db.select({ id: people.id }).from(people).limit(1);
    await db
      .update(bookings)
      .set({ courseMaterialsDoneAt: earlier, courseMaterialsDoneByPersonId: other?.id ?? null })
      .where(eq(bookings.id, bookingId));

    const result = await elearningCheckAction(shop.slug, tripId, null, check(bookingId, PAGE));

    expect(result).toEqual({ ok: true, verdict: "already_done" });
    expect((await tick(db, bookingId))?.at).toEqual(earlier);
  });

  it("counts a colleague's tick on another departure of the same course as done", async () => {
    const { db, shop, tripId, bookingId } = await context();
    const [session] = await db.select().from(trips).where(eq(trips.id, tripId));
    const [seat] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
    if (!session || !seat) throw new Error("the course seat is missing");
    const [other] = await db
      .select({ id: people.id })
      .from(people)
      .where(ne(people.id, seat.personId))
      .limit(1);
    const { id: _trip, ...sessionFields } = session;
    const [poolWeekend] = await db
      .insert(trips)
      .values({
        ...sessionFields,
        startsAt: new Date(session.startsAt.getTime() - 14 * 86_400_000),
        endsAt: new Date(session.endsAt.getTime() - 14 * 86_400_000),
      })
      .returning({ id: trips.id });
    const { id: _seat, ...seatFields } = seat;
    const earlier = new Date("2026-10-01T09:00:00Z");
    await db.insert(bookings).values({
      ...seatFields,
      tripId: poolWeekend?.id ?? "",
      courseMaterialsDoneAt: earlier,
      courseMaterialsDoneByPersonId: other?.id ?? null,
    });

    const result = await elearningCheckAction(shop.slug, tripId, null, check(bookingId, PAGE));

    expect(result).toEqual({ ok: true, verdict: "already_done" });
    expect((await tick(db, bookingId))?.at).toBeNull();
  });

  it("leaves a colleague's tick made since the check alone on Undo", async () => {
    const { db, shop, staffId, tripId, bookingId } = await context();
    await elearningCheckAction(shop.slug, tripId, null, check(bookingId, PAGE));
    const [other] = await db
      .select({ id: people.id })
      .from(people)
      .where(ne(people.id, staffId))
      .limit(1);
    await db
      .update(bookings)
      .set({ courseMaterialsDoneByPersonId: other?.id ?? null })
      .where(eq(bookings.id, bookingId));

    const result = await elearningCheckAction(
      shop.slug,
      tripId,
      null,
      check(bookingId, null, "undo"),
    );

    expect(result).toEqual({ ok: true, verdict: "already_done" });
    expect((await tick(db, bookingId))?.at).toBeInstanceOf(Date);
  });

  it("writes nothing when PADI shows the course unfinished, finds nobody, or cannot be read", async () => {
    const { db, shop, tripId, bookingId } = await context();
    const answers = [
      [`Lena Ortiz\t${EMAIL}\tAdvanced Open Water Diver Online\tIn Progress`, "not_complete"],
      ["No results found", "no_record"],
      ["Sign in to the PADI Pros' Site", "unreadable"],
    ] as const;
    for (const [page, verdict] of answers) {
      const result = await elearningCheckAction(shop.slug, tripId, null, check(bookingId, page));
      expect(result).toMatchObject({ ok: true, verdict });
    }
    expect((await tick(db, bookingId))?.at).toBeNull();
  });

  it("judges by the student on file, so another student's finished course ticks nothing", async () => {
    const { db, shop, tripId, bookingId } = await context();
    const page = "Sam Reyes\tsam@example.com\tAdvanced Open Water Diver Online\tComplete";

    const result = await elearningCheckAction(shop.slug, tripId, null, check(bookingId, page));

    expect(result).toEqual({ ok: true, verdict: "unreadable" });
    expect((await tick(db, bookingId))?.at).toBeNull();
  });

  it("refuses a course from an agency whose eLearning it does not read", async () => {
    const { db, shop, tripId, courseId, bookingId } = await context();
    await db.update(courses).set({ agency: "ssi" }).where(eq(courses.id, courseId));

    const result = await elearningCheckAction(shop.slug, tripId, null, check(bookingId, PAGE));

    expect(result).toEqual({ ok: false, reason: "invalid" });
    expect((await tick(db, bookingId))?.at).toBeNull();
  });

  it("refuses a seat on another departure, and a departure that teaches nothing", async () => {
    const { shop, tripId, bookingId, funDive } = await context();
    expect(
      await elearningCheckAction(shop.slug, funDive.tripId, null, check(bookingId, PAGE)),
    ).toEqual({ ok: false, reason: "invalid" });
    expect(
      await elearningCheckAction(shop.slug, tripId, null, check(funDive.bookingId, PAGE)),
    ).toEqual({ ok: false, reason: "invalid" });
    expect(
      await elearningCheckAction(shop.slug, funDive.tripId, null, check(funDive.bookingId, PAGE)),
    ).toEqual({ ok: false, reason: "invalid" });
  });

  it("refuses a post with no page text, or no booking", async () => {
    const { shop, tripId, bookingId } = await context();
    expect(await elearningCheckAction(shop.slug, tripId, null, check(bookingId, null))).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(await elearningCheckAction(shop.slug, tripId, null, check("nope", PAGE))).toEqual({
      ok: false,
      reason: "invalid",
    });
  });
});
