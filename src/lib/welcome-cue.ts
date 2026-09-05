import { nowDate } from "@/lib/clock";
import { DEPARTURE_BUFFER_MS } from "@/lib/closeout";

/**
 * **The welcome word under a diver's name** (issue #1182, delight report D22;
 * ADR 20260904-reef-all-the-way-down, slice 16d).
 *
 * A cue, not a badge, and the difference is written into the shape: it is
 * derived at read from the diver's own consent stamp and their own booking
 * history, it says one thing, and it stops existing an hour after the boat is
 * home. Nothing about it is stored on a person.
 *
 * Framework-free and code-only — the words are `src/i18n/welcome-cue-labels.ts`.
 */
export type WelcomeCue = { kind: "first_trip" } | { kind: "returning"; years: number };

/**
 * How long a gap has to be before coming back is worth a word.
 *
 * Two years, matched to `dive_recency_band`'s own reasoning that
 * `one_to_five_years` is ordinary for a holiday diver: a season off is not a
 * homecoming, and a crew greeting somebody "back after a year" when they dived
 * last August reads as a machine reciting a row. #1182 asks for a number per
 * cue kind and names none, so this is the recommendation rather than a ruling.
 */
export const WELCOME_GAP_YEARS = 2;

const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;

type CueInput = {
  /**
   * The start of this diver's most recent *departed* booking before this one,
   * or null when they have never been on a boat with this shop — the same
   * predicate `returningDiverIds` uses, so "first-timer" means one thing across
   * the app.
   */
  lastDivedAt: Date | null;
  tripEndsAt: Date;
  now?: Date;
};

/**
 * What there would be to say about this diver on this departure, consent set
 * aside. Null is the ordinary answer, in two ways:
 *
 * - **The boat is home.** An hour past the scheduled return
 *   ({@link DEPARTURE_BUFFER_MS}, the same late-arrival buffer every other
 *   departure check uses), the cue is gone. This is D22's expiry: a first-trip
 *   cue that lasts a season is a badge; one that lasts a day is a cue.
 * - **A short gap.** Under {@link WELCOME_GAP_YEARS}, coming back is ordinary
 *   and there is nothing to say.
 *
 * Exported for the diver's own `/ready` page, which has to be able to offer a
 * cue they have not consented to yet — that is the whole point of the question.
 * **No staff surface may call this**: theirs is {@link welcomeCueFor}, which
 * cannot answer without a consent stamp.
 */
export function offerableWelcomeCue({
  lastDivedAt,
  tripEndsAt,
  now = nowDate(),
}: CueInput): WelcomeCue | null {
  if (now.getTime() > tripEndsAt.getTime() + DEPARTURE_BUFFER_MS) return null;
  if (!lastDivedAt) return { kind: "first_trip" };
  const years = Math.floor((now.getTime() - lastDivedAt.getTime()) / YEAR_MS);
  return years >= WELCOME_GAP_YEARS ? { kind: "returning", years } : null;
}

/**
 * The cue a crew member reads, or null.
 *
 * **`sharedAt` is the gate, not the record.** A diver with a five-year gap who
 * never said the crew could know has no cue at all — Budget rule 6 doing its
 * job rather than a missing feature. Everything the cue then says is derived,
 * so taking the consent back takes the word off the manifest immediately.
 */
export function welcomeCueFor({
  sharedAt,
  ...input
}: CueInput & { sharedAt: Date | null }): WelcomeCue | null {
  return sharedAt ? offerableWelcomeCue(input) : null;
}
