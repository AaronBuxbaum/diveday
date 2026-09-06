// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waiverSendCopy } from "@/app/actions/waiver-send-types";
import type { HeldSendOutcome } from "@/db/held-sends";
import { staffTranslator } from "@/i18n/staff-messages";

// The control composes the `"use server"` action module — same treatment as
// DaySpine.test.tsx. The hold resolves as already due, so a tap releases at
// once and the outcome each test sets is what the control renders against.
type WaiverOutcome = Extract<HeldSendOutcome, { kind: "waiver_send" }>;
let outcome: WaiverOutcome = {
  kind: "waiver_send",
  channel: "email",
  sent: [],
  links: [],
  alreadyDone: [],
  errors: [],
};
const holdSendAction = vi.fn(async (_formData: FormData) => ({ id: "held-1", runAt: Date.now() }));
const undoHeldSendAction = vi.fn(async (_id: string) => true);
const releaseHeldSendAction = vi.fn(async (_id: string) => ({
  status: "done" as const,
  outcome: outcome as HeldSendOutcome,
}));
vi.mock("@/app/actions/held-sends", () => ({
  holdSendAction: (formData: FormData) => holdSendAction(formData),
  undoHeldSendAction: (id: string) => undoHeldSendAction(id),
  releaseHeldSendAction: (id: string) => releaseHeldSendAction(id),
}));

const { WaiverSendControl } = await import("./WaiverSendControl");

const copy = waiverSendCopy(staffTranslator("en-US"));

function renderControl() {
  return render(
    <WaiverSendControl
      surface="today"
      bookingIds={["booking-1"]}
      label="Resend waiver link"
      copy={copy}
    />,
  );
}

async function tapSend() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Resend waiver link" }));
  // The hold resolves as due, the release effect runs on the next tick.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  outcome = {
    kind: "waiver_send",
    channel: "email",
    sent: [],
    links: [],
    alreadyDone: [],
    errors: [],
  };
  vi.clearAllMocks();
});
afterEach(cleanup);

/**
 * **A control must never keep offering an errand it has just been told cannot
 * exist.**
 *
 * The case this is written for: a Today row saying a diver's waiver link could
 * not be delivered after five attempts, whose "Resend waiver link" button
 * answers that the diver already has a signed waiver. `issueWaiverRequest`
 * refuses that person outright, so every further tap returns the same sentence
 * — the button is pointing at nothing.
 *
 * And, since ADR 20260906-before-you-ask (decision 2): the tap holds the send
 * rather than sending, with the surface's own hidden inputs as the payload.
 */
describe("WaiverSendControl", () => {
  it("offers the send before anything has been tried", () => {
    renderControl();
    expect(screen.getByRole("button", { name: "Resend waiver link" })).toBeInTheDocument();
  });

  it("holds the send with the booking and surface as its payload, never sending on the tap", async () => {
    renderControl();
    await tapSend();
    expect(holdSendAction).toHaveBeenCalledTimes(1);
    const formData = holdSendAction.mock.calls[0]?.[0];
    if (!formData) throw new Error("hold was not asked for");
    expect(formData.get("holdKind")).toBe("waiver_send");
    expect(formData.get("surface")).toBe("today");
    expect(formData.getAll("bookingId")).toEqual(["booking-1"]);
    expect(releaseHeldSendAction).toHaveBeenCalledWith("held-1");
  });

  it("drops the send once the answer is that there is nothing to send", async () => {
    outcome = { ...outcome, alreadyDone: ["Declan Murphy"] };
    renderControl();
    await tapSend();
    expect(screen.queryByRole("button", { name: "Resend waiver link" })).toBeNull();
    // The reason stays: the staffer still has to learn why nothing happened.
    expect(screen.getByRole("status")).toHaveTextContent("already has a signed waiver");
  });

  it("keeps the send when part of the batch still needs one", async () => {
    // A mixed outcome is a real reason to tap again — one diver is covered, the
    // other is not, and the row is still the way to reach them.
    outcome = { ...outcome, alreadyDone: ["Declan Murphy"], sent: ["Priya Sharma"] };
    renderControl();
    await tapSend();
    expect(screen.getByRole("button", { name: "Resend waiver link" })).toBeInTheDocument();
  });

  it("keeps the send when it failed outright", async () => {
    outcome = { ...outcome, errors: ["Declan Murphy"] };
    renderControl();
    await tapSend();
    expect(screen.getByRole("button", { name: "Resend waiver link" })).toBeInTheDocument();
  });
});
