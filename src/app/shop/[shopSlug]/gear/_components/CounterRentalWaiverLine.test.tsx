// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";

const holdSendAction = vi.fn(async (_formData: FormData) => ({
  id: "held-1",
  runAt: Date.now() + 60_000,
  holdMs: 60_000,
}));
vi.mock("@/app/actions/held-sends", () => ({
  holdSendAction: (formData: FormData) => holdSendAction(formData),
  undoHeldSendAction: vi.fn(async () => true),
  releaseHeldSendAction: vi.fn(async () => ({ status: "pending" as const })),
}));

const { CounterRentalWaiverLine } = await import("./CounterRentalWaiverLine");

const t = staffTranslator("en-US");

afterEach(() => {
  cleanup();
  holdSendAction.mockClear();
});

/**
 * H-108 (issues #2261, #2346): the counter is told where the person stands
 * with the waiver and offered the link, and nothing waits on it.
 */
describe("CounterRentalWaiverLine", () => {
  it("says nothing for a current signature, or a standing nobody read", () => {
    const { container, rerender } = render(
      <CounterRentalWaiverLine t={t} state="current" personId="person-1" />,
    );
    expect(container).toBeEmptyDOMElement();
    rerender(<CounterRentalWaiverLine t={t} state={undefined} personId="person-1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("says a missing waiver and sends the link as a counter send", async () => {
    render(<CounterRentalWaiverLine t={t} state="none" personId="person-1" />);
    expect(screen.getByText("Waiver: Not signed")).toBeVisible();
    await userEvent.setup().click(screen.getByRole("button", { name: "Send waiver" }));
    const formData = holdSendAction.mock.calls.at(-1)?.[0];
    if (!formData) throw new Error("hold was not asked for");
    expect(formData.get("surface")).toBe("counter");
    expect(formData.get("personId")).toBe("person-1");
    // No ticket yet on the new-rental form: the send refreshes the form itself.
    expect(formData.get("ticketId")).toBeNull();
  });

  it("names the ticket when there is one", async () => {
    render(<CounterRentalWaiverLine t={t} state="expired" personId="person-1" ticketId="t-1" />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Send waiver" }));
    expect(holdSendAction.mock.calls.at(-1)?.[0].get("ticketId")).toBe("t-1");
  });

  it("offers no link where another link fixes nothing", () => {
    render(<CounterRentalWaiverLine t={t} state="medical_review" personId="person-1" />);
    expect(screen.queryByRole("button", { name: "Send waiver" })).toBeNull();
  });
});
