import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { createBooking } from "./bookings";
import { readCertificationEvidence } from "./certification-evidence";
import { bookedDepartures, nextDiveForBooking } from "./next-dive";
import { createCertification, upsertTripRequirements } from "./readiness";
import { bookings, certifications, courses, people, tripAssignments, trips } from "./schema";
import { createTripLens } from "./trip-lenses";
import { createTrip, listStaff } from "./trips";

// Spied rather than replaced: every case below still needs the real reads, and
// the one thing being asserted is how many times they happen.
vi.mock("./certification-evidence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./certification-evidence")>();
  return { ...actual, readCertificationEvidence: vi.fn(actual.readCertificationEvidence) };
});

/**
 * **The recap never points a diver at a boat they cannot board** (D35, issue
 * #1195) — and the rest of what this reader has to be true about the board it
 * reads: public, live, still ahead of the one-hour buffer, and holding a seat.
 *
 * The rules that pick *which* of the survivors wins live in
 * `src/lib/next-dive.ts` and are pinned there against plain values. What is
 * only checkable against a database is the filtering, and that is what these
 * cases are.
 *
 * Every trip is created in 2030 and every read is given a 2030 clock, so the
 * demo shop's own seeded board — anchored to the real now — is entirely in the
 * past and cannot answer for a case this file did not build.
 */

const NOW = new Date("2030-06-01T12:00:00Z");
const AT = (hoursFromNow: number) => new Date(NOW.getTime() + hoursFromNow * 60 * 60 * 1000);

async function boardContext() {
  const { db, shop } = ctx;
  const [diver] = await db
    .select({ id: people.id })
    .from(people)
    .where(eq(people.shopId, shop.id))
    .limit(1);
  if (!diver) throw new Error("seeded person missing");
  return { db, shop, diverId: diver.id };
}

async function departure(
  db: Awaited<ReturnType<typeof boardContext>>["db"],
  shopId: string,
  input: {
    title: string;
    startsAt: Date;
    capacity?: number;
    isPrivate?: boolean;
    lensId?: string | null;
    diveSiteId?: string;
  },
) {
  const trip = await createTrip(db, {
    shopId,
    title: input.title,
    ...(input.lensId === undefined ? {} : { lensId: input.lensId }),
    ...(input.diveSiteId === undefined ? {} : { dives: [{ diveSiteId: input.diveSiteId }] }),
    startsAt: input.startsAt,
    endsAt: new Date(input.startsAt.getTime() + 4 * 60 * 60 * 1000),
    capacity: input.capacity ?? 6,
    plannedDives: 2,
    isPrivate: input.isPrivate ?? false,
  });
  if (!trip) throw new Error(`trip "${input.title}" not created`);
  return trip;
}

const day = (justDivedTripId: string) => ({
  justDivedTripId,
  dayCourseId: null,
  dayShoutout: null,
  daySiteNames: [] as string[],
  dayLensId: null as string | null,
  now: NOW,
});

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`); nothing here commits or races.
const ctx = fileScopedShopContext();

describe("nextDiveForBooking", () => {
  it("returns null when the board ahead is empty", async () => {
    const { db, shop, diverId } = await boardContext();
    const pick = await nextDiveForBooking(db, {
      shopId: shop.id,
      personId: diverId,
      ...day("00000000-0000-0000-0000-0000000000ff"),
    });
    expect(pick).toBeNull();
  });

  it("takes the soonest public departure with a seat", async () => {
    const { db, shop, diverId } = await boardContext();
    await departure(db, shop.id, { title: "Later reef", startsAt: AT(72) });
    const soon = await departure(db, shop.id, { title: "Sooner reef", startsAt: AT(24) });

    const pick = await nextDiveForBooking(db, {
      shopId: shop.id,
      personId: diverId,
      ...day("00000000-0000-0000-0000-0000000000ff"),
    });
    expect(pick).toMatchObject({ tripId: soon.id, title: "Sooner reef", seatsLeft: 6 });
  });

  it("never offers a private charter", async () => {
    const { db, shop, diverId } = await boardContext();
    await departure(db, shop.id, { title: "Private charter", startsAt: AT(24), isPrivate: true });
    const open = await departure(db, shop.id, { title: "Open reef", startsAt: AT(48) });

    const pick = await nextDiveForBooking(db, {
      shopId: shop.id,
      personId: diverId,
      ...day("00000000-0000-0000-0000-0000000000ff"),
    });
    expect(pick?.tripId).toBe(open.id);
  });

  it("never offers a departure the shop has taken off the board", async () => {
    const { db, shop, diverId } = await boardContext();
    const gone = await departure(db, shop.id, { title: "Deleted reef", startsAt: AT(24) });
    const open = await departure(db, shop.id, { title: "Open reef", startsAt: AT(48) });
    await db.update(trips).set({ deletedAt: NOW }).where(eq(trips.id, gone.id));

    const pick = await nextDiveForBooking(db, {
      shopId: shop.id,
      personId: diverId,
      ...day("00000000-0000-0000-0000-0000000000ff"),
    });
    expect(pick?.tripId).toBe(open.id);
  });

  it("never offers the departure the diver just came home from", async () => {
    const { db, shop, diverId } = await boardContext();
    // Ahead of the clock and soonest of the two — and still not the pick, because
    // "the thing you have just done" is never a next dive.
    const justDived = await departure(db, shop.id, { title: "Today again", startsAt: AT(24) });
    const other = await departure(db, shop.id, { title: "Something else", startsAt: AT(48) });

    const pick = await nextDiveForBooking(db, {
      shopId: shop.id,
      personId: diverId,
      ...day(justDived.id),
    });
    expect(pick?.tripId).toBe(other.id);
  });

  /**
   * **D35's floor.** A departure demanding a card this diver does not hold is
   * dropped before the ranking sees it — not softened, not annotated. The same
   * gate `createBookingRecord` runs, so the card can never send somebody to a
   * checkout that would refuse them.
   */
  it("drops a departure demanding a level the diver has not reached, and keeps it once they have", async () => {
    const { db, shop, diverId } = await boardContext();
    const advanced = await departure(db, shop.id, { title: "Deep wreck", startsAt: AT(24) });
    const anyone = await departure(db, shop.id, { title: "Shallow reef", startsAt: AT(48) });
    await upsertTripRequirements(db, {
      shopId: shop.id,
      tripId: advanced.id,
      requiresWaiver: false,
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: [],
      requiresNitrox: false,
      requiresPayment: false,
    });
    await createCertification(db, {
      shopId: shop.id,
      personId: diverId,
      agency: "padi",
      level: "open_water",
      identifier: "OW-1",
    });

    const openWater = await nextDiveForBooking(db, {
      shopId: shop.id,
      personId: diverId,
      ...day("00000000-0000-0000-0000-0000000000ff"),
    });
    expect(openWater?.tripId).toBe(anyone.id);
    // The level it states is the shallow reef's own — every charter created
    // through `createTrip` starts at Open Water (src/db/trips-create.ts) — and
    // this diver holds it, which is why the card may say so.
    expect(openWater?.levelCovered).toBe("open_water");

    await createCertification(db, {
      shopId: shop.id,
      personId: diverId,
      agency: "padi",
      level: "advanced_open_water",
      identifier: "AOW-1",
    });
    const nowAdvanced = await nextDiveForBooking(db, {
      shopId: shop.id,
      personId: diverId,
      ...day("00000000-0000-0000-0000-0000000000ff"),
    });
    expect(nowAdvanced).toMatchObject({
      tripId: advanced.id,
      levelCovered: "advanced_open_water",
    });
  });

  /**
   * Twelve candidates is twelve chances to ask the same question about one
   * diver. The answer is a fact about them, not about any trip, so it is read
   * once — a regression here is thirty-six queries on a keepsake page.
   */
  it("reads the diver's certification evidence once, not once per candidate", async () => {
    const { db, shop, diverId } = await boardContext();
    for (const hours of [24, 48, 72, 96]) {
      await departure(db, shop.id, { title: `Reef +${hours}`, startsAt: AT(hours) });
    }
    vi.mocked(readCertificationEvidence).mockClear();
    await nextDiveForBooking(db, {
      shopId: shop.id,
      personId: diverId,
      ...day("00000000-0000-0000-0000-0000000000ff"),
    });
    expect(readCertificationEvidence).toHaveBeenCalledTimes(1);
  });
});

/**
 * **Never a seat they already hold** (fifth-loop ideas, item 37). A recap that
 * offers "Back to the reef" on a departure the diver is already booked on reads
 * as the shop not knowing its own book.
 */
describe("a departure the diver already holds a seat on", () => {
  async function seat(
    db: Awaited<ReturnType<typeof boardContext>>["db"],
    shopId: string,
    tripId: string,
    personId: string,
    status: "booked" | "cancelled" = "booked",
  ) {
    await db.insert(bookings).values({ shopId, tripId, personId, bookedAs: "diver", status });
  }

  it("is never the next dive, and the next open departure is", async () => {
    const { db, shop, diverId } = await boardContext();
    const held = await departure(db, shop.id, { title: "Booked reef", startsAt: AT(24) });
    const open = await departure(db, shop.id, { title: "Open reef", startsAt: AT(48) });
    await seat(db, shop.id, held.id, diverId);

    const pick = await nextDiveForBooking(db, {
      shopId: shop.id,
      personId: diverId,
      ...day("00000000-0000-0000-0000-0000000000ff"),
    });
    expect(pick?.tripId).toBe(open.id);
  });

  it("lists held seats soonest first, leaving out a canceled seat, a past day and the excluded trip", async () => {
    const { db, shop, diverId } = await boardContext();
    const later = await departure(db, shop.id, { title: "Later", startsAt: AT(72) });
    const sooner = await departure(db, shop.id, { title: "Sooner", startsAt: AT(24) });
    const canceled = await departure(db, shop.id, { title: "Canceled", startsAt: AT(30) });
    const past = await departure(db, shop.id, { title: "Past", startsAt: AT(-48) });
    const today = await departure(db, shop.id, { title: "Today", startsAt: AT(2) });
    await seat(db, shop.id, later.id, diverId);
    await seat(db, shop.id, sooner.id, diverId);
    await seat(db, shop.id, canceled.id, diverId, "cancelled");
    await seat(db, shop.id, past.id, diverId);
    await seat(db, shop.id, today.id, diverId);

    const held = await bookedDepartures(db, {
      shopId: shop.id,
      personId: diverId,
      now: NOW,
      excludeTripId: today.id,
    });
    expect(held.map((row) => row.title)).toEqual(["Sooner", "Later"]);
  });

  it("leaves out a held seat, which may be someone else's (dive-domain review r5-4, fix 5)", async () => {
    const { db, shop, diverId } = await boardContext();
    const guessed = await departure(db, shop.id, { title: "Guessed", startsAt: AT(24) });
    await db.insert(bookings).values({
      shopId: shop.id,
      tripId: guessed.id,
      personId: diverId,
      bookedAs: "diver",
      identityUnconfirmedAt: NOW,
      identityBookedAs: "N. Q.",
    });

    expect(await bookedDepartures(db, { shopId: shop.id, personId: diverId, now: NOW })).toEqual(
      [],
    );
  });
});

describe("nextDiveForBooking — a diver in training (issue #2058)", () => {
  /**
   * The card points where the booking door would sell: a departure after a
   * course the diver is booked on, which certifies its level, is offered; one
   * before the course ends is not. Same `inTrainingBefore` window as the sale.
   */
  it("offers a departure after the booked course that reaches its level, and never one before it", async () => {
    const { db, shop } = ctx;
    const [course] = await db
      .select()
      .from(courses)
      .where(
        and(
          eq(courses.shopId, shop.id),
          eq(courses.sourceTemplateSlug, "advanced-open-water-diver"),
        ),
      )
      .limit(1);
    if (!course) throw new Error("seeded Advanced course missing");
    const instructor = (await listStaff(db, shop.id)).find((entry) =>
      entry.roles.includes("instructor"),
    );
    if (!instructor) throw new Error("seeded instructor missing");

    // An Open Water diver the shop has verified, so admission reads their card.
    const [diver] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Ines Duarte", email: "ines.duarte@example.com" })
      .returning({ id: people.id });
    if (!diver) throw new Error("person insert failed");
    await createCertification(db, {
      shopId: shop.id,
      personId: diver.id,
      agency: "padi",
      level: "open_water",
      identifier: "OW-ID",
    });
    await db
      .update(certifications)
      .set({ status: "verified" })
      .where(eq(certifications.personId, diver.id));

    // A private session, so the card does not suggest the course itself.
    const session = await createTrip(db, {
      shopId: shop.id,
      courseId: course.id,
      title: "Advanced session",
      startsAt: AT(30),
      endsAt: AT(38),
      capacity: 6,
      isPrivate: true,
    });
    if (!session) throw new Error("session not created");
    await db.insert(tripAssignments).values({ tripId: session.id, personId: instructor.person.id });
    const enrolled = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: session.id,
      personId: diver.id,
    });
    if (!enrolled.ok) throw new Error(`course booking refused: ${enrolled.reason}`);

    const advancedOnly = async (title: string, startsAt: Date) => {
      const trip = await departure(db, shop.id, { title, startsAt });
      await upsertTripRequirements(db, {
        shopId: shop.id,
        tripId: trip.id,
        requiresWaiver: false,
        minimumCertificationLevel: "advanced_open_water",
        requiredSpecialties: [],
        requiresNitrox: false,
        requiresPayment: false,
      });
      return trip;
    };
    // Sails mid-course: the course has not got them there.
    await advancedOnly("Wall, mid-course", AT(34));
    const pick = await nextDiveForBooking(db, {
      shopId: shop.id,
      personId: diver.id,
      ...day("00000000-0000-0000-0000-0000000000ff"),
    });
    expect(pick).toBeNull();

    const after = await advancedOnly("Wall, after the course", AT(60));
    expect(
      await nextDiveForBooking(db, {
        shopId: shop.id,
        personId: diver.id,
        ...day("00000000-0000-0000-0000-0000000000ff"),
      }),
    ).toMatchObject({ tripId: after.id });
  });
});

describe("nextDiveForBooking — the shop's own word for a kind of day (#1408)", () => {
  /**
   * `same_lens` is the one reason whose fact lives on a *second* table, so it
   * is the one the database half can get wrong on its own: the rules in
   * `src/lib/next-dive.ts` are proven against plain values, and what is only
   * checkable here is that the sailed day's `lens_id` and each candidate's
   * both actually arrive, and that the word the sentence needs is read.
   */
  it("prefers a departure wearing the day's lens over a bare site match", async () => {
    const { db, shop, diverId } = await boardContext();
    const lens = await createTripLens(db, shop.id, "easygoing reef");
    if (!lens) throw new Error("lens not created");

    // The site match is sooner, so only precedence can put the lens first.
    await departure(db, shop.id, { title: "French Reef again", startsAt: AT(24) });
    const lensed = await departure(db, shop.id, {
      title: "Another easy day",
      startsAt: AT(48),
      lensId: lens.id,
    });

    const pick = await nextDiveForBooking(db, {
      shopId: shop.id,
      personId: diverId,
      ...day("00000000-0000-0000-0000-0000000000ff"),
      daySiteNames: ["French Reef"],
      dayLensId: lens.id,
    });
    expect(pick).toMatchObject({
      tripId: lensed.id,
      reason: "same_lens",
      reasonLens: "easygoing reef",
    });
  });

  it("gives no lens reason when the day wore none", async () => {
    const { db, shop, diverId } = await boardContext();
    const lens = await createTripLens(db, shop.id, "easygoing reef");
    if (!lens) throw new Error("lens not created");
    const lensed = await departure(db, shop.id, {
      title: "Another easy day",
      startsAt: AT(24),
      lensId: lens.id,
    });

    const pick = await nextDiveForBooking(db, {
      shopId: shop.id,
      personId: diverId,
      ...day("00000000-0000-0000-0000-0000000000ff"),
      dayLensId: null,
    });
    expect(pick).toMatchObject({ tripId: lensed.id, reason: "soonest_with_room" });
    expect(pick?.reasonLens).toBeUndefined();
  });
});
