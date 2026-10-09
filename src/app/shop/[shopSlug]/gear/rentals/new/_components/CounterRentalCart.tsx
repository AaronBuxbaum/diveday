"use client";

import { type ReactNode, useId, useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { ChoicePill, ChoiceRow, controlClass, StickyFormActions } from "@/components/ui/form";
import { isOneCoreSet } from "@/lib/counter-rentals";
import { formatMoneyCents } from "@/lib/format";
import type { GearItemKind } from "@/lib/gear";
import { majorToMinor } from "@/lib/money";
import {
  CONFIRM_FIELD_PREFIX,
  PAYMENT_FIELD,
  PRICE_FIELD_PREFIX,
  type RentalPayment,
  SET_PRICE_FIELD,
  UNIT_FIELD,
} from "../../rental-form";

export type PickerUnit = {
  id: string;
  kind: GearItemKind;
  label: string;
  size: string | null;
  /** Service words already in the staffer's language (overdue, concern, due soon). */
  care: string[];
  /** Why this unit cannot go to this person, worded; null when it can. */
  blocked: string | null;
  /** A flagged soft-goods unit: lent only with its own "lend anyway" tick. */
  confirmLabel: string | null;
  /** The price box's opening figure in major units, "" when the kind is unpriced. */
  price: string;
  priceAria: string;
  removeAria: string;
};

export type PaymentChoice = { value: RentalPayment; label: string; hint?: string };

export type CartWords = {
  gearHeading: string;
  kindsAria: string;
  billHeading: string;
  billEmpty: string;
  inSet: string;
  setLabel: string;
  total: string;
  payHeading: string;
  /** "# item" / "# items", with `#` standing for the count. */
  items: { one: string; other: string };
  submit: string;
  submitting: string;
};

/** A typed price as minor units; blank or unreadable counts as nothing. */
function centsOf(raw: string, currency: string): number {
  const major = Number(raw);
  return raw.trim() !== "" && Number.isFinite(major) && major >= 0
    ? majorToMinor(major, currency)
    : 0;
}

/**
 * **Rent out's gear, bill and payment**, as one client island inside the
 * page's form.
 *
 * The page before this one stacked nine kind menus and drew what was picked
 * under the last of them, which on a phone is off the screen: a pick looked
 * like nothing happened (Aaron, 2026-10-09). So a pick now answers where the
 * finger is. The kinds are a row of chips, the free units of the chosen kind
 * are tiles, and a tapped tile turns into a ticked one in place, tapped again
 * to put it back. The bill below lists every pick with its price, and the
 * sticky bar at the foot says how many and how much the whole time.
 *
 * **What it costs and how it is paid sit on the screen, always** (same day:
 * "it's not totally clear how I charge for it"). Prices open at the shop's
 * own list (`counterRentalLineCents`) and stay editable; a pick that is
 * exactly one core set bills one set line instead. The payment is a required
 * choice, whose options the server decided: cash and card machine are
 * recorded as paid, an invoice goes by email through Stripe, and "no charge"
 * records nothing. `invoiceExtras` (the tax address) shows only for an
 * invoice.
 *
 * The rules are decided on the server and arrive as words (`blocked`,
 * `confirmLabel`); the action re-checks every one of them.
 */
export function CounterRentalCart({
  groups,
  coreKinds,
  setPrice,
  currency,
  locale,
  step,
  payments,
  paymentNote,
  invoiceExtras,
  words,
  notice,
}: {
  groups: { kind: GearItemKind; kindLabel: string; units: PickerUnit[] }[];
  coreKinds: GearItemKind[];
  /** The set price for these days, in major units, or null when the shop has none. */
  setPrice: string | null;
  currency: string;
  locale: string;
  step: string;
  payments: PaymentChoice[];
  /** A line under the payment choices: why an invoice is not one of them, when it is not. */
  paymentNote: ReactNode;
  invoiceExtras: ReactNode;
  words: CartWords;
  notice: ReactNode;
}) {
  const billId = useId();
  const [kind, setKind] = useState<GearItemKind | undefined>(groups[0]?.kind);
  const [pickedIds, setPickedIds] = useState<readonly string[]>([]);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [setFigure, setSetFigure] = useState(setPrice ?? "");
  const [payment, setPayment] = useState<RentalPayment | null>(null);

  const byId = new Map(groups.flatMap((group) => group.units.map((unit) => [unit.id, unit])));
  const picked = pickedIds.flatMap((id) => byId.get(id) ?? []);
  const asSet =
    setPrice !== null &&
    isOneCoreSet(
      coreKinds,
      picked.map((unit) => unit.kind),
    );
  const priceOf = (unit: PickerUnit) => prices[unit.id] ?? unit.price;
  const totalCents =
    (asSet ? centsOf(setFigure, currency) : 0) +
    picked
      .filter((unit) => !(asSet && coreKinds.includes(unit.kind)))
      .reduce((sum, unit) => sum + centsOf(priceOf(unit), currency), 0);
  const total = formatMoneyCents(totalCents, currency, locale);
  const count = (picked.length === 1 ? words.items.one : words.items.other).replace(
    "#",
    String(picked.length),
  );
  const toggle = (id: string) =>
    setPickedIds((previous) =>
      previous.includes(id) ? previous.filter((other) => other !== id) : [...previous, id],
    );
  const shown = groups.find((group) => group.kind === kind) ?? groups[0];

  return (
    <>
      <SectionCard title={words.gearHeading}>
        <fieldset aria-label={words.kindsAria} className="flex min-w-0 flex-wrap gap-2">
          {groups.map((group) => {
            const chosen = group.kind === shown?.kind;
            const taken = group.units.filter((unit) => pickedIds.includes(unit.id)).length;
            return (
              <button
                key={group.kind}
                type="button"
                aria-pressed={chosen}
                onClick={() => setKind(group.kind)}
                className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors ${
                  chosen
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-surface hover:bg-surface-sunken"
                }`}
              >
                {group.kindLabel}
                {taken > 0 ? (
                  <span
                    className={`rounded-full px-1.5 text-xs tabular-nums ${
                      chosen ? "bg-primary-foreground text-primary" : "bg-primary-tint text-primary"
                    }`}
                  >
                    {taken}
                  </span>
                ) : null}
              </button>
            );
          })}
        </fieldset>
        {shown ? (
          <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {shown.units.map((unit) => {
              const on = pickedIds.includes(unit.id);
              return (
                <li key={unit.id}>
                  <button
                    type="button"
                    aria-pressed={on}
                    disabled={unit.blocked !== null}
                    onClick={() => toggle(unit.id)}
                    className={`flex h-full min-h-14 w-full items-start gap-2 rounded-lg border p-3 text-start text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                      on
                        ? "border-primary bg-primary-tint"
                        : "border-border bg-surface enabled:hover:bg-surface-sunken"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm border ${
                        on
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border-strong"
                      }`}
                    >
                      {on ? (
                        <svg
                          aria-hidden="true"
                          viewBox="0 0 16 16"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2.5}
                          className="size-3"
                        >
                          <path d="M3.5 8.5l3 3 6-7" />
                        </svg>
                      ) : null}
                    </span>
                    <span className="min-w-0">
                      <span className="block font-medium">
                        {unit.label}
                        {unit.size ? (
                          <span className="font-normal text-muted"> · {unit.size}</span>
                        ) : null}
                      </span>
                      {unit.blocked ? (
                        <span className="block text-muted">{unit.blocked}</span>
                      ) : unit.care.length > 0 ? (
                        <span className="block text-warning-strong">{unit.care.join(" · ")}</span>
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </SectionCard>

      <SectionCard title={words.billHeading}>
        {picked.length === 0 ? (
          <p className="text-sm text-muted">{words.billEmpty}</p>
        ) : (
          <div className="flex flex-col gap-6">
            <ul aria-label={words.billHeading} id={billId} className="divide-y divide-border">
              {asSet ? (
                <li className="flex min-h-14 items-center gap-3 py-2">
                  <p className="min-w-0 flex-1 text-sm font-medium">{words.setLabel}</p>
                  <input
                    type="number"
                    name={SET_PRICE_FIELD}
                    min={0}
                    step={step}
                    value={setFigure}
                    onChange={(event) => setSetFigure(event.currentTarget.value)}
                    aria-label={words.setLabel}
                    className={`${controlClass} w-28 shrink-0 text-end tabular-nums`}
                  />
                  <span aria-hidden="true" className="size-11 shrink-0" />
                </li>
              ) : null}
              {picked.map((unit) => {
                const inSet = asSet && coreKinds.includes(unit.kind);
                return (
                  <li key={unit.id} className="flex flex-col gap-1 py-2">
                    <input type="hidden" name={UNIT_FIELD} value={unit.id} />
                    <div className="flex min-h-11 items-center gap-3">
                      <p className="min-w-0 flex-1 text-sm">
                        <span className="font-medium">{unit.label}</span>
                        {unit.size ? <span className="text-muted"> · {unit.size}</span> : null}
                      </p>
                      {inSet ? (
                        <span className="w-28 shrink-0 text-end text-sm text-muted">
                          {words.inSet}
                        </span>
                      ) : (
                        <input
                          type="number"
                          name={`${PRICE_FIELD_PREFIX}${unit.id}`}
                          min={0}
                          step={step}
                          value={priceOf(unit)}
                          onChange={(event) => {
                            const value = event.currentTarget.value;
                            setPrices((previous) => ({ ...previous, [unit.id]: value }));
                          }}
                          aria-label={unit.priceAria}
                          className={`${controlClass} w-28 shrink-0 text-end tabular-nums`}
                        />
                      )}
                      <button
                        type="button"
                        aria-label={unit.removeAria}
                        onClick={() => toggle(unit.id)}
                        className={buttonClass({ variant: "ghost", size: "icon" })}
                      >
                        <svg
                          aria-hidden="true"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                          strokeLinecap="round"
                          className="size-4"
                        >
                          <path d="M6 6l12 12M18 6L6 18" />
                        </svg>
                      </button>
                    </div>
                    {unit.confirmLabel ? (
                      <ChoiceRow
                        type="checkbox"
                        name={`${CONFIRM_FIELD_PREFIX}${unit.id}`}
                        className="text-sm"
                      >
                        {unit.confirmLabel}
                      </ChoiceRow>
                    ) : null}
                  </li>
                );
              })}
              <li className="flex min-h-12 items-center gap-3 pt-3">
                <p className="flex-1 font-medium">{words.total}</p>
                <p className="text-lg font-semibold tabular-nums">{total}</p>
                <span aria-hidden="true" className="size-11 shrink-0" />
              </li>
            </ul>

            <fieldset className="min-w-0">
              <legend className="text-sm font-medium">{words.payHeading}</legend>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {payments.map((choice) => (
                  <ChoicePill
                    key={choice.value}
                    type="radio"
                    name={PAYMENT_FIELD}
                    value={choice.value}
                    required
                    checked={payment === choice.value}
                    onChange={() => setPayment(choice.value)}
                  >
                    <span className="block font-medium">{choice.label}</span>
                    {choice.hint ? <span className="block text-muted">{choice.hint}</span> : null}
                  </ChoicePill>
                ))}
              </div>
              {paymentNote ? <p className="mt-3 text-sm text-muted">{paymentNote}</p> : null}
            </fieldset>
            {payment === "invoice" ? invoiceExtras : null}
          </div>
        )}
      </SectionCard>

      <StickyFormActions>
        <p className="me-auto text-sm" aria-live="polite">
          <span className="font-medium">{count}</span>
          {picked.length > 0 ? <span className="tabular-nums text-muted"> · {total}</span> : null}
        </p>
        {notice}
        <SubmitButton
          pendingLabel={words.submitting}
          disabled={picked.length === 0}
          className={buttonClass()}
        >
          {words.submit}
        </SubmitButton>
      </StickyFormActions>
    </>
  );
}
