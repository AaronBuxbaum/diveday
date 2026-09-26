// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The control posts a `"use server"` action; rendering it needs only the
// reference, not the session and database behind it.
vi.mock("@/app/actions/notifications", () => ({
  resendConfirmationAction: vi.fn(async () => ({ status: "idle" as const })),
}));

const { ResendConfirmationControl } = await import("./ResendConfirmationControl");

afterEach(cleanup);

const copy = {
  resending: "Resending…",
  confirmationResent: "Confirmation resent",
  errors: {
    invalid: "invalid",
    noEmail: "no email",
    notConfigured: "not configured",
    failed: "failed",
  },
};

/**
 * **A fix in a ledger row is the row's size.** Today's queue puts this button
 * in a `LedgerRow` beside the other fixes, which are all `sm` (44px, 14px);
 * this one was the default `md` (48px, 16px), and the pixel probe measured the
 * same row's waiver send 2px under its top hairline and 1px over its bottom
 * one (`button.ts`: "a ledger row, a table cell or a chip row takes `sm`").
 */
describe("ResendConfirmationControl", () => {
  it("draws its button at the ledger row's size", () => {
    render(
      <ResendConfirmationControl
        shopSlug="blue-mantis"
        bookingId="booking-1"
        label="Resend confirmation"
        copy={copy}
      />,
    );
    const button = screen.getByRole("button", { name: "Resend confirmation" });
    expect(button).toHaveClass("text-sm", "py-2");
    expect(button).not.toHaveClass("min-h-12");
    expect(button).not.toHaveClass("text-base");
  });
});
