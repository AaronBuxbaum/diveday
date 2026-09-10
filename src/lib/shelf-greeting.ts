import { calendarDateInTimezone } from "@/lib/calendar-date";
import type { CertificationLevel } from "@/lib/certification-levels";
import { certificationRank } from "@/lib/readiness";

/**
 * **The two decisions behind a returning diver's storefront**, as pure
 * functions the page and its tests both read.
 *
 * Codes, never sentences (ADR 20260731-domain-layer-copy-leaks): which greeting
 * and whether the card clears the departure are decisions; the words are the
 * surface's.
 */

export type ShelfGreetingChoice =
  /** They hold a seat, and it is today in the shop's own day. */
  | { kind: "tonight"; ordinal: number }
  /** They hold a seat on a later day. */
  | { kind: "upcoming"; ordinal: number }
  /** Nothing booked. A greeting with no number, because there is nothing to count toward. */
  | { kind: "cold" };

/**
 * Which greeting this diver gets, and which visit their next one is.
 *
 * **The ordinal is days behind them plus one**, so a diver with eleven days on
 * file is on their twelfth. Both surfaces read the same `diveCount`, which is
 * what stops the storefront and the shelf disagreeing about how many times
 * somebody has been out.
 *
 * **"Today" is the shop's day, never the reader's.** A diver reading from a
 * hotel three zones east must not be told tonight about tomorrow, and `Intl`
 * falls back to the host zone — every DiveDay server is UTC — when no zone is
 * named, so the zone is a required parameter rather than a defaulted one.
 */
export function chooseShelfGreeting(input: {
  /** Days already dived with this shop. */
  diveCount: number;
  /** When their next seat leaves, or null when they hold none. */
  nextStartsAt: Date | null;
  now: Date;
  /** The shop's own zone. */
  timeZone: string;
}): ShelfGreetingChoice {
  if (!input.nextStartsAt) return { kind: "cold" };
  const ordinal = input.diveCount + 1;
  const sameDay =
    calendarDateInTimezone(input.nextStartsAt, input.timeZone) ===
    calendarDateInTimezone(input.now, input.timeZone);
  return sameDay ? { kind: "tonight", ordinal } : { kind: "upcoming", ordinal };
}

/**
 * **Does the card the shop holds clear what this departure demands?**
 *
 * The **ladder only** — the same narrowing `aboveStatedLevel` on the storefront
 * already makes. A specialty or a nitrox requirement is never cleared by this
 * function and stays a marker on the row, because a sentence claiming to clear
 * one would be a claim `src/lib/readiness.ts` never made.
 *
 * Scoped to a demand **above the entry rung**, deliberately: "your Open Water
 * card clears this" on every row of a board that asks for Open Water is noise,
 * and the sentence exists to answer the one row a reader would otherwise expect
 * to be closed to them.
 *
 * Never a gate. `trip-admission.ts` decides whether a seat may be sold and
 * `readiness.ts` decides whether a diver boards; this decides one sentence.
 */
export function cardClearsDeparture(
  held: CertificationLevel | null,
  required: CertificationLevel | null | undefined,
): boolean {
  if (!held || !required) return false;
  const demand = certificationRank(required);
  if (demand <= certificationRank("open_water")) return false;
  return certificationRank(held) >= demand;
}
