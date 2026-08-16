// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RecapSendControl } from "./RecapSendControl";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const copy = {
  waiting: "Automatic sending is available in {remaining}.",
  ready: "Recaps can now be sent.",
  send: "Send recap now",
  sending: "Sending recap…",
  lessThanMinute: "less than a minute",
};

describe("RecapSendControl", () => {
  it("shows a live countdown and does not enable a premature send", () => {
    render(
      <RecapSendControl
        action={vi.fn()}
        eligibleAt="2026-08-16T16:00:00.000Z"
        nowMs={new Date("2026-08-16T12:00:00.000Z").getTime()}
        copy={copy}
      />,
    );
    expect(screen.getByText("Automatic sending is available in 4h 00m.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send recap now" })).toBeDisabled();
  });

  it("enables the manual send at the eligibility boundary", () => {
    render(
      <RecapSendControl
        action={vi.fn()}
        eligibleAt="2026-08-16T16:00:00.000Z"
        nowMs={new Date("2026-08-16T16:00:00.000Z").getTime()}
        copy={copy}
      />,
    );
    expect(screen.getByText("Recaps can now be sent.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send recap now" })).toBeEnabled();
  });
});
