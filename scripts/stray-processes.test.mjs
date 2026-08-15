import { describe, expect, it } from "vitest";
import {
  currentSessionPid,
  descendsFrom,
  humanElapsed,
  orphanedDevProcesses,
  parseElapsedSeconds,
  parseProcessTable,
  staleSessionShells,
  summarizeCommand,
} from "./stray-processes.mjs";

/**
 * The reporter behind the `Stop` hook, which exists because a wait-loop ran for
 * nine hours (see the script's own docblock).
 *
 * Two things make these worth more than the usual script tests. The kill
 * boundary is the one place this tool can *cause* harm rather than report it —
 * a sibling session's poll loop looks identical to a wedged one from outside,
 * and reaping one was a real mistake made while writing this. And the Linux
 * half is otherwise unprovable: the hook ships in the project's settings, so it
 * runs on Claude Cloud's runners, and a workstation can only ever exercise BSD
 * `ps`. Both platforms' real output is pinned below as a fixture.
 */

/** macOS BSD `ps -eo pid=,ppid=,etime=,rss=,command=`, copied from a real run. */
const BSD_PS = `    1     0 27-00:56:47  19280 /sbin/launchd
  240     1 10-01:48:48   8064 /usr/libexec/milod
28573     1 16-13:04:49 2033664 next-server (v16.3.0-preview.9)
 7589 18343    09:09:38   4096 /bin/zsh -c source /Users/a/.claude/shell-snapshots/snap.sh && eval 'until grep -q X /tmp/f; do sleep 5; done' < /dev/null`;

/**
 * Linux procps, same flags. Right-aligned to different widths, a `MM:SS` elapsed
 * with no hour field, and a kernel thread whose command is bracketed and whose
 * rss is 0 — none of which a macOS box ever produces.
 */
const LINUX_PS = `      1       0 27-00:56:47   19280 /sbin/init
      2       0 27-00:56:47       0 [kthreadd]
    240       1    01:48:48    8064 /usr/lib/systemd/systemd-journald
   1337       1       48:12  204800 next-server
  40001   39999 02-03:04:05    8192 /bin/bash -c source /home/u/.claude/shell-snapshots/s.sh && eval 'until grep -q X /tmp/f; do sleep 5; done' < /dev/null`;

describe("parseElapsedSeconds", () => {
  it("reads every shape ps prints, on either platform", () => {
    expect(parseElapsedSeconds("48:12")).toBe(48 * 60 + 12);
    expect(parseElapsedSeconds("01:48:48")).toBe(3600 + 48 * 60 + 48);
    expect(parseElapsedSeconds("09:09:38")).toBe(9 * 3600 + 9 * 60 + 38);
    expect(parseElapsedSeconds("16-13:04:49")).toBe(16 * 86400 + 13 * 3600 + 4 * 60 + 49);
  });

  it("returns 0 rather than NaN for anything it cannot read", () => {
    // A NaN here would compare false against every threshold and silently
    // exclude the row — the failure mode being a stray that is never reported.
    expect(parseElapsedSeconds("")).toBe(0);
    expect(parseElapsedSeconds("garbage")).toBe(0);
  });
});

describe("parseProcessTable", () => {
  it("reads macOS BSD ps output", () => {
    const rows = parseProcessTable(BSD_PS);
    expect(rows).toHaveLength(4);
    expect(rows[2]).toMatchObject({ pid: 28573, ppid: 1, rssMb: 1986 });
    expect(rows[3].pid).toBe(7589);
    expect(rows[3].elapsedSeconds).toBe(9 * 3600 + 9 * 60 + 38);
  });

  it("reads Linux procps output, including a bracketed kernel thread", () => {
    const rows = parseProcessTable(LINUX_PS);
    expect(rows).toHaveLength(5);
    expect(rows[1]).toMatchObject({ pid: 2, ppid: 0, rssMb: 0, command: "[kthreadd]" });
    // `MM:SS` with no hour field is a Linux-only shape here.
    expect(rows[2].elapsedSeconds).toBe(3600 + 48 * 60 + 48);
    expect(rows[3].elapsedSeconds).toBe(48 * 60 + 12);
    expect(rows[4].command).toContain("shell-snapshots");
  });

  it("keeps the whole command, spaces and all", () => {
    const [row] = parseProcessTable("  42   1 01:00 1024 /usr/bin/node --flag a b c");
    expect(row.command).toBe("/usr/bin/node --flag a b c");
  });

  it("ignores header lines and blanks rather than inventing rows", () => {
    expect(parseProcessTable("\n  PID  PPID ELAPSED   RSS COMMAND\n\n")).toEqual([]);
  });
});

describe("humanElapsed", () => {
  it("scales the unit to the age, so nine hours cannot read as nine minutes", () => {
    expect(humanElapsed(90)).toBe("1m");
    expect(humanElapsed(9 * 3600 + 9 * 60)).toBe("9h09m");
    expect(humanElapsed(16 * 86400 + 13 * 3600)).toBe("16d13h");
  });
});

describe("summarizeCommand", () => {
  it("lifts out the eval a session shell was actually given", () => {
    const [, , , shell] = parseProcessTable(BSD_PS);
    // The wrapper is ~600 characters of snapshot sourcing and exports; the
    // actionable part is the loop, and burying it makes the report unreadable.
    expect(summarizeCommand(shell.command)).toBe("until grep -q X /tmp/f; do sleep 5; done");
  });

  it("falls back to the raw command when there is no eval, and bounds it", () => {
    expect(summarizeCommand("next-server (v16)")).toBe("next-server (v16)");
    expect(summarizeCommand(`node ${"x".repeat(400)}`)).toHaveLength(160);
  });
});

describe("who owns a shell", () => {
  const rows = [
    { pid: 100, ppid: 1, elapsedSeconds: 0, rssMb: 0, command: "claude --session-id abc" },
    { pid: 101, ppid: 100, elapsedSeconds: 0, rssMb: 0, command: "/bin/zsh -c x" },
    { pid: 102, ppid: 101, elapsedSeconds: 0, rssMb: 0, command: "node y" },
    { pid: 200, ppid: 1, elapsedSeconds: 0, rssMb: 0, command: "claude --session-id zzz" },
    { pid: 201, ppid: 200, elapsedSeconds: 0, rssMb: 0, command: "/bin/zsh -c other" },
  ];

  it("finds this session by walking up to the process holding --session-id", () => {
    expect(currentSessionPid(rows, [102, 101, 100, 1])).toBe(100);
  });

  it("answers 0 when there is no session ancestor, rather than guessing one", () => {
    expect(currentSessionPid(rows, [999])).toBe(0);
  });

  it("traces a grandchild back to its session but not to a sibling's", () => {
    const byPid = new Map(rows.map((row) => [row.pid, row]));
    expect(descendsFrom(rows[2], 100, byPid)).toBe(true);
    expect(descendsFrom(rows[4], 100, byPid)).toBe(false);
    expect(descendsFrom(rows[2], 0, byPid)).toBe(false);
  });
});

describe("staleSessionShells", () => {
  const snapshot =
    "/bin/zsh -c source ~/.claude/shell-snapshots/s.sh && eval 'sleep 1' < /dev/null";
  const rows = [
    { pid: 10, ppid: 1, elapsedSeconds: 0, rssMb: 0, command: "claude --session-id abc" },
    { pid: 11, ppid: 10, elapsedSeconds: 3600, rssMb: 0, command: snapshot },
    { pid: 12, ppid: 1, elapsedSeconds: 3600, rssMb: 0, command: snapshot },
    { pid: 13, ppid: 99, elapsedSeconds: 3600, rssMb: 0, command: snapshot },
    { pid: 14, ppid: 10, elapsedSeconds: 30, rssMb: 0, command: snapshot },
    { pid: 15, ppid: 10, elapsedSeconds: 3600, rssMb: 0, command: "/bin/zsh -c ordinary terminal" },
  ];
  const found = () => staleSessionShells(rows, [], 10);

  it("reports only session-spawned shells past the threshold", () => {
    // 14 is too young; 15 is the user's own terminal, which this must never
    // claim. Both absences matter more than the presences.
    expect(
      found()
        .map((row) => row.pid)
        .sort(),
    ).toEqual([11, 12, 13]);
  });

  it("excludes its own process chain, so the check never reports itself", () => {
    expect(staleSessionShells(rows, [11], 10).map((row) => row.pid)).not.toContain(11);
  });

  it("marks a shell descending from this session as mine", () => {
    expect(found().find((row) => row.pid === 11)).toMatchObject({ mine: true, orphaned: false });
  });

  /*
   * The kill boundary, and the reason this file exists. A sibling session's
   * poll loop against a pull request it is waiting on is indistinguishable from
   * a wedged one out here, and reaping one during development is how this
   * distinction got written. `mine: false` is what spares it.
   */
  it("never claims a shell belonging to another live session", () => {
    expect(found().find((row) => row.pid === 13)).toMatchObject({ mine: false, orphaned: false });
  });

  /*
   * `ppid === 1` is its own answer: the shell outlived whoever started it, so
   * no live session owns it and reaping it interrupts nobody. Without this an
   * orphaned wait-loop -- the worst kind, and what a detached `nohup ... &`
   * leaves -- reads as a sibling's live work and is spared forever.
   */
  it("treats an orphaned shell as reapable rather than as somebody else's", () => {
    expect(found().find((row) => row.pid === 12)).toMatchObject({ mine: true, orphaned: true });
  });

  it("sorts oldest first, so the worst offender leads the report", () => {
    expect(found()[0].elapsedSeconds).toBe(3600);
  });
});

describe("orphanedDevProcesses", () => {
  const rows = [
    { pid: 1, ppid: 0, elapsedSeconds: 10, rssMb: 1, command: "/sbin/init" },
    { pid: 20, ppid: 1, elapsedSeconds: 1_400_000, rssMb: 1986, command: "next-server (v16)" },
    { pid: 21, ppid: 1, elapsedSeconds: 100, rssMb: 10, command: "node vitest --run" },
    { pid: 22, ppid: 500, elapsedSeconds: 999_999, rssMb: 99, command: "next-server (v16)" },
    { pid: 23, ppid: 1, elapsedSeconds: 50, rssMb: 5, command: "/usr/bin/ssh-agent" },
  ];

  it("reports dev processes whose parent is gone, and nothing else", () => {
    // 22 still has a parent, so somebody owns it; 23 is not a dev process.
    // Reporting either would train a reader to skim the list.
    expect(orphanedDevProcesses(rows, []).map((row) => row.pid)).toEqual([20, 21]);
  });

  it("labels what it found and carries the memory it is holding", () => {
    const [worst] = orphanedDevProcesses(rows, []);
    expect(worst).toMatchObject({ pid: 20, label: "next-server", rssMb: 1986 });
  });
});

describe("the nine-hour regression", () => {
  /*
   * End to end over the real macOS fixture: the exact shape that ran for nine
   * hours -- a `sleep`-driven `until` loop waiting on a marker its producer
   * could no longer write -- must appear in the report with its age and its
   * loop legible. It failed silently before because nothing looked at the
   * process table at all; `TaskList` said "No tasks found" throughout.
   */
  it("finds the wait-loop that started all this", () => {
    const rows = parseProcessTable(BSD_PS);
    const [stray] = staleSessionShells(rows, [], 18343);
    expect(stray.pid).toBe(7589);
    expect(humanElapsed(stray.elapsedSeconds)).toBe("9h09m");
    expect(summarizeCommand(stray.command)).toContain("do sleep 5; done");
  });

  it("finds the sixteen-day next-server orphans beside it", () => {
    const [orphan] = orphanedDevProcesses(parseProcessTable(BSD_PS), []);
    expect(orphan).toMatchObject({ pid: 28573, label: "next-server" });
    expect(humanElapsed(orphan.elapsedSeconds)).toBe("16d13h");
  });

  it("does the same against Linux output, which is where the hook also runs", () => {
    const rows = parseProcessTable(LINUX_PS);
    const [stray] = staleSessionShells(rows, [], 39999);
    expect(stray).toMatchObject({ pid: 40001, mine: true });
    expect(summarizeCommand(stray.command)).toBe("until grep -q X /tmp/f; do sleep 5; done");
    expect(orphanedDevProcesses(rows, []).map((row) => row.label)).toEqual(["next-server"]);
  });
});
