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
const PLANNER_WORKFLOW = CI_WORKFLOW.slice(
  CI_WORKFLOW.indexOf("\n  visual-plan:\n"),
  CI_WORKFLOW.indexOf("\n  visual:\n"),
);

describe("fresh versioned visual baseline workflow", () => {
  it("propagates the explicit reset marker from preparation to the caller", () => {
    expect(PUBLISH_WORKFLOW).toContain("baseline_reset: ${{ steps.baseline.outputs.fresh_start }}");
    expect(PUBLISH_WORKFLOW).toContain(
      "baseline_reset: ${{ needs.prepare.outputs.baseline_reset }}",
    );
    expect(PUBLISH_WORKFLOW).toContain("baseline_reset:");
  });

  it("allows an empty expected inventory only when preparation signals a fresh start", () => {
    expect(
      PUBLISH_WORKFLOW.match(
        /VISUAL_FRESH_START: \$\{\{ steps\.baseline\.outputs\.fresh_start \}\}/gu,
      ),
    ).toHaveLength(2);
    expect(
      PUBLISH_WORKFLOW.match(/VISUAL_CAPTURE_MODE: \$\{\{ inputs\.capture-mode \}\}/gu),
    ).toHaveLength(3);
    expect(PUBLISH_WORKFLOW).toContain("name: Require all captures for a fresh baseline");
    expect(PUBLISH_WORKFLOW).toContain("inputs.capture-mode != 'all'");
    const baselineAt = PUBLISH_WORKFLOW.indexOf("name: Resolve a baseline that actually exists");
    const fullCaptureGuardAt = PUBLISH_WORKFLOW.indexOf(
      "name: Require all captures for a fresh baseline",
    );
    const expectedAt = PUBLISH_WORKFLOW.indexOf(
      "name: Prepare expected screenshots without AWS credentials",
    );
    expect(fullCaptureGuardAt).toBeGreaterThan(baselineAt);
    expect(fullCaptureGuardAt).toBeLessThan(expectedAt);
  });

  it("plans all captures before publishing the first baseline", () => {
    expect(PLANNER_WORKFLOW).toContain("node scripts/reg-suit-keys.mjs --github-env");
    expect(PLANNER_WORKFLOW).toContain("node scripts/wait-for-baseline.mjs");
    expect(PLANNER_WORKFLOW).toContain("FRESH_START: ${{ steps.baseline.outputs.fresh_start }}");
    expect(PLANNER_WORKFLOW).toContain('[ "${FRESH_START}" = "true" ]');
  });

  it("carries a separate pre-capture inventory through the trusted publisher", () => {
    expect(CI_WORKFLOW).toContain("e2e/capture-manifest/*.json");
    expect(PUBLISH_WORKFLOW).toContain("name: Download the planned visual capture inventory");
    expect(PUBLISH_WORKFLOW).toContain("name: visual-list");
    expect(PUBLISH_WORKFLOW).toContain("VISUAL_EXPECTED_CAPTURE_TESTS");
    expect(
      PUBLISH_WORKFLOW.match(
        /VISUAL_EXPECTED_CAPTURE_MANIFEST: \$\{\{ runner\.temp \}\}\/reg-suit-capture-manifest\.json/gu,
      ),
    ).toHaveLength(3);
    expect(PUBLISH_WORKFLOW).toContain("name: Verify complete screenshot inventory");
  });

  it("allows a no-comparison report only for the explicit fresh start", () => {
    expect(CI_WORKFLOW).toContain(
      "needs.visual-publish.outputs.baseline_reset == 'true' && steps.summary.outputs.verdict == 'no-baseline'",
    );
  });
});
