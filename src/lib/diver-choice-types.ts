/** Client-safe projection shared by UI and the feature store; no runtime database import. */
import type { people, rentalFitProfiles } from "@/db/schema";

export type BookableDiver = {
  person: typeof people.$inferSelect;
  rentalFit: typeof rentalFitProfiles.$inferSelect | null;
};

/**
 * One name the counter is being asked about, and the one fact that makes the
 * question answerable.
 *
 * A list of five names is not evidence: the name is what the staffer just
 * typed, which is why every one of them is on the list. "Is this the same
 * Nadia who dived yesterday?" is a question about a *day*, so the day comes
 * with the name (issue #1556).
 */
export type SimilarDiver = {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  /**
   * The person row's own date of birth, as stored (a `YYYY-MM-DD` calendar
   * date), or null when nobody has put one on file — which is the normal case
   * for a record the counter created, since the staff create-diver form does
   * not ask for it.
   *
   * **Printed on purpose** (H-20260916-unconfirmed-identity-withhold-cost, issue #1698): it is the field that most
   * reliably tells two people with one name apart, the staffer is already
   * choosing between two humans, and it is a weaker disclosure than the
   * emergency contact the manifest prints. The raw date goes no further than
   * this prompt: roster, manifest and check-in still print only what follows
   * from it (age, minor, birthday), and the kiosk strips it entirely.
   */
  dateOfBirth: string | null;
  /**
   * The most recent departure this diver was actually on, or null when this
   * shop has no dive day on file for them.
   *
   * **A dive day is `diveDay()`** (`src/db/dive-days.ts`, issue #1694): a
   * booking that is neither cancelled nor `no_show`, on a live departure the
   * shop still says ran or the crew logged a dive on, that has already left.
   * The recap's count reads the same predicate, so this prompt never names a
   * day the diver's own recap refuses to count. A `no_show` has no escape
   * (`dive-domain-expert`, 2026-09-11); the argument is on
   * `seatCanBeDiveDay`. The fly-safe reader alone widens the rule, letting a
   * roll-call boarding outrank a later cancellation; this prompt would rather
   * ask the staffer, who can see the person, than assume.
   *
   * **Whether a null says anything on screen is not this reader's call**: it
   * speaks when a sibling candidate has a day and is silent when they all
   * lack one, argued once on `noDiveDayNeedsSaying`
   * (`src/lib/name-match-evidence.ts`) so the three doors rendering the prompt
   * cannot answer it two ways.
   */
  lastDiveDayAt: Date | null;
};
