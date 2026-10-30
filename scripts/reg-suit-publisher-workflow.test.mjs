import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW = readFileSync(path.join(ROOT, ".github/workflows/reg-suit-publish.yml"), "utf8");
const PREPARE = WORKFLOW.slice(
  WORKFLOW.indexOf("\n  prepare:\n"),
  WORKFLOW.indexOf("\n  publish:\n"),
);
const PUBLISH = WORKFLOW.slice(WORKFLOW.indexOf("\n  publish:\n"));

describe("reg-suit publisher workflow", () => {
  it("accepts workflow calls only and repeats the same-repository fork guard", () => {
    expect(WORKFLOW).toMatch(/^on:\n {2}workflow_call:/mu);
    expect(WORKFLOW).toContain("repository: ${{ job.workflow_repository }}");
    expect(WORKFLOW).toContain("ref: ${{ job.workflow_sha }}");
    expect(WORKFLOW).not.toContain("github.workflow_sha");
    expect(WORKFLOW).not.toContain("github.event.repository.default_branch");
    expect(WORKFLOW.match(/DEFAULT_BRANCH: main/g)).toHaveLength(2);
    expect(WORKFLOW).toContain(
      "github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == " +
        "github.repository",
    );
    expect(WORKFLOW).toContain('REG_SUIT_TRUSTED_BASE_CODE: "true"');
  });

  it("keeps the image-processing job without OIDC and limits the publisher permission", () => {
    expect(PREPARE).toContain("      contents: read");
    expect(PREPARE).not.toContain("id-token:");
    const permissionStart = PUBLISH.indexOf("    permissions:\n");
    const permissionEnd = PUBLISH.indexOf("    outputs:\n", permissionStart);
    const publisherPermissions = PUBLISH.slice(permissionStart, permissionEnd);
    expect(publisherPermissions.trim()).toBe("permissions:\n      id-token: write");
    expect(publisherPermissions).not.toContain("contents:");
    expect(publisherPermissions).not.toContain("pull-requests:");
  });

  it("decodes and compares in the unprivileged job, then uploads only a fixed bundle", () => {
    expect(WORKFLOW).toContain("name: visual-screenshots-1");
    expect(WORKFLOW).not.toContain("pattern: visual-screenshots-*");
    expect(WORKFLOW).not.toContain("path: e2e/screenshots");
    expect(WORKFLOW).toContain("node scripts/visual-publish-artifacts.mjs --validate-selection");
    expect(
      WORKFLOW.match(/if: \$\{\{ contains\(fromJSON\(inputs\.capture-shards\), [1-8]\) \}\}/gu),
    ).toHaveLength(8);
    expect(WORKFLOW.match(/name: visual-screenshots-[1-8]/gu)).toHaveLength(8);
    expect(WORKFLOW).toContain(
      "VISUAL_FILL_FROM_EXPECTED: ${{ inputs.capture-mode == 'affected' || inputs.capture-mode == 'light' }}",
    );
    expect(WORKFLOW).toContain('VISUAL_VERIFY_COMPLETE: "true"');
    const sanitizeAt = PREPARE.indexOf("node scripts/visual-publish-artifacts.mjs");
    const baselineAt = PREPARE.indexOf("node scripts/visual-prepare-baseline.mjs");
    const compareAt = PREPARE.indexOf("run: pnpm visual:compare");
    const inventoryAt = PREPARE.indexOf(
      "node scripts/visual-publish-artifacts.mjs --verify-complete",
    );
    const bundleAt = PREPARE.indexOf("node scripts/visual-build-publish-bundle.mjs");
    const uploadArtifactAt = PREPARE.indexOf("name: reg-suit-publish-bundle");
    const assumeAt = PUBLISH.indexOf("name: Assume the reg-suit publisher role");
    const putAt = PUBLISH.indexOf("aws s3api put-object");
    expect(sanitizeAt).toBeGreaterThanOrEqual(0);
    expect(baselineAt).toBeGreaterThan(sanitizeAt);
    expect(compareAt).toBeGreaterThan(baselineAt);
    expect(inventoryAt).toBeGreaterThan(compareAt);
    expect(bundleAt).toBeGreaterThan(compareAt);
    expect(uploadArtifactAt).toBeGreaterThan(bundleAt);
    expect(assumeAt).toBeGreaterThanOrEqual(0);
    expect(putAt).toBeGreaterThan(assumeAt);
    expect(PREPARE).toContain('VISUAL_EXPECTED_READY: "true"');
    expect(PREPARE).toContain('REG_SUIT_COMPARE_ONLY: "true"');
    expect(PUBLISH).toContain("REG_ACTUAL_KEY: ${{ needs.prepare.outputs.actual_key }}");
    expect(PUBLISH).toContain("--content-encoding gzip");
    expect(PUBLISH).toContain('--key "$REG_ACTUAL_KEY/$object_path"');
    expect(PUBLISH).not.toMatch(
      /actions\/checkout|pnpm|node scripts|visual:compare|run:\s*reg-suit (?:run|publish)/u,
    );
    expect(PUBLISH.slice(assumeAt)).not.toMatch(/^\s+- uses:/mu);
  });

  it("refuses to overwrite a snapshot owned by main or another PR", () => {
    expect(PUBLISH).toContain("aws s3api head-object");
    expect(PUBLISH).toContain("Metadata.diveday-pr-number");
    expect(PUBLISH).toContain('if [[ "$existing_pr" != "$PR_NUMBER" ]]; then');
    expect(PUBLISH).toContain("404|Not Found|NoSuchKey");
    expect(PUBLISH).toContain('metadata_args=(--metadata "diveday-pr-number=$PR_NUMBER")');
    expect(PUBLISH).toContain('cat "$head_error" >&2');
  });
});
