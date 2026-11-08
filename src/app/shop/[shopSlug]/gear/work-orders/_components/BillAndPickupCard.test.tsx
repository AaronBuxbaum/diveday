// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DbExecutor } from "@/db/client";
import type { WorkOrder } from "@/db/schema";
import { staffTranslator } from "@/i18n/staff-messages";
import { BillAndPickupCard } from "./BillAndPickupCard";

vi.mock("@/db/work-order-follow-up", () => ({
  billAndPickupFacts: vi.fn(async () => ({
    readyNotice: null,
    bill: null,
    connected: false,
    canBill: true,
    customerHasEmail: true,
  })),
}));
vi.mock("../follow-up-actions", () => ({
  recordBenchPaymentAction: vi.fn(),
  resendReadyNoticeAction: vi.fn(),
  sendWorkOrderBillAction: vi.fn(),
}));
afterEach(cleanup);
const t = staffTranslator("en-US");
const pickedUp = {
  id: "wo-1",
  personId: "person-1",
  deletedAt: null,
  status: "picked_up",
} as unknown as WorkOrder;
const props = {
  db: {} as DbExecutor,
  shop: { id: "shop-1", slug: "blue-mantis", timezone: "America/New_York", currency: "USD" },
  workOrder: pickedUp,
  lineCount: 2,
  totalCents: 5400,
  viewerPersonId: "staff-1",
  locale: "en-US",
  t,
};

describe("a concurrent pickup while the ready-message form was open", () => {
  it("still renders the stale-send refusal without a ready-message history record", async () => {
    render(await BillAndPickupCard({ ...props, notice: "ready-not-ready" }));
    expect(screen.getByText(t("benchFollowUp.notice.readyNotReady"))).toBeVisible();
    expect(screen.queryByText(t("benchFollowUp.ready.pending"))).toBeNull();
    expect(screen.queryByRole("button", { name: t("benchFollowUp.ready.send") })).toBeNull();
  });
});
