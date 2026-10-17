import type { StaffMessageKey } from "@/i18n/staff-messages";

/** The refusals the new-work-order form renders beside a field. */
export type NewOrderNoticeField = "reported-problem" | "promised-on" | "technician";
export const NEW_ORDER_NOTICE_FIELD: Record<string, NewOrderNoticeField> = {
  "empty-problem": "reported-problem",
  "invalid-date": "promised-on",
  "unknown-technician": "technician",
};

/** Every notice the new-work-order form reads off `?notice=`. */
export const NEW_ORDER_NOTICES: Record<string, StaffMessageKey> = {
  "empty-problem": "workOrders.notice.emptyProblem",
  "no-items": "workOrders.notice.noItems",
  "no-subject": "workOrders.notice.noSubject",
  "two-subjects": "workOrders.notice.twoSubjects",
  "invalid-date": "workOrders.notice.invalidDate",
  "not-found": "workOrders.notice.notFound",
  "unknown-technician": "workOrders.notice.unknownTechnician",
  invalid: "workOrders.notice.invalid",
  "piece-added": "workOrders.notice.pieceAdded",
};
