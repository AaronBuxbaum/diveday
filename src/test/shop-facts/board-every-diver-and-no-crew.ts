import { and, eq, gte, inArray } from "drizzle-orm";
import type { AppDb } from "../../db/client";
import { recordRollCall } from "../../db/manifests";
import { bookings, cards, people, personRoles, trips } from "../../db/schema/index";
import { seatHeld } from "../../db/trips-queries";
import { completeWaiver, issueWaiverRequest } from "../../db/waivers";
import { STAFF_ROLES } from "../../lib/authz";
import { HOUR_MS } from "../../lib/clock";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "../../lib/medical";

/**
 * **A full boat whose crew nobody has counted** — the state where somebody may
 * still be on the dock, or in the water, and every diver-shaped signal on the
 * page says the day is going perfectly.
 *
 * Today's departure card celebrated exactly here, on `boarded === booked`,
 * while the manifest reading the same departure correctly refused to close the
 * checkpoint (issue #789). Now it says the crew roll call is still open, in a
 * warning tone — and a warning nothing has ever photographed is a warning
 * nobody has ever looked at (AGENTS.md).
 *
 * Reached the honest way: sign each diver's release so the app is willing to
 * board them, board them through the real writer, and record nothing at all for
 * the crew. Not seeded into `blue-mantis`, like everything else in this file: a
 * demo that opens every capture on an uncounted crew is a worse demo.
 */
export async function boardEveryDiverAndNoCrew(
  db: AppDb,
  shopId: string,
  now: Date,
): Promise<void> {
  const [crew] = await db
    .select({ id: people.id })
    .from(people) // diveday:allow-deleted-people: an e2e seed finds the people it just seeded
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shopId), inArray(personRoles.role, [...STAFF_ROLES])))
    .limit(1);
  if (!crew) return;

  // The *next* departure only. Ordered by the trip's start and then the diver's
  // name — never `bookings.id`, which is `defaultRandom()` and re-seeded before
  // every test, so ordering by it makes the capture photograph a different boat
  // each run (the mistake this file already carries a paragraph about).
  const [next] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(
      and(
        eq(trips.shopId, shopId),
        eq(trips.status, "scheduled"),
        // The same 1-hour late-departure buffer every "has it sailed" question
        // in this app uses. Without it this picked the earliest scheduled trip
        // in the seed — one that sailed weeks ago and is on no board.
        gte(trips.startsAt, new Date(now.getTime() - HOUR_MS)),
      ),
    )
    .orderBy(trips.startsAt)
    .limit(1);
  if (!next) return;

  const roster = await db
    .select({ id: bookings.id, personId: bookings.personId, fullName: people.fullName })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .where(
      and(
        eq(bookings.shopId, shopId),
        eq(bookings.tripId, next.id),
        // Checked in as well as booked: the demo's morning hand-off checks
        // two divers in at the counter, and the station counts their seats
        // too, so leaving them ashore would never fill the boat.
        seatHeld,
      ),
    )
    .orderBy(people.fullName);

  for (const seat of roster) {
    // A diver the seed already had sign is refused a second link, which is the
    // state we want anyway.
    const issued = await issueWaiverRequest(db, { shopId, bookingId: seat.id });
    if (issued.ok) {
      await completeWaiver(db, issued.key, {
        signerName: seat.fullName,
        agreed: true,
        medicalAnswers: emptyMedicalAnswers(RSTC_QUESTIONNAIRE),
      });
    }
    const board = () =>
      recordRollCall(db, {
        shopId,
        tripId: next.id,
        bookingId: seat.id,
        recordedByPersonId: crew.id,
        status: "boarded",
      });
    if ((await board()).ok) continue;
    // `not_ready` is the gate doing its job, and the seeded boat has a diver
    // with no card on file (Nadia Petrov) precisely so that something
    // photographs a blocked one. This capture is about the *crew* half, so the
    // diver half has to be clean — verify her card the way a front desk would,
    // and board her through the same writer, rather than reaching past the
    // gate with a direct write.
    await db.insert(cards).values({
      kind: "level",
      shopId,
      personId: seat.personId,
      agency: "padi" as const,
      level: "open_water" as const,
      identifier: "DEMO-CREW-UNCOUNTED",
      status: "verified" as const,
      reviewedByPersonId: crew.id,
      reviewedAt: now,
    });
    await board();
  }
  // And deliberately no `recordCrewRollCall` — that absence is the capture.
}
