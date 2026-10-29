import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  DRIVERS,
  install,
  mergeDurationsText,
  mergeJson,
  mergeRatchetText,
} from "./merge-drivers.mjs";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "merge-drivers.mjs");

describe("mergeJson", () => {
  it("takes the side that changed", () => {
    expect(mergeJson({ a: 1 }, { a: 1 }, { a: 2 })).toEqual({ a: 2 });
    expect(mergeJson({ a: 1 }, { a: 3 }, { a: 1 })).toEqual({ a: 3 });
  });

  it("takes the larger count when both sides moved it, so no guard reads it as growth", () => {
    expect(mergeJson({ a: 500 }, { a: 480 }, { a: 490 })).toEqual({ a: 490 });
  });

  it("keeps both sides' new keys and unions absorb logs without duplicates", () => {
    const base = { "//absorbed": [{ why: "x" }], a: 1 };
    const ours = { "//absorbed": [{ why: "x" }, { why: "ours" }], a: 1, b: 2 };
    const theirs = { "//absorbed": [{ why: "x" }, { why: "theirs" }], a: 1, c: 3 };
    expect(mergeJson(base, ours, theirs)).toEqual({
      "//absorbed": [{ why: "x" }, { why: "ours" }, { why: "theirs" }],
      a: 1,
      b: 2,
      c: 3,
    });
  });

  it("keeps a deletion one side made, unless the other side changed that key", () => {
    expect(mergeJson({ a: 1, b: 2 }, { a: 1 }, { a: 1, b: 2, c: 3 })).toEqual({ a: 1, c: 3 });
    expect(mergeJson({ a: 1, b: 2 }, { a: 1 }, { a: 1, b: 5 })).toEqual({ a: 1, b: 5 });
  });

  it("leaves a string both sides rewrote as ours", () => {
    expect(mergeJson({ n: "base" }, { n: "ours" }, { n: "theirs" })).toEqual({ n: "ours" });
  });
});

describe("mergeRatchetText", () => {
  it("writes the note first and the guards sorted, like writeRatchet", () => {
    const base = JSON.stringify({ "//": "note", voice: { "//": "v", x: 3 } });
    const ours = JSON.stringify({ "//": "note", voice: { "//": "v", x: 2 } });
    const theirs = JSON.stringify({ "//": "note", copy: { y: 1 }, voice: { "//": "v", x: 3 } });
    const text = mergeRatchetText(base, ours, theirs);
    expect(Object.keys(JSON.parse(text))).toEqual(["//", "copy", "voice"]);
    expect(JSON.parse(text).voice.x).toBe(2);
    expect(text.endsWith("}\n")).toBe(true);
  });
});

describe("mergeDurationsText", () => {
  it("takes the larger duration, keeps both sides' files, and sorts like merge-test-durations", () => {
    const base = JSON.stringify({ "src/b.test.ts": 100, "src/gone.test.ts": 5 });
    const ours = JSON.stringify({ "src/b.test.ts": 300, "src/Z.test.ts": 1 });
    const theirs = JSON.stringify({
      "src/b.test.ts": 200,
      "src/gone.test.ts": 5,
      "src/a.test.ts": 7,
    });
    const text = mergeDurationsText(base, ours, theirs);
    // Code-unit order ("Z" before "a"), as `merge-test-durations.mjs` writes it, so a merge
    // does not reorder the file; a file one side pruned stays pruned.
    expect(text).toBe(
      `${JSON.stringify({ "src/Z.test.ts": 1, "src/a.test.ts": 7, "src/b.test.ts": 300 }, null, 2)}\n`,
    );
  });
});

describe("the repository's .gitattributes", () => {
  const attributes = readFileSync(path.join(path.dirname(SCRIPT), "..", ".gitattributes"), "utf8");

  // 2026-10-13: layer merges stopped on scripts/test-durations.json, which had no driver.
  it("gives scripts/test-durations.json a driver", () => {
    expect(attributes).toMatch(/^scripts\/test-durations\.json merge=diveday-durations$/m);
  });

  // 2026-10-22: export-bundle.divers.snap conflicted in 5 merges with no driver, although
  // `pnpm regen` rewrites it in the same test run as the shop snapshot.
  it("gives every snapshot `pnpm regen` rewrites the generated driver", () => {
    const test = readFileSync(
      path.join(path.dirname(SCRIPT), "..", "src/db/export-bundle.snapshot.test.ts"),
      "utf8",
    );
    const snapshots = [...test.matchAll(/"\.\/(__snapshots__\/[\w.-]+\.snap)"/g)].map(
      (match) => `src/db/${match[1]}`,
    );
    expect(snapshots.length).toBeGreaterThan(1);
    for (const file of snapshots)
      expect(attributes).toContain(`\n${file} merge=diveday-generated\n`);
  });

  it("names only drivers that install defines", () => {
    const named = [...attributes.matchAll(/merge=([\w-]+)/g)].map((match) => match[1]);
    expect(named.length).toBeGreaterThan(0);
    for (const id of named) expect(DRIVERS).toHaveProperty(id);
  });
});

/** A throwaway repo whose two branches both edit the generated files, then merge. */
async function conflictedRepo() {
  const root = await mkdtemp(path.join(tmpdir(), "diveday-merge-drivers-"));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "test");
  for (const [id, { driver }] of Object.entries(DRIVERS)) {
    git("config", `merge.${id}.driver`, driver.replace("scripts/merge-drivers.mjs", SCRIPT));
  }
  await mkdir(path.join(root, "scripts"), { recursive: true });
  await writeFile(
    path.join(root, ".gitattributes"),
    "scripts/ratchets.json merge=diveday-ratchets\nindex.md merge=diveday-generated\nscripts/test-durations.json merge=diveday-durations\n",
  );
  const write = async (ratchets, index, durations = { "a.test.ts": 10, "b.test.ts": 20 }) => {
    await writeFile(
      path.join(root, "scripts/test-durations.json"),
      `${JSON.stringify(durations, null, 2)}\n`,
    );
    await writeFile(
      path.join(root, "scripts/ratchets.json"),
      `${JSON.stringify(ratchets, null, 2)}\n`,
    );
    await writeFile(path.join(root, "index.md"), index);
    git("add", ".");
  };
  await write({ "//": "n", "page-length": { "a.tsx": 500, "b.tsx": 450 } }, "# Index\n\n- one\n");
  git("commit", "-qm", "base");
  git("checkout", "-qb", "theirs");
  await write(
    { "//": "n", "page-length": { "a.tsx": 490, "b.tsx": 450 } },
    "# Index\n\n- one\n- theirs\n",
    { "a.test.ts": 15, "b.test.ts": 20 },
  );
  git("commit", "-qm", "theirs");
  git("checkout", "-q", "main");
  await write(
    { "//": "n", "page-length": { "a.tsx": 480, "b.tsx": 440 } },
    "# Index\n\n- one\n- ours\n",
    { "a.test.ts": 10, "b.test.ts": 25 },
  );
  git("commit", "-qm", "ours");
  return { root, git };
}

describe("the drivers inside a real git merge", () => {
  it("merges both generated files without stopping", async () => {
    const { root, git } = await conflictedRepo();
    git("merge", "-q", "--no-edit", "theirs");
    const ratchets = JSON.parse(await readFile(path.join(root, "scripts/ratchets.json"), "utf8"));
    expect(ratchets["page-length"]).toEqual({ "a.tsx": 490, "b.tsx": 440 });
    expect(await readFile(path.join(root, "index.md"), "utf8")).toBe("# Index\n\n- one\n- ours\n");
    const durations = JSON.parse(
      await readFile(path.join(root, "scripts/test-durations.json"), "utf8"),
    );
    expect(durations).toEqual({ "a.test.ts": 15, "b.test.ts": 25 });
    expect(git("status", "--porcelain")).toBe("");
  });
});

/** A fake `git config` over a map, counting writes; `failWrites` makes every write lose. */
function fakeConfig(initial = {}, { failWrites = false, racer = null } = {}) {
  const config = new Map(Object.entries(initial));
  const writes = [];
  const git = (args) => {
    if (args[2] === "--get") {
      return config.has(args[3])
        ? { status: 0, stdout: `${config.get(args[3])}\n` }
        : { status: 1, stdout: "" };
    }
    writes.push(args[2]);
    if (failWrites) {
      // Another session's start holds config.lock and writes the same value.
      if (racer) config.set(args[2], racer(args[2], args[3]));
      return { status: 255, stdout: "" };
    }
    config.set(args[2], args[3]);
    return { status: 0, stdout: "" };
  };
  return { git, writes, config };
}

const installed = Object.fromEntries(
  Object.entries(DRIVERS).flatMap(([id, { name, driver }]) => [
    [`merge.${id}.name`, name],
    [`merge.${id}.driver`, driver],
  ]),
);

describe("installing the drivers", () => {
  it("writes nothing when every definition already reads back, so parallel starts do not contend", () => {
    const { git, writes } = fakeConfig(installed);
    expect(install("/repo", { git })).toBe(true);
    expect(writes).toEqual([]);
  });

  it("writes only the definitions that are missing or different", () => {
    const { "merge.diveday-ratchets.driver": _gone, ...partial } = installed;
    const { git, writes, config } = fakeConfig({
      ...partial,
      "merge.diveday-generated.name": "old",
    });
    expect(install("/repo", { git })).toBe(true);
    expect(writes).toEqual(["merge.diveday-ratchets.driver", "merge.diveday-generated.name"]);
    expect(Object.fromEntries(config)).toEqual(installed);
  });

  it("counts a write that lost the lock as installed when the winner wrote the same value", () => {
    const { git } = fakeConfig({}, { failWrites: true, racer: (_key, value) => value });
    expect(install("/repo", { git })).toBe(true);
  });

  it("returns false when a definition is still missing after its write failed", () => {
    const { git } = fakeConfig({}, { failWrites: true });
    expect(install("/repo", { git })).toBe(false);
  });
});
