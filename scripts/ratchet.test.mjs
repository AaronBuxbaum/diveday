import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  bankCounts,
  RATCHETS_PATH,
  ratchetFlags,
  readCounts,
  readRatchet,
  writeRatchet,
} from "./ratchet.mjs";

async function repo(ratchets) {
  const root = await mkdtemp(path.join(tmpdir(), "diveday-ratchet-"));
  if (ratchets !== undefined) {
    await mkdir(path.join(root, "scripts"), { recursive: true });
    await writeFile(path.join(root, RATCHETS_PATH), `${JSON.stringify(ratchets, null, 2)}\n`);
  }
  return root;
}

const onDisk = async (root) => JSON.parse(await readFile(path.join(root, RATCHETS_PATH), "utf8"));

const bank = (root, overrides) =>
  bankCounts({
    root,
    guard: "copy",
    counts: {},
    allowed: {},
    exists: true,
    note: "copy note",
    refusal: "Extract the string instead",
    absorb: null,
    summary: (files, total) => `${files} files, ${total} strings`,
    ...overrides,
  });

let logs;
beforeEach(() => {
  logs = [];
  for (const level of ["log", "warn", "error"]) {
    vi.spyOn(console, level).mockImplementation((line) => logs.push(line));
  }
});
afterEach(() => vi.restoreAllMocks());

describe("ratchetFlags", () => {
  it("reads --write and the reason after --absorb", () => {
    expect(ratchetFlags(["node", "x.mjs"])).toEqual({ write: false, absorb: null });
    expect(ratchetFlags(["node", "x.mjs", "--write"])).toEqual({ write: true, absorb: null });
    expect(ratchetFlags(["node", "x.mjs", "--absorb", "merged #12"])).toEqual({
      write: false,
      absorb: "merged #12",
    });
  });

  it("reads a bare --absorb, or one followed by another flag, as an empty reason", () => {
    expect(ratchetFlags(["node", "x.mjs", "--absorb"]).absorb).toBe("");
    expect(ratchetFlags(["node", "x.mjs", "--absorb", "--report"]).absorb).toBe("");
  });
});

describe("readCounts", () => {
  it("reports a missing file or section as not yet set up", async () => {
    expect(await readCounts(await repo(), "copy")).toEqual({ counts: {}, exists: false });
    expect(await readCounts(await repo({ voice: {} }), "copy")).toEqual({
      counts: {},
      exists: false,
    });
  });

  it("leaves the // note and the absorb log out of the counts", async () => {
    const root = await repo({
      copy: { "//": "note", "//absorbed": [{ why: "x", files: {} }], "src/a.tsx": 2 },
    });
    expect(await readCounts(root, "copy")).toEqual({ counts: { "src/a.tsx": 2 }, exists: true });
  });
});

describe("writeRatchet", () => {
  it("replaces one section, keeps every other, and orders guards by name", async () => {
    const root = await repo({ "//": "old note", voice: { "//": "v" }, architecture: { a: 1 } });
    await writeRatchet(root, "copy", { "//": "c" });
    const all = await onDisk(root);
    expect(Object.keys(all)).toEqual(["//", "architecture", "copy", "voice"]);
    expect(all.voice).toEqual({ "//": "v" });
    expect(all.architecture).toEqual({ a: 1 });
    expect(await readRatchet(root, "copy")).toEqual({ "//": "c" });
  });
});

describe("bankCounts", () => {
  it("banks a fall, sorted, and accepts a list of hits as its length", async () => {
    const root = await repo({ copy: { "//": "copy note", "src/b.tsx": 3, "src/a.tsx": 1 } });
    const code = await bank(root, {
      counts: new Map([
        ["src/b.tsx", ["one", "two"]],
        ["src/a.tsx", 1],
      ]),
      allowed: { "src/a.tsx": 1, "src/b.tsx": 3 },
    });
    expect(code).toBe(0);
    expect((await onDisk(root)).copy).toEqual({
      "//": "copy note",
      "src/a.tsx": 1,
      "src/b.tsx": 2,
    });
    expect(logs).toContain("copy: baseline written — 2 files, 3 strings");
  });

  it("refuses a rise and leaves the file untouched", async () => {
    const before = { copy: { "//": "copy note", "src/a.tsx": 1 } };
    const root = await repo(before);
    const code = await bank(root, {
      counts: { "src/a.tsx": 2, "src/new.tsx": 1 },
      allowed: { "src/a.tsx": 1 },
    });
    expect(code).toBe(1);
    expect(await onDisk(root)).toEqual(before);
    expect(logs[0]).toBe("Refusing to write a baseline that grows. Extract the string instead:");
    expect(logs).toContain("- src/a.tsx: 1 → 2");
    expect(logs).toContain("- src/new.tsx: new file with 1");
  });

  it("refuses an --absorb with no reason, because the reason is the point", async () => {
    const root = await repo({ copy: { "//": "copy note" } });
    const code = await bank(root, { counts: { "src/a.tsx": 1 }, absorb: "" });
    expect(code).toBe(1);
    expect((await onDisk(root)).copy).toEqual({ "//": "copy note" });
  });

  it("absorbs a rise with its reason, appended to the section's log", async () => {
    const root = await repo({
      copy: {
        "//": "copy note",
        "//absorbed": [{ why: "earlier", files: { "src/z.tsx": "0 -> 1" } }],
        "src/a.tsx": 1,
      },
    });
    const code = await bank(root, {
      counts: { "src/a.tsx": 2 },
      allowed: { "src/a.tsx": 1 },
      absorb: "merged #42, which predates the check",
    });
    expect(code).toBe(0);
    expect((await onDisk(root)).copy).toEqual({
      "//": "copy note",
      "//absorbed": [
        { why: "earlier", files: { "src/z.tsx": "0 -> 1" } },
        { why: "merged #42, which predates the check", files: { "src/a.tsx": "1 -> 2" } },
      ],
      "src/a.tsx": 2,
    });
  });

  it("writes any counts on the first run, before the section exists", async () => {
    const root = await repo({ voice: { "//": "v" } });
    const code = await bank(root, { counts: { "src/a.tsx": 4 }, exists: false });
    expect(code).toBe(0);
    expect(await onDisk(root)).toEqual({
      "//": expect.any(String),
      copy: { "//": "copy note", "src/a.tsx": 4 },
      voice: { "//": "v" },
    });
  });
});
