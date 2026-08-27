import { describe, expect, it } from "vitest";

import {
  DEFAULT_GRACE_MS,
  findStack,
  headSha,
  layerIsClear,
  outputLine,
  resolveStackPosition,
  waitForLayers,
} from "./stack-ci-priority.mjs";

const SHA = (n) => String(n).repeat(40).slice(0, 40);

/** One layer as `GET /stacks` returns it. */
function layer(number, { state = "open", merged = false } = {}) {
  return {
    number,
    state,
    merged_at: merged ? "2026-08-27T00:00:00Z" : null,
    head: { ref: `claude/layer-${number}`, sha: SHA(number % 10) },
  };
}

const stack = (numbers, opts = {}) => ({
  number: 900,
  pull_requests: numbers.map((n) => layer(n, opts[n] ?? {})),
});

describe("resolveStackPosition", () => {
  it("puts the lowest open layer at the bottom, waiting for nobody", () => {
    expect(resolveStackPosition(stack([1, 2, 3]), 1)).toEqual({ position: "bottom", yieldTo: [] });
  });

  it("makes the top yield to the bottom only", () => {
    const result = resolveStackPosition(stack([1, 2, 3]), 3);
    expect(result.position).toBe("top");
    expect(result.yieldTo.map((l) => l.number)).toEqual([1]);
  });

  it("makes a middle layer yield to both ends", () => {
    const result = resolveStackPosition(stack([1, 2, 3, 4]), 3);
    expect(result.position).toBe("middle");
    expect(result.yieldTo.map((l) => l.number)).toEqual([1, 4]);
  });

  it("treats a two-layer stack as bottom and top, with no middle", () => {
    expect(resolveStackPosition(stack([1, 2]), 1).position).toBe("bottom");
    expect(resolveStackPosition(stack([1, 2]), 2).position).toBe("top");
  });

  // The point of counting only open layers: after a bottom-up merge the layer
  // GitHub has just retargeted onto main is the one that should now run first.
  it("ignores layers that have already merged, so the bottom moves up", () => {
    const merged = stack([1, 2, 3], { 1: { state: "closed", merged: true } });
    expect(resolveStackPosition(merged, 2)).toEqual({ position: "bottom", yieldTo: [] });
    expect(resolveStackPosition(merged, 3).position).toBe("top");
  });

  it("is solo when only one layer is still open", () => {
    const merged = stack([1, 2], { 1: { state: "closed", merged: true } });
    expect(resolveStackPosition(merged, 2)).toEqual({ position: "solo", yieldTo: [] });
  });

  it("is solo for a pull request the stack does not name, and for no stack at all", () => {
    expect(resolveStackPosition(stack([1, 2, 3]), 9)).toEqual({ position: "solo", yieldTo: [] });
    expect(resolveStackPosition(null, 1)).toEqual({ position: "solo", yieldTo: [] });
    expect(resolveStackPosition({}, 1)).toEqual({ position: "solo", yieldTo: [] });
  });
});

describe("headSha", () => {
  it("takes a full commit sha and nothing else", () => {
    expect(headSha({ head: { sha: SHA(1) } })).toBe(SHA(1));
    // Anything that isn't 40 hex characters would be going into a query string.
    expect(headSha({ head: { sha: "main" } })).toBeNull();
    expect(headSha({ head: { sha: `${SHA(1)}?x=1` } })).toBeNull();
    expect(headSha({})).toBeNull();
  });
});

describe("findStack", () => {
  it("returns the stack naming this pull request", async () => {
    const request = async () => [stack([7, 8]), stack([1, 2, 3])];
    expect((await findStack({ repo: "o/r", prNumber: 2, request })).pull_requests).toHaveLength(3);
  });

  it("stops at an empty page rather than walking every page", async () => {
    const paths = [];
    const request = async (path) => {
      paths.push(path);
      return [];
    };
    expect(await findStack({ repo: "o/r", prNumber: 2, request })).toBeNull();
    expect(paths).toHaveLength(1);
  });

  it("gives up after a bounded number of pages", async () => {
    let pages = 0;
    const request = async () => {
      pages += 1;
      return [stack([7, 8])];
    };
    expect(await findStack({ repo: "o/r", prNumber: 2, request, log: () => {} })).toBeNull();
    expect(pages).toBe(3);
  });

  it("treats an unrecognised payload as no stack", async () => {
    const request = async () => ({ message: "Not Found" });
    expect(await findStack({ repo: "o/r", prNumber: 2, request, log: () => {} })).toBeNull();
  });
});

describe("layerIsClear", () => {
  const clearWith = (workflow_runs, elapsedMs = 0) =>
    layerIsClear({
      repo: "o/r",
      workflow: "ci.yml",
      sha: SHA(1),
      request: async () => ({ workflow_runs }),
      elapsedMs,
      graceMs: DEFAULT_GRACE_MS,
    });

  it("is clear once every run for the sha has completed", async () => {
    await expect(clearWith([{ status: "completed", conclusion: "success" }])).resolves.toBe(true);
  });

  // A red bottom layer has stopped asking for runners; holding the middle
  // hostage to somebody else's fix is not the trade this gate makes.
  it("is clear when the run completed red", async () => {
    await expect(clearWith([{ status: "completed", conclusion: "failure" }])).resolves.toBe(true);
  });

  // What makes a cascading rebase safe: the superseded run is cancelled, so the
  // wait ends instead of blocking on a sha nobody will build again.
  it("is clear when the run was cancelled", async () => {
    await expect(clearWith([{ status: "completed", conclusion: "cancelled" }])).resolves.toBe(true);
  });

  it("is not clear while any run for the sha is still going", async () => {
    await expect(clearWith([{ status: "completed" }, { status: "in_progress" }])).resolves.toBe(
      false,
    );
    await expect(clearWith([{ status: "queued" }])).resolves.toBe(false);
  });

  it("holds a layer with no run at all only until the grace period", async () => {
    await expect(clearWith([], 0)).resolves.toBe(false);
    await expect(clearWith([], DEFAULT_GRACE_MS)).resolves.toBe(true);
  });

  it("asks for the runs of that sha and no other", async () => {
    let asked = "";
    await layerIsClear({
      repo: "o/r",
      workflow: "ci.yml",
      sha: SHA(3),
      request: async (path) => {
        asked = path;
        return { workflow_runs: [{ status: "completed" }] };
      },
      elapsedMs: 0,
      graceMs: DEFAULT_GRACE_MS,
    });
    expect(asked).toBe(`/repos/o/r/actions/workflows/ci.yml/runs?head_sha=${SHA(3)}&per_page=20`);
  });
});

/** A fake clock: `wait` advances it instead of sleeping. */
function clock() {
  const state = { ms: 0, sleeps: 0 };
  return {
    state,
    now: () => state.ms,
    wait: async (ms) => {
      state.ms += ms;
      state.sleeps += 1;
    },
  };
}

describe("waitForLayers", () => {
  const opts = (request, extra = {}) => ({
    repo: "o/r",
    workflow: "ci.yml",
    request,
    log: () => {},
    intervalMs: 30_000,
    ...extra,
  });

  it("returns at once when there is nothing to yield to", async () => {
    const result = await waitForLayers(opts(async () => {}, { yieldTo: [] }));
    expect(result.ok).toBe(true);
  });

  it("skips a layer whose head sha is not a sha, rather than waiting on it", async () => {
    const result = await waitForLayers(
      opts(
        async () => {
          throw new Error("should not be asked");
        },
        { yieldTo: [{ number: 5, head: { ref: "x" } }] },
      ),
    );
    expect(result.ok).toBe(true);
  });

  it("polls until both layers finish", async () => {
    const c = clock();
    const request = async () => ({
      workflow_runs: [{ status: c.state.ms >= 60_000 ? "completed" : "in_progress" }],
    });
    const result = await waitForLayers(
      opts(request, { yieldTo: [layer(1), layer(2)], now: c.now, wait: c.wait }),
    );
    expect(result.ok).toBe(true);
    expect(c.state.sleeps).toBe(2);
  });

  // Rule 2: it always ends. The deadline is the exit, not the success.
  it("gives up at the deadline and says which layers are still running", async () => {
    const c = clock();
    const request = async () => ({ workflow_runs: [{ status: "in_progress" }] });
    const result = await waitForLayers(
      opts(request, {
        yieldTo: [layer(1), layer(4)],
        now: c.now,
        wait: c.wait,
        deadlineMs: 120_000,
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("#1");
    expect(result.reason).toContain("#4");
    expect(c.state.ms).toBeLessThan(120_000);
  });

  // Rule 1: no information opens the gate, it never holds it shut.
  it("treats an unreadable layer as clear", async () => {
    const request = async () => {
      throw new Error("403");
    };
    const result = await waitForLayers(opts(request, { yieldTo: [layer(1)] }));
    expect(result.ok).toBe(true);
  });

  it("stops asking about a layer once it is clear", async () => {
    const c = clock();
    const asked = [];
    const request = async (path) => {
      asked.push(path);
      const done = path.includes(SHA(1)) || c.state.ms >= 60_000;
      return { workflow_runs: [{ status: done ? "completed" : "in_progress" }] };
    };
    await waitForLayers(opts(request, { yieldTo: [layer(1), layer(2)], now: c.now, wait: c.wait }));
    expect(asked.filter((p) => p.includes(SHA(1)))).toHaveLength(1);
  });
});

describe("outputLine", () => {
  it("is one trailing-newline key=value pair", () => {
    expect(outputLine("middle")).toBe("position=middle\n");
  });
});
