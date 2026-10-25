// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { OrderMoreMenu } from "./OrderMoreMenu";

vi.mock("next/navigation", () => ({ usePathname: () => "/shop/blue-mantis/orders/o1" }));
vi.mock("../actions", () => ({ refreshAction: vi.fn(async () => {}), voidAction: vi.fn() }));

const { voidAction } = await import("../actions");

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/**
 * **Void asks before it posts** (layer 3 review, dive-domain run B, item 7).
 * In the More menu it sits one row under Refresh status, and a voided Stripe
 * invoice cannot be paid again, so a mis-tap after a refresh must not land.
 */
describe("the order's More menu", () => {
  it("asks before voiding the Stripe invoice, and sends nothing on Cancel", async () => {
    const t = staffTranslator("en-US");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(
      <OrderMoreMenu
        t={t}
        shopSlug="blue-mantis"
        orderId="11111111-1111-4111-8111-111111111111"
        canDisputeSheet={false}
        stripeOpen
        demo={false}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: t("orders.detail.more") }));
    await userEvent.click(screen.getByRole("button", { name: "Void order" }));
    expect(confirm).toHaveBeenCalledWith(t("orders.detail.voidConfirm"));
    expect(voidAction).not.toHaveBeenCalled();
  });
});
