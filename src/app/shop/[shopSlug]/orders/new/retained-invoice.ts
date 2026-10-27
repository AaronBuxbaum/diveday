import { MINUTE_MS } from "@/lib/clock";
import { MAX_LINE_ITEMS_PER_ORDER } from "@/lib/order-limits";
import { isUuid } from "@/lib/uuid";
import {
  INVOICE_ROW_FIELDS,
  type InvoiceRow,
  invoiceAttemptFromForm,
  invoiceTargetFromKey,
  orderRowsFromForm,
} from "./order-form";

export const INVOICE_FORM = "new-order";
const RETAINED_FOR_MS = 10 * MINUTE_MS;
const MAX_STORED_LENGTH = 16_000;

// This finite invoice-only list includes billing location, never payment credentials.
const FIELD_LIMITS = {
  personId: 36,
  bookingId: 36,
  description: 200,
  customerAddressLine1: 200,
  customerAddressLine2: 200,
  customerAddressCity: 100,
  customerAddressRegion: 100,
  customerAddressPostalCode: 30,
  customerAddressCountry: 2,
} as const;
const ROW_LIMITS: Record<keyof InvoiceRow, number> = {
  kind: 40,
  description: 200,
  quantity: 32,
  unitAmount: 32,
};
export type RetainedInvoice = {
  at: number;
  attempt: string;
  target: string;
  rows: InvoiceRow[];
  fields: Record<string, string>;
};

/** Capture display state only; every value still passes the action and domain gates. */
export function retainInvoice(form: FormData, at: number): string | null {
  const rows = orderRowsFromForm(form);
  const attempt = invoiceAttemptFromForm(form);
  const target = form.get("invoiceTarget");
  if (!rows || !attempt || !invoiceTargetFromKey(target)) return null;
  const fields: Record<string, string> = {};
  for (const [name, max] of Object.entries(FIELD_LIMITS)) {
    const value = form.get(name);
    if (typeof value === "string" && value.length <= max) fields[name] = value;
  }
  const raw = JSON.stringify({ at, attempt, target, rows, fields });
  return readRetainedInvoice(raw, at) ? raw : null;
}

/** Reject stale, oversized and fabricated storage; it never supplies authority. */
export function readRetainedInvoice(raw: string | null, at: number): RetainedInvoice | null {
  if (!raw || raw.length > MAX_STORED_LENGTH) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const draft = value as Partial<RetainedInvoice>;
    if (typeof draft.at !== "number" || draft.at > at || at - draft.at > RETAINED_FOR_MS)
      return null;
    if (
      typeof draft.attempt !== "string" ||
      !isUuid(draft.attempt) ||
      !invoiceTargetFromKey(draft.target)
    )
      return null;
    if (
      !Array.isArray(draft.rows) ||
      draft.rows.length < 1 ||
      draft.rows.length > MAX_LINE_ITEMS_PER_ORDER
    )
      return null;
    for (const row of draft.rows) {
      if (!row || typeof row !== "object" || Array.isArray(row)) return null;
      if (Object.keys(row).length !== INVOICE_ROW_FIELDS.length) return null;
      for (const field of INVOICE_ROW_FIELDS) {
        if (typeof row[field] !== "string" || row[field].length > ROW_LIMITS[field]) return null;
      }
    }
    if (!draft.fields || typeof draft.fields !== "object" || Array.isArray(draft.fields))
      return null;
    for (const [name, text] of Object.entries(draft.fields)) {
      if (
        !Object.hasOwn(FIELD_LIMITS, name) ||
        typeof text !== "string" ||
        text.length > FIELD_LIMITS[name as keyof typeof FIELD_LIMITS]
      )
        return null;
    }
    return draft as RetainedInvoice;
  } catch {
    return null;
  }
}
