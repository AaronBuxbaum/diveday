import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLISH_WORKFLOW = readFileSync(
  path.join(ROOT, ".github/workflows/reg-suit-publish.yml"),
  "utf8",
);
const CI_WORKFLOW = readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");

describe("fresh versioned visual baseline workflow", () => {
  it("propagates the explicit reset marker from preparation to the caller", () => {
    expect(PUBLISH_WORKFLOW).toContain("baseline_reset: ${{ steps.baseline.outputs.fresh_start }}");
    expect(PUBLISH_WORKFLOW).toContain(
      "baseline_reset: ${{ needs.prepare.outputs.baseline_reset }}",
    );
    expect(PUBLISH_WORKFLOW).toContain("baseline_reset:");
  });

  it("allows a no-comparison report only for the explicit fresh start", () => {
    expect(CI_WORKFLOW).toContain(
      "needs.visual-publish.outputs.baseline_reset == 'true' && steps.summary.outputs.verdict == 'no-baseline'",
    );
  });
});
