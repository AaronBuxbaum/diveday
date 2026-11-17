"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { buttonClass } from "@/components/ui/button";
import {
  ChoiceFieldset,
  ChoicePill,
  controlClass,
  Field,
  FieldGrid,
  FormStatus,
} from "@/components/ui/form";
import type { OrderableCustomer } from "@/db/orders";
import { formatMoneyCents } from "@/lib/format";
import { MAX_LINE_ITEMS_PER_ORDER } from "@/lib/order-limits";
import { purchaseFormTotal } from "@/lib/purchase-lines";
import { type PurchaseActionState, recordPurchaseAction } from "../purchase-actions";
import { CustomerPicker } from "./CustomerPicker";
import { PurchaseLineFields } from "./PurchaseLineFields";
import type { PurchaseRow, PurchaseWords } from "./purchase-form-types";

export type PurchaseFormProps = {
  attemptId: string;
  currency: string;
  locale: string;
  step: string;
  /** The customer a link named (`?personId=`), chosen when the form opens. */
  customer: OrderableCustomer | null;
  canCreateDue: boolean;
  words: PurchaseWords;
};
/** What the form sends with nobody chosen: a walk-in, for a received receipt only. */
const WALK_IN = "walk-in";

/** A due amount and an already-received receipt are distinct, with one preserved item draft. */
export function PurchaseForm({
  attemptId,
  currency,
  locale,
  step,
  customer,
  canCreateDue,
  words,
}: PurchaseFormProps) {
  const [state, action, pending] = useActionState(recordPurchaseAction, {
    error: null,
  } as PurchaseActionState);
  const [intent, setIntent] = useState<"received" | "due">("received");
  const [payer, setPayer] = useState(customer?.id ?? WALK_IN);
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [tax, setTax] = useState("");
  const [tip, setTip] = useState("");
  const [rows, setRows] = useState<PurchaseRow[]>([
    { id: 0, kind: "merchandise", description: "", quantity: "1", unitAmount: "" },
  ]);
  const [nextId, setNextId] = useState(1);
  const inputs = useRef(new Map<number, HTMLInputElement>());
  const [focusTarget, setFocusTarget] = useState<number | null>(null);
  useEffect(() => {
    if (focusTarget !== null) {
      inputs.current.get(focusTarget)?.focus();
      setFocusTarget(null);
    }
  }, [focusTarget]);
  const total = purchaseFormTotal(rows, currency);
  const change = (
    id: number,
    key: "kind" | "description" | "quantity" | "unitAmount",
    value: string,
  ) =>
    setRows((previous) => previous.map((row) => (row.id === id ? { ...row, [key]: value } : row)));
  const due = intent === "due";
  return (
    <form action={action} aria-label={words.title}>
      <input type="hidden" name="attemptId" value={attemptId} />
      <input type="hidden" name="currency" value={currency} />
      <input type="hidden" name="lineItemCount" value={rows.length} />
      <fieldset disabled={pending} className="space-y-6">
        {canCreateDue ? (
          <ChoiceFieldset legend={words.entryType} bodyClassName="mt-2 flex flex-wrap gap-2">
            <ChoicePill
              type="radio"
              name="intent"
              value="received"
              checked={!due}
              onChange={() => setIntent("received")}
            >
              {words.received}
            </ChoicePill>
            <ChoicePill
              type="radio"
              name="intent"
              value="due"
              checked={due}
              onChange={() => setIntent("due")}
            >
              {words.due}
            </ChoicePill>
          </ChoiceFieldset>
        ) : (
          <input type="hidden" name="intent" value="received" />
        )}
        <CustomerPicker
          name="personId"
          initial={customer}
          emptyValue={WALK_IN}
          required={due}
          description={due && payer === WALK_IN ? words.payerRequired : undefined}
          onChange={setPayer}
          words={words.customer}
        />
        <ChoiceFieldset legend={words.itemsHeading} bodyClassName="mt-3 space-y-4">
          {rows.map((row, index) => (
            <PurchaseLineFields
              key={row.id}
              {...{ row, index, step, words, change }}
              removable={rows.length > 1}
              descriptionRef={(node) => {
                if (node) inputs.current.set(row.id, node);
                else inputs.current.delete(row.id);
              }}
              remove={() => {
                const remaining = rows.filter((entry) => entry.id !== row.id);
                setRows(remaining);
                setFocusTarget(remaining[Math.min(index, remaining.length - 1)].id);
              }}
            />
          ))}
        </ChoiceFieldset>
        {rows.length < MAX_LINE_ITEMS_PER_ORDER ? (
          <button
            type="button"
            className={buttonClass({ variant: "secondary" })}
            onClick={() => {
              setRows((previous) => [
                ...previous,
                { id: nextId, kind: "merchandise", description: "", quantity: "1", unitAmount: "" },
              ]);
              setFocusTarget(nextId);
              setNextId((id) => id + 1);
            }}
          >
            {words.add}
          </button>
        ) : null}
        {due ? (
          <>
            <input type="hidden" name="collection" value="local_invoice" />
            <input type="hidden" name="tax" value="" />
            <input type="hidden" name="tip" value="" />
            <input type="hidden" name="receiptReference" value="" />
            <p className="text-sm text-muted">{words.dueHelp}</p>
          </>
        ) : (
          <ChoiceFieldset legend={words.paymentHeading} bodyClassName="mt-3 space-y-4">
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
            <FieldGrid columns={2}>
              <Field label={words.tax} description={words.taxHint} hint={words.optional}>
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
              <Field label={words.tip} hint={words.optional}>
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
              <Field label={words.reference} hint={words.optional}>
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
          </ChoiceFieldset>
        )}
        <Field label={words.note} hint={words.optional}>
          <input
            name="description"
            type="text"
            maxLength={200}
            className={controlClass}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
        <p className="text-base font-medium">
          {due ? words.grossDue : words.gross}:{" "}
          <output className="tabular-nums">
            {total === null ? words.totalInvalid : formatMoneyCents(total, currency, locale)}
          </output>
        </p>
        {state.error ? <FormStatus tone="danger">{words.invalid}</FormStatus> : null}
        <button
          type="submit"
          disabled={pending || total === null || (due && (payer === "walk-in" || total === 0))}
          className={buttonClass()}
        >
          {pending ? words.busy : due ? words.submitDue : words.submit}
        </button>
      </fieldset>
    </form>
  );
}
