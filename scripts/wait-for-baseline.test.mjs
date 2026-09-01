import { describe, expect, it } from "vitest";

import {
  baselineDir,
  baselineItems,
  DEFAULT_MAX_ANCESTORS,
  nearestPublishedAncestor,
  waitForBaseline,
} from "./wait-for-baseline.mjs";

const KEY = "3333333333333333333333333333333333333333";
const BUCKET = "diveday-vrt";

function report(items) {
  return JSON.stringify({ actualItems: items, passedItems: items, failedItems: [], newItems: [] });
}

/**
 * A fake bucket plus a fake clock. `objects` is the set of keys that exist and
 * `bodies` is what the one readable object says; `appearAfter` adds a key once
 * the clock has passed a given elapsed time, which is how "the layer below is
 * still uploading" is expressed.
 */
function bucketWith({ bodies = {}, objects = [], appearAfter = {} }) {
  const state = { elapsed: 0, gets: 0, heads: 0 };
  const present = () =>
    new Set([
      ...objects,
      ...Object.entries(appearAfter)
        .filter(([, at]) => state.elapsed >= at)
        .map(([key]) => key),
    ]);
  const fetchImpl = async (url, options = {}) => {
    const key = decodeURIComponent(new URL(url).pathname.slice(1));
    if (options.method === "HEAD") state.heads += 1;
    else state.gets += 1;
    if (!present().has(key)) return { ok: false, status: 404 };
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => new TextEncoder().encode(bodies[key] ?? "").buffer,
    };
  };
  return { state, fetchImpl };
}

function run(fixture, overrides = {}) {
  return waitForBaseline({
    bucket: BUCKET,
    key: KEY,
    deadlineMs: 10 * 60_000,
    intervalMs: 60_000,
    fetchImpl: fixture.fetchImpl,
    now: () => fixture.state.elapsed,
    wait: async (ms) => {
      fixture.state.elapsed += ms;
    },
    log: () => {},
    ...overrides,
  });
}

describe("waitForBaseline", () => {
  it("passes straight through when the whole baseline is already published", async () => {
    const items = ["home-vw-390.png", "shop-vw-1280.png"];
    const fixture = bucketWith({
      bodies: { [`${KEY}/out.json`]: report(items) },
      objects: [`${KEY}/out.json`, ...items.map((item) => `${KEY}/actual/${item}`)],
    });
    await expect(run(fixture)).resolves.toMatchObject({ ok: true });
    expect(fixture.state.elapsed).toBe(0);
  });

  it("waits for the layer below's run to publish anything at all", async () => {
    const items = ["home-vw-390.png"];
    const fixture = bucketWith({
      bodies: { [`${KEY}/out.json`]: report(items) },
      appearAfter: { [`${KEY}/out.json`]: 180_000, [`${KEY}/actual/home-vw-390.png`]: 180_000 },
    });
    await expect(run(fixture)).resolves.toMatchObject({ ok: true });
    expect(fixture.state.elapsed).toBe(180_000);
  });

  // reg-suit uploads a run's files in chunks and `out.json` sorts near the end
  // of them — near enough to look complete while a few images are in flight.
  it("keeps waiting when the report is up but its images are not", async () => {
    const items = ["home-vw-390.png", "shop-vw-1280.png"];
    const fixture = bucketWith({
      bodies: { [`${KEY}/out.json`]: report(items) },
      objects: [`${KEY}/out.json`, `${KEY}/actual/home-vw-390.png`],
      appearAfter: { [`${KEY}/actual/shop-vw-1280.png`]: 120_000 },
    });
    await expect(run(fixture)).resolves.toMatchObject({ ok: true });
    expect(fixture.state.elapsed).toBe(120_000);
  });

  // Rule 2: it always ends. A wait whose only exit is the success marker is the
  // nine-hour loop AGENTS.md was written around.
  it("gives up at its deadline instead of waiting forever", async () => {
    const fixture = bucketWith({ bodies: {}, objects: [] });
    const result = await run(fixture);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/gave up after 10 minutes/);
    expect(fixture.state.elapsed).toBeLessThan(10 * 60_000);
  });

  it("stops rather than looping on a report it cannot read", async () => {
    const fixture = bucketWith({
      bodies: { [`${KEY}/out.json`]: "<html>404</html>" },
      objects: [`${KEY}/out.json`],
    });
    await expect(run(fixture)).resolves.toMatchObject({ ok: false });
  });

  it("stops rather than looping on a report with no surfaces in it", async () => {
    const fixture = bucketWith({
      bodies: { [`${KEY}/out.json`]: report([]) },
      objects: [`${KEY}/out.json`],
    });
    const result = await run(fixture);
    expect(result).toMatchObject({ ok: false });
    expect(result.reason).toMatch(/no surfaces/);
  });

  it("re-checks only the images still missing", async () => {
    const items = ["a.png", "b.png", "c.png"];
    const fixture = bucketWith({
      bodies: { [`${KEY}/out.json`]: report(items) },
      objects: [`${KEY}/out.json`, `${KEY}/actual/a.png`, `${KEY}/actual/b.png`],
      appearAfter: { [`${KEY}/actual/c.png`]: 60_000 },
    });
    await run(fixture);
    // Three on the first sweep, then one on the second — not three again.
    expect(fixture.state.heads).toBe(4);
  });
});

describe("baselineItems", () => {
  it("prefers the report's own actual set", () => {
    expect(baselineItems({ actualItems: ["a.png"], passedItems: ["b.png"] })).toEqual(["a.png"]);
  });

  it("reconstructs the set for a payload with no actualItems", () => {
    expect(
      baselineItems({ passedItems: ["a.png"], failedItems: ["b.png"], newItems: ["a.png"] }),
    ).toEqual(["a.png", "b.png"]);
  });

  // A path out of somebody else's report is data, not a URL.
  it("drops anything that could climb out of the key's own prefix", () => {
    expect(
      baselineItems({
        actualItems: ["../../secrets.png", "/etc/passwd", "https://elsewhere/x.png", "ok.png"],
      }),
    ).toEqual(["ok.png"]);
  });

  it("reads a report that is not one as no surfaces at all", () => {
    expect(baselineItems(null)).toEqual([]);
    expect(baselineItems("nope")).toEqual([]);
  });
});

describe("baselineDir", () => {
  it("takes the directory out of the layer below's own report", () => {
    expect(baselineDir({ actualDir: "actual" })).toBe("actual");
  });

  it("falls back to reg-suit's default when the report does not say", () => {
    expect(baselineDir({})).toBe("actual");
    expect(baselineDir(null)).toBe("actual");
  });

  // Same reasoning as the item paths: a field out of somebody else's report is
  // data, and this one ends up in a URL.
  it("refuses a directory that is not a plain name", () => {
    expect(baselineDir({ actualDir: "../../.." })).toBe("actual");
    expect(baselineDir({ actualDir: "a/b" })).toBe("actual");
  });
});

describe("nearestPublishedAncestor", () => {
  const A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const C = "cccccccccccccccccccccccccccccccccccccccc";
  const git = (answers) => (args) => {
    const key = args.join(" ");
    if (!(key in answers)) throw new Error(`stub git: no answer for \`git ${key}\``);
    return answers[key];
  };
  const revList = `rev-list --first-parent --max-count=${DEFAULT_MAX_ANCESTORS} ${KEY}^`;

  it("keeps a key whose snapshot is published, without touching git", async () => {
    const fixture = bucketWith({ objects: [`${KEY}/out.json`] });
    const found = await nearestPublishedAncestor({
      bucket: BUCKET,
      key: KEY,
      git: () => {
        throw new Error("git must not be consulted");
      },
      fetchImpl: fixture.fetchImpl,
    });
    expect(found).toEqual({ key: KEY, skipped: 0 });
    expect(fixture.state.heads).toBe(1);
  });

  // A docs-only commit, or a cancelled main run, publishes nothing; the commit
  // before it is the honest baseline and the count says how far back it is.
  it("walks past unpublished ancestors to the nearest published one", async () => {
    const fixture = bucketWith({ objects: [`${B}/out.json`, `${C}/out.json`] });
    const found = await nearestPublishedAncestor({
      bucket: BUCKET,
      key: KEY,
      git: git({ [revList]: `${A}\n${B}\n${C}\n` }),
      fetchImpl: fixture.fetchImpl,
    });
    expect(found).toEqual({ key: B, skipped: 2 });
  });

  it("gives up rather than inventing a key when nothing within reach is published", async () => {
    const fixture = bucketWith({});
    const found = await nearestPublishedAncestor({
      bucket: BUCKET,
      key: KEY,
      git: git({ [revList]: `${A}\n${B}` }),
      fetchImpl: fixture.fetchImpl,
    });
    expect(found).toBeNull();
    // The key itself plus each ancestor, once each — no retries, no loop.
    expect(fixture.state.heads).toBe(3);
  });

  it("honours a smaller reach and ignores lines that are not shas", async () => {
    const fixture = bucketWith({ objects: [`${C}/out.json`] });
    const found = await nearestPublishedAncestor({
      bucket: BUCKET,
      key: KEY,
      maxAncestors: 2,
      git: git({ [`rev-list --first-parent --max-count=2 ${KEY}^`]: `${A}\nnot-a-sha\n` }),
      fetchImpl: fixture.fetchImpl,
    });
    expect(found).toBeNull();
  });

  it("treats a git failure as nothing found, never as a throw", async () => {
    const fixture = bucketWith({});
    const found = await nearestPublishedAncestor({
      bucket: BUCKET,
      key: KEY,
      git: git({}),
      fetchImpl: fixture.fetchImpl,
    });
    expect(found).toBeNull();
  });
});
