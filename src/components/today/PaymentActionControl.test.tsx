// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InvoiceResendState } from "@/app/actions/invoice-resend-types";

vi.mock("@/app/actions/invoices", () => ({
  resendInvoiceAction: vi.fn(),
}));

import { resendInvoiceAction } from "@/app/actions/invoices";
import { PaymentActionControl, type PaymentActionCopy } from "./PaymentActionControl";

const mockResend = vi.mocked(resendInvoiceAction);

afterEach(() => {
  cleanup();
  mockResend.mockReset();
});

const COPY: PaymentActionCopy = {
  copyLink: "Copy payment link",
  linkCopied: "Link copied.",
  copyFailed: "Couldn’t copy — copy it from the invoice instead.",
  resendInvoice: "Resend invoice",
  resending: "Resending…",
  invoiceResent: "Invoice resent.",
  errors: {
    // The record is an "order" wherever it is named; "invoice" survives only
    // for the Stripe artifact itself (the resend action, the hosted page).
    notFound: "That order could not be found — open the trip to check it.",
    notOpen: "This order is no longer open — open the trip to check its status.",
    notConfigured: "Payments aren’t connected for this shop yet.",
    failed: "Still couldn’t resend it — open the trip to check the order.",
  },
};

function mockClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  return writeText;
}

describe("PaymentActionControl", () => {
  it("only offers to copy a link when the booking's invoice actually has one", () => {
    const { rerender } = render(
      <PaymentActionControl
        shopSlug="blue-mantis"
        orderId="order-1"
        hostedInvoiceUrl="https://invoice.stripe.com/i/acct_1/in_1"
        copy={COPY}
      />,
    );
    expect(screen.getByRole("button", { name: COPY.copyLink })).toBeInTheDocument();

    rerender(
      <PaymentActionControl
        shopSlug="blue-mantis"
        orderId="order-1"
        hostedInvoiceUrl={null}
        copy={COPY}
      />,
    );
    expect(screen.queryByRole("button", { name: COPY.copyLink })).toBeNull();
    // Resend invoice stays available either way — a hosted link may not exist
    // yet even though the invoice itself does.
    expect(screen.getByRole("button", { name: COPY.resendInvoice })).toBeInTheDocument();
  });

  it("copies the diver's hosted payment link to the clipboard", async () => {
    const writeText = mockClipboard();
    render(
      <PaymentActionControl
        shopSlug="blue-mantis"
        orderId="order-1"
        hostedInvoiceUrl="https://invoice.stripe.com/i/acct_1/in_1"
        copy={COPY}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: COPY.copyLink }));
    });

    expect(writeText).toHaveBeenCalledWith("https://invoice.stripe.com/i/acct_1/in_1");
    expect(screen.getByText(COPY.linkCopied)).toBeInTheDocument();
  });

  it("resends the invoice in place and reports success", async () => {
    mockResend.mockResolvedValue({ status: "sent" } satisfies InvoiceResendState);
    render(
      <PaymentActionControl
        shopSlug="blue-mantis"
        orderId="order-1"
        hostedInvoiceUrl={null}
        copy={COPY}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: COPY.resendInvoice }));
    });

    expect(mockResend).toHaveBeenCalledWith(
      "blue-mantis",
      { status: "idle" },
      expect.any(FormData),
    );
    expect(screen.getByRole("status")).toHaveTextContent(COPY.invoiceResent);
  });

  it("surfaces a worded error — never a silent failure — when the resend can't go out", async () => {
    mockResend.mockResolvedValue({
      status: "error",
      reason: "failed",
    } satisfies InvoiceResendState);
    render(
      <PaymentActionControl
        shopSlug="blue-mantis"
        orderId="order-1"
        hostedInvoiceUrl={null}
        copy={COPY}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: COPY.resendInvoice }));
    });

    expect(screen.getByRole("status")).toHaveTextContent(COPY.errors.failed);
  });

  it("tells staff payments aren't connected instead of pretending the resend worked", async () => {
    mockResend.mockResolvedValue({
      status: "error",
      reason: "not_configured",
    } satisfies InvoiceResendState);
    render(
      <PaymentActionControl
        shopSlug="blue-mantis"
        orderId="order-1"
        hostedInvoiceUrl={null}
        copy={COPY}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: COPY.resendInvoice }));
    });

    expect(screen.getByRole("status")).toHaveTextContent(COPY.errors.notConfigured);
  });
});
