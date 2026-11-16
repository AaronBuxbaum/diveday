"use client";

import { useActionState, useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid, FormStatus } from "@/components/ui/form";
import { type LocalReceiptState, recordLocalReceiptAction } from "../../local-order-actions";

type Words = {
  method: string;
  tax: string;
  tip: string;
  reference: string;
  hint: string;
  submit: string;
  busy: string;
  invalid: string;
  methods: { value: string; label: string }[];
};
export function LocalReceiptForm({
  orderId,
  attemptId,
  totalCents,
  currency,
  step,
  words,
}: {
  orderId: string;
  attemptId: string;
  totalCents: number;
  currency: string;
  step: string;
  words: Words;
}) {
  const [state, action, pending] = useActionState(recordLocalReceiptAction, {
    error: null,
  } as LocalReceiptState);
  const [method, setMethod] = useState("cash");
  const [tax, setTax] = useState("");
  const [tip, setTip] = useState("");
  const [reference, setReference] = useState("");
  return (
    <form action={action} className="mt-4">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="attemptId" value={attemptId} />
      <input type="hidden" name="expectedTotalCents" value={totalCents} />
      <input type="hidden" name="currency" value={currency} />
      <fieldset disabled={pending} className="space-y-4">
        <Field label={words.method}>
          <select
            name="collection"
            className={controlClass}
            value={method}
            onChange={(event) => setMethod(event.target.value)}
          >
            {words.methods.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </Field>
        <p className="text-sm text-muted">{words.hint}</p>
        <FieldGrid columns={2}>
          <Field label={words.tax}>
            <input
              name="tax"
              type="number"
              inputMode="decimal"
              min={0}
              step={step}
              className={controlClass}
              value={tax}
              onChange={(event) => setTax(event.target.value)}
            />
          </Field>
          <Field label={words.tip}>
            <input
              name="tip"
              type="number"
              inputMode="decimal"
              min={0}
              step={step}
              className={controlClass}
              value={tip}
              onChange={(event) => setTip(event.target.value)}
            />
          </Field>
          <Field label={words.reference}>
            <input
              name="receiptReference"
              type="text"
              maxLength={100}
              className={controlClass}
              value={reference}
              onChange={(event) => setReference(event.target.value)}
            />
          </Field>
        </FieldGrid>
        {state.error ? <FormStatus tone="danger">{words.invalid}</FormStatus> : null}
        <button type="submit" disabled={pending} className={buttonClass()}>
          {pending ? words.busy : words.submit}
        </button>
      </fieldset>
    </form>
  );
}
