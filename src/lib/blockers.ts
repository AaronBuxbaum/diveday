import {
  blockerActionLabelCopy,
  pointingLabelCopy,
  type WaiverBatchCode,
} from "@/i18n/today-labels";
import type { Copy } from "./copy";
import type { ReadinessBlocker, ReadinessBlockerCode } from "./readiness";
import { KIND_SEVERITY, type TodayActionKind } from "./today-kinds";

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
 * `blockerDestination` (below), so neither can drift about a diver they
 * both show.
 */

/**
 * The blocker codes a one-tap send actually resolves. A minor's solo
 * signature is one: the issue path refuses to count that record as standing,
 * so the tap supersedes it and mints a link that asks for both signatures
 * (ADR 20260907-guardian-co-signature). A lapsed release is another, for the
 * same reason: it no longer stands, so the tap mints a fresh link.
 */
const WAIVER_CODES = new Set<ReadinessBlockerCode>([
  "waiver_not_sent",
  "waiver_lapsed",
  "waiver_runs_out",
  "waiver_pending",
  "waiver_expired",
  "guardian_signature_missing",
]);

export function isWaiverCode(code: ReadinessBlockerCode): code is WaiverBatchCode {
  return WAIVER_CODES.has(code);
}

/**
 * Blocked divers are the reason this page exists, so each blocker resolves to
 * the one surface that actually fixes it. Card evidence lives on the person
 * record; waiver, payment, and requirement work lives on the trip roster. The
 * words for `actionLabel`/`groupLabel` live in `src/i18n/today-labels.ts`
 * (`BLOCKER_ACTION_LABEL_KEYS`), keyed by the same
 * `ReadinessBlockerCode` — this map only states kind and target.
 */
export const BLOCKER_ACTIONS: Record<
  ReadinessBlockerCode,
  { kind: TodayActionKind; target: "trip" | "diver" }
> = {
  requirements_not_configured: { kind: "requirements", target: "trip" },
  identity_unconfirmed: { kind: "identity", target: "trip" },
  // Targets the diver: the fix is either a corrected date of birth on their
  // record or a conversation with the family, never a change to the trip.
  under_minimum_age: { kind: "certification", target: "diver" },
  waiver_not_sent: { kind: "waiver", target: "trip" },
  waiver_lapsed: { kind: "waiver", target: "trip" },
  waiver_runs_out: { kind: "waiver", target: "trip" },
  waiver_pending: { kind: "waiver", target: "trip" },
  waiver_expired: { kind: "waiver", target: "trip" },
  // **The diver, not the departure**, since #1252 gave the hold a door: the
  // physician clearance that ends it is recorded on the diver's own record, and
  // it is a fact about the person rather than about Saturday's boat. It pointed
  // at the trip roster, where `medical_review` has no action at all — so the
  // one blocker in the app that needed a human to walk somewhere sent them to
  // the surface that could do the least about it.
  medical_review: { kind: "medical_review", target: "diver" },
  // The diver too, and for a sharper reason than the row above: the work a
  // refusal creates is entirely about the person — tell them, move them, refund
  // them — and none of it happens on the departure they can no longer join.
  medical_not_cleared: { kind: "medical_not_cleared", target: "diver" },
  guardian_signature_missing: { kind: "waiver", target: "trip" },
  // The roster is where a paper copy is recorded and the link is sent.
  course_form_unsigned: { kind: "waiver", target: "trip" },
  course_form_guardian_missing: { kind: "waiver", target: "trip" },
  // The mark is fixed or cleared on the departure's own roster.
  training_mark_invalid: { kind: "waiver", target: "trip" },
  certification_missing: { kind: "certification", target: "diver" },
  certification_pending: { kind: "certification", target: "diver" },
  certification_self_declared: { kind: "certification", target: "diver" },
  certification_insufficient: { kind: "certification", target: "diver" },
  certification_not_yet: { kind: "certification", target: "diver" },
  certification_in_training: { kind: "certification", target: "diver" },
  specialty_missing: { kind: "certification", target: "diver" },
  specialty_pending: { kind: "certification", target: "diver" },
  // An imported specialty card is one tap from clearing its gate, so this reads
  // as a confirmation, not a card to chase (ADR 20260725-import-specialty-cards).
  specialty_import_unconfirmed: { kind: "certification", target: "diver" },
  nitrox_missing: { kind: "certification", target: "diver" },
  nitrox_pending: { kind: "certification", target: "diver" },
  nitrox_self_declared: { kind: "certification", target: "diver" },
  payment_due: { kind: "payment", target: "trip" },
  payment_refunded: { kind: "payment", target: "trip" },
  readiness_unavailable: { kind: "readiness_unavailable", target: "trip" },
};

/**
 * A diver with three blockers is one piece of work, not three rows. The queue
 * shows the hardest blocker as the headline and keeps the rest as detail, so a
 * single person can't flood the list.
 */
export function primaryBlocker(blockers: readonly ReadinessBlocker[]): ReadinessBlocker | null {
  let best: ReadinessBlocker | null = null;
  for (const blocker of blockers) {
    if (!best) {
      best = blocker;
      continue;
    }
    const candidate = KIND_SEVERITY[BLOCKER_ACTIONS[blocker.code].kind];
    if (candidate < KIND_SEVERITY[BLOCKER_ACTIONS[best.code].kind]) best = blocker;
  }
  return best;
}

/**
 * Where a staffer goes to clear a diver's *worst* blocker, and what the link
 * says when they get there.
 *
 * This is the one blocker->destination rule. It used to be six identical lines
 * in two places — here and `blockerFixFor` (`src/lib/blockers.ts`) — kept in
 * step by a comment saying they were kept in step. The two callers are the
 * Today queue and the by-departure blocker view, which sit one tap apart and
 * are meant to agree about a diver (`src/db/blockers.ts` says so at the read);
 * the readiness *data* was already shared, the destination derived from it was
 * not. Each caller still shapes its own result — a `TodayAction` and a
 * `BlockerFix` are different objects with different jobs — but neither decides
 * where the link goes any more.
 *
 * Lives here, below Today (`src/features/today`), because the counter's and
 * the palette's fixes (`blockerFixFor`, `src/lib/palette-answer.ts`) read it
 * from the substrate too, and nothing in `src/lib` may import a feature.
 */
export type BlockerDestination = {
  blocker: ReadinessBlocker;
  kind: TodayActionKind;
  target: "trip" | "diver";
  sendsWaiver: boolean;
  /** The words, as a key the renderer resolves: this module decides the fix, not the language. */
  label: Copy;
  href: string;
};

export type BlockerDestinationContext = {
  shopSlug: string;
  tripId: string;
  personId: string;
  bookingId: string;
  fullName: string;
};

export function blockerDestination(
  blockers: readonly ReadinessBlocker[],
  ctx: BlockerDestinationContext,
): BlockerDestination | null {
  const blocker = primaryBlocker(blockers);
  if (!blocker) return null;
  const { kind, target } = BLOCKER_ACTIONS[blocker.code];
  const sendsWaiver = isWaiverCode(blocker.code);
  return {
    blocker,
    kind,
    target,
    sendsWaiver,
    // Waiver rows send in place, so they keep the verb; a card row only opens
    // the person record, so it points instead of pretending to act.
    label: sendsWaiver
      ? blockerActionLabelCopy(blocker.code)
      : pointingLabelCopy(target, ctx.fullName),
    href:
      target === "diver"
        ? `/shop/${ctx.shopSlug}/divers/${ctx.personId}`
        : `/shop/${ctx.shopSlug}/trips/${ctx.tripId}#booking-${ctx.bookingId}`,
  };
}

/**
 * A blocked row's one action. `sendsWaiver` rows post the send in place
 * (`bookingId` is the payload); every other row navigates to `href`. The label
 * is a verb only on the sends — a navigating row points ("Open Priya's record",
 * "Open roster") rather than pretending to act.
 */
export type BlockerFix = {
  label: Copy;
  href: string;
  sendsWaiver: boolean;
  bookingId: string;
};

/**
 * The one-tap fix for a diver's *worst* blocker: a missing/pending/expired
 * waiver sends from here; card evidence lives on the person record; payment and
 * setup work lives on the trip roster (anchored to the diver's booking).
 *
 * Shaping only — `blockerDestination` (above) decides where the link goes
 * and what it says, so the counter and the Today queue cannot drift apart about
 * a diver they both show.
 *
 * The label is a `Copy`, not a sentence: the caller that renders it owns the
 * locale (`resolveCopy`), so nothing here defaults to English.
 */
export function blockerFixFor(
  blockers: readonly ReadinessBlocker[],
  ctx: BlockerDestinationContext,
): BlockerFix | null {
  const destination = blockerDestination(blockers, ctx);
  if (!destination) return null;
  return {
    label: destination.label,
    href: destination.href,
    sendsWaiver: destination.sendsWaiver,
    bookingId: ctx.bookingId,
  };
}
