import { and, asc, eq } from "drizzle-orm";
import { demoEmail } from "@/lib/simulator-email";
import type { DbExecutor } from "../client";
import {
  bookings,
  interestReplies,
  interests,
  recapPulses,
  rollCallEvents,
  trips,
} from "../schema";
import { at, dateAt } from "./clock";

/** A few things the desk has already heard, answered, and followed up on. */
export async function seedDeskFollowThrough(
  db: DbExecutor,
  shopId: string,
  actorId: string,
): Promise<void> {
  const sailed = await db
    .select({
      bookingId: bookings.id,
      personId: bookings.personId,
      tripId: trips.id,
      endedAt: trips.endsAt,
    })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .innerJoin(
      rollCallEvents,
      and(
        eq(rollCallEvents.bookingId, bookings.id),
        eq(rollCallEvents.subjectKind, "seat"),
        eq(rollCallEvents.checkpoint, "departure"),
        eq(rollCallEvents.status, "boarded"),
      ),
    )
    .where(
      and(
        eq(bookings.shopId, shopId),
        eq(trips.description, "Sailed. Kept in the log for the shop's monthly numbers."),
      ),
    )
    .orderBy(asc(trips.startsAt), asc(bookings.createdAt))
    .limit(2);
  if (sailed.length)
    await db.insert(recapPulses).values(
      sailed.map((seat, index) => {
        const createdAt = new Date(seat.endedAt.getTime() + 5 * 60 * 60_000);
        const addressedAt = new Date(createdAt.getTime() + 24 * 60 * 60_000);
        return {
          shopId,
          bookingId: seat.bookingId,
          personId: seat.personId,
          tripId: seat.tripId,
          categories: index === 0 ? ["gear" as const] : ["briefing" as const],
          note:
            index === 0
              ? "The fin strap needed another adjustment after the first dive."
              : "A little more time for questions at the briefing would help.",
          createdAt,
          updatedAt: addressedAt,
          addressedAt,
          addressedByPersonId: actorId,
        };
      }),
    );
  const sentAt = at(-19, 11);
  const [request] = await db
    .insert(interests)
    .values({
      shopId,
      scope: "date",
      askedBy: "diver",
      interest: "A calm reef morning",
      name: "Rachel Mendez",
      email: demoEmail("rachel.mendez"),
      experienceLevel: "certified",
      preferredDate: dateAt(-10),
      partySize: 2,
      // i18n-exempt: the fictional diver's own request, kept verbatim.
      message: "Is there a relaxed two-tank trip that week?",
      askedAt: at(-20, 16),
      closedAt: sentAt,
      closedAs: "replied",
    })
    .returning({ id: interests.id });
  if (!request) throw new Error("seed: missing answered date request");
  await db.insert(interestReplies).values({
    shopId,
    interestId: request.id,
    channel: "email",
    toAddress: demoEmail("rachel.mendez"),
    body: "We have a relaxed reef morning that week. I've sent you the departure details.",
    locale: "en-US",
    sentByPersonId: actorId,
    status: "sent",
    providerMessageId: `seed-interest-reply-${shopId}`,
    sentAt,
    createdAt: sentAt,
  });
}
