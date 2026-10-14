import { readTypedMoney } from "./forgiving-fields";
import { majorToMinor } from "./money";

/**
 * **The roster's Paid mark** (batch 6 item 1, H-decision "a hand-marked
 * payment records its money"). A staffer marking a seat paid or deposit-paid
 * says how much changed hands and how — cash, card on the shop's own
 * terminal, or anything else — so counter money reaches Reports instead of
 * a `paid` row with no amount, which every revenue sum read as $0.
 *
 * The split of who may do what follows the action's existing rule
 * (`markPaymentAction`, issue #714): recording money is crew work, deciding
 * about money is not. A Paid mark **with no money** is a free seat by another
 * name, so it takes the same write-off right a waiver does.
 */
export const MANUAL_PAYMENT_METHODS = ["cash", "card", "other"] as const;
export type ManualPaymentMethodCode = (typeof MANUAL_PAYMENT_METHODS)[number];

/** The statuses a hand mark can attach money to. */
const MONEY_STATUSES = new Set(["paid", "deposit_paid"]);

export type ManualPaymentMarkReading =
  /** Money changed hands: this much, this way. */
  | { kind: "money"; amountCents: number; method: ManualPaymentMethodCode }
  /** Paid or deposit-paid with no amount (blank or zero): a write-off. */
  | { kind: "no_money" }
  /** A status that carries no money of its own (unpaid, waived, refunded). */
  | { kind: "not_money" }
  /** Something was typed that cannot be read; never guessed at. */
  | { kind: "invalid"; field: "amount" | "method" };

export function isManualPaymentMethod(value: unknown): value is ManualPaymentMethodCode {
  return (MANUAL_PAYMENT_METHODS as readonly unknown[]).includes(value);
}

/**
 * Read one submission of the Paid mark. `amountRaw` is what the staffer typed,
 * in the shop's currency's major unit ("120", "$54.50", "62,50");
 * `methodRaw` is the method control's value.
 */
export function readManualPaymentMark(
  status: string,
  amountRaw: string | null,
  methodRaw: string | null,
  currency: string,
): ManualPaymentMarkReading {
  if (!MONEY_STATUSES.has(status)) return { kind: "not_money" };
  const typed = (amountRaw ?? "").trim();
  if (!typed) return { kind: "no_money" };
  const reading = readTypedMoney(typed, currency);
  if (!reading) return { kind: "invalid", field: "amount" };
  const amountCents = majorToMinor(Number(reading.canonical), currency);
  if (amountCents === 0) return { kind: "no_money" };
  if (!isManualPaymentMethod(methodRaw)) return { kind: "invalid", field: "method" };
  return { kind: "money", amountCents, method: methodRaw };
}

/** Whether this mark is a decision about money — the right `canRefund` gates. */
export function markNeedsWriteOffRight(reading: ManualPaymentMarkReading): boolean {
  return reading.kind === "no_money";
}

/**
 * What the seat's payment row holds once this mark lands. A row's
 * `amount_cents` is what the shop holds for the seat right now — every revenue
 * sum reads it that way — while the mark's amount is what changed hands at the
 * counter just now.
 *
 * The two differ in one case: a balance taken on a seat whose deposit was
 * *also* marked by hand. The row would otherwise forget the deposit, since the
 * write replaces it. A deposit a checkout took is not added here: the row says
 * `stripe`, and Reports already adds that deposit back from the checkout
 * (`getMonthlyReport`), so adding it here too would count it twice.
 */
export function heldCentsAfterMark(
  previous: { status: string; amountCents: number | null; provider: string | null } | null,
  nextStatus: string,
  takenCents: number,
): number {
  const manualDeposit =
    previous?.status === "deposit_paid" && previous.provider === null
      ? (previous.amountCents ?? 0)
      : 0;
  return nextStatus === "paid" ? manualDeposit + takenCents : takenCents;
}
