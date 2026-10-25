// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { RecordPaymentForm } from "./CounterPayment";

// The forms post to server actions whose modules reach the database.
vi.mock("../counter-actions", () => ({
  holdCounterPaymentAction: vi.fn(),
  recordRoomChargeAction: vi.fn(),
  voidCounterAction: vi.fn(),
}));
vi.mock("@/app/actions/held-sends", () => ({
  undoHeldSendAction: vi.fn(),
  releaseHeldSendAction: vi.fn(),
}));
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

const { holdCounterPaymentAction } = await import("../counter-actions");
const { undoHeldSendAction, releaseHeldSendAction } = await import("@/app/actions/held-sends");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

const t = staffTranslator("en-US");
const ORDER_ID = "00000000-0000-4000-8000-000000000001";
const HOLD_ID = "00000000-0000-4000-8000-000000000002";
const LEAVE = "/shop/x/orders/1/leave";
const TOO_LATE = "/shop/x/orders/1?notice=payment-undo-too-late";
const urls = { leaveUrl: LEAVE, tooLateHref: TOO_LATE };

/**
 * **Record payment** (market sheet 2026-10-22, item 6; issue #3030): cash and
 * the card machine are live on a demo shop too, the room charge is not
 * offered there, and a tap holds the payment eight seconds with Undo before
 * anything is recorded.
 */
describe("RecordPaymentForm", () => {
  it("offers cash, the card machine and a room charge on a real shop", () => {
    render(<RecordPaymentForm orderId={ORDER_ID} amount="$340.00" t={t} {...urls} />);
    expect(screen.getByRole("button", { name: "Cash" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Card machine" })).toBeEnabled();
    expect(screen.getByText(t("orders.detail.recordPayment.roomCharge"))).toBeInTheDocument();
  });

  it("offers only cash and the card machine on a demo shop, both live", () => {
    render(
      <RecordPaymentForm orderId={ORDER_ID} amount="$340.00" t={t} roomCharge={false} {...urls} />,
    );
    expect(screen.getByRole("button", { name: "Cash" })).toHaveAttribute("value", "cash");
    expect(screen.getByRole("button", { name: "Card machine" })).toHaveAttribute(
      "value",
      "card_machine",
    );
    expect(screen.queryByText(t("orders.detail.recordPayment.roomCharge"))).toBeNull();
  });

  it("holds a tap as “Recording $340.00 cash” with Undo, and Undo puts the buttons back", async () => {
    vi.mocked(holdCounterPaymentAction).mockResolvedValueOnce({
      ok: true,
      ticket: { id: HOLD_ID, runAt: 0, holdMs: 8_000 },
      collection: "cash",
    });
    vi.mocked(undoHeldSendAction).mockResolvedValueOnce(true);
    render(<RecordPaymentForm orderId={ORDER_ID} amount="$340.00" t={t} {...urls} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cash" }));
    });
    const posted = vi.mocked(holdCounterPaymentAction).mock.calls[0]?.[0];
    expect(posted?.get("orderId")).toBe(ORDER_ID);
    expect(posted?.get("collection")).toBe("cash");
    expect(screen.getByRole("status")).toHaveTextContent("Recording $340.00 cash");
    expect(screen.queryByRole("button", { name: "Card machine" })).toBeNull();
    // The room charge steps aside while the hold drains.
    expect(screen.queryByText(t("orders.detail.recordPayment.roomCharge"))).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    });
    expect(undoHeldSendAction).toHaveBeenCalledWith(HOLD_ID);
    expect(releaseHeldSendAction).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Cash" })).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("releases at the end of the hold and lands on the outcome's notice", async () => {
    vi.useFakeTimers();
    vi.mocked(releaseHeldSendAction).mockResolvedValue({
      status: "done",
      outcome: {
        kind: "counter_payment",
        demo: true,
        outcome: { ok: true, order: { id: ORDER_ID } as never },
        redirectTo: "/shop/x/orders/1?notice=payment-recorded-demo",
      },
    });
    render(
      <RecordPaymentForm
        orderId={ORDER_ID}
        amount="$340.00"
        t={t}
        {...urls}
        initialHold={{
          ticket: { id: HOLD_ID, runAt: 0, holdMs: 8_000 },
          collection: "card_machine",
        }}
      />,
    );
    // A reload inside the hold shows it still draining.
    expect(screen.getByRole("status")).toHaveTextContent("Recording $340.00 on the card machine");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7_000);
    });
    expect(releaseHeldSendAction).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    expect(releaseHeldSendAction).toHaveBeenCalledWith(HOLD_ID);
    expect(push).toHaveBeenCalledWith("/shop/x/orders/1?notice=payment-recorded-demo");
  });

  it("goes where a refused hold says, and keeps the buttons", async () => {
    vi.mocked(holdCounterPaymentAction).mockResolvedValueOnce({
      ok: false,
      redirectTo: "/step-up",
    });
    render(<RecordPaymentForm orderId={ORDER_ID} amount="$340.00" t={t} {...urls} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Card machine" }));
    });
    expect(push).toHaveBeenCalledWith("/step-up");
    expect(screen.getByRole("button", { name: "Cash" })).toBeInTheDocument();
  });

  it("says it is too late, never shows the buttons as undone, when the server refuses Undo", async () => {
    vi.mocked(holdCounterPaymentAction).mockResolvedValueOnce({
      ok: true,
      ticket: { id: HOLD_ID, runAt: 0, holdMs: 8_000 },
      collection: "cash",
    });
    // The hold had already run out on the server: the payment is recorded.
    vi.mocked(undoHeldSendAction).mockResolvedValueOnce(false);
    render(<RecordPaymentForm orderId={ORDER_ID} amount="$340.00" t={t} {...urls} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cash" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    });
    expect(push).toHaveBeenCalledWith(TOO_LATE);
    expect(screen.queryByRole("button", { name: "Cash" })).toBeNull();
  });

  it("says it is too late when the release finds the hold already gone", async () => {
    vi.useFakeTimers();
    vi.mocked(releaseHeldSendAction).mockResolvedValue({ status: "gone" });
    render(
      <RecordPaymentForm
        orderId={ORDER_ID}
        amount="$340.00"
        t={t}
        {...urls}
        initialHold={{ ticket: { id: HOLD_ID, runAt: 0, holdMs: 1_000 }, collection: "cash" }}
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(releaseHeldSendAction).toHaveBeenCalledWith(HOLD_ID);
    expect(push).toHaveBeenCalledWith(TOO_LATE);
  });

  it("records the hold as the page goes, once", async () => {
    const fetch = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response(null, { status: 204 }),
    );
    vi.stubGlobal("fetch", fetch);
    const { unmount } = render(
      <RecordPaymentForm
        orderId={ORDER_ID}
        amount="$340.00"
        t={t}
        {...urls}
        initialHold={{ ticket: { id: HOLD_ID, runAt: 0, holdMs: 8_000 }, collection: "cash" }}
      />,
    );
    window.dispatchEvent(new Event("pagehide"));
    window.dispatchEvent(new Event("pagehide"));
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(
      LEAVE,
      expect.objectContaining({ method: "POST", keepalive: true }),
    );
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({ heldId: HOLD_ID });
    unmount();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetch).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it("records the hold when a navigation inside the app unmounts the row", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    const { unmount } = render(
      <RecordPaymentForm
        orderId={ORDER_ID}
        amount="$340.00"
        t={t}
        {...urls}
        initialHold={{ ticket: { id: HOLD_ID, runAt: 0, holdMs: 8_000 }, collection: "cash" }}
      />,
    );
    unmount();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetch).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});
