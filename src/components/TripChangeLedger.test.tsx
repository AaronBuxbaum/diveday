// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { TripChangeEvent } from "@/db/trip-change-events";
import { TripChangeLedger } from "./TripChangeLedger";

/**
 * **What changed** (visual review 2026-10-24, B21): only the facts that moved,
 * each "{fact}: {new value}" once, with one muted "Changed {date, zone}" line.
 * No sentence about the card, no source chip, and nothing at all when nothing
 * changed.
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

const moved = (overrides: Partial<TripChangeEvent> = {}) =>
  event({
    id: "move",
    kind: "meeting_point",
    beforeValue: { meetingPointLabel: "Slip 2" },
    afterValue: { meetingPointLabel: "Slip 4, the east dock" },
    ...overrides,
  });

describe("TripChangeLedger", () => {
  it("states each changed fact with its new value, and when, in the shop's zone", () => {
    render(<TripChangeLedger events={[event()]} locale="en-US" timeZone={timeZone} />);
    expect(screen.getByText("Conditions: Light chop, 2 ft")).toBeInTheDocument();
    const when = screen.getByText(/^Changed /);
    expect(when).toHaveClass("text-muted");
    // The shop's zone, never the host's, and named.
    expect(when.textContent).toContain("7:40");
    expect(when.textContent).not.toContain("11:40");
    expect(when.textContent).toMatch(/EDT/);
  });

  it("drops the self-description and the source chip", () => {
    render(
      <TripChangeLedger events={[event({ source: "crew" })]} locale="en-US" timeZone={timeZone} />,
    );
    expect(screen.queryByText(/Material updates/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Crew · /)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Plan · /)).not.toBeInTheDocument();
  });

  it("names the meeting point's new value on the diver's own thread", () => {
    render(<TripChangeLedger events={[moved()]} locale="en-US" timeZone={timeZone} />);
    expect(screen.getByText("Meeting point: Slip 4, the east dock")).toBeInTheDocument();
  });

  it("keeps the exact place off a public page", () => {
    render(
      <TripChangeLedger
        events={[moved()]}
        locale="en-US"
        timeZone={timeZone}
        revealArrivalDetails={false}
      />,
    );
    expect(screen.getByText("Meeting point updated")).toBeInTheDocument();
    expect(screen.queryByText(/Slip 4/)).not.toBeInTheDocument();
  });

  it("does not restate a part that did not move", () => {
    render(
      <TripChangeLedger
        events={[
          moved({
            beforeValue: { meetingPointLabel: "Slip 4, the east dock", arrivalLookFor: "a flag" },
            afterValue: { meetingPointLabel: "Slip 4, the east dock", arrivalLookFor: "a sign" },
          }),
        ]}
        locale="en-US"
        timeZone={timeZone}
      />,
    );
    expect(screen.getByText("Arrival guidance updated")).toBeInTheDocument();
    expect(screen.queryByText(/Meeting point/)).not.toBeInTheDocument();
  });

  it("shows each fact once, at its newest value", () => {
    render(
      <TripChangeLedger
        events={[
          event({ id: "a", afterValue: { conditionsSummary: "Flat" } }),
          event({
            id: "b",
            beforeValue: { conditionsSummary: "Flat" },
            afterValue: { conditionsSummary: "Light chop, 2 ft" },
            occurredAt: new Date("2026-09-04T13:00:00Z"),
          }),
        ]}
        locale="en-US"
        timeZone={timeZone}
      />,
    );
    expect(screen.getAllByText(/^Conditions: /)).toHaveLength(1);
    expect(screen.getByText("Conditions: Light chop, 2 ft")).toBeInTheDocument();
  });

  it("keeps an earlier move of the meeting point when a later event changed only the photo", () => {
    render(
      <TripChangeLedger
        events={[
          moved(),
          moved({
            id: "photo",
            beforeValue: { meetingPointLabel: "Slip 4, the east dock" },
            afterValue: {
              meetingPointLabel: "Slip 4, the east dock",
              arrivalPhotoUrl: "https://media.dive.day/east-dock.jpg",
            },
            occurredAt: new Date("2026-09-04T13:00:00Z"),
          }),
        ]}
        locale="en-US"
        timeZone={timeZone}
      />,
    );
    expect(screen.getByText(/Slip 4, the east dock/)).toBeInTheDocument();
    expect(screen.getByText("Arrival photo updated")).toBeInTheDocument();
  });

  it("says a cleared conditions note is gone", () => {
    render(
      <TripChangeLedger
        events={[
          event({
            beforeValue: { conditionsSummary: "Strong current" },
            afterValue: { conditionsSummary: "" },
          }),
        ]}
        locale="en-US"
        timeZone={timeZone}
      />,
    );
    expect(screen.getByText("Conditions: no note from the crew")).toBeInTheDocument();
  });

  it("renders nothing when nothing has changed", () => {
    const { container } = render(
      <TripChangeLedger events={[]} locale="en-US" timeZone={timeZone} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when every event left its facts where they were", () => {
    const { container } = render(
      <TripChangeLedger
        events={[
          event({
            beforeValue: { conditionsSummary: "Flat" },
            afterValue: { conditionsSummary: "Flat" },
          }),
        ]}
        locale="en-US"
        timeZone={timeZone}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
