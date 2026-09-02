/**
 * **The shop's QR door: a diver puts themselves on file before any booking
 * exists** (issue #1236).
 *
 * Twelve of the 32 products surveyed on 2026-09-01 offer QR or tablet self
 * check-in, and the two strongest 2026 newcomers make it the centre of their
 * pitch — ScubaHub's Drop Dive case study reports pre-arrival onboarding going
 * from 0% to 90–95% and check-in from five or six minutes to under one.
 * DiveDay's waiver arrived on a booking- or person-scoped link a staffer had to
 * issue, so a walk-in who had not booked had no door of their own.
 *
 * This module is the framework-free half: the form's shape, and the one rule
 * that shapes everything around it.
 *
 * ### The rule: the visitor is told nothing about themselves
 *
 * The write matches a returning diver by email, exactly as the importer does.
 * The *response* must not. If a returning diver's submission looked any
 * different from a new one's — a different message, a redirect somewhere else,
 * a visibly skipped step — then an anonymous visitor could type any email
 * address and learn whether that person is a customer of this shop. Medical
 * referral is the same class of leak in a worse form: a hard block is a fact
 * about the diver's health, and it belongs to the shop.
 *
 * So there is exactly one success outcome (`SELF_REGISTRATION_DONE`), and it is
 * the same page whether the person was created or found, whether a waiver was
 * sent or was already on file, and whether their answers refer them to a
 * physician or clear them outright. The shop learns all of it; the screen says
 * the same sentence either way.
 */

/** What the diver claims about their own certification. Never evidence. */
export const SELF_DECLARED_LEVELS = [
  "open_water",
  "advanced_open_water",
  "rescue",
  "divemaster",
  "instructor",
] as const;

export type SelfDeclaredLevel = (typeof SELF_DECLARED_LEVELS)[number];

/**
 * The one success state, and the only one a visitor may distinguish.
 *
 * A string rather than a boolean so the form state reads at the call site, and
 * so a future second *public* outcome has to be added here deliberately rather
 * than by somebody returning a different message from one branch.
 */
export const SELF_REGISTRATION_DONE = "done" as const;

/**
 * What the form hands back to its own client component.
 *
 * `error` is only ever about the submission itself — a missing name, an
 * unreadable date, a rate limit, a shop that does not exist. It is never about
 * *the person*: "we already have you" and "your answers need a doctor" are both
 * facts about a diver that this surface must not state.
 */
export type SelfRegistrationFormState =
  | { status?: undefined; error?: string }
  | { status: typeof SELF_REGISTRATION_DONE; error?: undefined };

/**
 * A registration the shop can act on has to be reachable. The form asks for
 * both and requires neither alone, because a diver at a counter may have only
 * one — but with neither, the row records a stranger nobody can contact, and
 * the waiver this exists to start has nowhere to go.
 *
 * The same shape `submitInquiryAction`'s `hasReplyPath` uses, and for the same
 * reason; kept separate because this one also decides whether a *person* is
 * matchable, which an inquiry never is.
 */
export function hasContactPath(input: { email?: string; phone?: string }): boolean {
  return Boolean(input.email?.trim() || input.phone?.trim());
}
