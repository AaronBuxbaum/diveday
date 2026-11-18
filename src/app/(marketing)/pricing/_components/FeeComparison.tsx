"use client";

import { type ReactNode, useState } from "react";
import { Switch } from "@/components/ui/Switch";
import { FIGURE_LARGE_CLASS, ITEM_TITLE_CLASS } from "@/components/ui/typography";
import {
  COMPARED_SYSTEMS,
  type ComparedSystem,
  compareMonth,
  type DiveDayTerms,
} from "@/features/fee-comparison";
import { formatMoneyScanned } from "@/lib/format";
import { cachedFormatter } from "@/lib/intl-cache";
import { MoneySlider } from "./MoneySlider";

/** Words resolved on the server; `range` holds `{low}` and `{high}`, `totalNote` and `saving` hold percents. */
export type FeeComparisonLabels = {
  sliderLabel: string;
  marketplaceToggle: string;
  marketplaceShareLabel: string;
  subscription: string;
  free: string;
  bookingFee: string;
  otaFee: string;
  processing: string;
  marketplace: string;
  total: string;
  range: string;
  totalNote: string;
  saving: string;
  systems: Record<ComparedSystem, { name: string; note: string }>;
};

const MAX_CENTS = 10_000_000;
const STEP_CENTS = 50_000;
const START_CENTS = 3_000_000;
const START_SHARE = 20;

/**
 * **The same month on two systems.** One slider for the money received, a switch
 * that adds Booking.com's commission (with the share of money that comes through
 * it), and one column per system. The arithmetic is `compareMonth`, tested in
 * `src/features/fee-comparison/rules.test.ts`; the sources and assumptions are written on the
 * page beside it. DiveDay's column is highlighted and its terms are the offer's.
 */
export function FeeComparison({
  labels,
  locale,
  diveDay,
  saving,
}: {
  labels: FeeComparisonLabels;
  locale: string;
  diveDay: DiveDayTerms;
  /** What a sale moved off a marketplace keeps, at each end of their range, as fractions of the sale. */
  saving: { low: number; high: number };
}) {
  const [received, setReceived] = useState(START_CENTS);
  const [withMarketplace, setWithMarketplace] = useState(false);
  const [share, setShare] = useState(START_SHARE);
  const money = (cents: number) => formatMoneyScanned(cents, "usd", locale);
  const percent = (fraction: number) =>
    cachedFormatter("num", Intl.NumberFormat, locale, {
      style: "percent",
      maximumFractionDigits: 1,
    }).format(fraction);
  const rows = compareMonth(received, withMarketplace ? share / 100 : 0, diveDay);
  const range = (low: string, high: string, same: boolean) =>
    same ? low : labels.range.replace("{low}", low).replace("{high}", high);
  return (
    <div className="mt-10">
      <div className="grid gap-8 lg:grid-cols-2 lg:gap-14">
        <MoneySlider
          label={labels.sliderLabel}
          value={received}
          min={0}
          max={MAX_CENTS}
          step={STEP_CENTS}
          format={money}
          onChange={setReceived}
        />
        <div className="space-y-4">
          <Switch
            checked={withMarketplace}
            onChange={setWithMarketplace}
            label={labels.marketplaceToggle}
          />
          {withMarketplace ? (
            <MoneySlider
              label={labels.marketplaceShareLabel}
              value={share}
              min={0}
              max={80}
              step={5}
              format={(value) => percent(value / 100)}
              onChange={setShare}
            />
          ) : null}
        </div>
      </div>

      <ul className="mt-10 grid gap-6 lg:grid-cols-2">
        {COMPARED_SYSTEMS.map((system) => {
          const row = rows.find((candidate) => candidate.system === system);
          if (!row) return null;
          const mine = system === "diveday";
          return (
            <li
              key={system}
              className={`flex flex-col rounded-panel border p-6 ${mine ? "border-primary bg-surface" : "border-border"}`}
            >
              <h3 className={ITEM_TITLE_CLASS}>{labels.systems[system].name}</h3>
              <p className="mt-1 min-h-[4.5rem] text-sm leading-6 text-muted">
                {labels.systems[system].note}
              </p>
              <dl className="mt-4 space-y-2 border-t border-border pt-4 text-sm">
                <Line label={labels.subscription}>
                  {row.subscriptionCents === 0 ? labels.free : money(row.subscriptionCents)}
                </Line>
                <Line label={labels.bookingFee}>{money(row.bookingFeeCents)}</Line>
                {withMarketplace ? (
                  <Line label={labels.otaFee}>{money(row.otaFeeCents)}</Line>
                ) : null}
                <Line label={labels.processing}>{money(row.processingCents)}</Line>
                {withMarketplace ? (
                  <Line label={labels.marketplace}>
                    {range(
                      money(row.marketplaceLowCents),
                      money(row.marketplaceHighCents),
                      row.marketplaceLowCents === row.marketplaceHighCents,
                    )}
                  </Line>
                ) : null}
              </dl>
              <div className="mt-4 border-t border-border pt-4">
                <p className="text-sm text-muted">{labels.total}</p>
                <p className={FIGURE_LARGE_CLASS} aria-live="polite">
                  {range(
                    money(row.totalLowCents),
                    money(row.totalHighCents),
                    row.totalLowCents === row.totalHighCents,
                  )}
                </p>
                {received > 0 ? (
                  <p className="mt-1 text-sm text-muted">
                    {labels.totalNote.replace(
                      "{percent}",
                      range(
                        percent(row.totalLowCents / received),
                        percent(row.totalHighCents / received),
                        row.totalLowCents === row.totalHighCents,
                      ),
                    )}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      {withMarketplace ? (
        <p className="mt-6 max-w-2xl border-l-2 border-primary ps-5 text-lg leading-8">
          {labels.saving
            .replace("{low}", percent(saving.low))
            .replace("{high}", percent(saving.high))}
        </p>
      ) : null}
    </div>
  );
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className="text-end tabular-nums">{children}</dd>
    </div>
  );
}
