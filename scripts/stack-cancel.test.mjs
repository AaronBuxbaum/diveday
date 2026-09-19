import { describe, expect, it } from "vitest";

import {
  cancellableRuns,
  cancelMiddleLayerRuns,
  MAX_CANCELLATIONS,
  MAX_RUN_PAGES,
  middleLayers,
  RUNS_PER_PAGE,
} from "./stack-cancel.mjs";

/**
 * This is the one piece of the stack machinery that destroys work rather than
 * declining to do it, so the "leaves alone" cases carry more weight here than
 * the cancellations. Cancelling a push to `main` would take the visual baseline
 * every later run is keyed to with it — the documented worst failure this
 * pipeline has — so each of the three rails gets its own test even though the
 * query string would normally have kept them out.
 */

const REPO = "AaronBuxbaum/diveday";
const TOKEN = "t";
const layer = (number, ref) => ({ number, head: { ref } });
const chainOf = (...refs) => refs.map((ref, index) => layer(index + 1, ref));

/** A live CI run on a layer's own branch: the one shape that may be cancelled. */
function liveRun(id, headBranch, overrides = {}) {
  return {
    id,
    status: "in_progress",
    head_branch: headBranch,
    path: ".github/workflows/ci.yml",
    ...overrides,
  };
}

/**
 * A fake API. `runsByBranch` answers the workflow-runs read; every cancel is
 * recorded, and a branch listed in `refuseCancel` answers as GitHub does when
 * the run completed a moment earlier.
 */
function api({ runsByBranch = {}, refuseCancel = [] } = {}) {
  const cancelled = [];
  const reads = [];
  const call = async (pathname, { method = "GET" } = {}) => {
    if (method === "GET") {
      reads.push(pathname);
      const params = new URL(`https://x${pathname}`).searchParams;
      const branch = decodeURIComponent(params.get("branch"));
      const pages = runsByBranch[branch] ?? [];
      // `runsByBranch` is either one flat list (the whole first page) or a list
      // of pages, which is how a paginated branch is expressed.
      const paged = Array.isArray(pages[0]) ? pages : [pages];
      return { workflow_runs: paged[Number(params.get("page")) - 1] ?? [] };
    }
    const id = Number(/\/actions\/runs\/(\d+)\/cancel$/.exec(pathname)[1]);
    if (refuseCancel.includes(id)) throw new Error(`POST -> 409: run ${id} has already completed`);
    cancelled.push(id);
    return null;
  };
  return { call, cancelled, reads };
}

const run = (chain, fake) =>
  cancelMiddleLayerRuns({
    chain,
    repo: REPO,
    token: TOKEN,
    defaultBranch: "main",
    call: fake.call,
  });

describe("middleLayers", () => {
  it("is empty for a chain with no middle", () => {
    expect(middleLayers(chainOf("a", "b"))).toEqual([]);
    expect(middleLayers(chainOf("a"))).toEqual([]);
    expect(middleLayers([])).toEqual([]);
  });

  // The bottom is the layer next to merge and the top is what a session
  // building upward is reading. Neither is ever superseded by a new layer.
  it("never includes the bottom or the top", () => {
    expect(middleLayers(chainOf("a", "b", "c", "d")).map((l) => l.head.ref)).toEqual(["b", "c"]);
  });
});

describe("cancellableRuns", () => {
  const opts = { headRef: "feature", defaultBranch: "main" };

  it("takes a live CI run on the layer's own branch", () => {
    expect(cancellableRuns([liveRun(1, "feature")], opts).map((r) => r.id)).toEqual([1]);
  });

  it("leaves a run that has already finished", () => {
    const runs = [liveRun(1, "feature", { status: "completed" })];
    expect(cancellableRuns(runs, opts)).toEqual([]);
  });

  // Rail 2, each half on its own. The query string already scopes the read to
  // one branch and one workflow; these hold if a future caller forgets.
  it("leaves a run belonging to another workflow", () => {
    const runs = [liveRun(1, "feature", { path: ".github/workflows/preview.yml" })];
    expect(cancellableRuns(runs, opts)).toEqual([]);
  });

  it("leaves a run on another branch", () => {
    expect(cancellableRuns([liveRun(1, "somebody-else")], opts)).toEqual([]);
  });

  // The failure this whole filter exists for: a push to `main` publishes the
  // snapshot every later run's baseline resolves to, and five cancelled main
  // runs on 2026-09-01 left the next one reporting 696 surfaces new, 0 compared.
  it("leaves a run on the default branch even if it is asked for by name", () => {
    const runs = [liveRun(1, "main")];
    expect(cancellableRuns(runs, { headRef: "main", defaultBranch: "main" })).toEqual([]);
  });

  it("leaves a status it does not recognise", () => {
    const runs = [liveRun(1, "feature", { status: "some_new_thing" })];
    expect(cancellableRuns(runs, opts)).toEqual([]);
  });
});

describe("cancelMiddleLayerRuns", () => {
  // The case the feature exists for: a session opens C on top of A -> B, and
  // B's full gate is ninety seconds into a run nobody will read.
  it("cancels the run on a layer that has just become a middle layer", async () => {
    const fake = api({ runsByBranch: { b: [liveRun(77, "b")] } });
    const summary = await run(chainOf("a", "b", "c"), fake);
    expect(fake.cancelled).toEqual([77]);
    expect(summary).toBe("Cancelled superseded CI on #2 (run 77).");
  });

  it("reads only the middle layers' branches", async () => {
    const fake = api({ runsByBranch: { b: [liveRun(1, "b")], c: [liveRun(2, "c")] } });
    await run(chainOf("a", "b", "c", "d"), fake);
    expect(fake.reads).toHaveLength(2);
    expect(fake.reads.join(" ")).toContain("branch=b");
    expect(fake.reads.join(" ")).toContain("branch=c");
    expect(fake.reads.join(" ")).not.toContain("branch=a");
    expect(fake.reads.join(" ")).not.toContain("branch=d");
  });

  it("does nothing at all for a two-layer stack", async () => {
    const fake = api({ runsByBranch: { a: [liveRun(1, "a")], b: [liveRun(2, "b")] } });
    expect(await run(chainOf("a", "b"), fake)).toBe("No middle layer to quiet.");
    expect(fake.reads).toEqual([]);
    expect(fake.cancelled).toEqual([]);
  });

  it("says so plainly when the middle has nothing left running", async () => {
    const fake = api({});
    expect(await run(chainOf("a", "b", "c"), fake)).toBe(
      "Middle layers #2 had no CI run left to cancel.",
    );
  });

  // The ordinary race, not an error: the run finished between the read and the
  // write. The registration is what had to happen, and it did.
  it("reports a refused cancel without throwing", async () => {
    const fake = api({ runsByBranch: { b: [liveRun(9, "b")] }, refuseCancel: [9] });
    const summary = await run(chainOf("a", "b", "c"), fake);
    expect(fake.cancelled).toEqual([]);
    expect(summary).toMatch(/^Left alone: #2 run 9 \(POST -> 409/);
  });

  it("carries on to the next layer when one cannot be read", async () => {
    const fake = api({ runsByBranch: { c: [liveRun(5, "c")] } });
    const original = fake.call;
    const call = async (pathname, options) => {
      if (pathname.includes("branch=b")) throw new Error("502");
      return original(pathname, options);
    };
    const summary = await cancelMiddleLayerRuns({
      chain: chainOf("a", "b", "c", "d"),
      repo: REPO,
      token: TOKEN,
      defaultBranch: "main",
      call,
    });
    expect(fake.cancelled).toEqual([5]);
    expect(summary).toBe(
      "Cancelled superseded CI on #3 (run 5); left alone: #2 (could not be read: 502).",
    );
  });

  // Sourcery's finding on #1892: the first version read one page of 20 and
  // called it done, against a contract that says every live run.
  it("follows pagination until a page comes back short", async () => {
    // A full page carrying one live run, so paging continues without the
    // cancellation ceiling getting there first.
    const full = [
      liveRun(1, "b"),
      ...Array.from({ length: RUNS_PER_PAGE - 1 }, (_, i) =>
        liveRun(i + 2, "b", { status: "completed" }),
      ),
    ];
    const fake = api({ runsByBranch: { b: [full, [liveRun(9001, "b")]] } });
    await run(chainOf("a", "b", "c"), fake);
    expect(fake.reads).toHaveLength(2);
    expect(fake.reads[1]).toContain("page=2");
    expect(fake.cancelled).toEqual([1, 9001]);
  });

  // Runs come back newest first and `ci.yml` keeps one lane per ref, so a page
  // with nothing live on it is the end of the live ones — no second request.
  it("stops at the first page with nothing live on it", async () => {
    const done = Array.from({ length: RUNS_PER_PAGE }, (_, i) =>
      liveRun(i + 1, "b", { status: "completed" }),
    );
    const fake = api({ runsByBranch: { b: [done, [liveRun(9001, "b")]] } });
    await run(chainOf("a", "b", "c"), fake);
    expect(fake.reads).toHaveLength(1);
    expect(fake.cancelled).toEqual([]);
  });

  it("asks for a full page and stops after one when the branch is short", async () => {
    const fake = api({ runsByBranch: { b: [liveRun(1, "b")] } });
    await run(chainOf("a", "b", "c"), fake);
    expect(fake.reads).toHaveLength(1);
    expect(fake.reads[0]).toContain(`per_page=${RUNS_PER_PAGE}`);
    expect(fake.reads[0]).toContain("page=1");
  });

  // Unbounded paging is its own sweep. Past this the cancellation ceiling has
  // already stopped us acting on what the extra reads would find.
  it("reads no more than its page ceiling", async () => {
    const full = [
      liveRun(1, "b"),
      ...Array.from({ length: RUNS_PER_PAGE - 1 }, (_, i) =>
        liveRun(i + 2, "b", { status: "completed" }),
      ),
    ];
    const fake = api({ runsByBranch: { b: Array.from({ length: 12 }, () => full) } });
    await run(chainOf("a", "b", "c"), fake);
    expect(fake.reads).toHaveLength(MAX_RUN_PAGES);
  });

  // A bug in the chain walk must not become a repository-wide sweep.
  it("stops at its ceiling rather than cancelling without bound", async () => {
    const runs = Array.from({ length: MAX_CANCELLATIONS + 5 }, (_, i) => liveRun(i + 1, "b"));
    const fake = api({ runsByBranch: { b: [runs] } });
    const summary = await run(chainOf("a", "b", "c"), fake);
    expect(fake.cancelled).toHaveLength(MAX_CANCELLATIONS);
    expect(summary).toContain(`stopped at the ${MAX_CANCELLATIONS}-run ceiling`);
  });
});
