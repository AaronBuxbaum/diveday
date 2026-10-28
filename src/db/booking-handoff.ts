import { and, asc, desc, eq, gt, isNull, lte, ne } from "drizzle-orm";
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
import type { NotificationProvider } from "@/lib/notifications";
import { notificationProviderSignal } from "@/lib/notifications";
import { recipientLocale } from "@/lib/notifications/kinds";
import { publicTripPath } from "@/lib/public-routes";
import { type LastGear, type RentableItemKind, toRentableKinds } from "@/lib/rentals";
import {
  issueBookingCapability,
  revokeIssuedCapabilities,
  verifyBookingCapability,
} from "./booking-capabilities";
import { readCertificationEvidence } from "./certification-evidence";
import type { AppDb, DbExecutor } from "./client";
import { diveDay } from "./dive-days";
import { withErasureCoordinatedBookingSend } from "./erasure-coordinated-send";
import { authorizesNitroxFill } from "./nitrox";
import { sendAndRecordNotification } from "./notifications";
import { getRentalFit } from "./rental-fit";
import {
  bookingCapabilities,
  bookings,
  nitroxCertifications,
  notificationDeliveries,
  people,
  shops,
  trips,
} from "./schema";
import { liveTrip } from "./trips-live";
import {
  getCurrentWaiverGeneration,
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
  /**
   * What their last trip with the shop carried, to start the gear step from
   * (fifth-loop ideas, item 40): "as on your last trip". Null when it carried
   * nothing, or there was no last trip. Nitrox only while their card still
   * authorizes a fill.
   */
  lastGear: LastGear | null;
};

/** Mint a handoff for a booking's diver. Null for a booking that is not this shop's or is cancelled. */
export async function issueBookingHandoff(
  db: DbExecutor,
  input: {
    shopId: string;
    bookingId: string;
    expectedPersonId?: string;
    expectedTripId?: string;
    now?: Date;
  },
) {
  const now = input.now ?? nowDate();
  return issueBookingCapability(db, {
    shopId: input.shopId,
    bookingId: input.bookingId,
    purpose: "handoff",
    expectedPersonId: input.expectedPersonId,
    expectedTripId: input.expectedTripId,
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
  // A handoff minted from a held seat (#2082) speaks for a diver record staff
  // have not yet matched to whoever holds the link: nothing is pre-filled.
  const [seat] = await db
    .select({ identityUnconfirmedAt: bookings.identityUnconfirmedAt })
    .from(bookings)
    .where(and(eq(bookings.id, capability.bookingId), eq(bookings.shopId, input.shopId)))
    .limit(1);
  if (!seat || seat.identityUnconfirmedAt) return null;
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
  const [evidence, waivers, template, rentalFit, emergencyContact, lastGear] = await Promise.all([
    readCertificationEvidence(db, input.shopId, person.id),
    listSignedWaiversByPerson(db, input.shopId, [person.id]),
    getCurrentWaiverGeneration(db, input.shopId),
    getRentalFit(db, input.shopId, person.id),
    getEmergencyContactForPerson(db, input.shopId, person.id),
    lastGearFor(db, { shopId: input.shopId, personId: person.id, now }),
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
    lastGear,
  };
}

/**
 * The gear on a person's most recent sailed diver seat with the shop: the
 * rental pieces its checkout charged for, and nitrox when that seat asked for
 * it **and** their card still authorizes a fill (`authorizesNitroxFill`, the
 * one predicate every fill gate shares). A ticked box on the next form is a
 * starting point the diver can untick, never a fill decision.
 */
export async function lastGearFor(
  db: DbExecutor,
  input: { shopId: string; personId: string; now: Date },
): Promise<LastGear | null> {
  const [last] = await db
    .select({ wantsNitrox: bookings.wantsNitrox, paidRentalKinds: bookings.paidRentalKinds })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(bookings.shopId, input.shopId),
        eq(bookings.personId, input.personId),
        eq(bookings.participantType, "diver"),
        // A held seat's gear was chosen by whoever booked it, who may not be
        // this person (#2082; security review r5-4, N3).
        isNull(bookings.identityUnconfirmedAt),
        diveDay(),
        lte(trips.startsAt, input.now),
      ),
    )
    .orderBy(desc(trips.startsAt), asc(trips.title), desc(bookings.id))
    .limit(1);
  if (!last) return null;
  const rentedKinds = toRentableKinds(last.paidRentalKinds).filter(
    (kind): kind is RentableItemKind => kind !== "nitrox",
  );
  let nitrox = false;
  if (last.wantsNitrox) {
    const [card] = await db
      .select({ id: nitroxCertifications.id })
      .from(nitroxCertifications)
      .where(
        and(
          eq(nitroxCertifications.shopId, input.shopId),
          eq(nitroxCertifications.personId, input.personId),
          authorizesNitroxFill,
        ),
      )
      .limit(1);
    nitrox = Boolean(card);
  }
  return nitrox || rentedKinds.length > 0 ? { nitrox, rentedKinds } : null;
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

export type HandoffOfferOutcome = "sent" | "queued" | "failed" | "skipped";

/**
 * **One link, to an address typed cold** (H-68 b). When the lead email on a
 * booking form matches a live diver with a booking at this shop, that diver
 * gets one email carrying a handoff onto the same departure. The page never
 * learns the answer — the public action discards this internal result — and the
 * delivery row keeps it to one an hour, so a form that blurs the field ten
 * times sends once.
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
  options: { provider?: NotificationProvider } = {},
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
      bookingTripId: bookings.tripId,
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
  // A public departure only: the mail names the trip, and a private one is
  // not the shop's to announce to whoever typed an address.
  const [trip] = await db
    .select({ title: trips.title })
    .from(trips)
    .where(
      and(
        eq(trips.id, input.tripId),
        eq(trips.shopId, input.shopId),
        eq(trips.isPrivate, false),
        liveTrip(),
      ),
    )
    .limit(1);
  if (!trip) return "skipped";
  // One an hour per *person*, over every booking of theirs — keyed on the
  // newest booking alone, a fresh public booking in their name would reset it.
  const [recent] = await db
    .select({ id: notificationDeliveries.id })
    .from(notificationDeliveries)
    .innerJoin(bookings, eq(bookings.id, notificationDeliveries.bookingId))
    .where(
      and(
        eq(notificationDeliveries.shopId, input.shopId),
        eq(bookings.personId, match.personId),
        eq(notificationDeliveries.kind, "booking_handoff"),
        gt(notificationDeliveries.attemptedAt, new Date(now.getTime() - HANDOFF_OFFER_COOLDOWN_MS)),
      ),
    )
    .limit(1);
  if (recent) return "skipped";
  const result = await withErasureCoordinatedBookingSend(
    db,
    {
      shopId: input.shopId,
      bookingId: match.bookingId,
      expectedPersonId: match.personId,
      expectedTripId: match.bookingTripId,
      expectedEmail: match.personEmail,
    },
    async (tx) => {
      const issued = await issueBookingHandoff(tx, {
        shopId: input.shopId,
        bookingId: match.bookingId,
        expectedPersonId: match.personId,
        expectedTripId: match.bookingTripId,
        now,
      });
      if (!issued) return "skipped" as const;
      const delivery = await sendAndRecordNotification(
        tx,
        {
          kind: "booking_handoff",
          bookingId: match.bookingId,
          shopId: input.shopId,
          to: match.personEmail as string,
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
        },
        { provider: options.provider, signal: notificationProviderSignal() },
      );
      const queued =
        delivery.status === "failed" && "retryQueued" in delivery && delivery.retryQueued === true;
      if (delivery.status !== "sent" && !queued) {
        await revokeIssuedCapabilities(tx, {
          shopId: input.shopId,
          tokens: [issued.token],
          now,
        });
      }
      if (delivery.status === "sent") return "sent" as const;
      return queued ? ("queued" as const) : ("failed" as const);
    },
  );
  return result ?? "skipped";
}
