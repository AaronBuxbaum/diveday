"use client";

import { useState } from "react";
import { ITEM_TITLE_CLASS } from "@/components/ui/typography";
import {
  COMPARED_SYSTEMS,
  type ComparedSystem,
  compareMonth,
  type DiveDayTerms,
  FEE_ASSUMPTIONS,
  type SystemCost,
} from "@/features/fee-comparison";
import { formatMoneyScanned } from "@/lib/format";
import { cachedFormatter } from "@/lib/intl-cache";
import { MoneySlider } from "./MoneySlider";

/** Words resolved on the server; `totalNote` holds a percent, `otaFootnote` the share of bookings. */
export type FeeComparisonLabels = {
  sliderLabel: string;
  subscription: string;
  free: string;
  bookingFee: string;
  otaFee: string;
  processing: string;
  total: string;
  totalNote: string;
  otaFootnote: string;
  otaSource: string;
  systems: { fareharbor: { name: string; estimated: string }; diveday: { name: string } };
};

const MAX_CENTS = 10_000_000;
const STEP_CENTS = 50_000;
const START_CENTS = 3_000_000;

/**
 * **The same month on two systems.** One slider for the money received and one table with a
 * row per fee and a column per system, 37% of the money counted as through online travel agencies
 * (footnoted, with its source). The arithmetic is `compareMonth`, tested in
 * `src/features/fee-comparison/rules.test.ts`; the sources and assumptions are written on the
 * page beside it. DiveDay's column is highlighted and its terms are the offer's.
 */
export function FeeComparison({
  labels,
  locale,
  diveDay,
}: {
  labels: FeeComparisonLabels;
  locale: string;
  diveDay: DiveDayTerms;
}) {
  const [received, setReceived] = useState(START_CENTS);
  const money = (cents: number) => formatMoneyScanned(cents, "usd", locale);
  const percent = (fraction: number) =>
    cachedFormatter("num", Intl.NumberFormat, locale, {
      style: "percent",
      maximumFractionDigits: 1,
    }).format(fraction);
  const rows = compareMonth(received, diveDay);
  const byName = Object.fromEntries(rows.map((row) => [row.system, row])) as Record<
    ComparedSystem,
    SystemCost
  >;
  const rate = (basisPoints: number) => percent(basisPoints / 10_000);
  // A fee's rate beside the dollars it comes to, "6% ($9,000)"; "Free" when it is nothing.
  const fee = (basisPoints: number, cents: number) =>
    basisPoints === 0 ? labels.free : `${rate(basisPoints)} (${money(cents)})`;
  const card = (cents: number) =>
    `${rate(FEE_ASSUMPTIONS.cardBasisPoints)} + ${money(FEE_ASSUMPTIONS.cardFixedCents)} (${money(cents)})`;
  const lines: { label: string; cells: Record<ComparedSystem, string> }[] = [
    {
      label: labels.subscription,
      cells: {
        fareharbor: labels.free,
        diveday: diveDay.monthlyCents === 0 ? labels.free : money(diveDay.monthlyCents),
      },
    },
    {
      label: labels.bookingFee,
      cells: {
        fareharbor: fee(FEE_ASSUMPTIONS.fareHarborBasisPoints, byName.fareharbor.bookingFeeCents),
        diveday: fee(diveDay.basisPoints, byName.diveday.bookingFeeCents),
      },
    },
    {
      // Footnoted: the share of bookings that come through the agencies is an assumption.
      label: `${labels.otaFee}*`,
      cells: {
        fareharbor: fee(FEE_ASSUMPTIONS.fareHarborOtaBasisPoints, byName.fareharbor.otaFeeCents),
        diveday: labels.free,
      },
    },
    {
      label: labels.processing,
      cells: {
        fareharbor: card(byName.fareharbor.processingCents),
        diveday: card(byName.diveday.processingCents),
      },
    },
  ];
  return (
    <div className="mt-10">
      <div className="max-w-xl">
        <MoneySlider
          label={labels.sliderLabel}
          value={received}
          min={0}
          max={MAX_CENTS}
          step={STEP_CENTS}
          format={money}
          onChange={setReceived}
        />
      </div>

      <table className="mt-10 w-full table-fixed border-collapse text-start text-sm sm:text-base">
        <thead>
          <tr className="align-top">
            <td className="w-[28%] sm:w-[34%]" />
            {COMPARED_SYSTEMS.map((system) => (
              <th
                key={system}
                scope="col"
                className={`px-2 pt-4 pb-4 text-start font-normal sm:px-3 ${system === "diveday" ? "rounded-t-panel bg-surface" : ""}`}
              >
                <span className={ITEM_TITLE_CLASS}>{labels.systems[system].name}</span>
                {system === "fareharbor" ? (
                  <span className="block text-sm font-normal text-muted">
                    {labels.systems.fareharbor.estimated}
                  </span>
                ) : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.label} className="border-t border-border">
              <th scope="row" className="py-3 pe-3 text-start font-normal text-muted">
                {line.label}
              </th>
              {COMPARED_SYSTEMS.map((system) => (
                <td
                  key={system}
                  className={`px-2 py-3 tabular-nums sm:px-3 ${system === "diveday" ? "bg-surface" : ""}`}
                >
                  {line.cells[system]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-border-strong align-top">
            <th scope="row" className="py-4 pe-3 text-start font-normal text-muted">
              {labels.total}
            </th>
            {COMPARED_SYSTEMS.map((system) => {
              const row = byName[system];
              return (
                <td
                  key={system}
                  className={`px-2 py-4 sm:px-3 ${system === "diveday" ? "rounded-b-panel bg-surface" : ""}`}
                >
                  <span
                    // diveday:allow-type-ramp: smaller on a phone, where a third of the width holds "$1,941.90"
                    className="block text-lg font-semibold tracking-tight tabular-nums sm:text-3xl"
                    aria-live="polite"
                  >
                    {money(row.totalCents)}
                  </span>
                  {received > 0 ? (
                    <span className="mt-1 block text-sm text-muted">
                      {labels.totalNote.replace("{percent}", percent(row.totalCents / received))}
                    </span>
                  ) : null}
                </td>
              );
            })}
          </tr>
        </tfoot>
      </table>

      <p className="mt-3 text-xs leading-5 text-muted">
        *{" "}
        {labels.otaFootnote.replace(
          "{share}",
          percent(FEE_ASSUMPTIONS.otaShareBasisPoints / 10_000),
        )}{" "}
        <a
          href={FEE_ASSUMPTIONS.otaSourceUrl}
          target="_blank"
          rel="noopener"
          className="underline underline-offset-2"
        >
          {labels.otaSource}
        </a>
      </p>
    </div>
  );
}
