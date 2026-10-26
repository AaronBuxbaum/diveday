import type { StaffMessageKey } from "@/i18n/staff-messages";

export const LINE_ADD_REFUSAL_KEYS = {
  "invalid-quantity": "workOrders.notice.invalidQuantity",
  "invalid-amount": "workOrders.notice.invalidAmount",
  "empty-description": "workOrders.notice.emptyDescription",
} as const satisfies Record<string, StaffMessageKey>;

/** Only a validated add-line refusal belongs to the add form; edits and gates stay global. */
export function isLineAddRefusal(
  notice: string | undefined,
  form: string | undefined,
  readOnly = false,
) {
  return (
    !readOnly &&
    form === "line-add" &&
    notice !== undefined &&
    Object.hasOwn(LINE_ADD_REFUSAL_KEYS, notice)
  );
}
