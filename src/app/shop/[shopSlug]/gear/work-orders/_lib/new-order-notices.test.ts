import { describe, expect, it } from "vitest";
import { noticeFromParam } from "@/lib/staff-notices";
import { NEW_ORDER_NOTICES } from "./new-order-notices";

describe("new work-order notices", () => {
  it("keeps every message and field mapping in one definition", () => {
    expect(NEW_ORDER_NOTICES).toEqual({
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
    });
  });

  it("resolves field, global, and success notices through the shared safe lookup", () => {
    expect(noticeFromParam("invalid-date", NEW_ORDER_NOTICES)).toEqual({
      messageKey: "workOrders.notice.invalidDate",
      field: "promised-on",
    });
    expect(noticeFromParam("no-subject", NEW_ORDER_NOTICES)).toEqual({
      messageKey: "workOrders.notice.noSubject",
    });
    expect(noticeFromParam("piece-added", NEW_ORDER_NOTICES)).toEqual({
      messageKey: "workOrders.notice.pieceAdded",
    });
  });

  it.each([undefined, "unknown", "constructor", "__proto__"])(
    "does not resolve an absent, unknown, or prototype-shaped notice: %s",
    (notice) => {
      expect(noticeFromParam(notice, NEW_ORDER_NOTICES)).toBeUndefined();
    },
  );
});
