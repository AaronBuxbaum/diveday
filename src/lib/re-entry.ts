import type { reEntryAsk } from "@/db/schema";
import { nowDate } from "@/lib/clock";

/**
 * **Kind re-entry for a diver who has been away** (ADR
 * 20260904-reef-all-the-way-down, D18/#1178).
 *
 * D18's boundary is one sentence: offer support without shame and without a
 * silent gate, and suppress it when there is too little time to act. So this
 * file has no `blocks()`, no warning, and no minimum — three asks a diver may
 * tap, and a window in which the shop can still answer one.
 *
 * **What triggers it is the diver's own tap**, not a recency fact. The public
 * departure page is anonymous end to end — divers have no accounts, and
 * `bookings.last_dived_band` is asked on `/ready`, after the seat — so looking
 * recency up from a typed email would be an enumeration oracle on an
 * unauthenticated form. Asking for recency on the booking form was separately
 * declined by the owner (ADR 20260821-currency-is-what-catches-people: "the
 * booking form is a checkout and every field on it is paid for in abandoned
 * carts"). A diver who has just chosen "getting comfortable again" has told us
 * the same thing, in this session, at no cost.
 */
export type ReEntryAsk = (typeof reEntryAsk.enumValues)[number];

/**
 * The three asks, in the order they are offered — smallest to largest, so a
 * diver who wants nothing more than a word on deck reads that first.
 *
 * A runtime tuple with a `satisfies`, so a value added to the pgEnum without a
 * label here is a compile error.
 *
 * The drawn fourth offer, "a five-minute refresher to read tonight", is
 * deliberately absent: no such primer exists anywhere in this product, and
 * offering one would be a promise DiveDay cannot keep.
 */
export const RE_ENTRY_ASKS = [
  "deck_word",
  "easy_first_dive",
  "refresher_course",
] as const satisfies readonly ReEntryAsk[];

/**
 * **The offers actually worth making**, which is all three only where the shop
 * publishes a refresher course: an ask about a course nobody runs is a question
 * with no answer.
 *
 * One list, read by the surface that renders the offers *and* by the action
 * that accepts one (`saveReEntryAskFromReady`). Two copies drifted the moment
 * they existed: the readiness page filtered `refresher_course` out for a shop
 * with no refresher, while the action re-derived only the saved intent and the
 * 24-hour window and took the third ask from anyone who posted it — a crafted
 * submission, or an ordinary one from a page rendered before the shop
 * deactivated its refresher course, recording an offer the shop cannot make
 * (caught in review of PR #1416).
 */
export function reEntryOffersFor(hasRefresherCourse: boolean): readonly ReEntryAsk[] {
  return hasRefresherCourse
    ? RE_ENTRY_ASKS
    : RE_ENTRY_ASKS.filter((ask) => ask !== "refresher_course");
}

/**
 * The DiveDay-published course templates that *are* a refresher, by slug
 * (`src/db/course-templates.ts`). A shop's own course copied from one of these
 * keeps the slug, so this recognises the shop's course without reading its
 * prose — and a shop that wrote its own refresher under its own name is simply
 * not recognised, which costs the diver the third ask and never a wrong answer.
 */
export const REFRESHER_TEMPLATE_SLUGS = [
  "scuba-refresher",
  "ssi-scuba-skills-update",
  "sdi-inactive-diver-scuba-refresher",
] as const;

/** Whether a shop's course is one a diver easing back could be pointed at. */
export function isRefresherCourse(course: {
  sourceTemplateSlug: string | null;
  isActive: boolean;
}): boolean {
  if (!course.isActive || !course.sourceTemplateSlug) return false;
  return (REFRESHER_TEMPLATE_SLUGS as readonly string[]).includes(course.sourceTemplateSlug);
}

/** How much notice a shop needs for any of the three asks to be worth making. */
const RE_ENTRY_NOTICE_MS = 24 * 60 * 60 * 1000;

/**
 * Whether there is still time for the shop to act on an ask.
 *
 * Closed inside 24 hours of the departure, and closed once it has left — D18's
 * "suppress it when there is too little time to act". A diver booking the
 * morning boat tonight gets the question they can answer (the intent) and not
 * the one nobody can act on; the crew still reads the intent count.
 */
export function reEntryWindowOpen(startsAt: Date, now: Date = nowDate()): boolean {
  return startsAt.getTime() - now.getTime() > RE_ENTRY_NOTICE_MS;
}

/** A posted or stored value narrowed to one of the three, or null. Never trusts the post. */
export function parseReEntryAsk(value: unknown): ReEntryAsk | null {
  return typeof value === "string" && (RE_ENTRY_ASKS as readonly string[]).includes(value)
    ? (value as ReEntryAsk)
    : null;
}
