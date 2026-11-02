import { z } from "zod";

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
 * payload — ids only, plus the one thing a re-insert needs (a deleted note's
 * text).
 *
 * The action that removed something lands with `undoParams(offer)` in its
 * query; the page reads it back with `readUndoOffer`, and the toast posts the
 * same fields to the one generic `undoAction` (`src/app/actions/undo.ts`),
 * which dispatches to the kind's inverse through a registry typed over
 * `UNDO_KINDS` — a kind with no inverse is a compile error there. Each inverse
 * still calls the `src/db` restore that holds the real re-checks
 * (`restoreDiver`'s email clash, a card number re-entered since).
 *
 * Every field is untrusted: it arrives in a URL and comes back in a form post,
 * so each payload is a strict schema, every id a uuid, and the inverse re-runs
 * the same live gate as the removal it reverses.
 */
export const UNDO_KINDS = ["diver-card", "diver-note", "diver-removal"] as const;
export type UndoKind = (typeof UNDO_KINDS)[number];

/** Where a diver's removal was undone from, so the answer lands on the same page. */
export const UNDO_REMOVAL_FROM = ["record", "roster"] as const;

const person = z.uuid();

const UNDO_PAYLOADS = {
  /** A level, specialty or nitrox card archived from the record (`deleteCertificationAction`). */
  "diver-card": z.strictObject({
    undo: z.literal("diver-card"),
    undoPerson: person,
    undoCard: z.uuid(),
    cardType: z.enum(["level", "specialty", "nitrox"]),
  }),
  /** A staff note deleted from the record; restored by re-adding its text. */
  "diver-note": z.strictObject({
    undo: z.literal("diver-note"),
    undoPerson: person,
    // `addDiverNote`'s own bound, so an offer it would refuse is never made.
    noteBody: z.string().trim().min(1).max(1_000),
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
]);

/** One offer of Undo: the kind and the fields its inverse needs. */
export type UndoOffer = z.infer<typeof undoOffer>;
export type UndoOfferOf<K extends UndoKind> = Extract<UndoOffer, { undo: K }>;

/** The query params (and the toast's hidden fields) that carry an offer. */
export const UNDO_PARAMS = ["undo", "undoPerson", "undoCard", "cardType", "noteBody", "undoFrom"];

/**
 * The offer as flat strings, for the landing's query and the toast's hidden
 * inputs. Parsed before it is spelled, so a payload the reader would refuse
 * is a throw at the action that made it rather than an Undo that bounces.
 */
export function undoParams(offer: UndoOffer): Record<string, string> {
  return { ...undoOffer.parse(offer) };
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
