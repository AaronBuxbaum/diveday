// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { RollCallEvidencePanel } from "./RollCallEvidencePanel";

it("labels the shop's zone while retaining each original statement's attribution and raw instant", () => {
  const { container } = render(
    <RollCallEvidencePanel
      checkpoint="departure"
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

it.each([
  ["departure", "boarded", "not_boarded"],
  ["after_dive_1", "not_boarded", "boarded"],
] as const)(
  "keeps the at-risk statement first at %s regardless of input order",
  (checkpoint, risk, other) => {
    const labels = { boarded: "Aboard", not_boarded: "Not aboard", cleared: "Taken back" };
    const evidence = [
      {
        id: "a",
        status: other,
        recordedByName: "Other",
        occurredAt: "2026-07-20T14:00:00.000Z",
        meetingDay: 0,
        note: null,
      },
      {
        id: "z",
        status: risk,
        recordedByName: "At risk",
        occurredAt: "2026-07-20T14:00:00.000Z",
        meetingDay: 0,
        note: "Check now",
      },
      {
        id: "m",
        status: "cleared" as const,
        recordedByName: "Withdrawal",
        occurredAt: "2026-07-20T14:00:00.000Z",
        meetingDay: -1,
        note: null,
      },
    ];
    const original = structuredClone(evidence);
    const panel = (items: typeof evidence) => (
      <RollCallEvidencePanel
        checkpoint={checkpoint}
        locale="en-US"
        timeZone="America/New_York"
        copy={{
          heading: "Check",
          unknownDay: "Unknown day",
          unknownOrder: "Unknown order",
          statuses: labels,
        }}
        context={{
          conflict: true,
          orderingUnknown: true,
          unknownMeetingDay: true,
          meetingDay: 0,
          observedEvidenceIds: ["a", "m", "z"],
          evidence: items,
        }}
      >
        <button type="button">Resolve</button>
      </RollCallEvidencePanel>
    );
    const { rerender, container } = render(panel(evidence));
    const rows = () => [...container.querySelectorAll("li")].map((row) => row.textContent);
    expect(rows()).toHaveLength(3);
    expect(rows()[0]).toContain(labels[risk]);
    expect(rows()[0]).toContain("At risk");
    expect(rows()[0]).toContain("Check now");
    expect(rows()[1]).toContain("Taken back");
    expect(rows()[1]).toContain("Withdrawal");
    expect(rows()[2]).toContain(labels[other]);
    expect(container.textContent).toContain("Unknown order");
    expect(container.textContent).toContain("Unknown day");
    const first = rows();
    rerender(panel([...evidence].reverse()));
    expect(rows()).toEqual(first);
    expect(evidence).toEqual(original);
  },
);
