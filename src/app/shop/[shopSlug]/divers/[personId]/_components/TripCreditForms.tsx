"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import type { ForgivingCopy } from "@/components/ui/ForgivingInput";
import { ChoiceFieldset, controlClass, Field, FormStatus, PriceField } from "@/components/ui/form";
import { fill } from "@/i18n/fill";
import { formatMoneyCents } from "@/lib/format";
import { tripCreditAction } from "../trip-credit-actions";

export type TripCreditWords = {
  grant: string;
  more: string;
  amount: string;
  reason: string;
  goodwill: string;
  promotion: string;
  busy: string;
  apply: string;
  eligible: string;
  noEligible: string;
  policy: string;
  granted: string;
  applied: string;
  errors: Record<
    | "invalid"
    | "not_authorized"
    | "not_found"
    | "unavailable"
    | "insufficient"
    | "changed"
    | "busy",
    string
  >;
};

type Option = {
  bookingId: string;
  attemptId: string;
  title: string;
  date: string;
  fareCents: number;
};

/** One explicit grant intent at a time; a second grant requires choosing Grant more. */
export function TripCreditForms({
  personId,
  currency,
  locale,
  balanceCents,
  canGrant,
  grantAttemptId,
  options,
  words,
  forgiving,
}: {
  personId: string;
  currency: string;
  locale: string;
  balanceCents: number;
  canGrant: boolean;
  grantAttemptId: string;
  options: Option[];
  words: TripCreditWords;
  forgiving: ForgivingCopy;
}) {
  const [grantId, setGrantId] = useState(grantAttemptId);
  const [grantComplete, setGrantComplete] = useState(false);
  const [state, action, pending] = useActionState(
    async (previous: Parameters<typeof tripCreditAction>[0], data: FormData) => {
      const next = await tripCreditAction(previous, data);
      if (next?.ok && next.kind === "grant") setGrantComplete(true);
      return next;
    },
    null,
  );
  function scope(attemptId: string, kind: "grant" | "redeem") {
    return (
      <>
        <input type="hidden" name="personId" value={personId} />
        <input type="hidden" name="currency" value={currency} />
        <input type="hidden" name="attemptId" value={attemptId} />
        <input type="hidden" name="kind" value={kind} />
      </>
    );
  }
  return (
    <div className="space-y-5 pt-2">
      <p className="text-sm text-muted">{words.policy}</p>
      {state?.ok ? (
        <p className="text-sm font-medium">
          {fill(state.kind === "grant" ? words.granted : words.applied, {
            amount: formatMoneyCents(state.amountCents, state.currency, locale),
            balance: formatMoneyCents(state.balanceCents, state.currency, locale),
          })}
        </p>
      ) : null}
      <FormStatus tone="danger">
        {state && !state.ok ? words.errors[state.reason] : undefined}
      </FormStatus>
      {canGrant ? (
        grantComplete ? (
          <button
            type="button"
            className={buttonClass({ variant: "secondary" })}
            onClick={() => {
              setGrantId(crypto.randomUUID());
              setGrantComplete(false);
            }}
          >
            {words.more}
          </button>
        ) : (
          <form key={grantId} action={action} className="space-y-3">
            {scope(grantId, "grant")}
            <ChoiceFieldset legend={words.grant}>
              <div className="grid gap-3 sm:grid-cols-2">
                <PriceField
                  name="amount"
                  label={words.amount}
                  cents={null}
                  currency={currency}
                  locale={locale}
                  copy={forgiving}
                />
                <Field label={words.reason}>
                  <select name="reason" className={controlClass}>
                    <option value="goodwill">{words.goodwill}</option>
                    <option value="promotion">{words.promotion}</option>
                  </select>
                </Field>
              </div>
            </ChoiceFieldset>
            <SubmitButton
              pendingLabel={words.busy}
              disabled={pending}
              className={buttonClass({ variant: "secondary" })}
            >
              {words.grant}
            </SubmitButton>
          </form>
        )
      ) : null}
      <div className="space-y-3">
        <p className="text-sm font-medium">{words.eligible}</p>
        {options.length ? (
          <ul className="divide-y divide-border">
            {options.map((option) => (
              <li
                key={option.bookingId}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <div>
                  <p className="font-medium">{option.title}</p>
                  <p className="text-sm text-muted">{option.date}</p>
                </div>
                <form action={action}>
                  {scope(option.attemptId, "redeem")}
                  <input type="hidden" name="bookingId" value={option.bookingId} />
                  <input type="hidden" name="expectedFareCents" value={option.fareCents} />
                  <SubmitButton
                    pendingLabel={words.busy}
                    disabled={pending || balanceCents < option.fareCents}
                    className={buttonClass({ variant: "secondary" })}
                  >
                    {fill(words.apply, {
                      amount: formatMoneyCents(option.fareCents, currency, locale),
                    })}
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">{words.noEligible}</p>
        )}
      </div>
    </div>
  );
}
