import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { DRIVERS, mergeJson, mergeRatchetText } from "./merge-drivers.mjs";

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
    "scripts/ratchets.json merge=diveday-ratchets\nindex.md merge=diveday-generated\n",
  );
  const write = async (ratchets, index) => {
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
  );
  git("commit", "-qm", "theirs");
  git("checkout", "-q", "main");
  await write(
    { "//": "n", "page-length": { "a.tsx": 480, "b.tsx": 440 } },
    "# Index\n\n- one\n- ours\n",
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
    expect(git("status", "--porcelain")).toBe("");
  });
});
