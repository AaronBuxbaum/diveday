import { and, eq, inArray, isNull, or } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import { busyOnLockWait } from "@/db/lock-bounds";
import { people, personRoles, shops } from "@/db/schema";
import { findSimilarDivers } from "@/features/people/divers";
import { personNamesMatch } from "@/lib/person-name";
import { phoneForStorage } from "@/lib/phone";
import { type SeatDiverChannel, type SeatDiverRefusal, seatDiver } from "../seat-diver";
import type { PastedPerson } from "./read";

/**
 * **Seating a pasted trip list** ("Try it Saturday", item 1): who on the
 * list is already on file, and then everybody seated, each on a booking of
 * their own.
 *
 * Each person is their own booking, not one party of fifteen. A booking
 * tool's manifest is a list of passengers from many bookings: a party would
 * make the first name the lead of strangers, put the rest on one payment and
 * one waiver queue, and refuse everybody when one seat cannot be had. Per
 * seat, the one who cannot be seated is named and the rest sail.
 *
 * Nobody is refused for a name that reads like somebody on file. The match is
 * shown per row with a default, and staff change the few that need it:
 *
 * - the diver on file when the email or number is theirs and the name agrees;
 * - otherwise a new person, with the namesakes offered beside it.
 */

/** "New person": what a row's choice says when it is not a record's id. */
export const PASTE_NEW_PERSON = "new";

export type PasteCandidate = {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  /** Found by the row's own email or number, not only by its name. */
  byContact: boolean;
};

export type PasteMatch = {
  candidates: PasteCandidate[];
  /** A candidate's id, or {@link PASTE_NEW_PERSON}. */
  choice: string;
};

/**
 * The people on file each pasted row could be, contact matches first, and the
 * default choice. Shop scoped, live divers only.
 */
export async function matchPastedPeople(
  db: AppDb,
  shopId: string,
  pasted: readonly Pick<PastedPerson, "fullName" | "email" | "phone">[],
): Promise<PasteMatch[]> {
  const [shop] = await db
    .select({ country: shops.addressCountry })
    .from(shops)
    .where(eq(shops.id, shopId))
    .limit(1);
  const stored = pasted.map((person) =>
    person.phone ? phoneForStorage(person.phone, shop?.country) : null,
  );
  const emails = [...new Set(pasted.flatMap((person) => (person.email ? [person.email] : [])))];
  const phones = [...new Set(stored.filter((phone): phone is string => Boolean(phone)))];
  const byContact =
    emails.length || phones.length
      ? await db
          .selectDistinct({
            id: people.id,
            fullName: people.fullName,
            email: people.email,
            phone: people.phone,
          })
          .from(people)
          .innerJoin(personRoles, eq(personRoles.personId, people.id))
          .where(
            and(
              eq(people.shopId, shopId),
              eq(personRoles.role, "diver"),
              isNull(people.deletedAt),
              or(
                emails.length ? inArray(people.email, emails) : undefined,
                phones.length ? inArray(people.phone, phones) : undefined,
              ),
            ),
          )
      : [];

  const matches: PasteMatch[] = [];
  // One at a time: a list of two hundred must not take every pooled connection.
  for (const [index, person] of pasted.entries()) {
    const phone = stored[index];
    const contact = byContact
      .filter(
        (row) =>
          (person.email !== undefined && row.email === person.email) ||
          (phone !== null && phone !== undefined && row.phone === phone),
      )
      .map((row) => ({ ...row, byContact: true }));
    const named = (await findSimilarDivers(db, shopId, person.fullName))
      .filter((diver) => !contact.some((row) => row.id === diver.id))
      .map((diver) => ({
        id: diver.id,
        fullName: diver.fullName,
        email: diver.email,
        phone: diver.phone,
        byContact: false,
      }));
    const sure = contact.find((row) => personNamesMatch(row.fullName, person.fullName));
    matches.push({ candidates: [...contact, ...named], choice: sure?.id ?? PASTE_NEW_PERSON });
  }
  return matches;
}

export type PastedSeatRequest = Pick<PastedPerson, "row" | "fullName" | "email" | "phone"> & {
  choice: string;
};

export type PastedSeatOutcome =
  | {
      ok: true;
      /** The row's number in what was pasted. */
      row: number;
      fullName: string;
      bookingId: string;
      reached: SeatDiverChannel[];
      /** Seated on a namesake's record and held until a staffer confirms it is them. */
      held: boolean;
    }
  | { ok: false; row: number; fullName: string; reason: SeatDiverRefusal | "busy" };

/**
 * Seat every row on the departure, each through `seatDiver`, in list order.
 * A refusal names its row and the next row is still tried.
 *
 * A chosen record must be one the preview could have offered for that row,
 * re-read here: a posted id never names somebody the staffer was not shown.
 * A record picked by its name alone carries the typed name, so the booking
 * holds the seat when the names disagree (issue #1556), as the counter's
 * name prompt does; one picked by its own email or number lands released, as
 * a search pick does.
 */
export async function seatPastedList(
  db: AppDb,
  input: {
    shopId: string;
    tripId: string;
    actorPersonId: string;
    rows: readonly PastedSeatRequest[];
  },
): Promise<PastedSeatOutcome[]> {
  const picked = input.rows.filter((row) => row.choice !== PASTE_NEW_PERSON);
  const offered = await matchPastedPeople(db, input.shopId, picked);
  const outcomes: PastedSeatOutcome[] = [];
  for (const row of input.rows) {
    let diver: Parameters<typeof seatDiver>[1]["diver"];
    if (row.choice === PASTE_NEW_PERSON) {
      diver = { fullName: row.fullName, email: row.email, phone: row.phone };
    } else {
      const candidate = offered[picked.indexOf(row)]?.candidates.find(
        (option) => option.id === row.choice,
      );
      if (!candidate) {
        outcomes.push({
          ok: false,
          row: row.row,
          fullName: row.fullName,
          reason: "person_not_found",
        });
        continue;
      }
      diver = candidate.byContact
        ? { personId: candidate.id }
        : { personId: candidate.id, fromNameMatch: { typedName: row.fullName } };
    }
    const result = await seatDiver(db, {
      shopId: input.shopId,
      tripId: input.tripId,
      actorPersonId: input.actorPersonId,
      diver,
      entry: "roster",
      refusals: "specific",
    }).catch(busyOnLockWait);
    if (result === "busy") {
      outcomes.push({ ok: false, row: row.row, fullName: row.fullName, reason: "busy" });
    } else if (!result.ok) {
      outcomes.push({ ok: false, row: row.row, fullName: row.fullName, reason: result.reason });
    } else {
      outcomes.push({
        ok: true,
        row: row.row,
        fullName: result.personName,
        bookingId: result.bookingId,
        reached: result.reached,
        held: result.identityUnconfirmed,
      });
    }
  }
  return outcomes;
}
