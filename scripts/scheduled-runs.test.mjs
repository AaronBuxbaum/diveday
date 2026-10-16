import { describe, expect, it } from "vitest";

import {
  fetchScheduledRuns,
  readScheduledRuns,
  redScheduledText,
  redScheduledWorkflows,
  SCHEDULED_RUNS_TTL_MS,
  slimRuns,
} from "./scheduled-runs.mjs";

const SIM = { name: "Simulate a day", path: ".github/workflows/simulate-day.yml" };
const CI = { name: "CI", path: ".github/workflows/ci.yml" };

function run(workflow, day, conclusion) {
  return {
    ...workflow,
    status: "completed",
    conclusion,
    created_at: `2026-10-${String(day).padStart(2, "0")}T06:30:00Z`,
    html_url: `https://github.com/o/r/actions/runs/${day}`,
  };
}

describe("redScheduledWorkflows", () => {
  it("names a workflow whose last two scheduled runs failed, with its streak and first red day", () => {
    const runs = slimRuns([
      run(SIM, 13, "failure"),
      run(SIM, 12, "failure"),
      run(SIM, 11, "timed_out"),
      run(SIM, 10, "success"),
      run(SIM, 9, "failure"),
      run(CI, 13, "success"),
      run(CI, 12, "failure"),
    ]);
    expect(redScheduledWorkflows(runs)).toEqual([
      { ...SIM, streak: 3, since: "2026-10-11", url: "https://github.com/o/r/actions/runs/13" },
    ]);
  });

  it("leaves alone one red night, a green newest run, and cancelled or running ones", () => {
    const runs = slimRuns([
      run(SIM, 13, "failure"),
      run(SIM, 12, "success"),
      run(CI, 13, "success"),
      run(CI, 12, "failure"),
      run(CI, 11, "failure"),
      { ...run(SIM, 14, null), status: "in_progress" },
    ]);
    expect(redScheduledWorkflows(runs)).toEqual([]);
    const cancelled = slimRuns([
      run(SIM, 13, "failure"),
      run(SIM, 12, "cancelled"),
      run(SIM, 11, "success"),
    ]);
    expect(redScheduledWorkflows(cancelled)).toEqual([]);
  });

  it("reads runs in any order, and null as unknown", () => {
    const runs = slimRuns([run(SIM, 11, "failure"), run(SIM, 13, "failure")]);
    expect(redScheduledWorkflows(runs.reverse())).toHaveLength(1);
    expect(redScheduledWorkflows(null)).toBeNull();
  });
});

describe("redScheduledText", () => {
  it("is one clause per red workflow, or nothing", () => {
    expect(redScheduledText([{ ...SIM, streak: 26, since: "2026-09-18" }])).toBe(
      "scheduled Simulate a day red 26 runs running (since 2026-09-18)",
    );
    expect(redScheduledText([])).toBe("");
    expect(redScheduledText(null)).toBe("");
  });
});

describe("fetchScheduledRuns", () => {
  it("asks for main's scheduled runs, bounded, and slims them", () => {
    let asked;
    const runs = fetchScheduledRuns({
      repo: "o/r",
      run: (command, args, options) => {
        asked = { command, args, timeoutMs: options.timeoutMs };
        return { status: 0, stdout: JSON.stringify([run(SIM, 13, "failure")]) };
      },
    });
    expect(asked.command).toBe("gh");
    expect(asked.args[1]).toBe("repos/o/r/actions/runs?event=schedule&branch=main&per_page=100");
    // The whole page is about a megabyte, past spawnSync's buffer; gh trims it first.
    expect(asked.args.slice(2, 3)).toEqual(["--jq"]);
    expect(asked.timeoutMs).toBeLessThanOrEqual(5_000);
    expect(runs).toEqual([
      {
        ...SIM,
        conclusion: "failure",
        createdAt: "2026-10-13T06:30:00Z",
        url: "https://github.com/o/r/actions/runs/13",
      },
    ]);
  });

  it("is null when gh fails or answers nonsense", () => {
    expect(fetchScheduledRuns({ repo: "o/r", run: () => ({ status: 1 }) })).toBeNull();
    expect(fetchScheduledRuns({ repo: "o/r", run: () => ({ status: 0, stdout: "<" }) })).toBeNull();
  });
});

describe("readScheduledRuns", () => {
  const runs = slimRuns([run(SIM, 13, "failure")]);

  it("reads a fresh cache without asking GitHub", () => {
    const cached = JSON.stringify({ at: 1_000, runs });
    const got = readScheduledRuns("/c", {
      now: 1_000 + SCHEDULED_RUNS_TTL_MS,
      read: () => cached,
      fetch: () => {
        throw new Error("should not fetch");
      },
    });
    expect(got).toEqual(runs);
  });

  it("fetches and writes back when the cache is stale or missing, and is null when GitHub is", () => {
    let written;
    const got = readScheduledRuns("/c", {
      now: 5_000 + SCHEDULED_RUNS_TTL_MS + 1,
      read: () => JSON.stringify({ at: 5_000, runs: [] }),
      fetch: () => runs,
      write: (_file, text) => {
        written = JSON.parse(text);
      },
    });
    expect(got).toEqual(runs);
    expect(written.runs).toEqual(runs);
    expect(
      readScheduledRuns("/c", {
        read: () => {
          throw new Error("ENOENT");
        },
        fetch: () => null,
      }),
    ).toBeNull();
  });
});
