// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import type { MedicalWaiverMark, ShopWaiverStatus } from "@/lib/waivers";

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
const signedAt = new Date("2026-07-20T14:00:00Z");
const expiresAt = new Date("2027-07-20T14:00:00Z");

function Line(props: { status: ShopWaiverStatus | undefined; ticketId?: string }) {
  return (
    <CounterRentalWaiverLine
      t={t}
      personId="person-1"
      shopSlug="blue-mantis"
      locale="en-US"
      timezone="America/New_York"
      {...props}
    />
  );
}

function current(medical: Partial<MedicalWaiverMark> | null): ShopWaiverStatus {
  return {
    state: "current",
    signedAt,
    expiresAt,
    medical: medical
      ? ({
          overriddenRefusal: null,
          overriddenReferral: null,
          overriddenReferralAt: null,
          ...medical,
        } as MedicalWaiverMark)
      : null,
  } as ShopWaiverStatus;
}

afterEach(() => {
  cleanup();
  holdSendAction.mockClear();
});

/**
 * H-20261008-counter-rental-waiver-informs (issues #2261, #2346): the counter is told where the person stands
 * with the waiver and offered the link, and nothing waits on it.
 */
describe("CounterRentalWaiverLine", () => {
  it("says nothing for a clean current signature, or a standing nobody read", () => {
    const { container, rerender } = render(<Line status={current(null)} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<Line status={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("says a missing waiver and sends the link as a counter send", async () => {
    render(<Line status={{ state: "none" }} />);
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
    render(<Line status={{ state: "expired", signedAt }} ticketId="t-1" />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Send waiver" }));
    expect(holdSendAction.mock.calls.at(-1)?.[0].get("ticketId")).toBe("t-1");
  });

  it("says a physician's answer in full, without a waiver prefix or a link", () => {
    render(<Line status={{ state: "medical_not_cleared" } as ShopWaiverStatus} />);
    expect(screen.getByText("A physician did not clear this diver to dive.")).toBeVisible();
    expect(screen.queryByText(/^Waiver:/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Send waiver" })).toBeNull();
  });

  it("says a medical hold in full, without a link", () => {
    render(<Line status={{ state: "medical_review" } as ShopWaiverStatus} />);
    expect(
      screen.getByText("A medical answer needs a doctor’s sign-off before this diver dives."),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Send waiver" })).toBeNull();
  });

  // Dive-domain review: H-20261007-after-physician-says-no as amended lets a later clean release stand over
  // a physician's "not cleared"; the counter says it as the manifest does.
  it("warns of a physician's earlier refusal under a later clean signature, with the record", () => {
    render(
      <Line
        status={current({
          overriddenRefusal: {
            recordId: "refused-1",
            personId: "person-1",
            at: new Date("2026-07-18T15:00:00Z"),
            evaluatedOn: "2026-07-18",
          },
        })}
      />,
    );
    expect(
      screen.getByText(/A physician did not clear this person on Jul 18, 2026 \(earlier waiver\)/),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "View the physician’s decision" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/divers/person-1/waivers/refused-1",
    );
    expect(screen.queryByRole("button", { name: "Send waiver" })).toBeNull();
  });

  it("warns of an open referral under a later clean signature, with the referral", () => {
    const at = new Date("2026-07-17T15:00:00Z");
    render(
      <Line
        status={current({
          overriddenReferralAt: at,
          overriddenReferral: { recordId: "referral-1", personId: "person-1", at },
        })}
      />,
    );
    expect(screen.getByText(/Referred to a physician on Jul 17, 2026/)).toBeVisible();
    expect(screen.getByRole("link", { name: "View the referral" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/divers/person-1/waivers/referral-1",
    );
  });
});
