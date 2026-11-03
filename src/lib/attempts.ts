/**
 * **The attempt grammar** (issue #2703): one sentence for every ledger that
 * records work DiveDay still owes someone.
 *
 * A row is `pending` until a worker takes it, `in_flight` while a call is out,
 * and `done` or `failed` with a reason. Each ledger keeps its own status word
 * (`started`, `owed`, `pending`), because the word is part of the table's own
 * story, and {@link LEDGER_STATES} says which grammar state each word is. A new
 * status value fails `tsc` here until it is placed.
 *
 * Work is **unfinished** when its state is one the kind lists
 * ({@link ATTEMPT_RULES}`.unfinished`) and, for `in_flight`, when the call has
 * been out longer than the kind's window. One reader, `src/db/unfinished.ts`,
 * asks that question for every kind; each surface still shows its own kinds in
 * its own words (Orders for money, Settings' Data group for erasure, Today for
 * what is loud).
 *
 * Two kinds have no status column at all, and that is on purpose: an owed
 * shop-cancellation refund is derived (a captured seat on a cancelled trip),
 * and a failed refund is owed until the amount refunded catches up. They join
 * the grammar as a fixed state, so the reader treats them like any other kind.
 */

import type {
  MediaDeletionAttempt,
  PaymentOperationIntent,
  ProcessorErasureObligation,
} from "@/db/schema";
import { DAY_MS, MINUTE_MS } from "./clock";

export type AttemptState = "pending" | "in_flight" | "done" | "failed";

export const UNFINISHED_KINDS = [
  "payment_operation",
  "media_deletion",
  "processor_erasure",
  "shop_cancellation_refund",
  "failed_refund",
] as const;

export type UnfinishedKind = (typeof UNFINISHED_KINDS)[number];

export type AttemptRule = {
  /**
   * How long a call may be out before the row is stuck. Zero means there is no
   * window: the row is unfinished from the moment it exists.
   */
  stuckAfterMs: number;
  /**
   * How long the row waits before Today raises it. Today is for what is loud,
   * so it can wait longer than the kind's own queue, never less. Today reads
   * only payment operations, media deletes and owed shop-cancellation refunds;
   * for the other kinds this is the rule it would read with.
   */
  todayAfterMs: number;
  /** The grammar states a reader lists for this kind. */
  unfinished: readonly AttemptState[];
};

/**
 * The five-minute payment window: longer than any Stripe round trip, so a
 * `started` intent this old belonged to a call that died. Also the horizon of
 * every claim taken for such a call (checkout seats, counter claims, refund
 * locks), which is why those read it from here.
 */
const PAYMENT_WINDOW_MS = 5 * MINUTE_MS;

export const ATTEMPT_RULES = {
  /**
   * A Stripe side effect still `started` past the window: the process died
   * mid-call, or between the call and the local write that should have
   * followed (CR-005). A `failed` intent is Stripe's answer, not owed work.
   */
  payment_operation: {
    stuckAfterMs: PAYMENT_WINDOW_MS,
    todayAfterMs: PAYMENT_WINDOW_MS,
    unfinished: ["in_flight"],
  },
  /**
   * A stored-image delete. Most rows are queued and attempted in one call, so
   * a `pending` row past the window means that call died; a `failed` one is
   * owner-visible and retryable at once (CR-012). An erasure or a rejected
   * doctor's form queues its deletes inside its transaction and leaves them
   * to the daily retry, so those sit `pending` until it runs: never skip a
   * `pending` row as "already in flight", or those deletes starve.
   */
  media_deletion: {
    stuckAfterMs: PAYMENT_WINDOW_MS,
    todayAfterMs: PAYMENT_WINDOW_MS,
    unfinished: ["in_flight", "failed"],
  },
  /**
   * The processor half of an erasure. Owed from the moment the scrub commits;
   * a failed delete leaves it owed, with its reason, never failed and gone
   * (ADR 20260803-processor-erasure-obligations).
   */
  processor_erasure: { stuckAfterMs: 0, todayAfterMs: 0, unfinished: ["pending"] },
  /**
   * A captured seat on a departure the shop called off. Orders lists it at
   * once; Today raises it after a day.
   *
   * The day is measured from `trips.cancelled_at`, when the money became owed,
   * not from when the diver paid: a Saturday charter everyone paid for weeks
   * ago would otherwise be past the bound the moment it blew out, and a cash
   * walk-in for a Friday-evening dive would hide until Saturday. A trip
   * cancelled before that column existed has a null, read as stale: failing
   * toward showing the money is the right direction to fail.
   */
  shop_cancellation_refund: { stuckAfterMs: 0, todayAfterMs: DAY_MS, unfinished: ["pending"] },
  /** A refund Stripe accepted and later reported failed or canceled (issue #2291). */
  failed_refund: { stuckAfterMs: 0, todayAfterMs: 0, unfinished: ["failed"] },
} as const satisfies Record<UnfinishedKind, AttemptRule>;

/**
 * Each ledger's own status word, placed in the grammar. A media deletion's
 * `pending` is `in_flight`: a delete is attempted as it is queued, or by the
 * daily retry when an erasure queued it inside a transaction.
 */
export const LEDGER_STATES = {
  payment_operation: {
    started: "in_flight",
    succeeded: "done",
    failed: "failed",
  } satisfies Record<PaymentOperationIntent["status"], AttemptState>,
  media_deletion: {
    pending: "in_flight",
    succeeded: "done",
    failed: "failed",
  } satisfies Record<MediaDeletionAttempt["status"], AttemptState>,
  processor_erasure: {
    owed: "pending",
    discharged: "done",
  } satisfies Record<ProcessorErasureObligation["status"], AttemptState>,
} as const;

/**
 * The derived kinds, which have no status column and read as one fixed state.
 * Their readers keep their own predicates; this says where they sit in the
 * grammar, and their `unfinished` lists say the same thing.
 */
export const DERIVED_STATES = {
  shop_cancellation_refund: "pending",
  failed_refund: "failed",
} as const satisfies Record<Exclude<UnfinishedKind, keyof typeof LEDGER_STATES>, AttemptState>;

export type LedgerKind = keyof typeof LEDGER_STATES;
export type LedgerStatus<K extends LedgerKind> = keyof (typeof LEDGER_STATES)[K] & string;

/** A ledger's status words that sit in any of `states`, in declaration order. */
export function ledgerStatuses<K extends LedgerKind>(
  kind: K,
  states: readonly AttemptState[],
): LedgerStatus<K>[] {
  const words = LEDGER_STATES[kind] as Record<string, AttemptState>;
  return Object.keys(words).filter((word) =>
    states.includes(words[word] as AttemptState),
  ) as LedgerStatus<K>[];
}

/**
 * The unfinished status words of a ledger, split by whether the window
 * applies: `windowed` rows (a call is out) count only once they are older than
 * the window, `always` rows count at any age.
 */
export function unfinishedStatuses<K extends LedgerKind>(
  kind: K,
): { windowed: LedgerStatus<K>[]; always: LedgerStatus<K>[] } {
  const listed: readonly AttemptState[] = ATTEMPT_RULES[kind].unfinished;
  return {
    windowed: ledgerStatuses(
      kind,
      listed.filter((state) => state === "in_flight"),
    ),
    always: ledgerStatuses(
      kind,
      listed.filter((state) => state !== "in_flight"),
    ),
  };
}

/**
 * The cutoff a kind's own queue reads with, from the caller's `now`: rows in
 * flight since before it are stuck. Null when the kind has no window.
 */
export function stuckBefore(kind: UnfinishedKind, now: Date): Date | null {
  const { stuckAfterMs } = ATTEMPT_RULES[kind];
  return stuckAfterMs > 0 ? new Date(now.getTime() - stuckAfterMs) : null;
}

/** The cutoff Today reads with, from its own `now`. Null when Today raises at once. */
export function raisedOnTodayBefore(kind: UnfinishedKind, now: Date): Date | null {
  const { todayAfterMs } = ATTEMPT_RULES[kind];
  return todayAfterMs > 0 ? new Date(now.getTime() - todayAfterMs) : null;
}

/** The claim horizon of a payment call: a claim older than this belonged to a call that died. */
export const PAYMENT_CLAIM_STALE_AFTER_MS: number = ATTEMPT_RULES.payment_operation.stuckAfterMs;
