// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  IDLE_WAIVER_SEND_STATE,
  type WaiverSendState,
  waiverSendCopy,
} from "@/app/actions/waiver-send-types";
import { staffTranslator } from "@/i18n/staff-messages";

// The control composes the `"use server"` action module — same treatment as
// TodayQueue.test.tsx and BlockerGroups.test.tsx.
vi.mock("@/app/actions/waivers", () => ({ sendWaiversAction: vi.fn() }));

// The outcome is `useActionState`'s to hold, and this suite is about what the
// control does *with* one — so the hook is stubbed and each test sets the state
// it wants to render against.
let outcome: WaiverSendState = IDLE_WAIVER_SEND_STATE;
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useActionState: () => [outcome, vi.fn(), false],
  };
});

const { WaiverSendControl } = await import("./WaiverSendControl");

const copy = waiverSendCopy(staffTranslator("en-US"));

function renderControl() {
  return render(
    <WaiverSendControl
      shopSlug="blue-mantis"
      surface="today"
      bookingIds={["booking-1"]}
      label="Resend waiver link"
      copy={copy}
    />,
  );
}

beforeEach(() => {
  outcome = IDLE_WAIVER_SEND_STATE;
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
 */
describe("WaiverSendControl", () => {
  it("offers the send before anything has been tried", () => {
    renderControl();
    expect(screen.getByRole("button", { name: "Resend waiver link" })).toBeInTheDocument();
  });

  it("drops the send once the answer is that there is nothing to send", () => {
    outcome = { ...IDLE_WAIVER_SEND_STATE, status: "done", alreadyDone: ["Declan Murphy"] };
    renderControl();
    expect(screen.queryByRole("button", { name: "Resend waiver link" })).toBeNull();
    // The reason stays: the staffer still has to learn why nothing happened.
    expect(screen.getByRole("status")).toHaveTextContent("already has a signed waiver");
  });

  it("keeps the send when part of the batch still needs one", () => {
    // A mixed outcome is a real reason to tap again — one diver is covered, the
    // other is not, and the row is still the way to reach them.
    outcome = {
      ...IDLE_WAIVER_SEND_STATE,
      status: "done",
      alreadyDone: ["Declan Murphy"],
      sent: ["Priya Sharma"],
    };
    renderControl();
    expect(screen.getByRole("button", { name: "Resend waiver link" })).toBeInTheDocument();
  });

  it("keeps the send when it failed outright", () => {
    outcome = { ...IDLE_WAIVER_SEND_STATE, status: "done", errors: ["Declan Murphy"] };
    renderControl();
    expect(screen.getByRole("button", { name: "Resend waiver link" })).toBeInTheDocument();
  });
});
