import { z } from "zod";
import type { FeaturesPageWrite, ShopSwitches } from "@/db/shops";
import { REPLY_NOTES_MAX_LENGTH } from "@/lib/assists/inbox";
import { allValues, checkbox, formValue, readForm } from "@/lib/form-parse";
import { SHOP_FEATURE_COLUMNS } from "@/lib/shop-features";
import {
  FEATURE_ROWS,
  type FeatureRowGate,
  type FeatureRowId,
  isOptionalFeature,
} from "./feature-rows";

/** The hidden field, one per row drawn, that tells the save which rows were on the page. */
export const ROWS_FIELD = "rows";

/**
 * Posted only when the page drew the notes for AI (assists lit). Without it
 * the save leaves the notes as they were: an absent box is not an empty one.
 */
export const REPLY_NOTES_DRAWN_FIELD = "replyNotesDrawn";

/** The notes for AI textarea. */
export const REPLY_NOTES_FIELD = "replyNotes";

/** The checkbox of a one-switch row. Diving keeps its three column names. */
export function switchField(id: FeatureRowId): string {
  return `feature:${id}`;
}

const DIVING_FIELDS = ["hasBoatDiving", "hasShoreDiving", "hasPoolDiving"] as const;

const featureForm = z.object({
  [ROWS_FIELD]: allValues(),
  ...Object.fromEntries(FEATURE_ROWS.map((row) => [switchField(row.id), checkbox()])),
  ...Object.fromEntries(DIVING_FIELDS.map((name) => [name, checkbox()])),
});

const notesForm = z.object({
  [REPLY_NOTES_DRAWN_FIELD]: checkbox(),
  [REPLY_NOTES_FIELD]: formValue(),
});

/** The column a one-switch row writes. */
function switchColumn(id: Exclude<FeatureRowId, "divingOptions">): keyof ShopSwitches {
  if (isOptionalFeature(id)) return SHOP_FEATURE_COLUMNS[id];
  return id === "tax" ? "taxEnabled" : "crewScheduleEnabled";
}

export type FeatureSavePlan =
  /** The post named no row this reader may flip: nothing to write. */
  | { kind: "nothing" }
  /** All three kinds of diving off: the whole save is refused. */
  | { kind: "diving-options-none" }
  | { kind: "write"; switches: FeaturesPageWrite };

/**
 * **What one Save of the Features page writes** (issue #2814, Aaron
 * 2026-10-23). The page posts every row it drew in `rows`; a row it did not
 * draw is absent from the post, and an absent checkbox only means "off" for a
 * row that was drawn. So a row is written only when the post lists it **and**
 * the reader passes its gate today; every other column is left exactly as it
 * was, never read as an unticked switch. A forged `rows` naming a row behind
 * a gate the reader fails is dropped the same way.
 *
 * Diving refuses all three off: a shop needs at least one kind of departure,
 * and the DB check refuses it too. That refusal stops the whole save, so a
 * Save either lands every switch or none, the notes for AI included.
 *
 * The notes for AI ride the same Save when the page drew their box (the
 * `replyNotesDrawn` marker): trimmed, capped at `REPLY_NOTES_MAX_LENGTH`, and
 * an empty box clears them. They are shop settings, the gate the whole action
 * already holds.
 */
export function planFeatureSave(
  formData: FormData,
  gates: ReadonlySet<FeatureRowGate>,
): FeatureSavePlan {
  const form = readForm(featureForm, formData) as Record<string, boolean> & {
    [ROWS_FIELD]: FormDataEntryValue[];
  };
  const listed = new Set(form[ROWS_FIELD]);
  const rows = FEATURE_ROWS.filter((row) => listed.has(row.id) && gates.has(row.gate));
  if (rows.length === 0) return { kind: "nothing" };

  const switches: FeaturesPageWrite = {};
  for (const row of rows) {
    if (row.id === "divingOptions") {
      const [hasBoatDiving, hasShoreDiving, hasPoolDiving] = DIVING_FIELDS.map(
        (name) => form[name] === true,
      );
      if (!hasBoatDiving && !hasShoreDiving && !hasPoolDiving) {
        return { kind: "diving-options-none" };
      }
      Object.assign(switches, { hasBoatDiving, hasShoreDiving, hasPoolDiving });
    } else {
      switches[switchColumn(row.id)] = form[switchField(row.id)] === true;
    }
  }
  const { [REPLY_NOTES_DRAWN_FIELD]: drawn, [REPLY_NOTES_FIELD]: notes } = readForm(
    notesForm,
    formData,
  );
  // Only a hand-built post sends the marker without the box's text: notes stay as they were.
  if (drawn && typeof notes === "string") {
    switches.replyNotes = notes.trim().slice(0, REPLY_NOTES_MAX_LENGTH) || null;
  }
  return { kind: "write", switches };
}
