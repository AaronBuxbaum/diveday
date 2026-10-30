import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW = readFileSync(path.join(ROOT, ".github/workflows/reg-suit-publish.yml"), "utf8");
const SETUP = readFileSync(path.join(ROOT, ".github/actions/setup/action.yml"), "utf8");
const CI_WORKFLOW = readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");
const PUBLISH = WORKFLOW.slice(WORKFLOW.indexOf("\n  publish:\n"));

describe("reg-suit publisher workflow", () => {
  it("runs only from a checkout of this immutable reusable workflow revision", () => {
    expect(PUBLISH).toContain("repository: ${{ job.workflow_repository }}");
    expect(PUBLISH).toContain("ref: ${{ job.workflow_sha }}");
    expect(PUBLISH).not.toContain("github.workflow_sha");
    expect(PUBLISH).toMatch(
      /uses: actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7\.0\.1/u,
    );
    expect(PUBLISH).toContain("uses: ./.github/actions/setup");
    expect(PUBLISH).toContain('ignore-scripts: "true"');
  });

  it("limits the OIDC job to contents read and token issuance", () => {
    const permissionStart = PUBLISH.indexOf("    permissions:\n");
    const permissionEnd = PUBLISH.indexOf("    outputs:\n", permissionStart);
    const permissions = PUBLISH.slice(permissionStart, permissionEnd);
    expect(permissions.trim()).toBe("permissions:\n      contents: read\n      id-token: write");
    expect(permissions).not.toContain("pull-requests:");
  });

  it("disables lifecycle scripts for the credentialed dependency install", () => {
    expect(SETUP).toContain("ignore-scripts:");
    expect(SETUP).toContain("pnpm install --frozen-lockfile --ignore-scripts");
    expect(PUBLISH.indexOf("uses: ./.github/actions/setup")).toBeLessThan(
      PUBLISH.indexOf("name: Assume the reg-suit publisher role"),
    );
  });

  it("downloads the prepared artifact as data before assuming the AWS role", () => {
    const downloadAt = PUBLISH.indexOf("actions/download-artifact@");
    const assumeAt = PUBLISH.indexOf("name: Assume the reg-suit publisher role");
    expect(downloadAt).toBeGreaterThanOrEqual(0);
    expect(downloadAt).toBeLessThan(assumeAt);
    expect(PUBLISH).toContain("name: reg-suit-publish-bundle");
    expect(PUBLISH).toContain("path: ${{ runner.temp }}/reg-suit-publish-bundle");
  });

  it("runs only the trusted publisher after credentials are configured", () => {
    const assumeAt = PUBLISH.indexOf("name: Assume the reg-suit publisher role");
    const publisherAt = PUBLISH.indexOf("run: node scripts/reg-suit-publish-bundle.mjs");
    expect(publisherAt).toBeGreaterThan(assumeAt);
    expect(PUBLISH.slice(assumeAt)).not.toMatch(/^\s+- uses:/mu);
    expect(PUBLISH.slice(assumeAt)).not.toMatch(
      /(?:npm|pnpm) (?:install|exec)|node (?!scripts\/reg-suit-publish-bundle\.mjs)/u,
    );
    for (const assignment of [
      "VISUAL_PUBLISH_BUNDLE: ${{ runner.temp }}/reg-suit-publish-bundle",
      "REG_ACTUAL_KEY: ${{ needs.prepare.outputs.actual_key }}",
      "REG_SUIT_S3_BUCKET_NAME: ${{ secrets.REG_SUIT_S3_BUCKET_NAME }}",
      "REG_SUIT_AWS_REGION: ${{ needs.prepare.outputs.region }}",
      "PR_NUMBER: ${{ github.event.pull_request.number }}",
      "SNAPSHOT_VERSION: ${{ needs.prepare.outputs.snapshot_version }}",
    ]) {
      expect(PUBLISH).toContain(assignment);
    }
  });

  it("keeps comparison and bundle construction in the unprivileged prepare job", () => {
    const prepare = WORKFLOW.slice(
      WORKFLOW.indexOf("\n  prepare:\n"),
      WORKFLOW.indexOf("\n  publish:\n"),
    );
    expect(prepare).toContain("permissions:\n      contents: read");
    expect(prepare).not.toContain("id-token:");
    expect(prepare).toContain("run: pnpm visual:compare");
    expect(prepare).toContain("node scripts/visual-build-publish-bundle.mjs");
    expect(CI_WORKFLOW).toContain(
      "key: reg-baseline-${{ github.sha }}-${{ needs.visual-publish.outputs.snapshot_version }}",
    );
  });
});
