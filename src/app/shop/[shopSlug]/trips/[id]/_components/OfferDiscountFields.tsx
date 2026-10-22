"use client";

import { useId, useState } from "react";
import { choiceClass, controlClass } from "@/components/ui/form";

/** Every word `OfferDiscountFields` renders, resolved on the server. */
export type OfferDiscountCopy = {
  /** "With a discount" */
  toggle: string;
  amountAriaLabel: string;
  kindAriaLabel: string;
  /** The currency symbol the "amount" option shows. */
  currencySymbol: string;
};

/**
 * **"With a discount"** on the Offer act: a percent off, or a fixed amount off
 * each booking, passed through the held send (`discount` and `discountKind`,
 * read by `holdSendAction`). Unticked, the inputs are disabled and so are not
 * posted: an offer without a discount carries no field at all. Drawn only for a
 * role that may discount (`mayDiscount`); the server refuses anyone else.
 */
export function OfferDiscountFields({ copy }: { copy: OfferDiscountCopy }) {
  const [on, setOn] = useState(false);
  const id = useId();
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <label htmlFor={id} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
        <input
          id={id}
          type="checkbox"
          checked={on}
          onChange={(event) => setOn(event.target.checked)}
          className={choiceClass}
        />
        {copy.toggle}
      </label>
      {on ? (
        <div className="flex items-center gap-1.5">
          <div className="w-24">
            <input
              name="discount"
              type="number"
              inputMode="decimal"
              min={1}
              step="any"
              defaultValue={25}
              required
              aria-label={copy.amountAriaLabel}
              className={`${controlClass} tabular-nums`}
            />
          </div>
          <div className="w-20 shrink-0">
            <select
              name="discountKind"
              defaultValue="percent"
              aria-label={copy.kindAriaLabel}
              className={controlClass}
            >
              <option value="percent">%</option>
              <option value="amount">{copy.currencySymbol}</option>
            </select>
          </div>
        </div>
      ) : null}
    </div>
  );
}
