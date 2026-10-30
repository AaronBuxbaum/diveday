import { describe, expect, it } from "vitest";

import {
  baselineEnvironment,
  DEFAULT_MAX_ANCESTORS,
  layerBelowBaseline,
  nearestPublishedAncestor,
} from "./wait-for-baseline.mjs";

const KEY = "3333333333333333333333333333333333333333";
const BUCKET = "diveday-vrt";
const VERSION = "a".repeat(64);

describe("baselineEnvironment", () => {
  it("exports the versioned cache key and leaves unknown versions uncached", () => {
    const version = "a".repeat(64);
    expect(baselineEnvironment({ key: KEY, version })).toEqual([
      `REG_EXPECTED_KEY=${KEY}`,
      `REG_EXPECTED_VERSION=${version}`,
      `REG_EXPECTED_CACHE_KEY=reg-baseline-${KEY}-${version}`,
    ]);
    expect(baselineEnvironment({ key: KEY, version: null })).toEqual([
      `REG_EXPECTED_KEY=${KEY}`,
      "REG_EXPECTED_VERSION=",
      "REG_EXPECTED_CACHE_KEY=",
    ]);
  });
});

/** A fake bucket: `objects` is the set of keys a HEAD finds, and nothing else exists. */
function bucketWith({ objects = [], versions = {} }) {
  const state = { heads: 0 };
  const present = new Set(objects);
  const fetchImpl = async (url) => {
    state.heads += 1;
    const key = decodeURIComponent(new URL(url).pathname.slice(1));
    const version = versions[key];
    return {
      ok: present.has(key),
      status: present.has(key) ? 200 : 404,
      headers: new Headers(version ? { "x-amz-meta-diveday-snapshot-version": version } : {}),
    };
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
    const fixture = bucketWith({
      objects: [`${KEY}/out.json`],
      versions: { [`${KEY}/out.json`]: VERSION },
    });
    const found = await nearestPublishedAncestor({
      bucket: BUCKET,
      key: KEY,
      git: () => {
        throw new Error("git must not be consulted");
      },
      fetchImpl: fixture.fetchImpl,
    });
    expect(found).toEqual({ key: KEY, skipped: 0, version: VERSION });
    expect(fixture.state.heads).toBe(1);
  });

  // A docs-only commit, or a cancelled main run, publishes nothing; the commit
  // before it is the honest baseline and the count says how far back it is.
  it("walks past unpublished ancestors to the nearest published one", async () => {
    const fixture = bucketWith({
      objects: [`${B}/out.json`, `${C}/out.json`],
      versions: { [`${B}/out.json`]: VERSION, [`${C}/out.json`]: "c".repeat(64) },
    });
    const found = await nearestPublishedAncestor({
      bucket: BUCKET,
      key: KEY,
      git: git({ [revList]: `${A}\n${B}\n${C}\n` }),
      fetchImpl: fixture.fetchImpl,
    });
    expect(found).toEqual({ key: B, skipped: 2, version: VERSION });
  });

  it("ignores old markers without a version and finds the first versioned baseline", async () => {
    const fixture = bucketWith({
      objects: [`${KEY}/out.json`, `${B}/out.json`],
      versions: { [`${B}/out.json`]: VERSION },
    });
    const found = await nearestPublishedAncestor({
      bucket: BUCKET,
      key: KEY,
      git: git({ [revList]: `${B}\n${C}\n` }),
      fetchImpl: fixture.fetchImpl,
    });

    expect(found).toEqual({ key: B, skipped: 1, version: VERSION });
  });

  it("signals a fresh start when only old unversioned markers exist", async () => {
    const fixture = bucketWith({ objects: [`${KEY}/out.json`, `${A}/out.json`] });
    const found = await nearestPublishedAncestor({
      bucket: BUCKET,
      key: KEY,
      git: git({ [revList]: `${A}\n` }),
      fetchImpl: fixture.fetchImpl,
    });

    expect(found).toEqual({ key: null, skipped: 2, version: null, freshStart: true });
  });

  it("treats a public-bucket 403 as an absent key when legacy markers are confirmed", async () => {
    const fixture = bucketWith({ objects: [`${A}/out.json`] });
    const fetchImpl = async (url, options) => {
      const key = decodeURIComponent(new URL(url).pathname.slice(1));
      if (key === `${KEY}/out.json`) {
        return { ok: false, status: 403, headers: new Headers() };
      }
      return fixture.fetchImpl(url, options);
    };
    const found = await nearestPublishedAncestor({
      bucket: BUCKET,
      key: KEY,
      git: git({ [revList]: `${A}\n` }),
      fetchImpl,
    });

    expect(found).toEqual({ key: null, skipped: 2, version: null, freshStart: true });
  });

  it("does not treat an unavailable current marker as a fresh start", async () => {
    const fixture = bucketWith({ objects: [`${A}/out.json`] });
    const fetchImpl = async (url, options) => {
      const key = decodeURIComponent(new URL(url).pathname.slice(1));
      if (key === `${KEY}/out.json`) {
        return { ok: false, status: 503, headers: new Headers() };
      }
      return fixture.fetchImpl(url, options);
    };
    const found = await nearestPublishedAncestor({
      bucket: BUCKET,
      key: KEY,
      git: git({ [revList]: `${A}\n` }),
      fetchImpl,
    });

    expect(found).toBeNull();
  });

  it("does not treat a malformed current marker as a fresh start", async () => {
    const fixture = bucketWith({
      objects: [`${KEY}/out.json`, `${A}/out.json`],
      versions: { [`${KEY}/out.json`]: "not-a-version" },
    });
    const found = await nearestPublishedAncestor({
      bucket: BUCKET,
      key: KEY,
      git: git({ [revList]: `${A}\n` }),
      fetchImpl: fixture.fetchImpl,
    });

    expect(found).toBeNull();
  });

  it("does not treat an unavailable ancestor as proof that only legacy markers exist", async () => {
    const fixture = bucketWith({ objects: [`${KEY}/out.json`, `${A}/out.json`] });
    const fetchImpl = async (url, options) => {
      const key = decodeURIComponent(new URL(url).pathname.slice(1));
      if (key === `${A}/out.json`) throw new Error("network unavailable");
      return fixture.fetchImpl(url, options);
    };
    const found = await nearestPublishedAncestor({
      bucket: BUCKET,
      key: KEY,
      git: git({ [revList]: `${A}\n` }),
      fetchImpl,
    });

    expect(found).toBeNull();
  });

  it("does not allow a fresh start when marker metadata is malformed", async () => {
    const fixture = bucketWith({
      objects: [`${KEY}/out.json`, `${A}/out.json`],
      versions: { [`${KEY}/out.json`]: "bad", [`${A}/out.json`]: "bad" },
    });
    const found = await nearestPublishedAncestor({
      bucket: BUCKET,
      key: KEY,
      git: git({ [revList]: `${A}\n` }),
      fetchImpl: fixture.fetchImpl,
    });

    expect(found).toBeNull();
  });

  it("reads the immutable snapshot version from the published report marker", async () => {
    const version = "a".repeat(64);
    const fixture = bucketWith({
      objects: [`${KEY}/out.json`],
      versions: { [`${KEY}/out.json`]: version },
    });
    await expect(
      nearestPublishedAncestor({
        bucket: BUCKET,
        key: KEY,
        git: () => {
          throw new Error("git must not be consulted");
        },
        fetchImpl: fixture.fetchImpl,
      }),
    ).resolves.toEqual({ key: KEY, skipped: 0, version });
  });

  it("skips a marker with malformed version metadata and keeps walking", async () => {
    const version = "d".repeat(64);
    const fixture = bucketWith({
      objects: [`${KEY}/out.json`, `${B}/out.json`],
      versions: {
        [`${KEY}/out.json`]: "not-a-version",
        [`${B}/out.json`]: version,
      },
    });
    const found = await nearestPublishedAncestor({
      bucket: BUCKET,
      key: KEY,
      git: git({ [revList]: `${B}\n${C}\n` }),
      fetchImpl: fixture.fetchImpl,
    });

    expect(found).toEqual({ key: B, skipped: 1, version });
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
    const { fetchImpl } = bucketWith({
      objects: [`${BELOW}/out.json`],
      versions: { [`${BELOW}/out.json`]: VERSION },
    });
    const result = await layerBelowBaseline({ bucket: BUCKET, ...layer, fetchImpl });
    expect(result).toMatchObject({ key: BELOW, version: VERSION });
    expect(result?.note).toContain("claude/layer-1");
  });

  it("does not use a legacy layer snapshot as a baseline", async () => {
    const { fetchImpl } = bucketWith({ objects: [`${BELOW}/out.json`] });
    expect(await layerBelowBaseline({ bucket: BUCKET, ...layer, fetchImpl })).toBeNull();
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
