"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { applyFormFields } from "@/components/apply-form-fields";
import { keptTypedKey } from "@/components/kept-typed-scope";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { ChoiceFieldset, controlClass, Field, FormStatus } from "@/components/ui/form";
import { nowMs } from "@/lib/clock";
import { formatMoneyCents } from "@/lib/format";
import { majorToMinor } from "@/lib/money";
import { MAX_LINE_ITEMS_PER_ORDER } from "@/lib/order-limits";
import type { InvoiceRow } from "./order-form";
import { INVOICE_FORM, readRetainedInvoice, retainInvoice } from "./retained-invoice";

export type InvoiceEditorWords = {
  legend: string;
  item: string;
  kind: string;
  description: string;
  descriptionPlaceholder: string;
  quantity: string;
  unitPrice: string;
  add: string;
  remove: string;
  removeAria: string;
  subtotal: string;
  submit: string;
  sending: string;
};
const blankRow = (): InvoiceRow => ({
  kind: "other",
  description: "",
  quantity: "1",
  unitAmount: "",
});
type EditorRow = InvoiceRow & { id: number };

/** Each invoice line owns its controls; the subtotal sits beside the explicit Send action. */
export function OrderEditor({
  defaults,
  bookingId,
  target,
  kinds,
  currency,
  locale,
  step,
  scope,
  restore,
  notice,
  words,
}: {
  defaults: InvoiceRow[];
  bookingId: string | null;
  kinds: { value: string; label: string }[];
  target: string;
  currency: string;
  locale: string;
  step: string;
  scope: string;
  restore: boolean;
  notice?: string;
  words: InvoiceEditorWords;
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const attemptField = useRef<HTMLInputElement>(null);
  const nextId = useRef(Math.max(defaults.length, 1));
  const [rows, setRows] = useState<EditorRow[]>(() =>
    (defaults.length ? defaults : [blankRow()]).map((row, id) => ({ ...row, id })),
  );
  const [linkedBooking, setLinkedBooking] = useState(bookingId ?? "");
  const focusRow = useRef<number | null>(null);
  const key = keptTypedKey(INVOICE_FORM, scope);

  const restoreFields = useEffectEvent(() => {
    const form = anchor.current?.closest("form");
    if (!form) return;
    try {
      const kept = readRetainedInvoice(window.sessionStorage.getItem(key), nowMs());
      if (!kept || kept.target !== target) return;
      setRows(kept.rows.map((row, id) => ({ ...row, id })));
      nextId.current = kept.rows.length;
      setLinkedBooking(kept.fields.bookingId ?? "");
      applyFormFields(form, kept.fields);
    } catch {
      /* Storage can be unavailable in a private tab. */
    }
  });
  useEffect(() => {
    if (restore) restoreFields();
    else {
      try {
        window.sessionStorage.removeItem(key);
      } catch {
        /* No stored typing. */
      }
    }
  }, [key, restore]);
  useEffect(() => {
    const form = anchor.current?.closest("form");
    if (!form) return;
    const onSubmit = () => {
      // A new attempt makes an old successful landing unable to consume this submission.
      if (attemptField.current) attemptField.current.value = window.crypto.randomUUID();
      const kept = retainInvoice(new FormData(form), nowMs());
      try {
        if (kept) window.sessionStorage.setItem(key, kept);
        else window.sessionStorage.removeItem(key);
      } catch {
        /* Refusal still renders when storage is unavailable. */
      }
    };
    let frame = 0;
    const onReset = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (restore) restoreFields();
      });
    };
    form.addEventListener("submit", onSubmit);
    form.addEventListener("reset", onReset);
    return () => {
      cancelAnimationFrame(frame);
      form.removeEventListener("submit", onSubmit);
      form.removeEventListener("reset", onReset);
    };
  }, [key, restore]);
  useEffect(() => {
    if (focusRow.current === null || !rows.some((row) => row.id === focusRow.current)) return;
    anchor.current
      ?.closest("form")
      ?.querySelector<HTMLInputElement>(
        `[data-invoice-row="${focusRow.current}"] input[type="text"]`,
      )
      ?.focus();
    focusRow.current = null;
  }, [rows]);

  const change = (id: number, field: keyof InvoiceRow, value: string) => {
    setRows((previous) =>
      previous.map((row) => (row.id === id ? { ...row, [field]: value } : row)),
    );
  };
  const subtotal = rows.reduce((sum, row) => {
    const quantity = Number(row.quantity);
    const amount = Number(row.unitAmount);
    return row.description.trim() &&
      row.unitAmount.trim() &&
      Number.isInteger(quantity) &&
      quantity >= 1 &&
      quantity <= 100 &&
      Number.isFinite(amount) &&
      amount >= 0 &&
      amount <= 100_000
      ? sum + quantity * majorToMinor(amount, currency)
      : sum;
  }, 0);

  return (
    <>
      <span ref={anchor} hidden />
      <input ref={attemptField} type="hidden" name="invoiceAttempt" defaultValue="" />
      <input type="hidden" name="invoiceTarget" value={target} />
      <input type="hidden" name="bookingId" value={linkedBooking} />
      <input type="hidden" name="lineItemCount" value={rows.length} />
      <ChoiceFieldset legend={words.legend} bodyClassName="flex flex-col gap-4">
        {rows.map((row, index) => (
          <fieldset
            key={row.id}
            data-invoice-row={row.id}
            aria-label={words.item.replace("#", String(index + 1))}
            className="min-w-0 rounded-lg border border-border p-4"
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[7rem_minmax(0,1fr)_5rem_7rem]">
              <Field label={words.kind}>
                <select
                  name={`kind-${index}`}
                  value={row.kind}
                  onChange={(event) => change(row.id, "kind", event.currentTarget.value)}
                  className={controlClass}
                >
                  {kinds.map((kind) => (
                    <option key={kind.value} value={kind.value}>
                      {kind.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={words.description}>
                <input
                  type="text"
                  name={`description-${index}`}
                  value={row.description}
                  onChange={(event) => change(row.id, "description", event.currentTarget.value)}
                  placeholder={words.descriptionPlaceholder}
                  maxLength={200}
                  className={controlClass}
                />
              </Field>
              <Field label={words.quantity}>
                <input
                  type="number"
                  name={`quantity-${index}`}
                  value={row.quantity}
                  onChange={(event) => change(row.id, "quantity", event.currentTarget.value)}
                  min={1}
                  max={100}
                  step={1}
                  className={controlClass}
                />
              </Field>
              <Field label={words.unitPrice}>
                <input
                  type="number"
                  name={`unitAmount-${index}`}
                  value={row.unitAmount}
                  onChange={(event) => change(row.id, "unitAmount", event.currentTarget.value)}
                  step={step}
                  min={0}
                  max={100_000}
                  className={controlClass}
                />
              </Field>
            </div>
            {rows.length > 1 ? (
              <button
                type="button"
                aria-label={words.removeAria.replace("#", String(index + 1))}
                className={buttonClass({ variant: "link", size: "sm", className: "mt-2" })}
                onClick={() => {
                  const remaining = rows.filter((item) => item.id !== row.id);
                  focusRow.current = remaining[Math.min(index, remaining.length - 1)]?.id ?? null;
                  setRows(remaining);
                }}
              >
                {words.remove}
              </button>
            ) : null}
          </fieldset>
        ))}
        <button
          type="button"
          disabled={rows.length >= MAX_LINE_ITEMS_PER_ORDER}
          className={buttonClass({ variant: "secondary", className: "self-start" })}
          onClick={() => {
            const id = nextId.current++;
            focusRow.current = id;
            setRows((previous) => [...previous, { ...blankRow(), id }]);
          }}
        >
          {words.add}
        </button>
      </ChoiceFieldset>
      <div className="flex flex-wrap items-center gap-3">
        <p className="me-auto tabular-nums" aria-live="polite">
          {words.subtotal} <strong>{formatMoneyCents(subtotal, currency, locale)}</strong>
        </p>
        <SubmitButton pendingLabel={words.sending} className={buttonClass()}>
          {words.submit}
        </SubmitButton>
        <FormStatus tone="danger">{notice}</FormStatus>
      </div>
    </>
  );
}
