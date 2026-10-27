import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ci = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
const job = (id) => ci.split(`\n  ${id}:\n`)[1]?.split(/\n {2}[a-z0-9-]+:\n/u)[0] ?? "";

function selected(pattern, entries, flags = "-Eq") {
  const result = spawnSync("grep", [flags, pattern], {
    input: `${entries.join("\n")}\n`,
    encoding: "utf8",
    timeout: 5000,
  });
  expect(result.error).toBeUndefined();
  return result.status === 0;
}

describe("CI installs PDF tools for the selected browser tests", () => {
  it.each(["staff-saved-print", "boarding-certification-paper", "five-dive-departure-log"])(
    "installs Poppler when the shard contains %s",
    (spec) => {
      const block = job("playwright");
      const match = block.match(/grep -(qx|Eq) '([^']+)'; then\s+if ! command -v pdftotext/u);
      expect(match).not.toBeNull();
      const [, flags, pattern] = match;
      expect(selected(pattern, [`e2e/${spec}.spec.ts`], `-${flags}`)).toBe(true);
      expect(selected(pattern, ["e2e/unrelated.spec.ts"], `-${flags}`)).toBe(false);
      expect(selected(pattern, [`e2e/${spec}.spec.ts.extra`], `-${flags}`)).toBe(false);
      expect(block).toContain("poppler-utils");
    },
  );

  it.each(["staff-saved-print", "boarding-certification-paper", "five-dive-departure-log"])(
    "installs Poppler for a fast-lane selection of %s, including a line selection",
    (spec) => {
      const block = job("fast-lane");
      const pattern = block.match(/grep -Eq '([^']+)' fast-lane\/specs\.txt/u)?.[1];
      expect(pattern).toBeDefined();
      expect(selected(pattern, [`e2e/${spec}.spec.ts`])).toBe(true);
      expect(selected(pattern, [`e2e/${spec}.spec.ts:42`])).toBe(true);
      expect(selected(pattern, [`e2e/${spec}.spec.ts:42:9`])).toBe(false);
      expect(selected(pattern, ["e2e/unrelated.spec.ts"])).toBe(false);
      expect(block).toContain("steps.plan.outputs.captures }}\" = 'true'");
      expect(block).toContain("poppler-utils");
    },
  );
});
