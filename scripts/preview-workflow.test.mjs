import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(".github/workflows/preview.yml", "utf8");
const deploy = workflow.slice(workflow.indexOf("  deploy:"));

describe("the preview credential boundary", () => {
  it("uses the trusted base workflow for pull request events", () => {
    expect(workflow).toContain("  pull_request_target:");
    expect(workflow).not.toMatch(/^ {2}pull_request:/m);
    expect(workflow).toContain("github.event_name == 'pull_request_target'");
    expect(workflow).toContain('if [ "$repo" != "$GITHUB_REPOSITORY" ]');
  });

  it("installs a pinned CLI in isolation before checking out the PR", () => {
    const install = deploy.indexOf("npm install");
    const checkout = deploy.indexOf("uses: actions/checkout@");
    expect(install).toBeGreaterThan(0);
    expect(checkout).toBeGreaterThan(install);
    expect(deploy).toContain("--ignore-scripts");
    expect(deploy).toContain("--registry=https://registry.npmjs.org/");
    expect(deploy).toContain("persist-credentials: false");
    expect(deploy).not.toContain("./.github/actions/setup");
    expect(deploy).not.toContain("pnpm dlx");
    expect(deploy).toContain("$RUNNER_TEMP/preview-cli/node_modules/.bin/vercel");
  });

  it("refuses executable project configuration before exposing the token", () => {
    const guard = deploy.indexOf("Refuse executable Vercel configuration");
    const token = deploy.indexOf("VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}");
    expect(guard).toBeGreaterThan(0);
    expect(token).toBeGreaterThan(guard);
    for (const extension of ["ts", "mts", "js", "mjs", "cjs"]) {
      expect(deploy).toContain(`vercel.${extension}`);
    }
  });
});
