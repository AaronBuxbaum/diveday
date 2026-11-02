import type { StaffGapCode } from "@/lib/staffing-week";

export type StaffingWeekWords = {
  /** Each person's week in one figure, by person id (`personTotalsWords`, item 52). */
  personTotals?: Readonly<Record<string, string>>;
  /** Names the grid to a screen reader. */
  ariaLabel: string;
  previous: string;
  next: string;
  thisWeek: string;
  today: string;
  /** The header of the person column — visually empty, never nameless. */
  person: string;
  /** The gap row's own label. */
  needsCrew: string;
  shiftsAndAway: string;
  /** "Assign", the gap's one act. */
  assign: string;
  /** "Assign crew to {trip}" — what that link is called out of context. */
  assignAria: string;
  /** "Crewing" — what a departure chip is, said to a screen reader only. */
  crewing: string;
  remove: string;
  removing: string;
  /** "{person}, {day}" — names a day's shift disclosure. */
  shiftAria: string;
  /** The whole week, nobody scheduled and nothing to crew. */
  empty: string;
  /** "Away" — what a blackout chip is (issue #1235). */
  away: string;
  /** "Away {dates}" — the warning a crewed departure wears when a blackout overlaps it. */
  awayConflict: string;
  /**
   * "Also rostered on {departure}" (issue #1695, reworded under H-20260916-may-one-hull-carry): this person is
   * rostered on another departure at these very hours. Named, never counted —
   * which boat is the question a manager has the moment they see it.
   */
  crewClash: string;
  /** "Ask for this one" — a crew member's own request. */
  request: string;
  /** "Ask to work {trip}" — that button out of context. */
  requestAria: string;
  requesting: string;
  /** "{person} asked" — one pending request on a gap. */
  requested: string;
  approve: string;
  decline: string;
  deciding: string;
  /** "Approved" / "Declined" — a request that has been answered. */
  requestApproved: string;
  requestDeclined: string;
  /** Beside the ask, when the reader's being aboard would not close it (#1339). */
  askWontClose: string;
  /**
   * Beside Approve, when approving *this* ask would not close it (#1339). The
   * decider is the one person on this surface who can, and they were the one
   * reader never told.
   */
  requestWontClose: string;
  /**
   * Under a gap's code when a lapsed rating is why it is short (issue #1853):
   * the crew list names somebody, and the chip alone read as nobody.
   */
  ratingLapsed: string;
  ratingUnverified: string;
  /**
   * "until {time} · from {day}" — a window that began on an earlier day and
   * ends on this one (UX review 2026-10-13, item 21). The whole range on the
   * second day read as a second night boat.
   */
  continuedUntil: string;
  /** "from {day}" — a middle day of a window that neither starts nor ends on it. */
  continuedFrom: string;
};

export type StaffingWeekLinks = {
  rangeLabel: string;
  previousHref: string;
  nextHref: string;
  /** Null while the week on screen is the one the shop is in. */
  thisWeekHref: string | null;
};

/** The one word a gap code renders as, resolved by the page. */
export type GapWords = Record<StaffGapCode, string>;
