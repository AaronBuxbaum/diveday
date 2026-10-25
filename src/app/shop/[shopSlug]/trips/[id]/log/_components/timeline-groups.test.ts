import { describe, expect, it } from "vitest";
import type { IncidentTimelineEntry } from "@/lib/incident-export";
import { entriesOf, groupTimeline } from "./timeline-groups";

// Minute precision, as the page prints a stamp.
const stamp = (iso: string) => iso.slice(0, 16);

function mark(
  subjectName: string,
  occurredAt: string,
  overrides: Partial<Extract<IncidentTimelineEntry, { kind: "diver" | "crew" }>> = {},
): IncidentTimelineEntry {
  return {
    kind: "diver",
    occurredAt,
    checkpoint: "departure",
    subjectName,
    action: "boarded",
    source: "live",
    recordedByName: "Sal Moretti",
    ...overrides,
  };
}

describe("groupTimeline", () => {
  it("puts one heading over a checkpoint's run and one line per person", () => {
    const entries = [
      mark("Sana Malik", "2026-10-24T09:30:05Z"),
      mark("Tom Okafor", "2026-10-24T09:30:40Z"),
    ];
    const groups = groupTimeline(entries, stamp);
    expect(groups).toHaveLength(1);
    const [group] = groups;
    if (group.kind !== "checkpoint") throw new Error("expected a checkpoint group");
    expect(group).toMatchObject({
      checkpoint: "departure",
      stamp: "2026-10-24T09:30",
      recordedByName: "Sal Moretti",
    });
    expect(group.lines.map((line) => [line.ownStamp, line.ownRecorder])).toEqual([
      [null, null],
      [null, null],
    ]);
  });

  it("keeps a different recorder on the line it belongs to (mixed recorders)", () => {
    const groups = groupTimeline(
      [
        mark("Sana Malik", "2026-10-24T09:30:00Z", { recordedByName: "Ana Ruiz" }),
        mark("Tom Okafor", "2026-10-24T09:30:00Z"),
        mark("June Park", "2026-10-24T09:30:00Z"),
      ],
      stamp,
    );
    const [group] = groups;
    if (group.kind !== "checkpoint") throw new Error("expected a checkpoint group");
    // The heading names who made most of the marks; the odd one names its own.
    expect(group.recordedByName).toBe("Sal Moretti");
    expect(group.lines.map((line) => line.ownRecorder)).toEqual(["Ana Ruiz", null, null]);
  });

  it("keeps a different minute on its own line (mixed times)", () => {
    const groups = groupTimeline(
      [mark("Sana Malik", "2026-10-24T09:30:00Z"), mark("Tom Okafor", "2026-10-24T09:42:00Z")],
      stamp,
    );
    const [group] = groups;
    if (group.kind !== "checkpoint") throw new Error("expected a checkpoint group");
    expect(group.stamp).toBe("2026-10-24T09:30");
    expect(group.lines.map((line) => line.ownStamp)).toEqual([null, "2026-10-24T09:42"]);
  });

  it("renders an undo and the re-mark after it as their own lines, in order", () => {
    const entries = [
      mark("Sana Malik", "2026-10-24T09:30:00Z"),
      mark("Sana Malik", "2026-10-24T09:31:00Z", { action: "cleared" }),
      mark("Sana Malik", "2026-10-24T09:32:00Z", { action: "not_boarded" }),
    ];
    const groups = groupTimeline(entries, stamp);
    expect(groups).toHaveLength(1);
    const [group] = groups;
    if (group.kind !== "checkpoint") throw new Error("expected a checkpoint group");
    expect(group.lines.map((line) => line.entry.action)).toEqual([
      "boarded",
      "cleared",
      "not_boarded",
    ]);
    expect(entriesOf(groups)).toEqual(entries);
  });

  it("gives a person marked at two checkpoints a line under each", () => {
    const entries = [
      mark("Sana Malik", "2026-10-24T09:30:00Z"),
      mark("Sana Malik", "2026-10-24T11:10:00Z", { checkpoint: "after_dive_1" }),
      mark("Sana Malik", "2026-10-24T12:40:00Z", {
        checkpoint: "after_dive_2",
        action: "not_boarded",
        note: "Surfaced 200 m north",
      }),
    ];
    const groups = groupTimeline(entries, stamp);
    expect(groups.map((group) => (group.kind === "checkpoint" ? group.checkpoint : null))).toEqual([
      "departure",
      "after_dive_1",
      "after_dive_2",
    ]);
    // A missing mark keeps its note: grouping carries the entry whole.
    expect(entriesOf(groups)).toEqual(entries);
  });

  it("starts a new group, in place, for a late mark at an earlier checkpoint", () => {
    const entries = [
      mark("Sana Malik", "2026-10-24T09:30:00Z"),
      mark("Tom Okafor", "2026-10-24T11:10:00Z", { checkpoint: "after_dive_1" }),
      mark("June Park", "2026-10-24T11:15:00Z", { recordedByName: "Ana Ruiz" }),
    ];
    const groups = groupTimeline(entries, stamp);
    expect(groups).toHaveLength(3);
    expect(entriesOf(groups)).toEqual(entries);
  });

  it("invents nothing for a checkpoint with no marks (empty checkpoint)", () => {
    const groups = groupTimeline([mark("Sana Malik", "2026-10-24T09:30:00Z")], stamp);
    expect(
      groups.some((group) => group.kind === "checkpoint" && group.checkpoint === "after_dive_1"),
    ).toBe(false);
    expect(groupTimeline([], stamp)).toEqual([]);
  });

  it("leaves a buddy or seat entry standing alone between runs, where it fell", () => {
    const buddy: IncidentTimelineEntry = {
      kind: "buddy_team",
      occurredAt: "2026-10-24T09:31:00Z",
      checkpoint: null,
      action: "formed",
      teamNumber: 1,
      memberNames: ["Sana Malik", "Tom Okafor"],
      recordedByName: "Sal Moretti",
    };
    const entries = [
      mark("Sana Malik", "2026-10-24T09:30:00Z"),
      buddy,
      mark("Tom Okafor", "2026-10-24T09:32:00Z"),
    ];
    const groups = groupTimeline(entries, stamp);
    expect(groups.map((group) => group.kind)).toEqual(["checkpoint", "single", "checkpoint"]);
    expect(entriesOf(groups)).toEqual(entries);
  });

  it("keeps a crew mark with no name and an offline mark whole", () => {
    const entries = [
      mark("", "2026-10-24T09:30:00Z", { kind: "crew" }),
      mark("Tom Okafor", "2026-10-24T09:30:00Z", { source: "offline" }),
    ];
    expect(entriesOf(groupTimeline(entries, stamp))).toEqual(entries);
  });
});
