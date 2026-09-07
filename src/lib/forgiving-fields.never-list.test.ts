import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isNeverForgivingFieldName } from "./forgiving-fields";

/**
 * ADR 20260906-before-you-ask, decision 3: the never-list, held by test.
 *
 * A forgiving reader on a certification card number, a head or seat count, a
 * tank pressure, a nitrox mix, a depth, a medical answer or the emergency
 * contact's name would be a helpful guess on a safety document. This walks
 * every `<ForgivingInput` in the tree and fails on one whose `name` is on the
 * list — so the ban is a build failure rather than a review comment.
 */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry)) out.push(full);
  }
  return out;
}

describe("the never-list", () => {
  it("no ForgivingInput is wired to a safety field", () => {
    const root = path.join(process.cwd(), "src");
    const offenders: string[] = [];
    for (const file of walk(root)) {
      const source = readFileSync(file, "utf8");
      if (!source.includes("<ForgivingInput")) continue;
      for (const match of source.matchAll(/<ForgivingInput\b[^>]*?\bname=["']([^"']+)["']/gs)) {
        const name = match[1] ?? "";
        if (isNeverForgivingFieldName(name)) {
          offenders.push(`${path.relative(process.cwd(), file)}: name="${name}"`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
