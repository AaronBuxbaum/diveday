import { describe, expect, it } from "vitest";

import {
  DEFAULT_MAX_ANCESTORS,
  layerBelowBaseline,
  nearestPublishedAncestor,
} from "./wait-for-baseline.mjs";

const KEY = "3333333333333333333333333333333333333333";
const BUCKET = "diveday-vrt";

/** A fake bucket: `objects` is the set of keys a HEAD finds, and nothing else exists. */
function bucketWith({ objects = [] }) {
  const state = { heads: 0 };
  const present = new Set(objects);
  const fetchImpl = async (url) => {
    state.heads += 1;
    return { ok: present.has(decodeURIComponent(new URL(url).pathname.slice(1))), status: 404 };
  };
  return { state, fetchImpl };
}

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

describe("layerBelowBaseline", () => {
  const BASE = "dddddddddddddddddddddddddddddddddddddddd";
  const BELOW = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  const git = (args) => {
    if (args.join(" ") === `merge-base ${BASE} HEAD`) return `${BELOW}\n`;
    throw new Error(`stub git: no answer for \`git ${args.join(" ")}\``);
  };
  const layer = { baseRef: "claude/layer-1", baseSha: BASE, defaultBranch: "main", key: KEY, git };

  it("compares a stacked layer against the layer below when that commit is published", async () => {
    const { fetchImpl } = bucketWith({ objects: [`${BELOW}/out.json`] });
    const result = await layerBelowBaseline({ bucket: BUCKET, ...layer, fetchImpl });
    expect(result?.key).toBe(BELOW);
    expect(result?.note).toContain("claude/layer-1");
  });

  it("keeps the fork point when the layer below has not published, and never waits", async () => {
    const { state, fetchImpl } = bucketWith({ objects: [] });
    expect(await layerBelowBaseline({ bucket: BUCKET, ...layer, fetchImpl })).toBeNull();
    expect(state.heads).toBe(1);
  });

  it("leaves a pull request on the default branch alone", async () => {
    const { state, fetchImpl } = bucketWith({ objects: [`${BELOW}/out.json`] });
    expect(
      await layerBelowBaseline({ bucket: BUCKET, ...layer, baseRef: "main", fetchImpl }),
    ).toBeNull();
    expect(state.heads).toBe(0);
  });

  it("leaves a push (no base sha) alone", async () => {
    const { fetchImpl } = bucketWith({ objects: [`${BELOW}/out.json`] });
    expect(
      await layerBelowBaseline({ bucket: BUCKET, ...layer, baseSha: undefined, fetchImpl }),
    ).toBeNull();
  });
});
