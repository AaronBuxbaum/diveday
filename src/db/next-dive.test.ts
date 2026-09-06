import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { seededShopContext } from "@/test/db";
import { readCertificationEvidence } from "./certification-evidence";
import { nextDiveForBooking } from "./next-dive";
import { createCertification, upsertTripRequirements } from "./readiness";
import { people, trips } from "./schema";
import { createTripLens } from "./trip-lenses";
import { createTrip } from "./trips";

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
  const { db, shop } = await seededShopContext();
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
    ...(input.diveSiteId === undefined ? {} : { diveSiteId: input.diveSiteId }),
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
    const sited = await departure(db, shop.id, { title: "French Reef again", startsAt: AT(24) });
    await db.update(trips).set({ diveSiteId: null }).where(eq(trips.id, sited.id));
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
