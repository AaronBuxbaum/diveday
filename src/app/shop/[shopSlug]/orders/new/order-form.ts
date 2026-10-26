import { MAX_LINE_ITEMS_PER_ORDER } from "@/lib/order-limits";
import { isUuid } from "@/lib/uuid";

export type InvoiceRow = {
  kind: string;
  description: string;
  quantity: string;
  unitAmount: string;
};
export const INVOICE_ROW_FIELDS = ["kind", "description", "quantity", "unitAmount"] as const;

/** The actual route target, independent of notice parameters and newly allocated defaults. */
export function invoiceTargetKey(bookingId?: string | null, personId?: string | null): string {
  return `${bookingId?.toLowerCase() ?? ""}:${personId?.toLowerCase() ?? ""}`;
}

export function invoiceTargetFromKey(
  value: unknown,
): { bookingId: string | null; personId: string | null } | null {
  if (typeof value !== "string" || value.length > 73) return null;
  const parts = value.split(":");
  if (parts.length !== 2 || parts.some((part) => part !== "" && !isUuid(part))) return null;
  return { bookingId: parts[0]?.toLowerCase() || null, personId: parts[1]?.toLowerCase() || null };
}

/** Cleanup correlation only; it supplies no billing or authorization authority. */
export function invoiceAttemptFromForm(form: FormData): string | null {
  const values = form.getAll("invoiceAttempt");
  return values.length === 1 && typeof values[0] === "string" && isUuid(values[0])
    ? values[0]
    : null;
}

/** Read the complete bounded form. No extra row or duplicate value is silently dropped. */
export function orderRowsFromForm(form: FormData): InvoiceRow[] | null {
  const counts = form.getAll("lineItemCount");
  if (counts.length !== 1 || typeof counts[0] !== "string" || !/^[1-9]\d*$/.test(counts[0]))
    return null;
  const count = Number(counts[0]);
  if (count > MAX_LINE_ITEMS_PER_ORDER) return null;
  for (const name of form.keys()) {
    if (!INVOICE_ROW_FIELDS.some((field) => name.startsWith(`${field}-`))) continue;
    const match = /^(kind|description|quantity|unitAmount)-(0|[1-9]\d*)$/.exec(name);
    if (!match || Number(match[2]) >= count) return null;
  }
  const rows: InvoiceRow[] = [];
  for (let index = 0; index < count; index++) {
    const row: InvoiceRow = { kind: "", description: "", quantity: "", unitAmount: "" };
    for (const field of INVOICE_ROW_FIELDS) {
      const values = form.getAll(`${field}-${index}`);
      if (values.length !== 1 || typeof values[0] !== "string") return null;
      row[field] = values[0];
    }
    rows.push(row);
  }
  return rows;
}

/** Default controls alone do not make an invoice item; a partially entered line does. */
export function invoiceRowIsBlank(row: InvoiceRow): boolean {
  return (
    !row.description.trim() &&
    !row.unitAmount.trim() &&
    row.quantity === "1" &&
    row.kind === "other"
  );
}
