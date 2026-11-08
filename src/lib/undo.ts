import { z } from "zod";
import { isUuid } from "./uuid";

/**
 * **Take-it-back is a property the action declares** (issue #2764).
 *
 * A soft-delete that offers Undo used to wire its own way back three times
 * over: an inverse server action exported per page (`restoreCardAction`,
 * `restoreDiverNoteAction`, `restorePersonAction`, the roster's
 * `restoreDiverAction`), the redirect params that carried what to restore, and
 * an `<UndoToast>` bound to that one inverse. This module is the framework-free
 * half of the one declared shape that replaces them, modelled on
 * `held-sends.ts`'s `HELD_SEND_KINDS`: the kinds of undo, and each kind's
 * payload — ids only. A deleted note is named by its id, never its words: the
 * offer is a URL anyone on the crew can type, and a note's text riding in one
 * let its author save words of their choosing under a staffer's name (#3701).
 *
 * The action that removed something lands with `undoParams(offer)` in its
 * query; the page reads it back with `readUndoOffer`, and the toast posts the
 * same fields to the one generic `undoAction` (`src/app/actions/undo.ts`),
 * which dispatches to the kind's inverse through a registry typed over
 * `UNDO_KINDS` — a kind with no inverse is a compile error there. Each inverse
 * still calls the `src/db` restore that holds the real re-checks
 * (`restoreDiver`'s email clash, a card number re-entered since, a card's
 * window and who archived it).
 *
 * Every field is untrusted: it arrives in a URL and comes back in a form post,
 * so each payload is a strict schema, every id a uuid, and the inverse re-runs
 * the same live gate as the removal it reverses.
 */
export const UNDO_KINDS = [
  "diver-card",
  "diver-note",
  "diver-removal",
  "trip-conservation",
  "course-teaching-note",
] as const;
export type UndoKind = (typeof UNDO_KINDS)[number];

/** Where a diver's removal was undone from, so the answer lands on the same page. */
export const UNDO_REMOVAL_FROM = ["record", "roster"] as const;

/** Any uuid the rest of the app accepts (`isUuid`), not only an RFC version zod's `z.uuid()` knows. */
const id = () => z.string().refine(isUuid);
const person = id();
const revision = () =>
  z
    .string()
    .regex(/^[1-9][0-9]*$/)
    .refine((value) => Number.isSafeInteger(Number(value)) && Number(value) <= 2_147_483_647);

const UNDO_PAYLOADS = {
  "trip-conservation": z.strictObject({
    undo: z.literal("trip-conservation"),
    undoTrip: id(),
    undoRecord: id(),
    undoRevision: revision(),
  }),
  "course-teaching-note": z.strictObject({
    undo: z.literal("course-teaching-note"),
    undoTrip: id(),
    undoRevision: revision(),
  }),
  /** A level, specialty or nitrox card archived from the record (`deleteCertificationAction`). */
  "diver-card": z.strictObject({
    undo: z.literal("diver-card"),
    undoPerson: person,
    undoCard: id(),
    cardType: z.enum(["level", "specialty", "nitrox"]),
  }),
  /** A staff note deleted from the record, softly; restored by its id (`restoreDiverNote`). */
  "diver-note": z.strictObject({
    undo: z.literal("diver-note"),
    undoPerson: person,
    undoNote: id(),
  }),
  /** A diver removed from the roster (`deletePersonAction`). */
  "diver-removal": z.strictObject({
    undo: z.literal("diver-removal"),
    undoPerson: person,
    undoFrom: z.enum(UNDO_REMOVAL_FROM),
  }),
} as const satisfies { [K in UndoKind]: z.ZodType<{ undo: K }> };

const undoOffer = z.discriminatedUnion("undo", [
  UNDO_PAYLOADS["diver-card"],
  UNDO_PAYLOADS["diver-note"],
  UNDO_PAYLOADS["diver-removal"],
  UNDO_PAYLOADS["trip-conservation"],
  UNDO_PAYLOADS["course-teaching-note"],
]);

/** One offer of Undo: the kind and the fields its inverse needs. */
export type UndoOffer = z.infer<typeof undoOffer>;
export type UndoOfferOf<K extends UndoKind> = Extract<UndoOffer, { undo: K }>;

/** The query params (and the toast's hidden fields) that carry an offer. */
export const UNDO_PARAMS = [
  "undo",
  "undoPerson",
  "undoCard",
  "cardType",
  "undoNote",
  "undoFrom",
  "undoTrip",
  "undoRecord",
  "undoRevision",
];

/**
 * The offer as flat strings, for the landing's query and the toast's hidden
 * inputs — or `undefined` when the reader would refuse it. Never a throw: this runs after the removal
 * has committed, and a removal that cannot offer Undo still lands, on its
 * plain notice, rather than on an error page.
 */
export function undoParams(offer: UndoOffer): Record<string, string> | undefined {
  const parsed = undoOffer.safeParse(offer);
  return parsed.success ? { ...parsed.data } : undefined;
}

/**
 * The offer a URL or a form post carries, or `null` for none (or a broken
 * one). Reads only the offer's own params and ignores everything else, so a
 * page passes its whole `searchParams` and a post its whole form; a value
 * given twice is no offer at all.
 */
export function readUndoOffer(
  params: Record<string, string | string[] | FormDataEntryValue | FormDataEntryValue[] | undefined>,
): UndoOffer | null {
  const fields: Record<string, unknown> = {};
  for (const name of UNDO_PARAMS) {
    if (params[name] !== undefined) fields[name] = params[name];
  }
  const parsed = undoOffer.safeParse(fields);
  return parsed.success ? parsed.data : null;
}
