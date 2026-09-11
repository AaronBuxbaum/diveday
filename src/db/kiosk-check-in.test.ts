// @vitest-environment node
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import {
  foldNameWord,
  kioskSelection,
  matchableNameTokens,
  readKioskInput,
  surnameOf,
} from "@/lib/kiosk-check-in";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { seededShopContext } from "@/test/db";
import {
  listSelfReportedArrivalBookingIds,
  listSelfReportedArrivalBookingIdsForTrip,
} from "./arrival-provenance";
import { checkInAtKiosk } from "./check-in";
import { issueDisplayToken, revokeDisplayToken, verifyDisplayToken } from "./display-tokens";
import { findKioskSeats, kioskNameMatch } from "./kiosk-check-in";
import { listDepartureBoardedBookingIds } from "./manifests";
import {
  bookingArrivalEvents,
  bookings,
  diveSupportNeeds,
  people,
  rollCallEvents,
  trips,
} from "./schema";
import { getTripRoster, listStaff, upcomingTripsWithCounts } from "./trips";
import { completeWaiver, issueWaiverRequest } from "./waivers";

const clearAnswers = emptyMedicalAnswers(RSTC_QUESTIONNAIRE);
const OTHER_SHOP = "00000000-0000-4000-8000-000000000000";

/**
 * The seeded reef boat, its first seat, and a live check-in link over the same
 * shop. Names are read off the roster rather than written down here: what the
 * lookup is about is the *derivation* — the last whitespace-separated word of
 * whatever the shop recorded — and pinning a cast member's surname in the
 * assertion would make these tests a tripwire on the demo's casting.
 */
async function counter() {
  const { db, shop } = await seededShopContext();
  const upcoming = await upcomingTripsWithCounts(db, shop.id);
  const reef = upcoming.find((trip) => trip.title === "Two-Tank Reef — Molasses & French");
  if (!reef) throw new Error("seeded reef trip missing");
  const roster = await getTripRoster(db, shop.id, reef.id);
  const seat = roster[0];
  if (!seat) throw new Error("seeded booking missing");
  const staff = await listStaff(db, shop.id);
  const owner = staff.find((entry) => entry.roles.includes("owner"));
  if (!owner) throw new Error("seeded shop has no owner");

  const link = await issueDisplayToken(db, {
    shopId: shop.id,
    personId: owner.person.id,
    label: "Counter tablet",
    purpose: "check_in",
    showNames: false,
  });
  if (!link.ok) throw new Error(link.reason);

  return {
    db,
    shop,
    reef,
    link: link.issued,
    booking: seat.booking,
    person: seat.person,
    surname: surnameOf(seat.person.fullName),
    /**
     * Ten minutes before the reef boat leaves — a diver walking into the lobby
     * for the boat they are booked on. Every lookup below states it, because
     * the kiosk's window is two hours wide (`kioskArrivalsWindow`) and the
     * seeded day is not: the tablet answering for a departure the diver is
     * *arriving for* is the whole subject, and leaning on wherever the frozen
     * clock happens to sit relative to the seed would make these tests a
     * tripwire on the demo's schedule instead.
     */
    atTheDoor: new Date(reef.startsAt.getTime() - 10 * 60 * 1000),
  };
}

/** Clears every blocker on the seat, so readiness answers "ready". */
async function clearForBoarding(
  db: Awaited<ReturnType<typeof counter>>["db"],
  shopId: string,
  bookingId: string,
  signerName: string,
) {
  const issued = await issueWaiverRequest(db, { shopId, bookingId });
  if (!issued.ok) throw new Error(issued.reason);
  await completeWaiver(db, issued.token, {
    signerName,
    agreed: true,
    medicalAnswers: clearAnswers,
  });
}

describe("findKioskSeats", () => {
  /**
   * **The row shape is closed, and closing it is the point.** This is read by
   * whoever walks up to an unattended screen, so a widened select is a leak
   * into a lobby rather than a refactor. Adding a key here is a deliberate act
   * that fails this test first.
   */
  it("answers with a narrow row carrying no contact detail, readiness or money", async () => {
    const { db, shop, surname, booking, atTheDoor } = await counter();
    const seats = await findKioskSeats(db, {
      shopId: shop.id,
      lookup: readKioskInput(surname),
      now: atTheDoor,
    });
    const found = seats.find((row) => row.bookingId === booking.id);
    expect(found).toBeDefined();
    expect(Object.keys(found ?? {}).sort()).toEqual([
      "bookingId",
      "endsAt",
      "meetingPointAddress",
      "meetingPointLabel",
      "personName",
      "startsAt",
      "tripId",
      "tripTitle",
    ]);
  });

  it("finds the seat by its booking reference", async () => {
    const { db, shop, booking, atTheDoor } = await counter();
    const seats = await findKioskSeats(db, {
      shopId: shop.id,
      lookup: readKioskInput(booking.id),
      now: atTheDoor,
    });
    expect(seats.map((row) => row.bookingId)).toEqual([booking.id]);
  });

  /**
   * **Exact and whole-word, never a substring.** A prefix match would let one
   * letter sweep the day's roster off a lobby screen — type "a", read every
   * diver whose name contains one.
   */
  it("refuses a prefix, a fragment and an email address", async () => {
    const { db, shop, surname, person } = await counter();
    const fragment = surname.slice(0, Math.max(1, surname.length - 1));
    expect(await findKioskSeats(db, { shopId: shop.id, lookup: readKioskInput(fragment) })).toEqual(
      [],
    );
    // Loudly, not conditionally: an unseeded email would quietly retire the
    // half of this test that matters most.
    if (!person.email) throw new Error("seeded diver has no email to try");
    expect(
      await findKioskSeats(db, { shopId: shop.id, lookup: readKioskInput(person.email) }),
    ).toEqual([]);
  });

  it("case-folds the typed answer and the stored name alike", async () => {
    const { db, shop, surname, booking, atTheDoor } = await counter();
    const shouted = await findKioskSeats(db, {
      shopId: shop.id,
      lookup: readKioskInput(surname.toUpperCase()),
      now: atTheDoor,
    });
    expect(shouted.map((row) => row.bookingId)).toContain(booking.id);
  });

  it("answers nothing for an unusable input, another shop, or a cancelled seat", async () => {
    const { db, shop, surname, booking } = await counter();
    expect(await findKioskSeats(db, { shopId: shop.id, lookup: null })).toEqual([]);
    expect(
      await findKioskSeats(db, { shopId: OTHER_SHOP, lookup: readKioskInput(surname) }),
    ).toEqual([]);

    await db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, booking.id));
    const afterCancel = await findKioskSeats(db, {
      shopId: shop.id,
      lookup: readKioskInput(booking.id),
    });
    expect(afterCancel).toEqual([]);
  });

  /**
   * A departure that has already sailed is off the window `arrivalsWindow`
   * bounds, and nobody is arriving for it. The diver who taps at 16:00 for an
   * 08:00 boat gets "see the desk", which is the true answer.
   */
  it("answers nothing for a departure outside the arrivals window", async () => {
    const { db, shop, booking } = await counter();
    const longAgo = new Date(nowDate().getTime() - 90 * 24 * 60 * 60 * 1000);
    expect(
      await findKioskSeats(db, {
        shopId: shop.id,
        lookup: readKioskInput(booking.id),
        now: longAgo,
      }),
    ).toEqual([]);
  });

  /**
   * **The rule the Spanish prompt asks for.** "Apellido" gets *García* from
   * essentially every Hispanic diver, and the lookup matched only the last
   * word, so a diver recorded with both apellidos was unreachable by the one
   * they answer with — refused in a sentence deliberately identical to "we do
   * not know you" (issue #1610).
   */
  it("finds a two-apellido diver by either apellido, and not by a given name", async () => {
    const { db, shop, booking, person, atTheDoor } = await counter();
    await db.update(people).set({ fullName: "Ana García Márquez" }).where(eq(people.id, person.id));

    for (const typed of ["García", "márquez", "García Márquez", "Ana García Márquez"]) {
      const seats = await findKioskSeats(db, {
        shopId: shop.id,
        lookup: readKioskInput(typed),
        now: atTheDoor,
      });
      expect(
        seats.map((row) => row.bookingId),
        typed,
      ).toContain(booking.id);
    }

    expect(
      await findKioskSeats(db, {
        shopId: shop.id,
        lookup: readKioskInput("Ana"),
        now: atTheDoor,
      }),
    ).toEqual([]);
  });

  /**
   * **An unaccented spelling is the ordinary one at a counter.** Case was
   * folded on both sides and nothing else was, so a diver recorded with the
   * accent was refused the spelling their tablet's keyboard reaches for, in the
   * same "See the desk" a stranger gets (issue #1656).
   */
  it("finds an accented name by its unaccented spelling, and the other way round", async () => {
    const { db, shop, booking, person, atTheDoor } = await counter();
    await db.update(people).set({ fullName: "Ana García Márquez" }).where(eq(people.id, person.id));

    for (const typed of ["garcia", "GARCIA", "Márquez", "marquez", "Garcia Marquez"]) {
      const seats = await findKioskSeats(db, {
        shopId: shop.id,
        lookup: readKioskInput(typed),
        now: atTheDoor,
      });
      expect(
        seats.map((row) => row.bookingId),
        typed,
      ).toContain(booking.id);
    }
  });

  /**
   * The SQL is `matchableNameTokens` written a second time, in another
   * language, over a column instead of a string — so the two agreeing is the
   * invariant rather than a coincidence. A name whose shape only one of them
   * understands is a diver one door finds and the other does not.
   *
   * Asked of `kioskNameMatch` over a literal rather than of `findKioskSeats`
   * over the seeded board, because the question is which *words* the two rules
   * agree on and the join answers nothing about that. Walked end to end it was
   * one full lookup per word of every name here, and it timed out at sixty
   * seconds on a CI shard the moment the list of names grew; the anchor below
   * keeps it honest that this is the predicate the reader actually runs.
   */
  it("matches exactly the words the rule in src/lib names, and no others", async () => {
    const { db, shop, booking, person, atTheDoor } = await counter();
    const names = [
      "Ana García Márquez",
      "María José García Márquez",
      "Jan van der Berg",
      "Adaeze Nwosu",
      "Prince",
      // Folding is the other half of the pairing (issue #1656), and this name
      // is here so a fold that only landed on one side shows up as a diver one
      // door finds and the other does not.
      "Ingrid Nyström",
      "Łukasz Wiśniewski",
      // Non-space whitespace, because `btrim` with one argument strips spaces
      // only: a leading tab used to shift the SQL's array by one and make the
      // given name matchable on that side alone (`security-reviewer`).
      "\tAdaeze Nwosu",
      "\nAna María García Márquez",
      "Sara  Bell   Whitmore",
    ];

    for (const fullName of names) {
      // Every word the name is written with, and every word it could be typed
      // as: the folded spelling is the one a tablet keyboard reaches for.
      const words = [
        ...new Set(
          fullName.split(/\s+/).flatMap((word) => [word.toLowerCase(), foldNameWord(word)]),
        ),
      ].filter((word) => word.length > 0);
      const matchable = matchableNameTokens(fullName);

      const asked = words.map((word, index) => {
        const lookup = readKioskInput(word);
        if (lookup?.kind !== "surname") throw new Error(`${word} is not a surname lookup`);
        return {
          word,
          column: `w${index}`,
          match: kioskNameMatch(sql`${fullName}::text`, lookup.surname),
        };
      });
      const answer = await db.execute(
        sql`select ${sql.join(
          asked.map(({ column, match }) => sql`${match} as ${sql.raw(column)}`),
          sql`, `,
        )}`,
      );
      const row = answer.rows[0] as Record<string, boolean | null>;

      for (const { word, column } of asked) {
        // The rule holds the folded form, so an accented spelling matches when
        // its fold does — which is the whole point of folding both sides.
        expect(row[column], `${fullName} by ${word}`).toBe(matchable.includes(foldNameWord(word)));
      }
    }

    // The anchor: the predicate above is the one the reader runs, over the
    // column it runs it over. Without this the parity could hold against a
    // literal while `findKioskSeats` asked something else entirely.
    await db.update(people).set({ fullName: "Jan van der Berg" }).where(eq(people.id, person.id));
    const seats = await findKioskSeats(db, {
      shopId: shop.id,
      lookup: readKioskInput("berg"),
      now: atTheDoor,
    });
    expect(seats.map((row) => row.bookingId)).toContain(booking.id);
    expect(
      await findKioskSeats(db, {
        shopId: shop.id,
        lookup: readKioskInput("der"),
        now: atTheDoor,
      }),
    ).toEqual([]);
  });

  /**
   * Two seats behind one surname is not an ambiguity the tablet resolves — but
   * it is one the reader has to be able to *report*, or `kioskSelection` never
   * sees a second row and the whole "several is the same as none" rule is
   * unreachable.
   */
  it("reports more than one match when a surname is shared", async () => {
    const { db, shop, surname, booking, atTheDoor } = await counter();
    const roster = await getTripRoster(db, shop.id, booking.tripId);
    const other = roster.find((row) => row.booking.id !== booking.id);
    if (!other) throw new Error("seeded reef boat has only one seat");
    await db
      .update(people)
      .set({ fullName: `Someone ${surname}` })
      .where(eq(people.id, other.person.id));

    const seats = await findKioskSeats(db, {
      shopId: shop.id,
      lookup: readKioskInput(surname),
      now: atTheDoor,
    });
    expect(seats.length).toBeGreaterThan(1);
  });

  /**
   * **Two seats of one diver must not hide a third seat of another.** The
   * `LIMIT` runs in Postgres and the same-person collapse runs here, so a limit
   * of two read one diver's two seats, collapsed them to one, and checked that
   * diver in while a stranger by the same name also matched and nobody was sent
   * to the desk (`security-reviewer`, 2026-09-10). Multi-day package holders
   * are exactly that shape.
   */
  it("still answers several when one diver's two seats come before another's", async () => {
    const { db, shop, surname, person, reef, atTheDoor } = await counter();
    const roster = await getTripRoster(db, shop.id, reef.id);
    const other = roster.find((row) => row.person.id !== person.id);
    if (!other) throw new Error("seeded reef boat has only one diver");
    await db
      .update(people)
      .set({ fullName: `Someone ${surname}` })
      .where(eq(people.id, other.person.id));

    // The same diver's second seat, an hour after the first, so the two rows
    // Postgres reads first both belong to them.
    const later = new Date(reef.startsAt.getTime() + 60 * 60 * 1000);
    const [second] = await db
      .insert(trips)
      .values({
        shopId: shop.id,
        title: "Afternoon single tank",
        startsAt: later,
        endsAt: new Date(later.getTime() + 2 * 60 * 60 * 1000),
        capacity: 8,
        status: "scheduled",
      })
      .returning({ id: trips.id });
    if (!second) throw new Error("could not seed the second departure");
    await db
      .insert(bookings)
      .values({ shopId: shop.id, tripId: second.id, personId: person.id, status: "booked" });

    const seats = await findKioskSeats(db, {
      shopId: shop.id,
      lookup: readKioskInput(surname),
      now: atTheDoor,
    });
    // Two people answer to this word, so the tablet has nothing to say.
    expect(kioskSelection(seats)).toBeNull();
  });

  /**
   * **A particle and an initial are nobody's key.** The widening made *der* a
   * whole-word answer and a stored middle initial a single-character one, which
   * is a dictionary rather than a guess against a link that does not expire.
   */
  it("refuses a particle and an initial, and still answers the last word", async () => {
    const { db, shop, booking, person, atTheDoor } = await counter();
    await db.update(people).set({ fullName: "Jan van der Berg" }).where(eq(people.id, person.id));

    for (const typed of ["van", "der", "jan"]) {
      expect(
        await findKioskSeats(db, {
          shopId: shop.id,
          lookup: readKioskInput(typed),
          now: atTheDoor,
        }),
        typed,
      ).toEqual([]);
    }
    const found = await findKioskSeats(db, {
      shopId: shop.id,
      lookup: readKioskInput("berg"),
      now: atTheDoor,
    });
    expect(found.map((row) => row.bookingId)).toContain(booking.id);

    await db.update(people).set({ fullName: "Ana M Garcia" }).where(eq(people.id, person.id));
    expect(
      await findKioskSeats(db, { shopId: shop.id, lookup: readKioskInput("m"), now: atTheDoor }),
    ).toEqual([]);
  });

  /**
   * **The tablet must not answer for a boat that has been and gone.** The
   * staffed counter looks six hours back on purpose — a diver who overslept
   * still walks up to the desk, and a human reads that row and says "they've
   * gone, let's sort you out". The tablet has no human, so it inherited a
   * window whose entire justification was the one thing it lacks, and told a
   * diver at 12:30 "You're set … 8:00 AM. Meet at …" for a boat tied up since
   * one (`dive-domain-expert` review, 2026-09-09).
   */
  it("goes quiet for a departure that has already sailed", async () => {
    const { db, shop, booking, reef } = await counter();
    const afterwards = new Date(reef.startsAt.getTime() + 4 * 60 * 60 * 1000);
    expect(
      await findKioskSeats(db, {
        shopId: shop.id,
        lookup: readKioskInput(booking.id),
        now: afterwards,
      }),
    ).toEqual([]);
  });

  /**
   * **And not for tomorrow's boat either.** Thirty-six hours forward made every
   * multi-day package holder — the resort shop's whole business — two matches
   * and therefore "See the desk" every single morning, and let a diver
   * wandering past the tablet in the afternoon write an arrival on a departure
   * they would not attend until the next day.
   */
  it("goes quiet for a departure that is still a day away", async () => {
    const { db, shop, booking, reef } = await counter();
    const theDayBefore = new Date(reef.startsAt.getTime() - 20 * 60 * 60 * 1000);
    expect(
      await findKioskSeats(db, {
        shopId: shop.id,
        lookup: readKioskInput(booking.id),
        now: theDayBefore,
      }),
    ).toEqual([]);
  });

  /**
   * **One diver's own two departures are a sequence, not an ambiguity.** Two
   * seats behind one surname belonging to two *people* stays "See the desk" —
   * the test above — because a tablet must never guess which stranger is in
   * front of it. The same diver booked on this morning's boat and tonight's
   * night dive is a different question, and a lobby at 07:40 wants the 08:00
   * one.
   */
  it("answers with the nearer departure when both seats are the same diver's", async () => {
    const { db, shop, surname, booking, person, reef, atTheDoor } = await counter();
    const later = new Date(reef.startsAt.getTime() + 4 * 60 * 60 * 1000);
    const [nightDive] = await db
      .insert(trips)
      .values({
        shopId: shop.id,
        title: "Night dive — Molasses",
        startsAt: later,
        endsAt: new Date(later.getTime() + 2 * 60 * 60 * 1000),
        capacity: 8,
        status: "scheduled",
      })
      .returning({ id: trips.id });
    if (!nightDive) throw new Error("could not seed the night dive");
    await db.insert(bookings).values({
      shopId: shop.id,
      tripId: nightDive.id,
      personId: person.id,
      status: "booked",
    });

    const seats = await findKioskSeats(db, {
      shopId: shop.id,
      lookup: readKioskInput(surname),
      now: atTheDoor,
    });
    expect(seats.map((row) => row.bookingId)).toEqual([booking.id]);
  });

  /**
   * **A diver who told the shop they need a hand meets a person.** Not a gate —
   * support needs never gate boarding and must never start — but a routing
   * rule: the whole value of a stated need is the conversation it starts at
   * arrival, and a tablet saying "You're set" is how the crew first hears about
   * it on the boat instead.
   */
  it("sends a diver with stated support needs to the desk", async () => {
    const { db, shop, booking, person, atTheDoor } = await counter();
    await db.insert(diveSupportNeeds).values({
      shopId: shop.id,
      personId: person.id,
      supportDiversNeeded: 1,
      supportDiversProvidedBy: "shop",
    });
    expect(
      await findKioskSeats(db, {
        shopId: shop.id,
        lookup: readKioskInput(booking.id),
        now: atTheDoor,
      }),
    ).toEqual([]);
  });

  /**
   * **And so does a minor.** A valid guardian co-signature makes a fourteen-
   * year-old `ready`, so readiness alone would have the tablet tell them they
   * are set — at a shop whose practice is to see the guardian at the counter.
   */
  it("sends a minor to the desk even when readiness clears them", async () => {
    const { db, shop, booking, person, reef, atTheDoor } = await counter();
    const fourteen = new Date(reef.startsAt.getTime());
    fourteen.setUTCFullYear(fourteen.getUTCFullYear() - 14);
    await db
      .update(people)
      .set({ dateOfBirth: fourteen.toISOString().slice(0, 10) })
      .where(eq(people.id, person.id));
    expect(
      await findKioskSeats(db, {
        shopId: shop.id,
        lookup: readKioskInput(booking.id),
        now: atTheDoor,
      }),
    ).toEqual([]);
  });
});

/**
 * **The provenance the shipped draft wrote and never read.**
 * `booking_arrival_events.display_token_id` existed from the first commit and
 * had no reader outside the CSV export's exclusion list, while three surfaces
 * went on reading `bookings.status = 'checked_in'` as evidence a person is in
 * the building. Both reviews landed on this as the change's central defect.
 */
describe("listSelfReportedArrivalBookingIds", () => {
  it("marks a tablet's arrival and leaves a staffer's alone", async () => {
    const { db, shop, link, booking, person, atTheDoor } = await counter();
    await clearForBoarding(db, shop.id, booking.id, person.fullName);
    const outcome = await checkInAtKiosk(db, {
      shopId: shop.id,
      displayTokenId: link.id,
      bookingId: booking.id,
      now: atTheDoor,
    });
    expect(outcome.ok).toBe(true);

    expect([...(await listSelfReportedArrivalBookingIds(db, shop.id, [booking.id]))]).toEqual([
      booking.id,
    ]);
    // Another shop's question about the same booking id answers nothing.
    expect(
      [...(await listSelfReportedArrivalBookingIds(db, OTHER_SHOP, [booking.id]))].length,
    ).toBe(0);
  });

  /**
   * **A staffer's later tap ends it.** Once a human has looked at the diver,
   * the arrival is a sighting again and the pill should say so — which is why
   * the latest event wins rather than "any tablet row, ever".
   */
  it("stops calling it self-reported once the desk confirms it", async () => {
    const { db, shop, link, booking, person, atTheDoor } = await counter();
    await clearForBoarding(db, shop.id, booking.id, person.fullName);
    await checkInAtKiosk(db, {
      shopId: shop.id,
      displayTokenId: link.id,
      bookingId: booking.id,
      now: atTheDoor,
    });
    // The desk's own row, written a minute later with no tablet on it.
    await db.insert(bookingArrivalEvents).values({
      shopId: shop.id,
      tripId: booking.tripId,
      bookingId: booking.id,
      recordedByPersonId: person.id,
      status: "arrived",
      source: "live",
      occurredAt: new Date(atTheDoor.getTime() + 60 * 1000),
    });
    expect([...(await listSelfReportedArrivalBookingIds(db, shop.id, [booking.id]))].length).toBe(
      0,
    );
  });

  /**
   * **The tie is the ordinary case, and it is broken by the trail's own three
   * keys.** `occurred_at` ties constantly — a frozen e2e clock, and a batched
   * offline sync replaying a queue of taps that all carry the moment the device
   * recorded them — so this read orders by `occurred_at`, `created_at`, `seq`,
   * the same keys `standingArrivalStatus` and `newestArrivalEvent` use. It
   * used to tie on `id`, a `defaultRandom()` uuid, and half of those coin flips
   * handed the desk row the win: the booking silently stopped reading as
   * self-reported, which is the direction that claims a human looked when none
   * did (`dive-domain-expert` and `security-reviewer`, 2026-09-11). The ids
   * below are written the wrong way round on purpose — under the old ordering
   * the row that should lose sorts first, every run.
   */
  it("lets the later tablet tap win an identical-timestamp tie", async () => {
    const { db, shop, link, booking, person, atTheDoor } = await counter();
    const tie = { occurredAt: atTheDoor, createdAt: atTheDoor };
    await db.insert(bookingArrivalEvents).values({
      id: "ffffffff-ffff-4fff-bfff-ffffffffffff",
      shopId: shop.id,
      tripId: booking.tripId,
      bookingId: booking.id,
      recordedByPersonId: person.id,
      status: "arrived",
      source: "live",
      ...tie,
    });
    await db.insert(bookingArrivalEvents).values({
      id: "00000000-0000-4000-8000-000000000001",
      shopId: shop.id,
      tripId: booking.tripId,
      bookingId: booking.id,
      recordedByPersonId: person.id,
      displayTokenId: link.id,
      status: "arrived",
      source: "live",
      ...tie,
    });

    expect([...(await listSelfReportedArrivalBookingIds(db, shop.id, [booking.id]))]).toEqual([
      booking.id,
    ]);
    // The manifest asks the same question a different way and must not get a
    // different answer.
    expect([
      ...(await listSelfReportedArrivalBookingIdsForTrip(db, shop.id, booking.tripId)),
    ]).toEqual([booking.id]);
  });

  it("lets the later desk tap win an identical-timestamp tie", async () => {
    const { db, shop, link, booking, person, atTheDoor } = await counter();
    const tie = { occurredAt: atTheDoor, createdAt: atTheDoor };
    await db.insert(bookingArrivalEvents).values({
      id: "ffffffff-ffff-4fff-bfff-ffffffffffff",
      shopId: shop.id,
      tripId: booking.tripId,
      bookingId: booking.id,
      recordedByPersonId: person.id,
      displayTokenId: link.id,
      status: "arrived",
      source: "live",
      ...tie,
    });
    await db.insert(bookingArrivalEvents).values({
      id: "00000000-0000-4000-8000-000000000001",
      shopId: shop.id,
      tripId: booking.tripId,
      bookingId: booking.id,
      recordedByPersonId: person.id,
      status: "arrived",
      source: "live",
      ...tie,
    });

    expect([...(await listSelfReportedArrivalBookingIds(db, shop.id, [booking.id]))].length).toBe(
      0,
    );
    expect(
      [...(await listSelfReportedArrivalBookingIdsForTrip(db, shop.id, booking.tripId))].length,
    ).toBe(0);
  });
});

describe("checkInAtKiosk", () => {
  it("records an arrival as the diver's own act, stamped with the tablet", async () => {
    const { db, shop, link, booking, person } = await counter();
    await clearForBoarding(db, shop.id, booking.id, person.fullName);

    const outcome = await checkInAtKiosk(db, {
      shopId: shop.id,
      displayTokenId: link.id,
      bookingId: booking.id,
    });
    expect(outcome).toMatchObject({ ok: true, bookingId: booking.id, alreadyArrived: false });

    const [saved] = await db.select().from(bookings).where(eq(bookings.id, booking.id));
    expect(saved?.status).toBe("checked_in");

    const trail = await db
      .select()
      .from(bookingArrivalEvents)
      .where(eq(bookingArrivalEvents.bookingId, booking.id));
    const arrival = trail.find((row) => row.displayTokenId === link.id);
    expect(arrival?.status).toBe("arrived");
    // The diver's own act: `recorded_by_person_id` is the diver, and the token
    // beside it is what tells this apart from a staffer's tap on a shop where
    // staff also dive.
    expect(arrival?.recordedByPersonId).toBe(person.id);
  });

  /**
   * **Nothing a diver taps in a lobby may reach the manifest.** Arrival is the
   * desk's question and boarding is the rail's, performed by a crew member with
   * the diver in front of them at roll call. The two vocabularies are kept
   * apart at the table — `arrival_status` has no `boarded` value at all — and
   * this is the assertion that keeps them apart in the code.
   */
  it("leaves the departure's roll call exactly as it found it", async () => {
    const { db, shop, link, booking, person, reef } = await counter();
    await clearForBoarding(db, shop.id, booking.id, person.fullName);
    const before = await db.select().from(rollCallEvents).where(eq(rollCallEvents.tripId, reef.id));
    const boardedBefore = await listDepartureBoardedBookingIds(db, shop.id, [reef.id]);

    await expect(
      checkInAtKiosk(db, { shopId: shop.id, displayTokenId: link.id, bookingId: booking.id }),
    ).resolves.toMatchObject({ ok: true });

    const after = await db.select().from(rollCallEvents).where(eq(rollCallEvents.tripId, reef.id));
    expect(after).toHaveLength(before.length);
    const boardedAfter = await listDepartureBoardedBookingIds(db, shop.id, [reef.id]);
    expect([...boardedAfter].sort()).toEqual([...boardedBefore].sort());
    expect(boardedAfter.has(booking.id)).toBe(false);

    // Belt and braces: no arrival this surface writes can even *say* boarded.
    const trail = await db
      .select({ status: bookingArrivalEvents.status })
      .from(bookingArrivalEvents)
      .where(eq(bookingArrivalEvents.bookingId, booking.id));
    expect(trail.every((row) => row.status === "arrived" || row.status === "cleared")).toBe(true);
  });

  /**
   * A diver who taps twice, or who was checked in at the desk a minute ago, is
   * asking the question they already asked. Say so warmly rather than refusing
   * — and write nothing the second time.
   */
  it("answers a second tap warmly and writes no second arrival", async () => {
    const { db, shop, link, booking, person } = await counter();
    await clearForBoarding(db, shop.id, booking.id, person.fullName);
    await checkInAtKiosk(db, { shopId: shop.id, displayTokenId: link.id, bookingId: booking.id });
    const afterFirst = await db
      .select()
      .from(bookingArrivalEvents)
      .where(eq(bookingArrivalEvents.bookingId, booking.id));

    const again = await checkInAtKiosk(db, {
      shopId: shop.id,
      displayTokenId: link.id,
      bookingId: booking.id,
    });
    expect(again).toMatchObject({ ok: true, alreadyArrived: true });
    const afterSecond = await db
      .select()
      .from(bookingArrivalEvents)
      .where(eq(bookingArrivalEvents.bookingId, booking.id));
    expect(afterSecond).toHaveLength(afterFirst.length);
  });

  /**
   * Readiness is what turns "You're set" into "See the desk", and it is re-read
   * here rather than trusted from the lookup. A diver whose waiver is unsigned
   * is refused **ashore**, while there is still somebody to talk to — which is
   * the whole reason the counter exists.
   */
  it("refuses a diver readiness will not clear, and leaves the seat booked", async () => {
    const { db, shop, link, booking } = await counter();
    const outcome = await checkInAtKiosk(db, {
      shopId: shop.id,
      displayTokenId: link.id,
      bookingId: booking.id,
    });
    expect(outcome).toEqual({ ok: false, reason: "not_ready" });
    const [saved] = await db.select().from(bookings).where(eq(bookings.id, booking.id));
    expect(saved?.status).toBe("booked");
    expect(
      await db
        .select()
        .from(bookingArrivalEvents)
        .where(eq(bookingArrivalEvents.bookingId, booking.id)),
    ).toEqual([]);
  });

  /**
   * **The door restates the reader's rules rather than trusting them.** The
   * lookup and the write are two calls, and only the first one filtered: a
   * booking id that reached this door by any other route — a second caller, a
   * replayed form post — inherited none of the tablet's window or its
   * desk-routing rules. Every one of these is a `not_found`, which the page
   * turns into the same "See the desk" every other refusal gets.
   */
  it("refuses on its own for a sailed boat, a stated support need, and a minor", async () => {
    const { db, shop, link, booking, person, reef, atTheDoor } = await counter();
    await clearForBoarding(db, shop.id, booking.id, person.fullName);
    const tap = (now: Date) =>
      checkInAtKiosk(db, {
        shopId: shop.id,
        displayTokenId: link.id,
        bookingId: booking.id,
        now,
      });

    // Four hours after it left, and a day before it leaves.
    expect(await tap(new Date(reef.startsAt.getTime() + 4 * 60 * 60 * 1000))).toMatchObject({
      ok: false,
      reason: "not_found",
    });
    expect(await tap(new Date(reef.startsAt.getTime() - 20 * 60 * 60 * 1000))).toMatchObject({
      ok: false,
      reason: "not_found",
    });

    const fourteen = new Date(reef.startsAt.getTime());
    fourteen.setUTCFullYear(fourteen.getUTCFullYear() - 14);
    await db
      .update(people)
      .set({ dateOfBirth: fourteen.toISOString().slice(0, 10) })
      .where(eq(people.id, person.id));
    expect(await tap(atTheDoor)).toMatchObject({ ok: false, reason: "not_found" });
    await db.update(people).set({ dateOfBirth: null }).where(eq(people.id, person.id));

    await db.insert(diveSupportNeeds).values({
      shopId: shop.id,
      personId: person.id,
      supportDiversNeeded: 1,
      supportDiversProvidedBy: "shop",
    });
    expect(await tap(atTheDoor)).toMatchObject({ ok: false, reason: "not_found" });

    // And the seat is untouched by any of the four.
    const [saved] = await db.select().from(bookings).where(eq(bookings.id, booking.id));
    expect(saved?.status).toBe("booked");
  });

  it("refuses a booking belonging to another shop", async () => {
    const { db, link, booking } = await counter();
    expect(
      await checkInAtKiosk(db, {
        shopId: OTHER_SHOP,
        displayTokenId: link.id,
        bookingId: booking.id,
      }),
    ).toEqual({ ok: false, reason: "not_found" });
  });

  /**
   * **The writer restates every predicate rather than inheriting one.** The
   * reader already excludes a departure the shop took off the board, so
   * nothing reaches here with a deleted trip's booking id by the normal
   * route — which is exactly why this is worth a test: this door has no
   * staffer behind it, and a second caller trusting the id it was handed is
   * how that stops being true.
   */
  it("refuses a booking on a departure the shop deleted", async () => {
    const { db, shop, link, booking, person, reef } = await counter();
    await clearForBoarding(db, shop.id, booking.id, person.fullName);
    await db.update(trips).set({ deletedAt: nowDate() }).where(eq(trips.id, reef.id));
    expect(
      await checkInAtKiosk(db, {
        shopId: shop.id,
        displayTokenId: link.id,
        bookingId: booking.id,
      }),
    ).toEqual({ ok: false, reason: "not_found" });
  });

  it("refuses a seat that is not bookable", async () => {
    const { db, shop, link, booking } = await counter();
    await db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, booking.id));
    expect(
      await checkInAtKiosk(db, {
        shopId: shop.id,
        displayTokenId: link.id,
        bookingId: booking.id,
      }),
    ).toEqual({ ok: false, reason: "not_bookable" });
  });

  /**
   * Revocation is the one door, and it is the same door the board's is. A
   * revoked tablet stops being able to look anybody up before it gets as far as
   * a booking, because the page and the action both open on
   * `verifyDisplayToken`.
   */
  it("goes dark when the shop revokes the tablet's link", async () => {
    const { db, shop, link } = await counter();
    const staff = await listStaff(db, shop.id);
    const owner = staff.find((entry) => entry.roles.includes("owner"));
    if (!owner) throw new Error("seeded shop has no owner");
    expect(
      await revokeDisplayToken(db, { shopId: shop.id, personId: owner.person.id, id: link.id }),
    ).toBe(true);
    expect(await verifyDisplayToken(db, { token: link.token, purpose: "check_in" })).toBeNull();
  });
});
