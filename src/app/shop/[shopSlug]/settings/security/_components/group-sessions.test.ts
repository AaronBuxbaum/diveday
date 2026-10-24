import { describe, expect, it } from "vitest";
import { groupSessions } from "./group-sessions";

const at = (iso: string) => new Date(iso);

function session(id: string, deviceLabel: string, lastSeen: string, isCurrent = false) {
  return { id, deviceLabel, isCurrent, lastSeenAt: at(lastSeen) };
}

describe("groupSessions", () => {
  it("collapses sessions with the same browser and platform into one group", () => {
    const groups = groupSessions([
      session("a", "Chrome · Linux", "2026-10-20T10:00:00Z"),
      session("b", "Chrome · Linux", "2026-10-22T10:00:00Z"),
      session("c", "Safari · iOS", "2026-10-21T10:00:00Z"),
    ]);
    expect(groups.map((group) => [group.deviceLabel, group.sessions.length])).toEqual([
      ["Chrome · Linux", 2],
      ["Safari · iOS", 1],
    ]);
  });

  it("orders groups and the sessions inside them by the latest seen, newest first", () => {
    const groups = groupSessions([
      session("old", "Firefox · Windows", "2026-10-01T10:00:00Z"),
      session("mid", "Chrome · Linux", "2026-10-10T10:00:00Z"),
      session("new", "Chrome · Linux", "2026-10-23T10:00:00Z"),
      session("phone", "Safari · iOS", "2026-10-15T10:00:00Z"),
    ]);
    expect(groups.map((group) => group.deviceLabel)).toEqual([
      "Chrome · Linux",
      "Safari · iOS",
      "Firefox · Windows",
    ]);
    expect(groups[0].sessions.map((row) => row.id)).toEqual(["new", "mid"]);
    expect(groups[0].lastSeenAt).toEqual(at("2026-10-23T10:00:00Z"));
  });

  it("puts the current session's group first, however long ago its other sessions were seen", () => {
    const groups = groupSessions([
      session("recent", "Chrome · Linux", "2026-10-23T10:00:00Z"),
      session("this", "Safari · macOS", "2026-09-01T10:00:00Z", true),
    ]);
    expect(groups[0].deviceLabel).toBe("Safari · macOS");
    expect(groups[0].isCurrent).toBe(true);
    expect(groups[1].isCurrent).toBe(false);
  });

  it("keeps every session, so each still has its own Revoke", () => {
    const rows = Array.from({ length: 12 }, (_, index) =>
      session(
        `s${index}`,
        index % 3 === 0 ? "Edge · Windows" : "Chrome · Linux",
        `2026-10-${10 + index}T10:00:00Z`,
      ),
    );
    const ids = groupSessions(rows).flatMap((group) => group.sessions.map((row) => row.id));
    expect(ids.sort()).toEqual(rows.map((row) => row.id).sort());
  });
});
