import { and, desc, eq, gt, isNull, ne } from "drizzle-orm";
import type { DiverLocale } from "@/i18n/settings";
import { hashCapabilityToken } from "@/lib/booking-capabilities";
import {
  foldKnownDiverFacts,
  HANDOFF_OFFER_COOLDOWN_MS,
  HANDOFF_TTL_MS,
  handoffHref,
  type KnownDiverFact,
} from "@/lib/booking-handoff";
import { nowDate } from "@/lib/clock";
import { recipientLocale } from "@/lib/notifications/kinds";
import { publicTripPath } from "@/lib/public-routes";
import { issueBookingCapability, verifyBookingCapability } from "./booking-capabilities";
import { readCertificationEvidence } from "./certification-evidence";
import type { AppDb, DbExecutor } from "./client";
import { sendAndRecordNotification } from "./notifications";
import { getRentalFit } from "./rental-fit";
import {
  bookingCapabilities,
  bookings,
  notificationDeliveries,
  people,
  shops,
  trips,
} from "./schema";
import { liveTrip } from "./trips-live";
import {
  getCurrentWaiverTemplate,
  getEmergencyContactForPerson,
  listSignedWaiversByPerson,
} from "./waivers";

/**
 * The door remembers who opened it (ADR 20260906-before-you-ask, decision 3).
 *
 * A handoff is a `booking_capabilities` row with purpose `handoff`: minted by
 * the diver's own thread when it links to the next dive, ten minutes long,
 * and consumed by the booking it leads to. The booking page reads a known
 * diver's facts only through it — never from an email typed into the form,
 * which is what keeps the page from confirming to a stranger that an address
 * is on file.
 */

export type KnownDiver = {
  bookingId: string;
  personId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  facts: KnownDiverFact[];
};

/** Mint a handoff for a booking's diver. Null for a booking that is not this shop's or is cancelled. */
export async function issueBookingHandoff(
  db: DbExecutor,
  input: { shopId: string; bookingId: string; now?: Date },
) {
  const now = input.now ?? nowDate();
  return issueBookingCapability(db, {
    shopId: input.shopId,
    bookingId: input.bookingId,
    purpose: "handoff",
    now,
    expiresAt: new Date(now.getTime() + HANDOFF_TTL_MS),
  });
}

/**
 * Who arrived, and what the shop already holds about them — or null, which
 * the page renders as the cold form it ships. Null covers every refusal at
 * once (unknown, expired, consumed, another shop's booking), deliberately: a
 * public page must not say which.
 */
export async function readKnownDiver(
  db: AppDb,
  input: { shopId: string; token: string; now?: Date },
): Promise<KnownDiver | null> {
  const now = input.now ?? nowDate();
  const capability = await verifyBookingCapability(db, {
    token: input.token,
    purpose: "handoff",
    now,
  });
  if (!capability || capability.shopId !== input.shopId) return null;
  const [person] = await db
    .select({
      id: people.id,
      fullName: people.fullName,
      email: people.email,
      phone: people.phone,
    })
    .from(people)
    .where(
      and(
        eq(people.id, capability.personId),
        eq(people.shopId, input.shopId),
        isNull(people.deletedAt),
      ),
    )
    .limit(1);
  if (!person) return null;
  const [evidence, waivers, template, rentalFit, emergencyContact] = await Promise.all([
    readCertificationEvidence(db, input.shopId, person.id),
    listSignedWaiversByPerson(db, input.shopId, [person.id]),
    getCurrentWaiverTemplate(db, input.shopId),
    getRentalFit(db, input.shopId, person.id),
    getEmergencyContactForPerson(db, input.shopId, person.id),
  ]);
  return {
    bookingId: capability.bookingId,
    personId: person.id,
    fullName: person.fullName,
    email: person.email,
    phone: person.phone,
    facts: foldKnownDiverFacts({
      certifications: evidence.certifications,
      waivers: waivers.get(person.id) ?? [],
      currentTemplateGeneration: template?.materialGeneration ?? null,
      rentalFit,
      emergencyContact,
      now,
    }),
  };
}

/**
 * Single use: the booking that carried the handoff consumes it. A consumed
 * token reads as no token from then on. Idempotent — consuming twice, or
 * consuming a token that never existed, changes nothing.
 */
export async function consumeBookingHandoff(
  db: DbExecutor,
  input: { shopId: string; token: string; now?: Date },
): Promise<void> {
  const now = input.now ?? nowDate();
  await db
    .update(bookingCapabilities)
    .set({ revokedAt: now })
    .where(
      and(
        eq(bookingCapabilities.shopId, input.shopId),
        eq(bookingCapabilities.purpose, "handoff"),
        eq(bookingCapabilities.tokenHash, hashCapabilityToken(input.token)),
        isNull(bookingCapabilities.revokedAt),
      ),
    );
}

export type HandoffOfferOutcome = "sent" | "skipped";

/**
 * **One link, to an address typed cold** (H-68 b). When the lead email on a
 * booking form matches a live diver with a booking at this shop, that diver
 * gets one email carrying a handoff onto the same departure. The page never
 * learns the answer — this returns the same shape whether it sent or not, and
 * the action above it returns nothing at all — and the delivery row keeps it
 * to one an hour, so a form that blurs the field ten times sends once.
 *
 * Only while a booking form is mid-fill with that address: the caller is the
 * form's own blur, never a page load.
 */
export async function offerBookingHandoffByEmail(
  db: AppDb,
  input: {
    shopId: string;
    tripId: string;
    email: string;
    /** The app origin the link is built on; null (unconfigured) sends nothing. */
    origin: string | null;
    requestLocale: DiverLocale;
    now?: Date;
  },
): Promise<HandoffOfferOutcome> {
  const now = input.now ?? nowDate();
  const email = input.email.trim().toLowerCase();
  if (!email || !input.origin) return "skipped";
  const [match] = await db
    .select({
      personId: people.id,
      fullName: people.fullName,
      personEmail: people.email,
      personLocale: people.locale,
      bookingId: bookings.id,
      shopName: shops.name,
      shopSlug: shops.slug,
      shopLocale: shops.defaultLocale,
      timezone: shops.timezone,
    })
    .from(people)
    .innerJoin(bookings, and(eq(bookings.personId, people.id), ne(bookings.status, "cancelled")))
    .innerJoin(trips, and(eq(trips.id, bookings.tripId), liveTrip()))
    .innerJoin(shops, eq(shops.id, people.shopId))
    .where(and(eq(people.shopId, input.shopId), eq(people.email, email), isNull(people.deletedAt)))
    .orderBy(desc(trips.startsAt))
    .limit(1);
  if (!match?.personEmail) return "skipped";
  const [trip] = await db
    .select({ title: trips.title })
    .from(trips)
    .where(and(eq(trips.id, input.tripId), eq(trips.shopId, input.shopId), liveTrip()))
    .limit(1);
  if (!trip) return "skipped";
  const [recent] = await db
    .select({ id: notificationDeliveries.id })
    .from(notificationDeliveries)
    .where(
      and(
        eq(notificationDeliveries.shopId, input.shopId),
        eq(notificationDeliveries.bookingId, match.bookingId),
        eq(notificationDeliveries.kind, "booking_handoff"),
        gt(notificationDeliveries.attemptedAt, new Date(now.getTime() - HANDOFF_OFFER_COOLDOWN_MS)),
      ),
    )
    .limit(1);
  if (recent) return "skipped";
  const issued = await issueBookingHandoff(db, {
    shopId: input.shopId,
    bookingId: match.bookingId,
    now,
  });
  if (!issued) return "skipped";
  await sendAndRecordNotification(db, {
    kind: "booking_handoff",
    bookingId: match.bookingId,
    shopId: input.shopId,
    to: match.personEmail,
    locale: recipientLocale(match.personLocale ?? input.requestLocale, match.shopLocale),
    diverName: match.fullName,
    shopName: match.shopName,
    tripTitle: trip.title,
    bookingUrl: new URL(
      handoffHref(publicTripPath(match.shopSlug, input.tripId), issued.token),
      `${input.origin}/`,
    ).toString(),
    expiresAt: issued.expiresAt,
    timezone: match.timezone,
  });
  return "sent";
}
