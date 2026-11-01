import type { welcomeHello } from "@/db/schema";
import { nowDate } from "@/lib/clock";
import { DEPARTURE_BUFFER_MS } from "@/lib/trips";
import { type DiveDayMilestone, diveDayMilestone } from "@/lib/visit-milestones";

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
/** What a first-timer chose to add to the hello (issue #2425): a fixed choice, never free text. */
export type WelcomeHello = (typeof welcomeHello.enumValues)[number];

/**
 * The choices in the order `/ready` offers them. A tuple with a `satisfies`,
 * like `DIVE_INTENTS`: a value here that the pgEnum lacks is a compile error.
 */
export const WELCOME_HELLOS = [
  "first_ocean_dive",
  "celebrating",
  "nervous",
] as const satisfies readonly WelcomeHello[];

export type WelcomeCue =
  /** `nonDiver`: a snorkeler's or a rider's first seat, which is not a "first dive". */
  | { kind: "first_trip"; nonDiver?: true }
  | { kind: "returning"; years: number }
  /**
   * A regular's 10th, 25th, 50th or 100th dive day with the shop (H-20261014-boat-count-milestones): a count,
   * never a badge. Staff-side only, behind the same consent as every cue.
   */
  | { kind: "milestone"; count: DiveDayMilestone };

/** What the diver's own `/ready` may offer: never a milestone, which is the crew's line. */
export type OfferableWelcomeCue = Exclude<WelcomeCue, { kind: "milestone" }>;

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
   * predicate the reminder sweep once used, so "first-timer" keeps one meaning
   * across the app.
   */
  lastDivedAt: Date | null;
  /** This seat is a snorkeler's or a rider's, so its first time is not a first dive. */
  nonDiver?: boolean;
  /**
   * Which dive day with the shop this departure's day is, for a diver
   * (`diveDayOrdinal`: one calendar day is one day, imported visits included).
   * Absent for a snorkeler's or a rider's seat, which counts no milestone.
   */
  diveDayCount?: number | null;
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
  nonDiver = false,
  tripEndsAt,
  now = nowDate(),
}: CueInput): OfferableWelcomeCue | null {
  if (now.getTime() > tripEndsAt.getTime() + DEPARTURE_BUFFER_MS) return null;
  if (!lastDivedAt)
    return nonDiver ? { kind: "first_trip", nonDiver: true } : { kind: "first_trip" };
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
}: CueInput & {
  sharedAt: Date | null;
  /**
   * Required here, though optional on the diver's own offer: a staff caller
   * that forgot it would silently never say a milestone (H-20261014-boat-count-milestones).
   */
  diveDayCount: number | null;
}): WelcomeCue | null {
  if (!sharedAt) return null;
  return milestoneCue(input) ?? offerableWelcomeCue(input);
}

/**
 * **A regular's milestone dive day** (H-20261014-boat-count-milestones, fifth-loop ideas item 39): said on
 * the 10th, 25th, 50th and 100th and on no other, with the cue's own expiry an
 * hour after the boat is home. It outranks "back after N years" on the rare
 * day both are true: the count is the news, and one line under a name says one
 * thing. Never on a non-diver's seat, whose count is not of dives.
 */
function milestoneCue({
  diveDayCount,
  nonDiver = false,
  tripEndsAt,
  now = nowDate(),
}: CueInput): WelcomeCue | null {
  if (nonDiver) return null;
  if (now.getTime() > tripEndsAt.getTime() + DEPARTURE_BUFFER_MS) return null;
  const count = diveDayMilestone(diveDayCount);
  return count ? { kind: "milestone", count } : null;
}
