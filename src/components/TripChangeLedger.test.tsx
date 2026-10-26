// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { TripChangeEvent } from "@/db/trip-change-events";
import { TripChangeLedger } from "./TripChangeLedger";

/**
 * **What changed** (visual review 2026-10-24, B21): only the facts that moved,
 * each "{fact}: {new value}" once, with one muted "Changed by the shop|crew on
 * {date, zone}" line: no source chip, but the source word stays (ADR
 * 20260904-reef-all-the-way-down, Budget rule 5). No sentence about the card,
 * and nothing at all when nothing changed.
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
    const when = screen.getByText(/^Changed by the shop on /);
    expect(when).toHaveClass("text-muted");
    // The shop's zone, never the host's, and named.
    expect(when.textContent).toContain("7:40");
    expect(when.textContent).not.toContain("11:40");
    expect(when.textContent).toMatch(/EDT/);
  });

  it("drops the self-description and the source chip, never the source word", () => {
    render(
      <TripChangeLedger events={[event({ source: "crew" })]} locale="en-US" timeZone={timeZone} />,
    );
    expect(screen.queryByText(/Material updates/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Crew · /)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Plan · /)).not.toBeInTheDocument();
    expect(screen.getByText(/^Changed by the crew on /)).toBeInTheDocument();
  });

  it("tells a crew report from a later shop edit of the same fact", () => {
    render(
      <TripChangeLedger
        events={[
          event({ id: "crew", source: "crew" }),
          event({
            id: "shop",
            source: "shop",
            beforeValue: { conditionsSummary: "Light chop, 2 ft" },
            afterValue: { conditionsSummary: "Flat" },
            occurredAt: new Date("2026-09-04T17:00:00Z"),
          }),
        ]}
        locale="es-ES"
        timeZone={timeZone}
      />,
    );
    expect(screen.getByText(/^Cambiado por el centro el /)).toBeInTheDocument();
    expect(screen.queryByText(/^Cambiado por la tripulación/)).not.toBeInTheDocument();
  });

  it("never claims a change was observed", () => {
    // Budget rule 5's floor: only Observed may print as what happened, and an
    // edit is not that, whichever source made it.
    render(
      <TripChangeLedger
        events={[
          event({ source: "crew" }),
          event({
            id: "event-2",
            kind: "meeting_point",
            source: "shop",
            afterValue: { meetingPointLabel: "Slip 4" },
          }),
        ]}
        locale="en-US"
        timeZone={timeZone}
      />,
    );
    expect(screen.queryByText(/Observed/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Forecast/)).not.toBeInTheDocument();
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

  describe("a site change (issue #3060)", () => {
    const sites = (overrides: Partial<TripChangeEvent> = {}) =>
      event({
        id: "sites",
        kind: "site_change",
        beforeValue: { siteNames: "Molasses Reef\nFrench Reef" },
        afterValue: { siteNames: "Pickles Reef" },
        ...overrides,
      });

    it("names the new sites, who changed them and when, in English and Spanish", () => {
      render(<TripChangeLedger events={[sites()]} locale="en-US" timeZone={timeZone} />);
      expect(screen.getByText("Sites: Pickles Reef")).toBeInTheDocument();
      expect(screen.getByText(/^Changed by the shop on .*7:40/)).toBeInTheDocument();
      cleanup();
      render(<TripChangeLedger events={[sites()]} locale="es-ES" timeZone={timeZone} />);
      expect(screen.getByText("Sitios: Pickles Reef")).toBeInTheDocument();
      expect(screen.getByText(/^Cambiado por el centro el /)).toBeInTheDocument();
    });

    it("lists a run of sites in order, as the Planned sites row words it, also on a public page", () => {
      render(
        <TripChangeLedger
          events={[sites({ afterValue: { siteNames: "Pickles Reef\nMolasses Reef" } })]}
          locale="en-US"
          timeZone={timeZone}
          revealArrivalDetails={false}
        />,
      );
      expect(screen.getByText("Sites: Pickles Reef, Molasses Reef")).toBeInTheDocument();
    });

    it("says a second dive at the same site, as the row does (review of PR 3061)", () => {
      render(
        <TripChangeLedger
          events={[
            sites({
              beforeValue: { siteNames: "Spiegel Grove\nMolasses Reef\nSpiegel Grove" },
              afterValue: { siteNames: "Spiegel Grove\nSpiegel Grove\nMolasses Reef" },
            }),
          ]}
          locale="en-US"
          timeZone={timeZone}
        />,
      );
      expect(
        screen.getByText("Sites: Spiegel Grove (two dives), Molasses Reef"),
      ).toBeInTheDocument();
    });

    it("says a cleared run, and nothing for a run that reads the same", () => {
      render(
        <TripChangeLedger
          events={[sites({ afterValue: { siteNames: null } })]}
          locale="en-US"
          timeZone={timeZone}
        />,
      );
      expect(screen.getByText("Sites: none planned yet")).toBeInTheDocument();
      cleanup();
      const { container } = render(
        <TripChangeLedger
          events={[sites({ afterValue: { siteNames: "Molasses Reef\nFrench Reef" } })]}
          locale="en-US"
          timeZone={timeZone}
        />,
      );
      expect(container).toBeEmptyDOMElement();
    });
  });
});
