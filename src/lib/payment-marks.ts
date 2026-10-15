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

/**
 * **What a bounced Paid mark carries back, and nothing else** (issue #2607). A
 * Paid mark the server refuses redirects to the roster with a notice; without
 * this the sheet reopened empty and a staffer at the dock retyped the amount
 * and picked the method again after every error, with a line waiting.
 *
 * Three plain values ride the URL: which money status was picked, the amount in
 * the currency's smallest unit as digits, and the method's code. Nothing else
 * from the form does (no notes, no names), and none is echoed as typed: the
 * amount is the parsed figure, the status and method are matched against their
 * own lists, so an unreadable value is dropped, never repeated.
 */
export const MARK_RETRY_PARAMS = {
  status: "markStatus",
  amount: "markAmount",
  method: "markMethod",
} as const;

/** The largest amount the sheet will be pre-filled with: $1,000,000.00 in cents. */
const MARK_RETRY_MAX_CENTS = 100_000_000;

export type MarkRetry = {
  status: "paid" | "deposit_paid";
  amountCents: number | null;
  method: ManualPaymentMethodCode | null;
};

/**
 * The query values for `noticeUrl` when the Paid mark bounces: what the staffer
 * picked and typed, as far as it can be read. Empty for a status that carries
 * no money, so an unrelated refusal adds nothing to the URL.
 */
export function markRetryParams(
  status: string,
  amountRaw: string | null,
  methodRaw: string | null,
  currency: string,
): Record<string, string | undefined> {
  if (!MONEY_STATUSES.has(status)) return {};
  const typed = (amountRaw ?? "").trim();
  const reading = typed ? readTypedMoney(typed, currency) : null;
  const cents = reading ? majorToMinor(Number(reading.canonical), currency) : 0;
  return {
    [MARK_RETRY_PARAMS.status]: status,
    [MARK_RETRY_PARAMS.amount]:
      cents > 0 && cents <= MARK_RETRY_MAX_CENTS ? String(cents) : undefined,
    [MARK_RETRY_PARAMS.method]: isManualPaymentMethod(methodRaw) ? methodRaw : undefined,
  };
}

/**
 * Read a bounced Paid mark back off the page's query string. The params are
 * hand-editable, so each is validated on its own: an unknown status means no
 * retry at all, and an oversized, negative, fractional or non-numeric amount,
 * or an unknown method, falls back to empty rather than failing the page.
 */
export function readMarkRetry(raw: {
  status?: string;
  amount?: string;
  method?: string;
}): MarkRetry | null {
  if (raw.status !== "paid" && raw.status !== "deposit_paid") return null;
  const amountCents =
    raw.amount !== undefined && /^[1-9]\d{0,8}$/.test(raw.amount) ? Number(raw.amount) : null;
  return {
    status: raw.status,
    amountCents: amountCents !== null && amountCents <= MARK_RETRY_MAX_CENTS ? amountCents : null,
    method: isManualPaymentMethod(raw.method) ? raw.method : null,
  };
}

/**
 * Whether this mark is a decision about money — the right `canRefund` gates.
 *
 * Two marks are: Paid or Deposit paid with no money at all, and Paid on less
 * than the seat owes (`balanceOwedCents`, before the mark), which writes the
 * rest off however small the amount typed — a cent is not a payment for a
 * $120 seat. Crew may still record part of the fare as Deposit paid, which
 * settles nothing.
 */
export function markNeedsWriteOffRight(
  reading: ManualPaymentMarkReading,
  status: string,
  balanceOwedCents: number | null,
): boolean {
  if (reading.kind === "no_money") return true;
  return (
    reading.kind === "money" &&
    status === "paid" &&
    balanceOwedCents !== null &&
    reading.amountCents < balanceOwedCents
  );
}

/**
 * What the seat's payment row holds once this mark lands. A row's
 * `amount_cents` is what the shop holds for the seat right now — every revenue
 * sum reads it that way — while the mark's amount is what changed hands at the
 * counter just now.
 *
 * The two differ when the seat's deposit was *also* marked by hand. The row
 * would otherwise forget it, since the write replaces the row: a balance taken
 * adds to it, and a blank Paid mark (the rest written off) keeps it, with the
 * method it was taken by, rather than erasing cash the shop has. A deposit a
 * checkout took is not added here: the row says `stripe`, and Reports already
 * adds that deposit back from the checkout (`getMonthlyReport`), so adding it
 * here too would count it twice.
 */
export function heldAfterMark(
  previous: {
    status: string;
    amountCents: number | null;
    provider: string | null;
    method: ManualPaymentMethodCode | null;
  } | null,
  nextStatus: string,
  reading: ManualPaymentMarkReading,
): { amountCents: number | null; method: ManualPaymentMethodCode | null } {
  const handDeposit =
    previous?.status === "deposit_paid" && previous.provider === null && previous.amountCents
      ? { amountCents: previous.amountCents, method: previous.method }
      : null;
  if (reading.kind === "money") {
    return {
      amountCents:
        nextStatus === "paid"
          ? (handDeposit?.amountCents ?? 0) + reading.amountCents
          : reading.amountCents,
      method: reading.method,
    };
  }
  if (reading.kind === "no_money" && nextStatus === "paid" && handDeposit) return handDeposit;
  return { amountCents: null, method: null };
}
