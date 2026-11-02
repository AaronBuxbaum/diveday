import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ratchetScripts, steps } from "./regenerate.mjs";

async function repo(guards, scripts) {
  const root = await mkdtemp(path.join(tmpdir(), "diveday-regen-"));
  await mkdir(path.join(root, "scripts"), { recursive: true });
  await writeFile(
    path.join(root, "scripts/ratchets.json"),
    JSON.stringify(Object.fromEntries([["//", "note"], ...guards.map((g) => [g, {}])])),
  );
  for (const name of scripts) await writeFile(path.join(root, `scripts/check-${name}.mjs`), "");
  return root;
}

describe("ratchetScripts", () => {
  it("runs each guard's own --write once, and function-length through page-length", async () => {
    const root = await repo(["function-length", "page-length", "voice"], ["page-length", "voice"]);
    expect(ratchetScripts(root)).toEqual([
      "scripts/check-page-length.mjs",
      "scripts/check-voice.mjs",
    ]);
  });

  it("leaves alone a section whose guard script is gone", async () => {
    const root = await repo(["retired"], []);
    expect(ratchetScripts(root)).toEqual([]);
  });
});

describe("steps", () => {
  it("ends with the export snapshot, and drops it on --no-snapshot", async () => {
    const root = await repo(["voice"], ["voice"]);
    expect(steps({ root }).at(-1)?.label).toBe("export-bundle snapshot");
    expect(steps({ root, snapshot: false }).map((step) => step.label)).toEqual([
      "ADR index",
      "human decision index",
      "glossary index",
      "ratchet voice",
    ]);
  });
});
