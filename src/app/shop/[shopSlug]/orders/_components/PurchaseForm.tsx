"use client";

import { useActionState, useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid, FormStatus, legendClass } from "@/components/ui/form";
import { formatMoneyCents } from "@/lib/format";
import { majorToMinor } from "@/lib/money";
import { MAX_LINE_ITEMS_PER_ORDER } from "@/lib/order-limits";
import { type PurchaseActionState, recordPurchaseAction } from "../purchase-actions";

type Words = {
  title: string;
  customer: string;
  choose: string;
  method: string;
  reference: string;
  note: string;
  item: string;
  kind: string;
  quantity: string;
  price: string;
  tax: string;
  taxHint: string;
  tip: string;
  gross: string;
  add: string;
  remove: string;
  submit: string;
  busy: string;
  invalid: string;
  included: string;
  kinds: { value: string; label: string }[];
  methods: { value: string; label: string }[];
};
export type PurchaseFormProps = {
  attemptId: string;
  currency: string;
  locale: string;
  step: string;
  customers: { id: string; fullName: string; email: string | null }[];
  personId?: string;
  words: Words;
};

/** One receipt, with received (tax-inclusive) lines rather than a stock/catalog/cart model. */
export function PurchaseForm({
  attemptId,
  currency,
  locale,
  step,
  customers,
  personId = "",
  words,
}: PurchaseFormProps) {
  const [state, action, pending] = useActionState(recordPurchaseAction, {
    error: null,
  } as PurchaseActionState);
  const [payer, setPayer] = useState(personId);
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [tax, setTax] = useState("");
  const [tip, setTip] = useState("");
  const [rows, setRows] = useState([
    { id: 0, kind: "merchandise", description: "", quantity: "1", unitAmount: "" },
  ]);
  const [nextId, setNextId] = useState(1);
  const total = rows.reduce(
    (sum, row) =>
      sum +
      (Number.isFinite(Number(row.unitAmount)) && Number.isFinite(Number(row.quantity))
        ? majorToMinor(Number(row.unitAmount), currency) * Number(row.quantity)
        : 0),
    0,
  );
  const change = (
    id: number,
    key: "kind" | "description" | "quantity" | "unitAmount",
    value: string,
  ) =>
    setRows((previous) => previous.map((row) => (row.id === id ? { ...row, [key]: value } : row)));
  return (
    <form action={action} aria-label={words.title}>
      <input type="hidden" name="attemptId" value={attemptId} />
      <input type="hidden" name="currency" value={currency} />
      <input type="hidden" name="lineItemCount" value={rows.length} />
      <fieldset disabled={pending} className="space-y-6">
        <FieldGrid columns={2}>
          <Field label={words.customer}>
            <select
              name="personId"
              required
              className={controlClass}
              value={payer}
              onChange={(event) => setPayer(event.target.value)}
            >
              <option value="" disabled>
                {words.choose}
              </option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.fullName}
                  {customer.email ? ` · ${customer.email}` : ""}
                </option>
              ))}
            </select>
          </Field>
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
        </FieldGrid>
        <p className="text-sm text-muted">{words.included}</p>
        <div className="space-y-4">
          {rows.map((row, index) => (
            <fieldset key={row.id} className="space-y-3 rounded-lg border border-border p-4">
              <legend className={`${legendClass} font-medium`}>
                {words.item} {index + 1}
              </legend>
              <FieldGrid columns={2}>
                <Field label={words.item}>
                  <input
                    type="text"
                    name={`description-${index}`}
                    required
                    maxLength={200}
                    className={controlClass}
                    value={row.description}
                    onChange={(event) => change(row.id, "description", event.target.value)}
                  />
                </Field>
                <Field label={words.kind}>
                  <select
                    name={`kind-${index}`}
                    className={controlClass}
                    value={row.kind}
                    onChange={(event) => change(row.id, "kind", event.target.value)}
                  >
                    {words.kinds.map((kind) => (
                      <option key={kind.value} value={kind.value}>
                        {kind.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={words.quantity}>
                  <input
                    type="number"
                    name={`quantity-${index}`}
                    min={1}
                    max={100}
                    step={1}
                    required
                    className={controlClass}
                    value={row.quantity}
                    onChange={(event) => change(row.id, "quantity", event.target.value)}
                  />
                </Field>
                <Field label={words.price}>
                  <input
                    type="number"
                    inputMode="decimal"
                    name={`unitAmount-${index}`}
                    min={0}
                    max={100000}
                    step={step}
                    required
                    className={controlClass}
                    value={row.unitAmount}
                    onChange={(event) => change(row.id, "unitAmount", event.target.value)}
                  />
                </Field>
              </FieldGrid>
              {rows.length > 1 ? (
                <button
                  type="button"
                  className={buttonClass({ variant: "ghost" })}
                  onClick={() =>
                    setRows((previous) => previous.filter((entry) => entry.id !== row.id))
                  }
                >
                  {words.remove}
                </button>
              ) : null}
            </fieldset>
          ))}
        </div>
        {rows.length < MAX_LINE_ITEMS_PER_ORDER ? (
          <button
            type="button"
            className={buttonClass({ variant: "secondary" })}
            onClick={() => {
              setRows((previous) => [
                ...previous,
                { id: nextId, kind: "merchandise", description: "", quantity: "1", unitAmount: "" },
              ]);
              setNextId((id) => id + 1);
            }}
          >
            {words.add}
          </button>
        ) : null}
        <FieldGrid columns={2}>
          <Field label={words.tax} description={words.taxHint}>
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
          <Field label={words.note}>
            <input
              name="description"
              type="text"
              maxLength={200}
              className={controlClass}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
        </FieldGrid>
        <p className="text-base font-medium">
          {words.gross}:{" "}
          <output className="tabular-nums">
            {formatMoneyCents(Number.isSafeInteger(total) ? total : 0, currency, locale)}
          </output>
        </p>
        {state.error ? <FormStatus tone="danger">{words.invalid}</FormStatus> : null}
        <button type="submit" disabled={pending} className={buttonClass()}>
          {pending ? words.busy : words.submit}
        </button>
      </fieldset>
    </form>
  );
}
