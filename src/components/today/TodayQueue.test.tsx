// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TodayAction } from "@/lib/today";

// TodayQueue composes WaiverSendControl/ResendConfirmationControl/
// PaymentActionControl, each of which statically imports its own
// `"use server"` action file. Those import `requireStaffSession` ->
// next-auth, which fails to resolve under vitest's module graph — mocking
// them here is what makes TodayQueue renderable in this environment at all,
// the same boundary DepartureBoard's own tests draw by taking a bound action
// as a prop instead.
vi.mock("@/app/actions/invoices", () => ({ resendInvoiceAction: vi.fn() }));
vi.mock("@/app/actions/notifications", () => ({ resendConfirmationAction: vi.fn() }));
vi.mock("@/app/actions/waivers", () => ({ sendWaiversAction: vi.fn() }));

import { type TodayInviteAction, TodayQueue } from "./TodayQueue";

afterEach(() => {
  cleanup();
});

const inviteAction: TodayInviteAction = vi.fn().mockResolvedValue("sent");

function action(overrides: Partial<TodayAction> = {}): TodayAction {
  return {
    id: "a",
    kind: "waiver",
    urgency: "now",
    subject: "Diver",
    context: null,
    detail: "…",
    actionLabel: "Open roster",
    href: "/shop/blue-mantis/trips/t1",
    dueAt: null,
    ...overrides,
  };
}

describe("TodayQueue urgency groups", () => {
  it("celebrates once today's boats (imminent + now) clear but later work remains", () => {
    render(
      <TodayQueue
        actions={[action({ id: "a1", urgency: "soon" })]}
        shopSlug="blue-mantis"
        shopName="Blue Mantis"
        inviteAction={inviteAction}
        locale="en-US"
      />,
    );
    expect(screen.getByText("Today's boats are all clear 🤙")).toBeInTheDocument();
  });

  it("stays quiet while a 'now' row is still outstanding", () => {
    render(
      <TodayQueue
        actions={[action({ id: "a1", urgency: "now" }), action({ id: "a2", urgency: "soon" })]}
        shopSlug="blue-mantis"
        shopName="Blue Mantis"
        inviteAction={inviteAction}
        locale="en-US"
      />,
    );
    expect(screen.queryByText("Today's boats are all clear 🤙")).toBeNull();
  });

  it("stays quiet while an 'imminent' row is still outstanding", () => {
    render(
      <TodayQueue
        actions={[
          action({ id: "a1", urgency: "imminent" }),
          action({ id: "a2", urgency: "later" }),
        ]}
        shopSlug="blue-mantis"
        shopName="Blue Mantis"
        inviteAction={inviteAction}
        locale="en-US"
      />,
    );
    expect(screen.queryByText("Today's boats are all clear 🤙")).toBeNull();
  });

  it("never doubles up with the fully-empty 🤙 state", () => {
    render(
      <TodayQueue
        actions={[]}
        shopSlug="blue-mantis"
        shopName="Blue Mantis"
        inviteAction={inviteAction}
        locale="en-US"
      />,
    );
    // The queue is entirely empty, so it renders the existing "nothing waiting"
    // state, not the "today's boats are clear" banner meant for a queue that
    // still has later work.
    expect(screen.queryByText("Today's boats are all clear 🤙")).toBeNull();
    expect(screen.getByText("Nothing is waiting on you")).toBeInTheDocument();
  });

  it("shows a worded item count on each group header, not a bare number", () => {
    render(
      <TodayQueue
        actions={[
          action({ id: "a1", urgency: "soon" }),
          action({ id: "a2", urgency: "soon" }),
          action({ id: "a3", urgency: "later" }),
        ]}
        shopSlug="blue-mantis"
        shopName="Blue Mantis"
        inviteAction={inviteAction}
        locale="en-US"
      />,
    );
    expect(screen.getByText("2 items")).toBeInTheDocument();
    expect(screen.getByText("1 item")).toBeInTheDocument();
  });
});

describe("TodayQueue payment rows", () => {
  it("renders the inline payment control only once a booking is known to be invoiced", () => {
    render(
      <TodayQueue
        actions={[
          action({
            id: "paid-row",
            kind: "payment",
            actionLabel: "Take payment",
            payment: {
              bookingId: "booking-1",
              orderId: "order-1",
              hostedInvoiceUrl: "https://invoice.stripe.com/i/acct_1/in_1",
            },
          }),
        ]}
        shopSlug="blue-mantis"
        shopName="Blue Mantis"
        inviteAction={inviteAction}
        locale="en-US"
      />,
    );
    expect(screen.getByRole("button", { name: "Copy payment link" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resend invoice" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Take payment" })).toBeNull();
  });

  it("falls back to plain roster navigation when the booking was never invoiced — never a dead button", () => {
    render(
      <TodayQueue
        actions={[
          action({
            id: "counter-row",
            kind: "payment",
            actionLabel: "Take payment",
            href: "/shop/blue-mantis/trips/t1/guests#booking-2",
            payment: { bookingId: "booking-2" },
          }),
        ]}
        shopSlug="blue-mantis"
        shopName="Blue Mantis"
        inviteAction={inviteAction}
        locale="en-US"
      />,
    );
    const link = screen.getByRole("link", { name: "Take payment" });
    expect(link).toHaveAttribute("href", "/shop/blue-mantis/trips/t1/guests#booking-2");
    expect(screen.queryByRole("button", { name: "Copy payment link" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Resend invoice" })).toBeNull();
  });

  it("falls back to navigation for a collapsed multi-diver payment row with no single booking", () => {
    render(
      <TodayQueue
        actions={[
          action({
            id: "group-row",
            kind: "payment",
            actionLabel: "Take payment",
            payment: undefined,
          }),
        ]}
        shopSlug="blue-mantis"
        shopName="Blue Mantis"
        inviteAction={inviteAction}
        locale="en-US"
      />,
    );
    expect(screen.getByRole("link", { name: "Take payment" })).toBeInTheDocument();
  });
});
