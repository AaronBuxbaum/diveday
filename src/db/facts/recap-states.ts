import { and, asc, eq, isNotNull, isNull, ne } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import { upsertExecutedDive } from "@/db/executed-dives";
import { MARINE_LIFE_CATALOG } from "@/db/marine-life-catalog";
import { issueShopCertification } from "@/db/readiness";
import { submitRecapPulse } from "@/db/recap-pulses";
import {
  bookings,
  courses,
  diveSiteCreatures,
  diveSites,
  recapPhotos,
  tripDives,
  trips,
} from "@/db/schema";
import { DEMO_RECAP_BOOKING_ID } from "@/db/seed";
import { listStaff } from "@/db/trips";
import { MINUTE_MS } from "@/lib/clock";
import { FactRefused } from "./refusal";

/**
 * **The demo recap's day, in the states only a crew's record can put it in.**
 * Each is a fact rather than a line in the seed for the reason AGENTS.md gives
 * for the trouble states: the calm variant is the one the demo should be, and
 * it is already photographed (`recap` captures the page with no
 * `executed_dives` row at all, which is what most days look like). A demo whose
 * every recap announced a turtle would be a worse demo, and would hide the
 * point: each line appears *because somebody wrote it down*.
 *
 * Every write goes through the product's own writer (`upsertExecutedDive`,
 * `issueShopCertification`, `submitRecapPulse`), so the row is one the product
 * could have produced, and every read carries the shop on the pinned booking,
 * not only the demo gate in front of it (issue #1812). They exist only on the
 * canonical demo, whose recap booking id is a seed constant.
 */
async function recapBooking(db: AppDb, shopId: string) {
  const [booking] = await db
    .select({
      id: bookings.id,
      tripId: bookings.tripId,
      personId: bookings.personId,
      startsAt: trips.startsAt,
    })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(bookings.id, DEMO_RECAP_BOOKING_ID),
        eq(bookings.shopId, shopId),
        eq(trips.shopId, shopId),
      ),
    )
    .limit(1);
  if (!booking) throw new FactRefused("no_booking", 404);
  return booking;
}

async function firstStaff(db: AppDb, shopId: string) {
  const [staff] = await listStaff(db, shopId);
  if (!staff) throw new FactRefused("no_staff", 404);
  return staff.person.id;
}

async function plannedFirstSite(db: AppDb, tripId: string) {
  const [planned] = await db
    .select({ diveSiteId: tripDives.diveSiteId })
    .from(tripDives)
    .where(and(eq(tripDives.tripId, tripId), eq(tripDives.diveNumber, 1)))
    .limit(1);
  return planned?.diveSiteId ?? null;
}

/**
 * **A course session that certified its diver** (`certifiedRecap`), so the
 * dive record's "Certified" line has something to render (fourth review, item
 * 55). The card goes through the roster's own Certify door; the one step no
 * writer takes is turning the pinned reef boat into an Advanced Open Water
 * session, because building a second sailed departure would photograph a
 * different day.
 */
export async function certifyTheRecapDiver(db: AppDb, shopId: string) {
  const booking = await recapBooking(db, shopId);
  const [course] = await db
    .select({ id: courses.id })
    .from(courses)
    .where(and(eq(courses.shopId, shopId), eq(courses.title, "Advanced Open Water Diver")))
    .limit(1);
  if (!course) throw new FactRefused("no_course", 404);
  await db
    .update(trips)
    .set({ courseId: course.id })
    .where(and(eq(trips.id, booking.tripId), eq(trips.shopId, shopId)));
  const card = await issueShopCertification(db, {
    shopId,
    personId: booking.personId,
    tripId: booking.tripId,
    level: "advanced_open_water",
    issuedByPersonId: await firstStaff(db, shopId),
  });
  if (!card) throw new FactRefused("not_issued");
}

/**
 * **The first dive recorded somewhere the plan did not name**
 * (`changedDiveSite`), so "planned versus lived" has something to compare
 * (issue #1191). The comparison only fires on a named plan meeting a named
 * record, so a trip whose first leg was left blank cannot produce it.
 */
export async function diveTheRecapSomewhereElse(db: AppDb, shopId: string) {
  const booking = await recapBooking(db, shopId);
  const planned = await plannedFirstSite(db, booking.tripId);
  const [elsewhere] = await db
    .select({ id: diveSites.id, name: diveSites.name })
    .from(diveSites)
    .where(
      and(
        eq(diveSites.shopId, shopId),
        isNull(diveSites.deletedAt),
        planned ? ne(diveSites.id, planned) : undefined,
      ),
    )
    .orderBy(diveSites.name)
    .limit(1);
  if (!planned || !elsewhere) throw new FactRefused("no_other_site");
  const result = await upsertExecutedDive(db, {
    shopId,
    tripId: booking.tripId,
    diveNumber: 1,
    actualSiteId: elsewhere.id,
    recordedByPersonId: await firstStaff(db, shopId),
  });
  if (!result.ok) throw new FactRefused(result.reason);
  return { actualSite: elsewhere.name };
}

/**
 * **One species the crew saw** on the first dive (`observedSpecies`), so "Seen
 * on the day" renders (issue #1190). Recorded at the planned site, and off the
 * site's guide on purpose: a sighting is worth recording because it was not the
 * usual. Deliberately not folded into `changedDiveSite`: most days that turn up
 * a turtle go exactly where they meant to.
 */
export async function recordASightingOnTheRecap(db: AppDb, shopId: string) {
  const booking = await recapBooking(db, shopId);
  const planned = await plannedFirstSite(db, booking.tripId);
  if (!planned) throw new FactRefused("no_planned_site");
  const listed = await db
    .select({ slug: diveSiteCreatures.catalogSlug })
    .from(diveSiteCreatures)
    .where(and(eq(diveSiteCreatures.shopId, shopId), eq(diveSiteCreatures.diveSiteId, planned)));
  const guide = new Set(listed.map((row) => row.slug));
  const species = MARINE_LIFE_CATALOG.map((entry) => entry.slug).find((slug) => !guide.has(slug));
  if (!species) throw new FactRefused("no_species");
  const result = await upsertExecutedDive(db, {
    shopId,
    tripId: booking.tripId,
    diveNumber: 1,
    actualSiteId: planned,
    observedSpeciesSlug: species,
    recordedByPersonId: await firstStaff(db, shopId),
  });
  if (!result.ok) throw new FactRefused(result.reason);
  return { species };
}

/**
 * **Every planned dive logged with a time in and out** (`diveTimes`), so the
 * fly-safe line has a last exit to count from (`src/lib/fly-safe.ts`, issue
 * #1425). Each at its planned site, laid out from the departure's own start:
 * the first dive an hour in, fifty minutes each, an hour's surface interval
 * between, the shape of a two-tank morning and not a claim about any real one.
 */
export async function timeEveryRecapDive(db: AppDb, shopId: string) {
  const booking = await recapBooking(db, shopId);
  const planned = await db
    .select({ diveNumber: tripDives.diveNumber, diveSiteId: tripDives.diveSiteId })
    .from(tripDives)
    .where(eq(tripDives.tripId, booking.tripId))
    .orderBy(asc(tripDives.diveNumber));
  if (planned.length === 0) throw new FactRefused("no_planned_dives");
  const recordedBy = await firstStaff(db, shopId);
  let cursor = booking.startsAt.getTime() + 60 * MINUTE_MS;
  const recorded: Array<{ diveNumber: number; exitedAt: string }> = [];
  for (const dive of planned) {
    const enteredAt = new Date(cursor);
    const exitedAt = new Date(cursor + 50 * MINUTE_MS);
    const result = await upsertExecutedDive(db, {
      shopId,
      tripId: booking.tripId,
      diveNumber: dive.diveNumber,
      actualSiteId: dive.diveSiteId,
      enteredAt,
      exitedAt,
      recordedByPersonId: recordedBy,
    });
    if (!result.ok) throw new FactRefused(result.reason);
    recorded.push({ diveNumber: dive.diveNumber, exitedAt: exitedAt.toISOString() });
    cursor = exitedAt.getTime() + 60 * MINUTE_MS;
  }
  return { tripId: booking.tripId, recorded };
}

/**
 * **One open private pulse** on the recap booking (`recapPulse`, D40, issue
 * #1200): two categories and a note, the shape a real one arrives in. The words
 * are fixture text and stay here; nothing in the product renders them but the
 * panel this photographs.
 */
export async function fileAPulseOnTheRecap(db: AppDb, shopId: string) {
  const booking = await recapBooking(db, shopId);
  const result = await submitRecapPulse(db, {
    bookingId: booking.id,
    categories: ["gear", "briefing"],
    note: "The BCD inflator stuck twice and nobody mentioned the current on the north end.",
  });
  if (!result.ok) throw new FactRefused(result.reason);
}

/**
 * **The recap diver's own first photo, shared with the boat**
 * (`sharedRecapPhoto`, H-20261014-share-photo-with-boat, issue #2806), by
 * setting the one column the upload tick sets (ADR 20261016-shared-boat-photos
 * §1), so the recap shows the sharer's "Stop sharing".
 */
export async function shareTheRecapPhoto(db: AppDb, shopId: string, now: Date) {
  const booking = await recapBooking(db, shopId);
  const [photo] = await db
    .select({ id: recapPhotos.id })
    .from(recapPhotos)
    .where(and(eq(recapPhotos.bookingId, booking.id), eq(recapPhotos.shopId, shopId)))
    .orderBy(asc(recapPhotos.createdAt))
    .limit(1);
  if (!photo) throw new FactRefused("no_photo", 404);
  await db
    .update(recapPhotos)
    .set({ sharedWithBoatAt: now })
    .where(and(eq(recapPhotos.id, photo.id), eq(recapPhotos.shopId, shopId)));
}

/**
 * **Which booking holds the photo another diver shared during seeding**
 * (`secondarySharedPhoto`): writes nothing, and answers the booking id so a
 * spec can open that recap from the receiving side.
 */
export async function findTheOtherSharedPhoto(db: AppDb, shopId: string) {
  const [photo] = await db
    .select({ bookingId: recapPhotos.bookingId })
    .from(recapPhotos)
    .where(
      and(
        eq(recapPhotos.shopId, shopId),
        ne(recapPhotos.bookingId, DEMO_RECAP_BOOKING_ID),
        isNotNull(recapPhotos.sharedWithBoatAt),
      ),
    )
    .limit(1);
  if (!photo) throw new FactRefused("no_secondary_photo", 404);
  return { bookingId: photo.bookingId };
}
