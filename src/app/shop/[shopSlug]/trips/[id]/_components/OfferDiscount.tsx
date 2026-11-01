// i18n-exempt-file: every visible label arrives as an already-translated prop.
"use client";

import { createContext, type ReactNode, useContext, useId, useState } from "react";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { controlClass } from "@/components/ui/form";

/** Every word the discount disclosure renders, resolved on the server. */
export type OfferDiscountCopy = {
  /** "Add a discount to offers" */
  toggle: string;
  /** The disclosure's one line: every offer below carries it. */
  hint: string;
  amountAriaLabel: string;
  kindAriaLabel: string;
  /** The currency symbol the "amount" option shows. */
  currencySymbol: string;
};

type Discount = { on: boolean; amount: string; kind: "percent" | "amount" };

const DiscountState = createContext<{
  discount: Discount;
  set: (next: Partial<Discount>) => void;
} | null>(null);

/**
 * **One discount, riding with every row's Offer** (visual review 2026-10-24,
 * A14; H-20261005-one-interest-table-names). Who wants in has one act per row, "Offer a seat", and one
 * disclosure above the list, "Add a discount to offers". Open, the discount
 * it holds goes out with whichever row's offer is sent next, as the
 * `discount` and `discountKind` fields `holdSendAction` reads (the rider, in
 * each row's own form). Closed, no row posts a discount field at all, so an
 * offer without a discount carries none, as before. The server refuses a
 * discount from a role that may not give one; the page draws none for them.
 */
export function OfferDiscountProvider({ children }: { children: ReactNode }) {
  const [discount, setDiscount] = useState<Discount>({ on: false, amount: "25", kind: "percent" });
  return (
    <DiscountState.Provider
      value={{ discount, set: (next) => setDiscount((was) => ({ ...was, ...next })) }}
    >
      {children}
    </DiscountState.Provider>
  );
}

/** The disclosure above the list: open is "with a discount", its fields the discount. */
export function OfferDiscountDisclosure({ copy }: { copy: OfferDiscountCopy }) {
  const state = useContext(DiscountState);
  const hintId = useId();
  if (!state) return null;
  const { discount, set } = state;
  return (
    <details
      data-offer-discount=""
      open={discount.on}
      onToggle={(event) => set({ on: event.currentTarget.open })}
      className="group/discount"
    >
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-primary [&::-webkit-details-marker]:hidden">
        {copy.toggle}
        <DisclosureCaret direction="down" className="size-4 group-open/discount:rotate-180" />
      </summary>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pb-2">
        <div className="flex items-center gap-1.5">
          <div className="w-24">
            <input
              type="number"
              inputMode="decimal"
              min={1}
              step="any"
              value={discount.amount}
              onChange={(event) => set({ amount: event.target.value })}
              aria-label={copy.amountAriaLabel}
              aria-describedby={hintId}
              className={`${controlClass} tabular-nums`}
            />
          </div>
          <div className="w-20 shrink-0">
            <select
              value={discount.kind}
              onChange={(event) =>
                set({ kind: event.target.value === "amount" ? "amount" : "percent" })
              }
              aria-label={copy.kindAriaLabel}
              className={controlClass}
            >
              <option value="percent">%</option>
              <option value="amount">{copy.currencySymbol}</option>
            </select>
          </div>
        </div>
        <p id={hintId} className="text-xs text-muted">
          {copy.hint}
        </p>
      </div>
    </details>
  );
}

/**
 * True while the disclosure is open with a blank amount: a discount the
 * staffer asked for and has not given. Each row's Offer is disabled until the
 * box holds an amount or the disclosure closes, so an offer never goes out
 * undiscounted by accident (layer 3 security review, note 1). Outside a
 * provider (Today's row) there is no disclosure, so never.
 */
export function useOfferDiscountBlank(): boolean {
  const state = useContext(DiscountState);
  return state?.discount.on === true && state.discount.amount.trim() === "";
}

/**
 * The discount's fields inside one row's Offer form, posted only while the
 * disclosure is open with an amount in it. `holdSendAction` refuses a
 * discount's kind without an amount, so a blank box is never read as an
 * ordinary offer.
 */
export function OfferDiscountRider() {
  const state = useContext(DiscountState);
  if (!state?.discount.on || state.discount.amount.trim() === "") return null;
  return (
    <>
      <input type="hidden" name="discount" value={state.discount.amount} />
      <input type="hidden" name="discountKind" value={state.discount.kind} />
    </>
  );
}
