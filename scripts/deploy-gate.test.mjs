import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  decideDeploy,
  GATE_SHA,
  GATE_SWITCH,
  gitDeployRefusal,
  newestGreenSha,
} from "./deploy-gate.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(ROOT, file), "utf8");

const OLD = "a".repeat(40);
const NEW = "b".repeat(40);

const run = (sha, overrides = {}) => ({
  head_sha: sha,
  head_branch: "main",
  event: "push",
  conclusion: "success",
  ...overrides,
});

describe("gitDeployRefusal", () => {
  const production = { VERCEL_ENV: "production", [GATE_SWITCH]: "true" };

  it("leaves every build alone while the switch is unset, which is today's behavior", () => {
    expect(gitDeployRefusal({ VERCEL_ENV: "production" })).toBeNull();
    expect(gitDeployRefusal({ VERCEL_ENV: "production", [GATE_SWITCH]: "false" })).toBeNull();
    expect(gitDeployRefusal({ VERCEL_ENV: "production", [GATE_SWITCH]: "TRUE" })).toBeNull();
  });

  it("never touches a preview or a local build, switch or not", () => {
    expect(gitDeployRefusal({ VERCEL_ENV: "preview", [GATE_SWITCH]: "true" })).toBeNull();
    expect(gitDeployRefusal({ [GATE_SWITCH]: "true" })).toBeNull();
  });

  it("refuses a push-triggered production build once the switch is on", () => {
    const refusal = gitDeployRefusal({ ...production, VERCEL_GIT_COMMIT_SHA: NEW });
    expect(refusal).toContain("deploy-gate.yml");
    expect(refusal).toContain("before any migration");
  });

  it("lets through the workflow's deploy of the commit it proved green", () => {
    expect(gitDeployRefusal({ ...production, [GATE_SHA]: NEW })).toBeNull();
    expect(
      gitDeployRefusal({ ...production, [GATE_SHA]: NEW, VERCEL_GIT_COMMIT_SHA: NEW }),
    ).toBeNull();
  });

  it("refuses an approval that names a different commit than the one building", () => {
    expect(
      gitDeployRefusal({ ...production, [GATE_SHA]: OLD, VERCEL_GIT_COMMIT_SHA: NEW }),
    ).toContain("different commit");
  });

  it("refuses an approval that is not a sha, rather than guessing", () => {
    expect(gitDeployRefusal({ ...production, [GATE_SHA]: "main" })).toContain("not a 40-character");
    expect(gitDeployRefusal({ ...production, [GATE_SHA]: "true" })).toContain("not a 40-character");
  });
});

describe("newestGreenSha", () => {
  it("takes the first green main run that tested a commit main holds", () => {
    expect(
      newestGreenSha([
        run(NEW, { conclusion: "failure" }),
        run(NEW, { event: "schedule" }),
        run(NEW, { event: "pull_request", head_branch: "feature" }),
        run(OLD),
      ]),
    ).toBe(OLD);
  });

  it("counts a dispatched run of main, which is how a bot-pushed commit gets CI", () => {
    expect(newestGreenSha([run(NEW, { event: "workflow_dispatch" }), run(OLD)])).toBe(NEW);
  });

  it("answers null when nothing is green", () => {
    expect(newestGreenSha([run(NEW, { conclusion: "failure" })])).toBeNull();
  });
});

describe("decideDeploy", () => {
  const base = {
    sha: NEW,
    trigger: "workflow_run",
    runsForSha: [run(NEW)],
    recentRuns: [run(NEW), run(OLD)],
    compare: "identical",
  };

  it("deploys the newest green commit on main", () => {
    expect(decideDeploy(base).deploy).toBe(true);
    expect(decideDeploy({ ...base, compare: "ahead" }).deploy).toBe(true);
  });

  it("never deploys a red commit", () => {
    const decision = decideDeploy({
      ...base,
      runsForSha: [run(NEW, { conclusion: "failure" })],
    });
    expect(decision).toEqual({ deploy: false, reason: expect.stringContaining("no green CI") });
  });

  it("does not count a green pull request run of the same commit", () => {
    expect(
      decideDeploy({
        ...base,
        runsForSha: [run(NEW, { event: "pull_request", head_branch: "claude/x" })],
      }).deploy,
    ).toBe(false);
  });

  it("refuses a commit main does not contain", () => {
    for (const compare of ["behind", "diverged", "", undefined]) {
      expect(decideDeploy({ ...base, compare }).deploy).toBe(false);
    }
  });

  it("refuses something that is not a sha", () => {
    expect(decideDeploy({ ...base, sha: "main" }).deploy).toBe(false);
  });

  it("does not roll production back when an older run finishes after a newer one", () => {
    const decision = decideDeploy({
      ...base,
      sha: OLD,
      runsForSha: [run(OLD)],
      recentRuns: [run(NEW), run(OLD)],
      compare: "ahead",
    });
    expect(decision.deploy).toBe(false);
    expect(decision.reason).toContain("roll production back");
  });

  it("lets a human dispatch any green commit on main, which is a redeploy or a rollback", () => {
    expect(
      decideDeploy({
        ...base,
        trigger: "workflow_dispatch",
        sha: OLD,
        runsForSha: [run(OLD)],
        compare: "ahead",
      }).deploy,
    ).toBe(true);
  });
});

describe("wiring", () => {
  it("both Vercel steps ask the gate before anything migrates", () => {
    expect(read("scripts/vercel-ignore-build.mjs")).toContain("gitDeployRefusal(process.env)");
    const build = read("scripts/vercel-build.mjs");
    const check = build.indexOf('"scripts/deploy-gate.mjs", "check"');
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(build.indexOf('"db:migrate"'));
  });

  it("the workflow reads the same switch, passes the same build variable, and checks Vercel's half", () => {
    const workflow = read(".github/workflows/deploy-gate.yml");
    expect(workflow).toContain(`vars.${GATE_SWITCH} == 'true'`);
    expect(workflow).toContain(`--build-env ${GATE_SHA}=`);
    expect(workflow).toContain(`"${GATE_SWITCH}"`);
  });

  it("a dispatch from any ref but main is refused before anything holds a token", () => {
    const workflow = read(".github/workflows/deploy-gate.yml");
    const resolve = workflow.slice(workflow.indexOf("  resolve:"), workflow.indexOf("  deploy:"));
    expect(resolve).toContain("github.ref == 'refs/heads/main'");
  });

  it("the job holding the Vercel token installs nothing and keeps no git credential", () => {
    const workflow = read(".github/workflows/deploy-gate.yml");
    expect(workflow).not.toContain("./.github/actions/setup");
    expect(workflow).not.toMatch(/pnpm install|--token/);
    const checkouts = workflow.match(/uses: actions\/checkout@/g) ?? [];
    const unpersisted = workflow.match(/persist-credentials: false/g) ?? [];
    expect(checkouts.length).toBeGreaterThan(0);
    expect(unpersisted).toHaveLength(checkouts.length);
  });
});
