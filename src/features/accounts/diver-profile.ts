import { and, asc, desc, eq, gt, isNull, lte } from "drizzle-orm";
import { readCertificationEvidence } from "@/db/certification-evidence";
import type { AppDb, DbExecutor } from "@/db/client";
import { storedPhone } from "@/db/person-phone";
import { bookings, people, trips } from "@/db/schema";
import { liveTrip, seatNotCancelled } from "@/db/trips";
import { recordPersonEmergencyContact } from "@/db/waivers";
import { readTripCredit } from "@/features/money/trip-credit";
import { nowDate } from "@/lib/clock";

/**
 * **The signed-in diver's own page at one shop** (ADR 20261125-diver-sign-in):
 * what that shop already holds about them, read by the person a live diver
 * session names and nothing wider. Every read is keyed by this shop and this
 * person; the page never takes either from the URL.
 */
export async function readDiverProfile(
  db: AppDb,
  input: { shopId: string; personId: string; currency: string; now?: Date },
) {
  const now = input.now ?? nowDate();
  const [person] = await db
    .select({
      id: people.id,
      fullName: people.fullName,
      email: people.email,
      phone: people.phone,
      emergencyContactName: people.emergencyContactName,
      emergencyContactPhone: people.emergencyContactPhone,
    })
    .from(people)
    .where(
      and(eq(people.id, input.personId), eq(people.shopId, input.shopId), isNull(people.deletedAt)),
    )
    .limit(1);
  if (!person) return null;
  const seat = (when: "upcoming" | "past") =>
    db
      .select({
        bookingId: bookings.id,
        tripId: trips.id,
        title: trips.title,
        startsAt: trips.startsAt,
      })
      .from(bookings)
      .innerJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, input.shopId)))
      .where(
        and(
          eq(bookings.shopId, input.shopId),
          eq(bookings.personId, person.id),
          seatNotCancelled,
          liveTrip(),
          eq(trips.isRehearsal, false),
          when === "upcoming" ? gt(trips.startsAt, now) : lte(trips.startsAt, now),
        ),
      )
      .orderBy(when === "upcoming" ? asc(trips.startsAt) : desc(trips.startsAt))
      .limit(when === "upcoming" ? 20 : 10);
  const [upcoming, past, cards, credit] = await Promise.all([
    seat("upcoming"),
    seat("past"),
    readCertificationEvidence(db, input.shopId, person.id),
    readTripCredit(db, input.shopId, person.id, input.currency),
  ]);
  return {
    person,
    upcoming,
    past,
    cards: [
      ...cards.certifications.map((card) => ({
        id: card.id,
        kind: "level" as const,
        level: card.level,
        agency: card.agency,
        verified: card.status === "verified",
      })),
      ...cards.specialtyCertifications.map((card) => ({
        id: card.id,
        kind: "specialty" as const,
        specialty: card.specialty,
        agency: card.agency,
        verified: card.status === "verified",
      })),
      ...cards.nitroxCertifications.map((card) => ({
        id: card.id,
        kind: "nitrox" as const,
        agency: card.agency,
        verified: card.status === "verified",
      })),
    ],
    credit: {
      balanceCents: credit.balanceCents ?? 0,
      entries: credit.entries
        .filter((entry) => entry.currency === input.currency)
        .slice(0, 10)
        .map((entry) => ({
          id: entry.id,
          kind: entry.kind,
          amountCents: entry.amountCents,
          occurredAt: entry.occurredAt,
        })),
    },
  };
}

export type DiverProfile = NonNullable<Awaited<ReturnType<typeof readDiverProfile>>>;

/**
 * The diver corrects the contact details they already gave: their phone and
 * their emergency contact. Their email is how they sign in, so it changes at
 * the shop. Written for the session's own person in the session's own shop.
 *
 * No link is withdrawn: the person typing is the one the shop sent them to,
 * proven by the session (ADR 20261125-diver-sign-in).
 */
export async function recordDiverOwnContact(
  db: DbExecutor,
  input: {
    shopId: string;
    personId: string;
    phone: string;
    emergencyContactName: string;
    emergencyContactPhone: string;
  },
): Promise<"saved" | "emergency_pair"> {
  const name = input.emergencyContactName.trim();
  const phone = input.emergencyContactPhone.trim();
  // Both or neither: a name with no number is not a contact a crew can call.
  if (Boolean(name) !== Boolean(phone)) return "emergency_pair";
  await db
    .update(people)
    .set({ phone: await storedPhone(db, input.shopId, input.phone) })
    .where(
      and(eq(people.id, input.personId), eq(people.shopId, input.shopId), isNull(people.deletedAt)),
    );
  if (name && phone) {
    await recordPersonEmergencyContact(db, {
      shopId: input.shopId,
      personId: input.personId,
      name,
      phone,
    });
  }
  return "saved";
}
