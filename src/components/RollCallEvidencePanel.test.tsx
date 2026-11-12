// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { RollCallEvidencePanel } from "./RollCallEvidencePanel";

it("labels the shop's zone while retaining each original statement's attribution and raw instant", () => {
  const { container } = render(
    <RollCallEvidencePanel
      locale="en-US"
      timeZone="America/New_York"
      copy={{
        heading: "Check these marks",
        unknownDay: "Unknown day",
        unknownOrder: "Unknown order",
        statuses: { boarded: "Aboard", not_boarded: "Not back aboard", cleared: "Taken back" },
      }}
      context={{
        conflict: true,
        orderingUnknown: false,
        unknownMeetingDay: false,
        meetingDay: 0,
        observedEvidenceIds: ["a", "m"],
        evidence: [
          {
            id: "a",
            status: "boarded",
            recordedByName: "Aboard reporter",
            occurredAt: "2026-07-20T14:00:00.000Z",
            meetingDay: 0,
            note: null,
          },
          {
            id: "m",
            status: "not_boarded",
            recordedByName: "Missing reporter",
            occurredAt: "2026-07-20T14:05:00.000Z",
            meetingDay: 0,
            note: null,
          },
        ],
      }}
    >
      <button type="button">Confirm aboard</button>
    </RollCallEvidencePanel>,
  );
  const times = [...container.querySelectorAll("time")];
  expect(times.map((time) => time.getAttribute("datetime"))).toEqual([
    "2026-07-20T14:00:00.000Z",
    "2026-07-20T14:05:00.000Z",
  ]);
  expect(times[0].textContent).toContain("10:00 AM EDT");
  expect(times[1].textContent).toContain("10:05 AM EDT");
  expect(screen.getByText(/Aboard reporter/).closest("li")).toHaveTextContent("Aboard");
  expect(screen.getByText(/Missing reporter/).closest("li")).toHaveTextContent("Not back aboard");
});
