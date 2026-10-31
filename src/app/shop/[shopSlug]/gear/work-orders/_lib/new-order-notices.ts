import type { StaffMessageKey } from "@/i18n/staff-messages";

/** The refusals the new-work-order form renders beside a field. */
export type NewOrderNoticeField = "reported-problem" | "promised-on" | "technician";

/** One new-work-order outcome: its localized copy and, for refusals, its field. */
export type NewOrderNotice = {
  messageKey: StaffMessageKey;
  field?: NewOrderNoticeField;
};

/** Every notice the new-work-order form reads off `?notice=`. */
export const NEW_ORDER_NOTICES: Record<string, NewOrderNotice> = {
  "empty-problem": {
    messageKey: "workOrders.notice.emptyProblem",
    field: "reported-problem",
  },
  "no-items": { messageKey: "workOrders.notice.noItems" },
  "no-subject": { messageKey: "workOrders.notice.noSubject" },
  "two-subjects": { messageKey: "workOrders.notice.twoSubjects" },
  "invalid-date": { messageKey: "workOrders.notice.invalidDate", field: "promised-on" },
  "not-found": { messageKey: "workOrders.notice.notFound" },
  "unknown-technician": {
    messageKey: "workOrders.notice.unknownTechnician",
    field: "technician",
  },
  invalid: { messageKey: "workOrders.notice.invalid" },
  "piece-added": { messageKey: "workOrders.notice.pieceAdded" },
};
