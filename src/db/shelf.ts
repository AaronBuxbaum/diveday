import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import type { CertificationAgency } from "@/db/schema";
import type { BrandDisplayFontCode } from "@/lib/brand";
import type { CertificationLevel } from "@/lib/certification-levels";
import { nowDate } from "@/lib/clock";
import type { NextDivePick } from "@/lib/next-dive";
import { signRecapToken } from "@/lib/recap-links";
import { hasReturned } from "@/lib/trips";
import { shopWaiverStatus } from "@/lib/waivers";
import type { AppDb } from "./client";
import { nextDiveForBooking } from "./next-dive";
import {
  boats,
  bookings,
  buddyPairMembers,
  certifications,
  people,
  rentalFitProfiles,
  shops,
  trips,
} from "./schema";
import { liveTrip } from "./trips-live";
import { pagedUpcomingTripsWithCounts, tripDiveSiteSummaries } from "./trips-queries";
import { getCurrentWaiverTemplate, listSignedWaiversByPerson } from "./waivers";

/**
 * **Everything the diver's shelf renders, and deliberately nothing else.**
 *
 * The shape below is the security boundary, not a convenience. `/shelf/[token]`
 * is a bearer surface a diver may leave open on a phone somebody else picks
 * up, so what it can show is decided **here**, by what this reader is able to
 * return, rather than by what the page happens to render today.
 *
 * Three things are absent by construction, and each is asserted in
 * `shelf.test.ts` against the live shape rather than trusted to review:
 *
 * - **No medical answer, ever.** Not the questionnaire, not a hold's reason,
 *   not a physician's verdict, not the word for any of them. `ShelfWaiver`
 *   below collapses every medical standing into one code that says the shop is
 *   looking at it and stops — which is true, is the diver's own next step, and
 *   discloses nothing a stranger holding the phone could read as a diagnosis.
 * - **No other diver.** Not a name, not a contact, not a seat. The buddy row
 *   carries a count and the departure it is for; see `ShelfBuddyTeam`.
 * - **No money.** No price, no balance, no refund, no tip. A shelf is a file,
 *   not an account, and a price on it is a thing to argue with rather than a
 *   reason to come back.
 *
 * Everything here belongs to the person the token names, at the shop the token
 * names. There is no path through this module that reads either from a caller.
 */

/** The shop's own face, for the shelf's chrome. Public facts only. */
export type ShelfShop = {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  defaultLocale: string;
  brandColor: string | null;
  brandDisplayFont: BrandDisplayFontCode | null;
  logoUrl: string | null;
};

/** A departure this diver holds a seat on. */
export type ShelfDeparture = {
  bookingId: string;
  tripId: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
};

/**
 * The same boat, next time — a departure with seats on the boat or in the
 * series the diver last dived. Never a price and never a head count: how full
 * it is is the trip page's answer, one tap away.
 */
export type ShelfSameBoat = {
  tripId: string;
  title: string;
  startsAt: Date;
  /** Which of the two rules matched, so the surface can say why it is this one. */
  because: "boat" | "series";
  /** The boat's own name when the match was the boat, for the sentence. */
  boatName: string | null;
};

/** A day this diver dived with this shop, and the recap if there is one to read. */
export type ShelfPastDive = {
  bookingId: string;
  tripId: string;
  title: string;
  startsAt: Date;
  siteNames: string[];
  /**
   * The diver's own recap, or null when the trip sailed and no recap page
   * exists for it — a cancelled seat, a no-show, a departure called off. The
   * path carries a signed recap token, which is the same credential the recap
   * email carries and is scoped to this booking alone.
   */
  recapPath: string | null;
};

/** What the shop holds about this diver's card. Never an image, never a number. */
export type ShelfCertification =
  | { state: "none" }
  /** On file and not yet checked against the plastic. */
  | { state: "on_file"; level: CertificationLevel; agency: CertificationAgency }
  /** Checked by a person, who is named, on a day that is named. */
  | {
      state: "verified";
      level: CertificationLevel;
      agency: CertificationAgency;
      verifiedAt: Date;
      /** The staffer who sighted it, or null for a card imported already verified. */
      verifiedBy: string | null;
    };

/**
 * Where the release stands, **without a medical vocabulary**.
 *
 * `shopWaiverStatus` returns six states and three of them are about a health
 * disclosure. Those three collapse to `with_the_shop` here, on purpose: the
 * diver's next step is identical in all three (nothing — the shop is working
 * it), and the difference between "a hold is open" and "a physician said no"
 * is a medical fact that has no business rendering on a page a stranger can
 * open. The two the diver *can* act on stay distinct, because they are the
 * only ones where a sentence changes what they do.
 */
export type ShelfWaiver =
  | { state: "signed"; signedAt: Date; expiresAt: Date }
  /** None on file, aged out, or a minor's solo signature: the diver signs again. */
  | { state: "needs_signing" }
  /** Signed, and the shop is looking at it. Nothing for the diver to do. */
  | { state: "with_the_shop" };

/** The sizes the shop has, which the diver may correct here. */
export type ShelfSizes = {
  bcdSize: string | null;
  wetsuitSize: string | null;
  bootSize: string | null;
  finSize: string | null;
};

/**
 * The diver's buddy team on their next departure — **as a count, never as
 * names**.
 *
 * The team is a fact about this diver, so it belongs on their file. Its other
 * members are not: a shelf link is a URL on a phone, and no shipped
 * diver-facing surface names another diver at all. So the row says how many
 * are on the team and which day it is for, which is what a diver checking their
 * own file wants to know, and names nobody.
 */
export type ShelfBuddyTeam = { size: number; tripId: string; startsAt: Date };

export type ShelfFile = {
  certification: ShelfCertification;
  waiver: ShelfWaiver;
  sizes: ShelfSizes;
  buddyTeam: ShelfBuddyTeam | null;
  /** Whether one is on file. Never the name, never the number. */
  emergencyContactOnFile: boolean;
};

export type ShelfPageData = {
  shop: ShelfShop;
  diver: { firstName: string; fullName: string };
  /** How many days this diver has dived with this shop, boarded and behind them. */
  diveCount: number;
  next: ShelfDeparture | null;
  sameBoat: ShelfSameBoat | null;
  /** The crew's "next time", ranked from the day just dived. Null when there is none. */
  nextTime: NextDivePick | null;
  dives: ShelfPastDive[];
  file: ShelfFile;
};

/**
 * How far back the rail of recap fronts reads. A season and a half of two-tank
 * weekends, which is more days than anybody scrolls, and bounded so a diver
 * with four hundred visits does not render four hundred cards
 * (`.claude/rules/e2e.md`: bound the page, not the capture).
 */
export const SHELF_DIVE_LIMIT = 24;

/**
 * How far down the board "same boat, next time" looks. Four weeks of a busy
 * shop; past it there is no useful "next time" to name and the storefront's own
 * week is the better answer.
 */
const SAME_BOAT_WINDOW = 40;

/**
 * The shelf, for the person and shop a verified token named.
 *
 * Both ids come from `verifyShelfToken` and never from a URL, a form or a
 * cookie, so every query below is already inside one tenant and one person; the
 * `shopId` on each `where` is defence in depth rather than the boundary.
 *
 * Returns null for a person the shop no longer has — the same answer an unknown
 * token gets, so the page has one dead-end rather than two.
 *
 * The shelf is lever Z of ADR 20260908-one-hand, decision 6 (slice 20t); what
 * it may show is decided here and nowhere downstream.
 */
export async function getShelfPageData(
  db: AppDb,
  input: { shopId: string; personId: string; now?: Date },
): Promise<ShelfPageData | null> {
  const now = input.now ?? nowDate();
  const { shopId, personId } = input;

  const [row] = await db
    .select({
      shop: {
        id: shops.id,
        slug: shops.slug,
        name: shops.name,
        timezone: shops.timezone,
        defaultLocale: shops.defaultLocale,
        brandColor: shops.brandColor,
        brandDisplayFont: shops.brandDisplayFont,
        logoUrl: shops.logoUrl,
      },
      fullName: people.fullName,
      emergencyContactName: people.emergencyContactName,
      emergencyContactPhone: people.emergencyContactPhone,
    })
    .from(people)
    .innerJoin(shops, eq(shops.id, people.shopId))
    .where(
      and(
        eq(people.id, personId),
        eq(people.shopId, shopId),
        isNull(people.deletedAt),
        isNull(people.anonymizedAt),
        isNull(people.mergedIntoPersonId),
      ),
    )
    .limit(1);
  if (!row) return null;

  // Every seat this diver holds at this shop that still counts, newest first
  // for the past and soonest first for the future. One read: a diver's whole
  // history here is bounded by how many times they have been out, and the two
  // halves are split in memory rather than by two round trips.
  const seats = await db
    .select({
      bookingId: bookings.id,
      tripId: trips.id,
      title: trips.title,
      startsAt: trips.startsAt,
      endsAt: trips.endsAt,
      tripStatus: trips.status,
      bookingStatus: bookings.status,
      boatId: trips.boatId,
      seriesId: trips.seriesId,
      courseId: trips.courseId,
      lensId: trips.lensId,
      recapShoutout: trips.recapShoutout,
    })
    .from(bookings)
    .innerJoin(trips, and(eq(trips.id, bookings.tripId), liveTrip()))
    .where(
      and(
        eq(bookings.shopId, shopId),
        eq(bookings.personId, personId),
        ne(bookings.status, "cancelled"),
      ),
    )
    .orderBy(desc(trips.startsAt))
    .limit(200);

  // **The one-hour buffer, through `hasReturned`** — never a hand comparison
  // (`.claude/rules/domain.md`). A boat that said it would be back at four and
  // is not yet an hour late is still out, and its day is not a memory.
  const past = seats.filter(
    (seat) => hasReturned(seat.endsAt, now) && seat.tripStatus === "scheduled",
  );
  const ahead = [...seats]
    .filter((seat) => !hasReturned(seat.endsAt, now) && seat.tripStatus === "scheduled")
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

  const next = ahead[0]
    ? {
        bookingId: ahead[0].bookingId,
        tripId: ahead[0].tripId,
        title: ahead[0].title,
        startsAt: ahead[0].startsAt,
        endsAt: ahead[0].endsAt,
      }
    : null;

  // A day only counts once it is behind the diver, and only if they were on
  // it: `no_show` is the seat that never boarded, and counting it would tell a
  // diver they dived on a day they missed.
  const dived = past.filter((seat) => seat.bookingStatus !== "no_show");
  const lastDived = dived[0] ?? null;

  const railSeats = dived.slice(0, SHELF_DIVE_LIMIT);
  const siteSummaries = await tripDiveSiteSummaries(
    db,
    shopId,
    railSeats.map((seat) => seat.tripId),
  );
  const dives: ShelfPastDive[] = railSeats.map((seat) => ({
    bookingId: seat.bookingId,
    tripId: seat.tripId,
    title: seat.title,
    startsAt: seat.startsAt,
    siteNames: (siteSummaries.get(seat.tripId)?.sites ?? []).map((site) => site.name),
    // The same three conditions `getRecapPageState` reads: an active seat, on a
    // departure that was not called off, that has come home. Signed rather than
    // looked up, exactly as the recap email's own link is.
    recapPath: `/recap/${signRecapToken(seat.bookingId)}`,
  }));

  const [sameBoat, nextTime, file] = await Promise.all([
    lastDived ? findSameBoat(db, shopId, lastDived, now) : Promise.resolve(null),
    lastDived
      ? nextDiveForBooking(db, {
          shopId,
          personId,
          justDivedTripId: lastDived.tripId,
          dayCourseId: lastDived.courseId,
          dayShoutout: lastDived.recapShoutout,
          daySiteNames: (siteSummaries.get(lastDived.tripId)?.sites ?? []).map((s) => s.name),
          dayLensId: lastDived.lensId,
          now,
        })
      : Promise.resolve(null),
    readShelfFile(db, { shopId, personId, fullName: row.fullName, next, now }),
  ]);

  return {
    shop: row.shop,
    diver: { firstName: firstNameOf(row.fullName), fullName: row.fullName },
    diveCount: dived.length,
    next,
    sameBoat,
    nextTime,
    dives,
    file: {
      ...file,
      emergencyContactOnFile: Boolean(row.emergencyContactName || row.emergencyContactPhone),
    },
  };
}

/**
 * The next public departure with seats on the same boat, or failing that in the
 * same series, as the day just dived.
 *
 * The boat first, because "same boat" is the thing a diver recognises — the
 * crew, the ladder, the shade. The series second, because a shop that runs one
 * boat has no distinguishing boat and its Saturday reef trip is the thing that
 * repeats. Null when neither matches inside the window, which is the honest
 * answer for a shop whose board is one-offs.
 */
async function findSameBoat(
  db: AppDb,
  shopId: string,
  lastDived: { tripId: string; boatId: string | null; seriesId: string | null },
  now: Date,
): Promise<ShelfSameBoat | null> {
  if (!lastDived.boatId && !lastDived.seriesId) return null;
  const { trips: upcoming } = await pagedUpcomingTripsWithCounts(db, shopId, {
    publicOnly: true,
    hasSpace: true,
    limit: SAME_BOAT_WINDOW,
    now,
  });
  const candidates = upcoming.filter((trip) => trip.id !== lastDived.tripId);
  const byBoat = lastDived.boatId
    ? candidates.find((trip) => trip.boatId === lastDived.boatId)
    : undefined;
  const bySeries =
    !byBoat && lastDived.seriesId
      ? candidates.find((trip) => trip.seriesId === lastDived.seriesId)
      : undefined;
  const match = byBoat ?? bySeries;
  if (!match) return null;

  let boatName: string | null = null;
  if (byBoat && match.boatId) {
    const [boat] = await db
      .select({ name: boats.name })
      .from(boats)
      .where(and(eq(boats.id, match.boatId), eq(boats.shopId, shopId)))
      .limit(1);
    boatName = boat?.name ?? null;
  }
  return {
    tripId: match.id,
    title: match.title,
    startsAt: match.startsAt,
    because: byBoat ? "boat" : "series",
    boatName,
  };
}

/** The file half of the shelf: the card, the release, the sizes, the team. */
async function readShelfFile(
  db: AppDb,
  input: {
    shopId: string;
    personId: string;
    fullName: string;
    next: ShelfDeparture | null;
    now: Date;
  },
): Promise<Omit<ShelfFile, "emergencyContactOnFile">> {
  const { shopId, personId, now } = input;

  // The staffer who sighted the card, by name. **Scoped to this shop as well as
  // to the id**, though the certification row this hangs off is already
  // shop-scoped: a subquery that resolves a person by id alone is one edit away
  // from being copied somewhere the outer row is not, and the cost of the
  // second condition is nothing.
  const reviewer = sql`(
    select ${people.fullName} from ${people}
    where ${people.id} = ${certifications.reviewedByPersonId}
      and ${people.shopId} = ${shopId}
  )`.as("reviewer_name");

  const [card] = await db
    .select({
      level: certifications.level,
      agency: certifications.agency,
      status: certifications.status,
      reviewedAt: certifications.reviewedAt,
      importedAt: certifications.importedAt,
      reviewerName: reviewer,
    })
    .from(certifications)
    .where(
      and(
        eq(certifications.shopId, shopId),
        eq(certifications.personId, personId),
        isNull(certifications.deletedAt),
      ),
    )
    // The strongest card the shop holds, not the newest row: a verified Open
    // Water beside an unverified Advanced is still a verified card.
    .orderBy(desc(certifications.status), desc(certifications.createdAt))
    .limit(1);

  const [signedByPerson, template, fit] = await Promise.all([
    listSignedWaiversByPerson(db, shopId, [personId]),
    getCurrentWaiverTemplate(db, shopId),
    db
      .select({
        bcdSize: rentalFitProfiles.bcdSize,
        wetsuitSize: rentalFitProfiles.wetsuitSize,
        bootSize: rentalFitProfiles.bootSize,
        finSize: rentalFitProfiles.finSize,
      })
      .from(rentalFitProfiles)
      .where(and(eq(rentalFitProfiles.shopId, shopId), eq(rentalFitProfiles.personId, personId)))
      .limit(1),
  ]);

  const standing = shopWaiverStatus({
    personSignedWaivers: signedByPerson.get(personId) ?? [],
    currentTemplateVersion: template?.materialGeneration ?? null,
    now,
  });

  return {
    certification: shelfCertification(card),
    waiver: shelfWaiver(standing),
    sizes: {
      bcdSize: fit[0]?.bcdSize ?? null,
      wetsuitSize: fit[0]?.wetsuitSize ?? null,
      bootSize: fit[0]?.bootSize ?? null,
      finSize: fit[0]?.finSize ?? null,
    },
    buddyTeam: input.next ? await readBuddyTeam(db, shopId, input.next) : null,
  };
}

function shelfCertification(
  card:
    | {
        level: CertificationLevel;
        agency: CertificationAgency;
        status: string;
        reviewedAt: Date | null;
        importedAt: Date | null;
        reviewerName: unknown;
      }
    | undefined,
): ShelfCertification {
  if (!card) return { state: "none" };
  if (card.status !== "verified") {
    return { state: "on_file", level: card.level, agency: card.agency };
  }
  // A card imported already verified (ADR 20260724-import-verified-cards) has
  // no `reviewedAt` and no reviewer: it was checked, at the prior shop, by
  // somebody this shop cannot name. `importedAt` is the day it arrived here,
  // which is the only date that is true, and the name stays null rather than
  // becoming a guess.
  const verifiedAt = card.reviewedAt ?? card.importedAt;
  if (!verifiedAt) return { state: "on_file", level: card.level, agency: card.agency };
  return {
    state: "verified",
    level: card.level,
    agency: card.agency,
    verifiedAt,
    verifiedBy: card.reviewedAt && typeof card.reviewerName === "string" ? card.reviewerName : null,
  };
}

/**
 * Six standings become three, and the three medical ones become one. See
 * `ShelfWaiver` for why — this function is where that promise is kept, and
 * `shelf.test.ts` pins every branch of it.
 */
function shelfWaiver(standing: ReturnType<typeof shopWaiverStatus>): ShelfWaiver {
  if (standing.state === "current") {
    return { state: "signed", signedAt: standing.signedAt, expiresAt: standing.expiresAt };
  }
  if (standing.state === "medical_review" || standing.state === "medical_not_cleared") {
    return { state: "with_the_shop" };
  }
  return { state: "needs_signing" };
}

/** How many are on this diver's team for their next departure, and nobody's name. */
async function readBuddyTeam(
  db: AppDb,
  shopId: string,
  next: ShelfDeparture,
): Promise<ShelfBuddyTeam | null> {
  const [mine] = await db
    .select({ pairId: buddyPairMembers.pairId })
    .from(buddyPairMembers)
    .where(
      and(
        eq(buddyPairMembers.shopId, shopId),
        eq(buddyPairMembers.tripId, next.tripId),
        eq(buddyPairMembers.bookingId, next.bookingId),
      ),
    )
    .limit(1);
  if (!mine) return null;
  const [sized] = await db
    .select({ size: sql<number>`count(*)::int` })
    .from(buddyPairMembers)
    .where(and(eq(buddyPairMembers.shopId, shopId), eq(buddyPairMembers.pairId, mine.pairId)));
  const size = Number(sized?.size ?? 0);
  return size > 0 ? { size, tripId: next.tripId, startsAt: next.startsAt } : null;
}

/**
 * The first word of a name, for the greeting. Falls back to the whole name
 * rather than to a generic, because a shop's own diver is never "there".
 */
export function firstNameOf(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || fullName;
}
