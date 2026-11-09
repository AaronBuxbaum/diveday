import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { cleanTemplateCache } from "./db-template-cleanup";

it("requires an explicit idle assertion and a bounded retain count", async () => {
  await expect(cleanTemplateCache("unused", { idle: false, keep: 3 })).rejects.toThrow(
    "Stop every test",
  );
  await expect(cleanTemplateCache("unused", { idle: true, keep: 0 })).rejects.toThrow(
    "Retain count",
  );
});
it("retains the requested generations and shared blobs, leaving unrelated files alone", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "template-gc-"));
  try {
    const shared = `${"a".repeat(64)}.tar`;
    const orphan = `${"b".repeat(64)}.tar`;
    await writeFile(path.join(directory, shared), "shared");
    await writeFile(path.join(directory, orphan), "orphan");
    await writeFile(path.join(directory, `${orphan}.1234-abcd.tmp`), "interrupted");
    await writeFile(path.join(directory, "unrelated.txt"), "keep");
    await mkdir(path.join(directory, "other-cache"));
    for (const digit of ["1", "2", "3", "4"]) {
      await writeFile(
        path.join(directory, `${digit.repeat(64)}.json`),
        JSON.stringify({
          files: Object.fromEntries(
            ["lean", "history", "empty"].map((variant) => [variant, { file: shared }]),
          ),
        }),
      );
    }
    expect(await cleanTemplateCache(directory, { idle: true, keep: 3 })).toEqual({
      retained: 3,
      removed: 3,
    });
    const names = await readdir(directory);
    expect(names).toContain(shared);
    expect(names).not.toContain(orphan);
    expect(names).toContain("unrelated.txt");
    expect(names).toContain("other-cache");
    expect(names.filter((name) => name.endsWith(".json"))).toHaveLength(3);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
