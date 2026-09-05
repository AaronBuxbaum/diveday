// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { TripChangeEvent } from "@/db/trip-change-events";
import { TripChangeLedger } from "./TripChangeLedger";

/**
 * **What changed, and who said so** — the ledger's provenance line, now the
 * app's one chip (ADR 20260904-reef-all-the-way-down, decision 2, Budget rule
 * 5) rather than two hand-written sentences.
 *
 * `trip_change_event_source` has always carried the distinction. What the chip
 * adds is that a diver reading it on their thread and a visitor reading it on
 * the public trip page see the same grammar as every other mutable fact.
 */
afterEach(cleanup);

const timeZone = "America/New_York";

function event(overrides: Partial<TripChangeEvent> = {}): TripChangeEvent {
  return {
    id: "event-1",
    tripId: "trip-1",
    kind: "conditions",
    source: "shop",
    beforeValue: null,
    afterValue: { conditionsSummary: "Light chop, 2 ft" },
    // 07:40 New York time, so a zone slip would read 11:40 rather than fail.
    occurredAt: new Date("2026-09-04T11:40:00Z"),
    seq: 1,
    ...overrides,
  };
}

describe("TripChangeLedger", () => {
  it("marks a crew change as Crew, with the time in the shop's own zone", () => {
    render(
      <TripChangeLedger events={[event({ source: "crew" })]} locale="en-US" timeZone={timeZone} />,
    );
    const chip = screen.getByText(/^Crew · /);
    expect(chip).toBeInTheDocument();
    // The shop's zone, never the host's — a UTC server would read 11:40.
    expect(chip.textContent).toContain("7:40");
    expect(chip.textContent).not.toContain("11:40");
  });

  it("marks a shop edit as the Plan", () => {
    render(
      <TripChangeLedger events={[event({ source: "shop" })]} locale="en-US" timeZone={timeZone} />,
    );
    expect(screen.getByText(/^Plan · /)).toBeInTheDocument();
    expect(screen.queryByText(/^Crew · /)).not.toBeInTheDocument();
  });

  it("never claims a change was observed", () => {
    // Budget rule 5's floor: only Observed may print as what happened, and an
    // *edit* is not that. Neither source may reach it.
    render(
      <TripChangeLedger
        events={[event({ source: "crew" }), event({ id: "event-2", source: "shop" })]}
        locale="en-US"
        timeZone={timeZone}
      />,
    );
    expect(screen.queryByText(/Observed/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Forecast/)).not.toBeInTheDocument();
  });

  it("renders nothing when nothing has changed", () => {
    const { container } = render(
      <TripChangeLedger events={[]} locale="en-US" timeZone={timeZone} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
