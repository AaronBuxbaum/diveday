import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CI = readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");
const REGCONFIG = JSON.parse(readFileSync(path.join(ROOT, "regconfig.json"), "utf8"));

function job(id) {
  const header = `\n  ${id}:\n`;
  const start = CI.indexOf(header);
  if (start < 0) throw new Error(`missing CI job ${id}`);
  return CI.slice(start + header.length).split(/\n {2}[a-z0-9-]+:\n/u)[0];
}

describe("reg-suit consumer workflow", () => {
  it("preserves selective capture planning for the trusted publisher", () => {
    const planner = job("visual-plan");
    expect(planner).toContain(
      "scripts/visual-affected.mjs --list visual-list.full.json --out visual-list.json --all --github-output",
    );
    expect(planner).toContain("--light-only");
    expect(planner).toContain("--base");
    expect(planner).toContain("--all --github-output");
    expect(planner).toContain("node scripts/reg-suit-keys.mjs --github-env");
    expect(planner).toContain("node scripts/wait-for-baseline.mjs");
    expect(planner).toContain("FRESH_START: ${{ steps.baseline.outputs.fresh_start }}");
    expect(planner).toContain('[ "${FRESH_START}" = "true" ]');
    expect(CI).toContain("shard: ${{ fromJSON(needs.visual-plan.outputs.shards) }}");
  });

  it("uploads screenshots and capture intents to the trusted publisher", () => {
    const visual = job("visual");
    expect(visual).toMatch(
      /^[ \t]+path: \|\n[ \t]+e2e\/screenshots\/\*\.png\n[ \t]+e2e\/capture-manifest\/\*\.json\n[ \t]+if-no-files-found: error$/mu,
    );
    expect(visual).not.toMatch(/^\s+path: e2e\/screenshots\/$/mu);
  });

  it("calls the pinned publisher with OIDC only", () => {
    const publisher = job("visual-publish");
    expect(publisher).toContain("      id-token: write");
    expect(publisher).not.toContain("pull-requests: write");
    expect(publisher).toMatch(
      /uses: AaronBuxbaum\/diveday\/.github\/workflows\/reg-suit-publish\.yml@[0-9a-f]{40}/u,
    );
    expect(publisher).not.toContain("reg-suit-publish.yml@refs/heads/main");
    expect(publisher).toContain(
      "uses: AaronBuxbaum/diveday/.github/workflows/reg-suit-publish.yml@42926746edc13b5e04ab7be76b172107ab5ca30e # immutable commit 42926746edc13b5e04ab7be76b172107ab5ca30e",
    );
    expect(publisher).not.toContain("steps:");
    expect(publisher).toContain("capture-mode: ${{ needs.visual-plan.outputs.mode }}");
    expect(publisher).toContain("capture-shards: ${{ needs.visual-plan.outputs.shards }}");
    expect(publisher).toContain(
      "github.event.pull_request.head.repo.full_name == github.repository",
    );
  });

  it("keeps comment permission in a separate job without an ID token", () => {
    const report = job("visual-report");
    expect(report).toContain("      pull-requests: write");
    expect(report).not.toContain("id-token: write");
    expect(report).toContain("needs: [visual-publish, visual, changes, visual-plan]");
    expect(report).toContain(
      "ref: ${{ github.event_name == 'pull_request' && 'refs/heads/main' || github.sha }}",
    );
    expect(report).toMatch(/pattern: visual-screenshots-\*\n[ \t]+path: e2e\n/u);
    expect(report).toContain("cp -R e2e/screenshots .reg-baseline");
    expect(report).toContain(
      "key: reg-baseline-v2-${{ github.sha }}-${{ needs.visual-publish.outputs.snapshot_version }}",
    );
    expect(report).not.toContain("id-token: write");
  });

  it("passes only the bucket secret to the reusable publisher", () => {
    const publisher = job("visual-publish");
    expect(publisher).toContain("REG_SUIT_S3_BUCKET_NAME: ${{ secrets.REG_SUIT_S3_BUCKET_NAME }}");
    expect(publisher).not.toContain("REG_SUIT_AWS_REGION");
    expect(publisher).not.toContain("REG_SUIT_AWS_ACCESS_KEY_ID");
    expect(publisher).not.toContain("REG_SUIT_AWS_SECRET_ACCESS_KEY");
  });

  it("passes fork context to the required-job verdict", () => {
    expect(job("ci-result")).toContain(
      "PR_IS_FORK: ${{ github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name != github.repository }}",
    );
  });

  it("removes credentials and the notifier from the default reg-suit config", () => {
    expect(JSON.stringify(REGCONFIG)).not.toMatch(
      /credentials|accessKeyId|secretAccessKey|reg-notify-github-plugin|clientId/iu,
    );
  });
});
