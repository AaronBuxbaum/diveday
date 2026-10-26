import { uuidParam } from "@/lib/uuid";

export const LINE_EDIT_REFUSAL_FIELDS = {
  "invalid-amount": "unitAmount",
  "invalid-quantity": "quantity",
  "empty-description": "description",
} as const;
export type LineEditNotice = keyof typeof LINE_EDIT_REFUSAL_FIELDS | "line-saved";
export type LineEditFeedback = { lineId: string; notice: LineEditNotice };

/** A query marker may open only an existing line on the ticket the desk is reading. */
export function lineEditFeedback(
  notice: string | undefined,
  form: string | undefined,
  rawLineId: string | undefined,
  lines: readonly { id: string }[],
  readOnly = false,
): LineEditFeedback | undefined {
  const lineId = uuidParam(rawLineId);
  if (readOnly || form !== "line-edit" || !lineId || !lines.some((line) => line.id === lineId))
    return;
  if (notice === "line-saved") return { lineId, notice };
  if (notice && Object.hasOwn(LINE_EDIT_REFUSAL_FIELDS, notice))
    return { lineId, notice: notice as keyof typeof LINE_EDIT_REFUSAL_FIELDS };
}
