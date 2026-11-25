import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.tsx$/.test(entry.name) && !/\.test\./.test(entry.name) ? [full] : [];
  });
}

describe("form encoding", () => {
  it("never names an encType: every form here posts through a function action, and React logs a warning for the pair", () => {
    const named = sources(path.join(process.cwd(), "src")).filter((file) =>
      /<form[^>]*\sencType=/s.test(readFileSync(file, "utf8")),
    );
    expect(named).toEqual([]);
  });
});
