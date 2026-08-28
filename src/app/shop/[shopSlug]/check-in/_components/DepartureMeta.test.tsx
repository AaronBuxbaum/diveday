// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DepartureMeta } from "./DepartureMeta";

afterEach(() => {
  cleanup();
});

const NOW = new Date("2026-08-27T18:00:00.000Z");

function renderMeta(startsAt: string) {
  return render(
    <DepartureMeta
      startsAt={new Date(startsAt)}
      endsAt={new Date(new Date(startsAt).getTime() + 3 * 60 * 60 * 1000)}
      now={NOW}
      locale="en-US"
      timeZone="America/New_York"
      departedLabel="Departed"
    />,
  );
}

describe("a departure's meta line on the counter", () => {
  /**
   * The rule this line exists for. `selectFocusedDeparture` keeps a sailed boat
   * in focus for up to six hours — deliberately, because a late walk-in inside
   * the standing one-hour buffer is real — which left a live head count and a
   * column of check-in taps for a boat at sea with nothing on screen saying it
   * had gone. At a busy dock the next diver walks up while the previous
   * departure is still the one being tapped.
   */
  it("says a boat has gone once it is past the late-arrival buffer", () => {
    renderMeta("2026-08-27T16:30:00.000Z");
    expect(screen.getByText("Departed")).toBeInTheDocument();
  });

  it("says nothing of the sort inside the buffer — trips run late", () => {
    // Scheduled 55 minutes ago: divers still arrive for it, and the counter has
    // not written it off (AGENTS.md's standing one-hour departure buffer).
    renderMeta("2026-08-27T17:05:00.000Z");
    expect(screen.queryByText("Departed")).not.toBeInTheDocument();
  });

  it("says nothing about a boat that has not left", () => {
    renderMeta("2026-08-27T21:00:00.000Z");
    expect(screen.queryByText("Departed")).not.toBeInTheDocument();
  });

  it("reads the departure in the shop's own zone, never the host's", () => {
    // 16:30 UTC is 12:30 in America/New_York. A host-zone render (every server
    // and CI box is UTC) would print 4:30 PM on the screen a staffer uses to
    // decide which boat they are working.
    const { container } = renderMeta("2026-08-27T16:30:00.000Z");
    expect(container.textContent).toContain("12:30 PM");
  });
});
