import { describe, expect, it } from "vitest";

import { filesUnder } from "./files-under.mjs";

const dir = (name) => ({ name, isDirectory: () => true });
const file = (name) => ({ name, isDirectory: () => false });

describe("filesUnder", () => {
  it("preserves listing order and depth-first relative paths without following symlinks", async () => {
    const listings = {
      src: [dir("b"), file("z.tsx"), dir("a")],
      "src/b": [file("one.ts")],
      "src/a": [file("last.tsx")],
    };
    const visited = [];
    const files = await filesUnder("src", async (relative) => {
      visited.push(relative);
      return listings[relative];
    });

    expect(files).toEqual(["src/b/one.ts", "src/z.tsx", "src/a/last.tsx"]);
    expect(visited).toEqual(["src", "src/b", "src/a"]);
  });

  it("keeps caller selection local while allowing all-entry scans", async () => {
    const entries = [file("page.tsx"), file("loading.tsx"), file("notes.md")];
    const list = async () => entries;
    expect(await filesUnder("src", list)).toEqual([
      "src/page.tsx",
      "src/loading.tsx",
      "src/notes.md",
    ]);
    expect(await filesUnder("src", list, (relative) => /\.tsx?$/.test(relative))).toEqual([
      "src/page.tsx",
      "src/loading.tsx",
    ]);
  });

  it("treats a missing directory as empty and propagates other errors", async () => {
    const missing = Object.assign(new Error("missing"), { code: "ENOENT" });
    await expect(
      filesUnder("src", async () => {
        throw missing;
      }),
    ).resolves.toEqual([]);

    const denied = Object.assign(new Error("denied"), { code: "EACCES" });
    await expect(
      filesUnder("src", async () => {
        throw denied;
      }),
    ).rejects.toBe(denied);
  });

  it("handles a directory disappearing during recursion as empty", async () => {
    const missing = Object.assign(new Error("missing"), { code: "ENOENT" });
    await expect(
      filesUnder("src", async (relative) => {
        if (relative === "src") return [dir("gone"), file("still.ts")];
        throw missing;
      }),
    ).resolves.toEqual(["src/still.ts"]);
  });
});
