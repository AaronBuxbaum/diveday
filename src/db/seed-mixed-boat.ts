import { eq } from "drizzle-orm";
import { demoEmail } from "@/lib/simulator-email";
import type { DbExecutor } from "./client";
import {
  bookings,
  people,
  personRoles,
  rentalFitProfiles,
  trips,
  waiverRecords,
  type waiverTemplates,
} from "./schema";
import { at, nextCreatedAt } from "./seed-clock";

/**
 * **A snorkeler and a rider on today's reef boat** (ADR
 * 20261007-participant-types): the roster and roll-call badge, the head
 * count's split, the price per type on the public form, and a packing line
 * that asks for mask and fins and nothing else — all on the departure a demo
 * visitor opens first, rather than only behind the trouble-states opt-in.
 *
 * Two new people, Mara and Owen Quint, so no diver another seed or spec reads
 * changes type. Both signed their release like the rest of the boat, so
 * neither adds a readiness blocker; Mara rents mask and fins, and Owen rents
 * nothing, which is what riding along means.
 *
 * The departure's capacity in `seed-trips.ts` already counts the two places
 * they take, so "3 spots left" still says the same thing.
 *
 * Adds only, and called late like the scenarios beside it, so nothing seeded
 * before it moves.
 */
const NOT_DIVING = [
  {
    fullName: "Mara Quint",
    label: "mara.quint",
    phone: "+13055550198",
    participantType: "snorkeler" as const,
    maskFins: { fin: "M", boot: "8" },
  },
  {
    fullName: "Owen Quint",
    label: "owen.quint",
    phone: "+13055550199",
    participantType: "rider" as const,
    maskFins: null,
  },
];

/** What the reef boat charges someone who is not diving. */
export const DEMO_SNORKELER_PRICE_CENTS = 4500;
export const DEMO_RIDER_PRICE_CENTS = 2500;

export async function seedMixedBoat(
  db: DbExecutor,
  shopId: string,
  ctx: { reef: typeof trips.$inferSelect; waiverTemplate: typeof waiverTemplates.$inferSelect },
): Promise<void> {
  const { reef, waiverTemplate } = ctx;
  await db
    .update(trips)
    .set({
      snorkelerPriceCents: DEMO_SNORKELER_PRICE_CENTS,
      riderPriceCents: DEMO_RIDER_PRICE_CENTS,
    })
    .where(eq(trips.id, reef.id));

  for (const [index, guest] of NOT_DIVING.entries()) {
    const [person] = await db
      .insert(people)
      .values({
        shopId,
        fullName: guest.fullName,
        email: demoEmail(guest.label),
        phone: guest.phone,
        createdAt: nextCreatedAt(),
      })
      .returning();
    if (!person) throw new Error(`seed: ${guest.fullName} insert returned no row`);
    await db.insert(personRoles).values({ personId: person.id, role: "diver" as const });

    const [booking] = await db
      .insert(bookings)
      .values({
        shopId,
        tripId: reef.id,
        personId: person.id,
        status: "booked" as const,
        participantType: guest.participantType,
        bookedAs: guest.participantType,
        createdAt: nextCreatedAt(),
      })
      .returning();
    if (!booking) throw new Error(`seed: ${guest.fullName}'s booking insert returned no row`);

    const signedAt = nextCreatedAt();
    await db.insert(waiverRecords).values({
      shopId,
      bookingId: booking.id,
      personId: person.id,
      templateId: waiverTemplate.id,
      templateTitle: waiverTemplate.title,
      templateVersion: waiverTemplate.version,
      templateGeneration: waiverTemplate.materialGeneration,
      templateBody: waiverTemplate.body,
      // Unique per shop, like the upcoming waivers in `seed-bookings.ts`.
      tokenHash: `seed-waiver-mixed-boat-${shopId}-${index}`,
      expiresAt: at(30, 12),
      createdAt: signedAt,
      status: "completed" as const,
      signedName: "Signed on file",
      signatureMethod: "in_person" as const,
      consentedAt: signedAt,
      signedAt,
      completedAt: signedAt,
    });

    if (guest.maskFins) {
      await db.insert(rentalFitProfiles).values({
        shopId,
        personId: person.id,
        rentsBcd: false,
        rentsRegulator: false,
        rentsWetsuit: false,
        rentsMaskFins: true,
        rentsWeights: false,
        finSize: guest.maskFins.fin,
        bootSize: guest.maskFins.boot,
        fitStatedAt: signedAt,
      });
    }
  }
}
