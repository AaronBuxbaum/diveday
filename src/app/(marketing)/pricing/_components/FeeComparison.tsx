"use client";

import { useState } from "react";
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

/** Words resolved on the server; `totalNote` and `saving` hold `{percent}`. */
export type FeeComparisonLabels = {
  sliderLabel: string;
  bookingToggle: string;
  bookingShareLabel: string;
  software: string;
  processing: string;
  bookingCom: string;
  total: string;
  included: string;
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
  savingPercent,
}: {
  labels: FeeComparisonLabels;
  locale: string;
  diveDay: DiveDayTerms;
  /** Booking.com's rate less DiveDay's all-in rate, as a ready percent string. */
  savingPercent: string;
}) {
  const [received, setReceived] = useState(START_CENTS);
  const [withBooking, setWithBooking] = useState(false);
  const [share, setShare] = useState(START_SHARE);
  const money = (cents: number) => formatMoneyScanned(cents, "usd", locale);
  const percent = (fraction: number) =>
    cachedFormatter("num", Intl.NumberFormat, locale, {
      style: "percent",
      maximumFractionDigits: 1,
    }).format(fraction);
  const rows = compareMonth(received, withBooking ? share / 100 : 0, diveDay);
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
          <Switch checked={withBooking} onChange={setWithBooking} label={labels.bookingToggle} />
          {withBooking ? (
            <MoneySlider
              label={labels.bookingShareLabel}
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
                <div className="flex justify-between gap-4">
                  <dt className="text-muted">{labels.software}</dt>
                  <dd className="tabular-nums">{money(row.softwareCents)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted">{labels.processing}</dt>
                  <dd className="tabular-nums">
                    {system === "fareharbor" ? labels.included : money(row.processingCents)}
                  </dd>
                </div>
                {withBooking ? (
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted">{labels.bookingCom}</dt>
                    <dd className="tabular-nums">{money(row.bookingComCents)}</dd>
                  </div>
                ) : null}
              </dl>
              <div className="mt-4 border-t border-border pt-4">
                <p className="text-sm text-muted">{labels.total}</p>
                <p className={FIGURE_LARGE_CLASS} aria-live="polite">
                  {money(row.totalCents)}
                </p>
                {received > 0 ? (
                  <p className="mt-1 text-sm text-muted">
                    {labels.totalNote.replace("{percent}", percent(row.totalCents / received))}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      {withBooking ? (
        <p className="mt-6 max-w-2xl border-l-2 border-primary ps-5 text-lg leading-8">
          {labels.saving.replace("{percent}", savingPercent)}
        </p>
      ) : null}
    </div>
  );
}
