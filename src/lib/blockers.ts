import { type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import type { ReadinessBlocker } from "./readiness";
import { type BlockerDestinationContext, blockerDestination } from "./today";

/**
 * Pointing a blocked diver's worst blocker at the surface that clears it —
 * the framework-free half of the counter's blocked rows.
 *
 * This file used to carry the whole by-departure "Not ready" queue as well: a
 * second grouping, a second urgency banding, and an `alsoOn` annotation over a
 * page of trips. That view retired with the shop home's recomposition into the
 * day spine (ADR 20260827-clearwater-surface-language, decision 4), and its
 * shapes went with it rather than being left behind as a queue nothing reads.
 * What survives is the one rule two live surfaces still share — the counter's
 * blocked rows and the Today queue's diver rows resolve a blocker through
 * `blockerDestination` (`./today.ts`), so neither can drift about a diver they
 * both show.
 */

/**
 * A blocked row's one action. `sendsWaiver` rows post the send in place
 * (`bookingId` is the payload); every other row navigates to `href`. The label
 * is a verb only on the sends — a navigating row points ("Open Priya's record",
 * "Open roster") rather than pretending to act.
 */
export type BlockerFix = {
  label: string;
  href: string;
  sendsWaiver: boolean;
  bookingId: string;
};

/**
 * The one-tap fix for a diver's *worst* blocker: a missing/pending/expired
 * waiver sends from here; card evidence lives on the person record; payment and
 * setup work lives on the trip roster (anchored to the diver's booking).
 *
 * Shaping only — `blockerDestination` (`today.ts`) decides where the link goes
 * and what it says, so the counter and the Today queue cannot drift apart about
 * a diver they both show.
 *
 * `t` defaults to English so every existing call site keeps working unchanged;
 * a locale-aware caller passes its own.
 */
export function blockerFixFor(
  blockers: readonly ReadinessBlocker[],
  ctx: BlockerDestinationContext,
  t: StaffTranslator = staffTranslator("en-US"),
): BlockerFix | null {
  const destination = blockerDestination(blockers, ctx, t);
  if (!destination) return null;
  return {
    label: destination.label,
    href: destination.href,
    sendsWaiver: destination.sendsWaiver,
    bookingId: ctx.bookingId,
  };
}
