"use client";

import { useTranslations } from "next-intl";
import { FIGURE_INLINE_CLASS } from "@/components/ui/typography";
import { formatMoneyCents, formatShortDate } from "@/lib/format";
import type { ShopCurrency } from "@/lib/money";

/**
 * **The money, resolved once, directly above the pay button.**
 *
 * ADR 20260827-the-divers-thread, decision 2: "the money resolves in one total
 * block ... fare × party, gear, fee, tax, deposit split, one 'due now' figure."
 * Before this the booking card said the price five different ways — a card
 * description under the heading, a party total, a running checkout total, a
 * third-party fee line and a tax line, all `text-sm` siblings the diver had to
 * assemble — while the hero shouted a sixth figure a whole page above. This
 * component is the one place the arithmetic is *shown*, and the invariant it
 * exists to hold is that it renders **exactly one figure at or above
 * `text-lg`**: the total the diver is about to commit to. Everything else is a
 * supporting line at `text-sm`.
 *
 * It computes nothing the checkout does not: the caller hands it per-diver
 * amounts already resolved by `src/lib/courses.ts` and `src/lib/deposits.ts`,
 * and this file only multiplies by the party and lays the rows out. That is
 * deliberate — a second implementation of the fare arithmetic living in a
 * render is exactly how a quoted total and a charged one drift apart.
 *
 * Three silences are as load-bearing as the figure, and each is pinned in
 * `MoneyBlock.test.tsx`:
 *
 * - `dueNow: "none"` — an unpriced departure — renders **nothing at all**. Not
 *   a zero, not an empty shell: a trip with no price has no money story, and a
 *   "$0.00" under a Book button reads as a bug or as a promise.
 * - A line whose amount is absent does not render as a zero row (`gearCents:
 *   0`, `courseFeeCents: null`, `eLearningFeeCents: null`, `passThroughFeeLine:
 *   null`).
 * - **The deposit split exists only in checkout mode.** A book-now-pay-later
 *   seat never renders a deposit line, because nothing is being taken now and
 *   splitting a payment nobody is making invents a transaction.
 */
export type MoneyBlockDueNow = "checkout" | "at_shop" | "none";

export function MoneyBlock({
  fareCents,
  partySize,
  gearCents,
  courseFeeCents,
  eLearningFeeCents,
  passThroughFeeLine,
  passThroughTotalCents,
  taxLine,
  dueNow,
  depositCents,
  balanceDueAt,
  currency,
  locale,
  timeZone,
  className = "",
}: {
  /** The per-diver fare the checkout charges (`perDiverBookingPriceCents`). */
  fareCents: number;
  partySize: number;
  /** Rental gear for the whole party, already summed. `0` hides the line. */
  gearCents: number;
  /**
   * A course session's two priced halves, per diver, from `courseCharges`.
   * When either is present they *replace* the plain fare line rather than
   * sitting beside it — the fare on a course session **is** their sum
   * (`perDiverBookingPriceCents`), so rendering both would show the same money
   * twice and read as a total nearly double what the card is charged.
   */
  courseFeeCents: number | null;
  eLearningFeeCents: number | null;
  /**
   * The shop's third-party charge as words, already composed from
   * `parsePassThroughFee` by the caller. `null` hides the line — and a caller
   * with no fee to state passes `0` for its total.
   */
  passThroughFeeLine: string | null;
  passThroughTotalCents: number;
  /** `"checkout"` states that Stripe adds tax on top; `"none"` says nothing. */
  taxLine: "checkout" | "none";
  dueNow: MoneyBlockDueNow;
  /**
   * The per-diver deposit, when the departure takes one. Read only in
   * `"checkout"` mode; `null` charges the full fare now.
   */
  depositCents: number | null;
  /** When the remainder is owed — the departure's own day. Null with no deposit. */
  balanceDueAt: Date | null;
  currency: ShopCurrency;
  locale: string;
  /** The shop's zone: a date rendered without one reads in the host's (UTC). */
  timeZone: string;
  className?: string;
}) {
  const t = useTranslations("booking");
  const money = (cents: number) => formatMoneyCents(cents, currency, locale);
  if (dueNow === "none") return null;

  // The deposit is a checkout mechanism. In `at_shop` mode nothing is charged
  // now, so there is no "now" for a deposit to be due at.
  const deposit = dueNow === "checkout" ? depositCents : null;
  const extrasCents = gearCents + passThroughTotalCents;
  const totalCents = fareCents * partySize + extrasCents;
  const dueNowCents = deposit === null ? totalCents : deposit * partySize + extrasCents;
  const balanceCents = deposit === null ? 0 : (fareCents - deposit) * partySize;
  const courseLines = courseFeeCents !== null || eLearningFeeCents !== null;

  return (
    <dl className={`flex flex-col gap-2 ${className}`.trim()}>
      {courseLines ? (
        <>
          {courseFeeCents !== null ? (
            <Line label={t("money.courseFee")} value={money(courseFeeCents * partySize)} />
          ) : null}
          {eLearningFeeCents !== null ? (
            <Line label={t("money.eLearning")} value={money(eLearningFeeCents * partySize)} />
          ) : null}
        </>
      ) : (
        <Line
          label={t("money.fare", { price: money(fareCents), count: partySize })}
          value={money(fareCents * partySize)}
        />
      )}
      {gearCents > 0 ? <Line label={t("money.gear")} value={money(gearCents)} /> : null}
      {passThroughFeeLine ? (
        <Line label={passThroughFeeLine} value={money(passThroughTotalCents)} />
      ) : null}
      {taxLine === "checkout" ? (
        <Line label={t("money.tax")} value={t("money.taxAtCheckout")} />
      ) : null}
      {/* The one figure this block exists to state — in the *same formatter as
          its addends*. It briefly wore the hero's `formatMoneyScanned` so the
          number a diver commits to matched the number that brought them here,
          but that optimized hero↔total consistency at the cost of the column:
          "Course fee $195.00 / E-learning $150.00 / Due at the shop $345"
          reads as rounding, and within the column is where the eye checks the
          sum (principle 6: reconciled money carries its minor units always). */}
      <div className="flex items-baseline justify-between gap-4 border-t border-border pt-3">
        <dt className="text-sm font-medium">
          {dueNow === "checkout" ? t("money.dueNow") : t("money.dueAtShop")}
        </dt>
        <dd className={FIGURE_INLINE_CLASS}>{money(dueNowCents)}</dd>
      </div>
      {deposit !== null && balanceCents > 0 && balanceDueAt ? (
        <div className="text-sm text-muted tabular-nums">
          {t("money.balanceAtDock", {
            balance: money(balanceCents),
            when: formatShortDate(balanceDueAt, locale, timeZone),
          })}
        </div>
      ) : null}
    </dl>
  );
}

/** One supporting row: what it is on the left, what it costs on the right. */
function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-sm tabular-nums">{value}</dd>
    </div>
  );
}
