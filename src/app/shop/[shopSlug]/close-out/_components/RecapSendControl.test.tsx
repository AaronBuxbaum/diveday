// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RecapSendControl } from "./RecapSendControl";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const copy = {
  waiting: "Automatic recap sending begins in {remaining}.",
  due: "Recaps will be sent within 1h.",
  paused: "Automatic recap sending is paused.",
  failed: "Automatic recap sending failed.",
  noScheduledReturn: "No scheduled return time. Recaps will not be sent automatically.",
  send: "Send recap now",
  sending: "Sending recap…",
  pause: "Pause automatic sending",
  pausing: "Pausing automatic sending…",
  unpause: "Unpause automatic sending",
  unpausing: "Unpausing automatic sending…",
  lessThanMinute: "less than a minute",
};

describe("RecapSendControl", () => {
  it("shows a live countdown to automatic sending and allows immediate manual send", () => {
    render(
      <RecapSendControl
        sendAction={vi.fn()}
        togglePauseAction={vi.fn()}
        tripId="trip-123"
        autoSendAt="2026-08-16T16:00:00.000Z"
        autoSendAtLabel="Aug 16, 2026, 12:00 PM EDT"
        paused={false}
        nowMs={new Date("2026-08-16T12:00:00.000Z").getTime()}
        copy={copy}
      />,
    );
    expect(screen.getByText("4h 00m")).toHaveAttribute("title", "Aug 16, 2026, 12:00 PM EDT");
    expect(screen.getByText(/Automatic recap sending begins in/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pause automatic sending" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send recap now" })).toBeEnabled();
  });

  it("shows paused status and unpause button when automatic sending is paused", () => {
    render(
      <RecapSendControl
        sendAction={vi.fn()}
        togglePauseAction={vi.fn()}
        tripId="trip-123"
        autoSendAt="2026-08-16T16:00:00.000Z"
        paused={true}
        nowMs={new Date("2026-08-16T12:00:00.000Z").getTime()}
        copy={copy}
      />,
    );
    expect(screen.getByText("Automatic recap sending is paused.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unpause automatic sending" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send recap now" })).toBeEnabled();
  });

  it("shows failed status when automatic sending failed", () => {
    render(
      <RecapSendControl
        sendAction={vi.fn()}
        togglePauseAction={vi.fn()}
        tripId="trip-123"
        autoSendAt="2026-08-16T16:00:00.000Z"
        paused={false}
        failed={true}
        nowMs={new Date("2026-08-16T16:00:00.000Z").getTime()}
        copy={copy}
      />,
    );
    expect(screen.getByText("Automatic recap sending failed.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send recap now" })).toBeEnabled();
  });

  it("shows due status when autoSendAt has arrived", () => {
    render(
      <RecapSendControl
        sendAction={vi.fn()}
        togglePauseAction={vi.fn()}
        tripId="trip-123"
        autoSendAt="2026-08-16T16:00:00.000Z"
        paused={false}
        nowMs={new Date("2026-08-16T16:00:00.000Z").getTime()}
        copy={copy}
      />,
    );
    expect(screen.getByText("Recaps will be sent within 1h.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pause automatic sending" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send recap now" })).toBeEnabled();
  });

  it("shows no scheduled return message when autoSendAt is null", () => {
    render(
      <RecapSendControl
        sendAction={vi.fn()}
        togglePauseAction={vi.fn()}
        tripId="trip-123"
        autoSendAt={null}
        paused={false}
        nowMs={new Date("2026-08-16T12:00:00.000Z").getTime()}
        copy={copy}
      />,
    );
    expect(
      screen.getByText("No scheduled return time. Recaps will not be sent automatically."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /pause/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send recap now" })).toBeEnabled();
  });
});
