"use server";

import { getDb } from "@/db/client";
import { requireShopSurface } from "@/features/accounts/session";
import {
  matchPastedPeople,
  PASTE_CHOICE_FIELD,
  PASTE_NEW_PERSON,
  type PasteCandidate,
  type PastedPerson,
  type PastedSeatOutcome,
  type PasteListRefusal,
  readPastedList,
  seatPastedList,
} from "@/features/bookings/paste-list";
import { isUuid } from "@/lib/uuid";

/**
 * **Paste a list onto this departure** ("Try it Saturday", item 1). One
 * action, two steps, answered in the form rather than by a redirect: the
 * names, emails and numbers on a list never travel in a URL.
 *
 * - `read`: the pasted text read into people, each with who on file they
 *   could be and a default. Nothing is written.
 * - `seat`: the same text read again (the browser's copy of the preview is
 *   never trusted) with the staffer's choice for each person, and everybody
 *   seated on a booking of their own (`seatPastedList`, which says why).
 *
 * Staff only and shop scoped: `requireShopSurface` refuses a slug that is not
 * the session's shop, and every read and write takes the session's shop id.
 */

export type PasteListPreviewRow = PastedPerson & {
  candidates: PasteCandidate[];
  choice: string;
};

export type PasteListState =
  | { step: "refused"; reason: PasteListRefusal | "invalid" }
  | {
      step: "preview";
      text: string;
      rows: PasteListPreviewRow[];
      skipped: number;
      duplicates: number;
    }
  | { step: "seated"; outcomes: PastedSeatOutcome[] };

function listText(formData: FormData): string | null {
  const value = formData.get("list");
  return typeof value === "string" ? value : null;
}

export async function pasteListAction(
  shopSlug: string,
  tripId: string,
  _previous: PasteListState | undefined,
  formData: FormData,
): Promise<PasteListState> {
  const session = (await requireShopSurface(shopSlug)).session;
  const shopId = session.user.shopId;
  const text = listText(formData);
  if (text === null || !isUuid(tripId)) return { step: "refused", reason: "invalid" };
  const read = readPastedList(text);
  if (!read.ok) return { step: "refused", reason: read.reason };
  const db = await getDb();

  if (formData.get("step") !== "seat") {
    const matches = await matchPastedPeople(db, shopId, read.people);
    return {
      step: "preview",
      text,
      rows: read.people.map((person, index) => ({
        ...person,
        candidates: matches[index]?.candidates ?? [],
        choice: matches[index]?.choice ?? PASTE_NEW_PERSON,
      })),
      skipped: read.skipped,
      duplicates: read.duplicates,
    };
  }

  const choices = formData.getAll(PASTE_CHOICE_FIELD);
  if (
    choices.length !== read.people.length ||
    choices.some((choice) => typeof choice !== "string" || !validChoice(choice))
  ) {
    return { step: "refused", reason: "invalid" };
  }
  const outcomes = await seatPastedList(db, {
    shopId,
    tripId,
    actorPersonId: session.user.personId,
    rows: read.people.map((person, index) => ({
      row: person.row,
      fullName: person.fullName,
      email: person.email,
      phone: person.phone,
      choice: String(choices[index]),
    })),
  });
  // Not revalidated here: a refreshed page could fill the boat and take the
  // band, and this result with it, off the screen before it is read. The
  // panel's Done refreshes the guest list.
  return { step: "seated", outcomes };
}

function validChoice(choice: string): boolean {
  return choice === PASTE_NEW_PERSON || isUuid(choice);
}
