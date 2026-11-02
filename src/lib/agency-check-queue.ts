import type { AgencyCheckQuery, AgencyListedKind, CheckableAgency } from "./agency-check";

/**
 * **"Check all N with their agencies", one card at a time** (H-20261008-cert-check-extension, layer 1 of
 * the cert-check extension's second round).
 *
 * A departure's Divers tab can hand every card the extension can check to the
 * extension in one tap. Each check is still the one-card check the diver record
 * runs: the extension reads the agency's page in the staffer's own browser, and
 * `agencyCheckAction` decides on the server whether it certifies. This module is
 * only the order of those checks, kept free of React and of the browser so the
 * rules it keeps can be tested by themselves:
 *
 * - **One request at a time**, with a short pause between, because twelve
 *   lookups in a row from one browser reads as a script, not a person.
 * - **Skips one unreadable result, stops on two in a row.** A single diver the
 *   agency's page does not show cleanly is that diver's (an odd spelling, a
 *   record the page lays out differently), so the run goes on. Two unreadable
 *   results or transport failures (the extension did not answer, or DiveDay's
 *   server did not) in a row is the page or the line, and the run stops so a
 *   broken or captcha'd agency page is not hammered. What was not checked is
 *   left exactly as it was, for the staffer.
 * - **Stops at once when the staffer is signed out of the agency** (PADI):
 *   that is the agency's state, not one diver's, and every card after it
 *   would meet the same sign-in.
 * - **Leaves an agency's other cards** when its page asks whether the staffer
 *   is human, has changed, or is not one this copy of the extension checks:
 *   that agency's state too, so its remaining cards are not sent, and the
 *   other agencies' go on. Not counted toward two unreadable in a row.
 * - **The staffer can stop it.** `cancelled` is asked before each card; the
 *   card in flight finishes, and nothing after it is sent.
 * - **Capped at the departure.** The caller hands in one departure's cards; the
 *   queue never reaches beyond the list it was given.
 * - **No undo of its own.** Each card's own Undo is the only way back, so one
 *   wrong tap can never uncertify a boat.
 */

/**
 * One card the extension can check, with the lookup it would type: a level
 * card, or a nitrox or specialty card (issue #2592), which says so in
 * `cardType` and names its kind.
 */
export type AgencyCheckableCard = {
  certificationId: string;
  /** Absent for a level card. A nitrox or specialty card is judged by its own rule and Undone by its own table. */
  cardType?: "nitrox" | "specialty";
  /** The kind a nitrox or specialty card is, for the words beside its button. */
  kind?: AgencyListedKind;
  personId: string;
  /** The diver's name as the shop holds it, for the queue's own words. */
  fullName: string;
  agency: CheckableAgency;
  query: AgencyCheckQuery;
};

/** What one card's check came to, as the queue reads it. */
export type AgencyCheckOutcome =
  /** The agency's page shows this diver at this level; the pending card is certified. */
  | "certified"
  /** The agency's page shows this diver at this level; the imported card is confirmed. */
  | "confirmed"
  /** The diver is on the page, this level is not: left for the staffer, with the page's words. */
  | "level_unconfirmed"
  /** The diver's card on the page is junior, limited or unfinished: left for the staffer. */
  | "limited_card"
  /** PADI shows a junior rating for a diver under 15: recorded by hand. */
  | "junior_under_15"
  /** Someone by this name, not with this birth date or number: left for the staffer. */
  | "namesake"
  /** The agency found nobody under this name: left for the staffer. */
  | "no_record"
  /** The agency listed several divers by this name (PADI): left for the staffer. */
  | "several_records"
  /** The page did not read as a result for this diver: skipped, and two in a row stop the queue. */
  | "unreadable"
  /** The agency's page asks whether the staffer is human: that agency's other cards are left. */
  | "captcha"
  /** The agency's lookup page has changed: that agency's other cards are left. */
  | "page_changed"
  | "manual_opened"
  /** This copy of the extension does not check the agency: its other cards are left. */
  | "unsupported"
  /** A lookup behind the shop's own sign-in (PADI) met a sign-in page: stops the queue at once. */
  | "signed_out"
  /** DiveDay's server did not answer: as unreadable, two in a row stop the queue. */
  | "transport"
  /** DiveDay refused this one card (already certified meanwhile, gone): the queue goes on. */
  | "refused";

/** The pause between two lookups. Short enough to wait out, long enough not to look like a script. */
export const AGENCY_CHECK_QUEUE_PAUSE_MS = 2_000;

/** Whether this outcome ends the run at once: every card after it would meet the same state. */
export function stopsAgencyCheckQueue(outcome: AgencyCheckOutcome): boolean {
  return outcome === "signed_out";
}

/** Whether this outcome counts toward the two in a row that stop the run. */
export function isUnreadableOutcome(outcome: AgencyCheckOutcome): boolean {
  return outcome === "unreadable" || outcome === "transport";
}

/** Whether this outcome leaves the rest of that agency's cards unsent: every one would meet the same page. */
export function leavesAgencyCards(outcome: AgencyCheckOutcome): boolean {
  return outcome === "captcha" || outcome === "page_changed" || outcome === "unsupported";
}

/** How many unreadable results or transport failures in a row stop the run. */
const UNREADABLE_IN_A_ROW = 2;

/**
 * The cards a "Check all" would send, in the order given, each card once.
 * Nothing is added: a departure's list is the whole of what a run may touch.
 */
export function agencyCheckQueueCards<Card extends { certificationId: string }>(
  cards: readonly Card[],
): Card[] {
  const seen = new Set<string>();
  const queue: Card[] = [];
  for (const card of cards) {
    if (seen.has(card.certificationId)) continue;
    seen.add(card.certificationId);
    queue.push(card);
  }
  return queue;
}

export type AgencyCheckQueueSummary<Card> = {
  /** How many cards were sent to the extension. */
  checked: number;
  /** How many pending cards the agency's page certified. */
  certified: number;
  /** How many imported cards the agency's page confirmed. */
  confirmed: number;
  /** The card the run stopped on, and why, or null when it ran to the end or was cancelled. */
  stopped: { card: Card; outcome: AgencyCheckOutcome } | null;
  /** The run was cancelled before it finished (the staffer stopped it, or the page went away). */
  cancelled: boolean;
  /**
   * Each agency whose other cards were left (`leavesAgencyCards`): the card
   * that met it, why, and how many of that agency's cards were not sent.
   */
  left: { card: Card; outcome: AgencyCheckOutcome; skipped: number }[];
};

/**
 * Run the checks one after another. `check` does one card end to end and
 * resolves with its outcome; a throw is read as a transport failure. `pause`
 * waits between two checks (never before the first, never after the last).
 * `cancelled` is asked before each card, so a page that unmounts stops asking.
 */
export async function runAgencyCheckQueue<
  Card extends { certificationId: string; agency?: string },
>(input: {
  cards: readonly Card[];
  check: (card: Card) => Promise<AgencyCheckOutcome>;
  pause: (ms: number) => Promise<void>;
  pauseMs?: number;
  /** Called as each card starts, with how many have finished before it. */
  onStart?: (card: Card, done: number) => void;
  /** Called as each card settles, with how many have finished including it. */
  onSettle?: (card: Card, outcome: AgencyCheckOutcome, done: number) => void;
  cancelled?: () => boolean;
}): Promise<AgencyCheckQueueSummary<Card>> {
  const cards = agencyCheckQueueCards(input.cards);
  const pauseMs = input.pauseMs ?? AGENCY_CHECK_QUEUE_PAUSE_MS;
  let checked = 0;
  let certified = 0;
  let confirmed = 0;
  let unreadableInARow = 0;
  const left: AgencyCheckQueueSummary<Card>["left"] = [];
  const leftFor = (card: Card) =>
    card.agency === undefined ? undefined : left.find((each) => each.card.agency === card.agency);
  const summary = (
    stopped: AgencyCheckQueueSummary<Card>["stopped"],
    cancelled: boolean,
  ): AgencyCheckQueueSummary<Card> => ({ checked, certified, confirmed, stopped, cancelled, left });
  let sent = 0;
  for (const card of cards) {
    if (input.cancelled?.()) return summary(null, true);
    const leaving = leftFor(card);
    if (leaving) {
      leaving.skipped += 1;
      continue;
    }
    if (sent > 0) {
      await input.pause(pauseMs);
      if (input.cancelled?.()) return summary(null, true);
    }
    sent += 1;
    input.onStart?.(card, checked);
    let outcome: AgencyCheckOutcome;
    try {
      outcome = await input.check(card);
    } catch {
      outcome = "transport";
    }
    checked += 1;
    if (outcome === "certified") certified += 1;
    if (outcome === "confirmed") confirmed += 1;
    unreadableInARow = isUnreadableOutcome(outcome) ? unreadableInARow + 1 : 0;
    if (leavesAgencyCards(outcome) && card.agency !== undefined) {
      left.push({ card, outcome, skipped: 0 });
    }
    input.onSettle?.(card, outcome, checked);
    if (stopsAgencyCheckQueue(outcome) || unreadableInARow >= UNREADABLE_IN_A_ROW) {
      return summary({ card, outcome }, false);
    }
  }
  return summary(null, false);
}
