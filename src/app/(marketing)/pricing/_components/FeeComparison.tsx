"use client";

import { useState } from "react";
import { Switch } from "@/components/ui/Switch";
import { FIGURE_LARGE_CLASS, ITEM_TITLE_CLASS } from "@/components/ui/typography";
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

/** Words resolved on the server; `range` holds `{low}` and `{high}`, `totalNote` holds a percent. */
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
  /** Said beside a system whose rates are reported, not published. */
  estimated: string;
  systems: Record<ComparedSystem, { name: string }>;
};

const MAX_CENTS = 10_000_000;
const STEP_CENTS = 50_000;
const START_CENTS = 3_000_000;
const START_SHARE = 20;

/**
 * **The same month on two systems.** One slider for the money received, a switch
 * that adds Booking.com's commission (with the share of money that comes through
 * it), and one table with a row per fee and a column per system. The arithmetic is `compareMonth`, tested in
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
  const [withMarketplace, setWithMarketplace] = useState(false);
  const [share, setShare] = useState(START_SHARE);
  const money = (cents: number) => formatMoneyScanned(cents, "usd", locale);
  const percent = (fraction: number) =>
    cachedFormatter("num", Intl.NumberFormat, locale, {
      style: "percent",
      maximumFractionDigits: 1,
    }).format(fraction);
  const rows = compareMonth(received, withMarketplace ? share / 100 : 0, diveDay);
  const byName = Object.fromEntries(rows.map((row) => [row.system, row])) as Record<
    ComparedSystem,
    SystemCost
  >;
  const range = (low: string, high: string, same: boolean) =>
    same ? low : labels.range.replace("{low}", low).replace("{high}", high);
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
    ...(withMarketplace
      ? [
          {
            label: labels.otaFee,
            cells: {
              fareharbor: fee(
                FEE_ASSUMPTIONS.fareHarborOtaBasisPoints,
                byName.fareharbor.otaFeeCents,
              ),
              diveday: labels.free,
            },
          },
        ]
      : []),
    {
      label: labels.processing,
      cells: {
        fareharbor: card(byName.fareharbor.processingCents),
        diveday: card(byName.diveday.processingCents),
      },
    },
    ...(withMarketplace
      ? [
          {
            label: labels.marketplace,
            cells: Object.fromEntries(
              COMPARED_SYSTEMS.map((system) => [
                system,
                `${range(
                  rate(FEE_ASSUMPTIONS.marketplaceLowBasisPoints),
                  rate(FEE_ASSUMPTIONS.marketplaceHighBasisPoints),
                  false,
                )} (${range(
                  money(byName[system].marketplaceLowCents),
                  money(byName[system].marketplaceHighCents),
                  byName[system].marketplaceLowCents === byName[system].marketplaceHighCents,
                )})`,
              ]),
            ) as Record<ComparedSystem, string>,
          },
        ]
      : []),
  ];
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

      <table className="mt-6 w-full table-fixed border-collapse text-start text-sm sm:text-base">
        <thead>
          <tr className="align-top">
            <td className="w-[34%]" />
            {COMPARED_SYSTEMS.map((system) => (
              <th
                key={system}
                scope="col"
                className={`px-3 pb-4 text-start font-normal ${system === "diveday" ? "rounded-t-panel bg-surface" : ""}`}
              >
                <span className={`block ${ITEM_TITLE_CLASS}`}>
                  {labels.systems[system].name}
                  {system === "fareharbor" ? (
                    <span className="ms-1.5 text-sm font-normal text-muted">
                      {labels.estimated}
                    </span>
                  ) : null}
                </span>
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
                  className={`px-3 py-3 tabular-nums ${system === "diveday" ? "bg-surface" : ""}`}
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
                  className={`px-3 py-4 ${system === "diveday" ? "rounded-b-panel bg-surface" : ""}`}
                >
                  <span className={`block ${FIGURE_LARGE_CLASS}`} aria-live="polite">
                    {range(
                      money(row.totalLowCents),
                      money(row.totalHighCents),
                      row.totalLowCents === row.totalHighCents,
                    )}
                  </span>
                  {received > 0 ? (
                    <span className="mt-1 block text-sm text-muted">
                      {labels.totalNote.replace(
                        "{percent}",
                        range(
                          percent(row.totalLowCents / received),
                          percent(row.totalHighCents / received),
                          row.totalLowCents === row.totalHighCents,
                        ),
                      )}
                    </span>
                  ) : null}
                </td>
              );
            })}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
