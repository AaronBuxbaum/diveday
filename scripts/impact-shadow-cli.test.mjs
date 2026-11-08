import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { selectionSnapshot } from "./impact-shadow.mjs";
import { main } from "./impact-shadow-cli.mjs";

const dirs = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
describe("impact shadow CLI", () => {
  it("writes reports even when no containment retry exists", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "impact-shadow-"));
    dirs.push(dir);
    const plan = path.join(dir, "plan.json");
    const results = path.join(dir, "results.json");
    const out = path.join(dir, "nested", "shadow.json");
    writeFileSync(plan, JSON.stringify(selectionSnapshot(null)));
    writeFileSync(results, JSON.stringify({ suites: [] }));
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    main([
      "report",
      "--plan",
      plan,
      "--results",
      results,
      "--retry",
      path.join(dir, "missing.json"),
      "--out",
      out,
    ]);
    expect(JSON.parse(readFileSync(out, "utf8")).available).toBe(false);
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining("Selection unavailable"));
  });
  it("refuses missing required arguments", () => {
    expect(() => main(["plan"])).toThrow("--out");
    expect(() => main(["report", "--out", "unused"])).toThrow("--plan and --results");
    expect(() => main(["unknown", "--out", "unused"])).toThrow("plan or report");
  });
  it("keeps shadow measurement advisory and saves it with the existing full-shard artifact", () => {
    const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
    const shard = workflow.slice(
      workflow.indexOf("\n  playwright:\n"),
      workflow.indexOf("\n  # An early browser answer"),
    );
    expect(shard).toContain("fetch-depth: 0");
    expect(shard).toContain("impact-shadow-cli.mjs plan --base");
    expect(shard).toContain("--retry e2e-durations/retry-attempt.json");
    expect(shard).toMatch(
      /Compare test-impact prediction with full shard\n\s+if: always\(\)\n\s+continue-on-error: true/,
    );
    expect(shard).toContain('pnpm exec playwright test "${spec_files[@]}"');
    expect(shard).toContain("path: e2e-durations/");
  });
});
