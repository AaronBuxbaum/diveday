"use client";

import { useState } from "react";
import { FIGURE_HERO_CLASS } from "@/components/ui/typography";
import type { DiveDayTerms } from "@/features/fee-comparison";
import { percentFeeCents } from "@/lib/billing/pricing-plans";
import { formatMoneyScanned } from "@/lib/format";
import { MoneySlider } from "./MoneySlider";

/** Words resolved on the server; `received` holds `{amount}`. */
export type PricingCalculatorLabels = {
  sliderLabel: string;
  received: string;
  feeLabel: string;
};

const MAX_CENTS = 10_000_000;
const STEP_CENTS = 50_000;
const START_CENTS = 3_000_000;

/**
 * **What a month could cost, as a slider.** The shop moves the money received in a
 * month and reads the DiveDay fee for it, off the same integer arithmetic billing
 * uses (`percentFeeCents`), so the figure can never drift from an
 * invoice. The first paint is the starting month, server-rendered.
 */
export function PricingCalculator({
  labels,
  locale,
  terms,
}: {
  labels: PricingCalculatorLabels;
  locale: string;
  /** The offer's terms: a monthly fee and a percent of money received. */
  terms: DiveDayTerms;
}) {
  const [received, setReceived] = useState(START_CENTS);
  const money = (cents: number) => formatMoneyScanned(cents, "usd", locale);
  return (
    <div className="mt-8 grid gap-8 lg:grid-cols-[1.2fr_0.8fr] lg:items-center lg:gap-14">
      <MoneySlider
        label={labels.sliderLabel}
        value={received}
        min={0}
        max={MAX_CENTS}
        step={STEP_CENTS}
        format={money}
        onChange={setReceived}
      />
      <div>
        <p className="text-sm text-muted">{labels.feeLabel}</p>
        <p className={FIGURE_HERO_CLASS} aria-live="polite">
          {money(terms.monthlyCents + percentFeeCents(received, terms.basisPoints))}
        </p>
        <p className="mt-1 text-sm text-muted">
          {labels.received.replace("{amount}", money(received))}
        </p>
      </div>
    </div>
  );
}
