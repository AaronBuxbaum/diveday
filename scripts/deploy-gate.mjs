#!/usr/bin/env node
/**
 * The production deploy gate: once it is on, a push to `main` no longer builds
 * production; a commit deploys after its CI on `main` finished green (H-20261021-deploy-gate-from-first).
 *
 * **What it stops, and what it does not.** It stops push-triggered production
 * builds, and with them a red commit's migration. It is not an access control:
 * `DEPLOY_GATE_SHA` is a marker, not a credential, and the uploaded tree brings
 * its own `vercel-build.mjs`, so anyone holding a Vercel token that can deploy
 * the project can still deploy production. Keep that token to the
 * production-deploy environment (manual action `production-deploy-gate`).
 *
 * **Why.** `scripts/vercel-build.mjs` runs `pnpm db:migrate` against the
 * production database inside the build, and Vercel builds every push to `main`
 * the moment it lands, twenty minutes before CI has an answer. A commit CI
 * would have stopped still runs its migration. Six of 23 main pushes on
 * 2026-10-21..23 ended red.
 *
 * **The mechanism, and why this one.** Vercel's Git integration cannot wait
 * for a GitHub check before it builds, and its own "deployment checks" hold
 * back the *alias*, not the build, so the migration would already have run.
 * The gate therefore has two halves:
 *
 * 1. Vercel's push-triggered production build cancels itself in the Ignored
 *    Build Step (`scripts/vercel-ignore-build.mjs`) and, should that step be
 *    bypassed (a dashboard "Redeploy"), refuses in `scripts/vercel-build.mjs`
 *    before `db:migrate` runs. Both ask {@link gitDeployRefusal}.
 * 2. `.github/workflows/deploy-gate.yml` waits for CI on `main` to complete
 *    green and deploys that exact commit with the Vercel CLI, passing
 *    `DEPLOY_GATE_SHA` as a build variable, which is what the first half lets
 *    through. {@link decideDeploy} is its decision.
 *
 * **Off by default, and off means today.** Vercel cannot read a GitHub
 * variable, so the switch is one name set in two places: the GitHub repository
 * variable `DEPLOY_REQUIRES_GREEN` (the workflow) and the Vercel project's
 * Production environment variable of the same name (the cancel). Unset in
 * both, every push to `main` deploys as before and the workflow does nothing.
 * The workflow refuses to deploy while Vercel's half is missing, so a
 * half-turned-on gate is red, not quietly bypassed. Turning it on and off:
 * docs/engineering/deploy-and-migrations-runbook.md, "The deploy gate".
 *
 *   node scripts/deploy-gate.mjs check
 *     exit 1 naming the reason when this build must not run (vercel-build.mjs)
 *   node scripts/deploy-gate.mjs decide --sha <sha> --trigger <event>
 *       --runs-for-sha <file> --recent-runs <file> --compare <status> [--github-output]
 *     prints `deploy=true|false` and a reason (deploy-gate.yml)
 *
 * Plain Node and nothing from node_modules: the workflow's resolve job runs it
 * on a checkout with no install.
 */
import { appendFileSync, readFileSync } from "node:fs";
import process from "node:process";

/** The switch, by the same name in GitHub's repository variables and in Vercel's env. */
export const GATE_SWITCH = "DEPLOY_REQUIRES_GREEN";
/** The build variable the workflow's deploy carries: the commit it proved green. */
export const GATE_SHA = "DEPLOY_GATE_SHA";
/** The CI run events on `main` that test a commit `main` holds. The nightly `schedule` runs one job. */
export const MAIN_CI_EVENTS = new Set(["push", "workflow_dispatch"]);

const SHA = /^[0-9a-f]{40}$/;

/**
 * Should this Vercel build stop before it migrates anything? `null` lets it
 * run. Only a production build with the switch on is ever refused, and then
 * only when it was not started by the gate workflow for this very commit.
 */
export function gitDeployRefusal(env) {
  if (env.VERCEL_ENV !== "production") return null;
  if (env[GATE_SWITCH] !== "true") return null;
  const approved = env[GATE_SHA] ?? "";
  if (approved === "") {
    return `The deploy gate is on (${GATE_SWITCH}=true): a push-triggered production build does not run; .github/workflows/deploy-gate.yml deploys a commit after its CI on main is green. This push-triggered build stops here, before any migration; the workflow deploys the commit once CI passes.`;
  }
  if (!SHA.test(approved)) {
    return `${GATE_SHA} is "${approved}", not a 40-character commit sha. Refusing rather than guessing which commit was proved green.`;
  }
  const commit = env.VERCEL_GIT_COMMIT_SHA ?? "";
  if (commit !== "" && commit !== approved) {
    return `${GATE_SHA} names ${approved}, but this build is ${commit}. The gate proved a different commit green; refusing.`;
  }
  return null;
}

/** The newest commit whose CI on `main` completed green, from a newest-first run list. */
export function newestGreenSha(runs) {
  const run = runs.find(
    (candidate) =>
      candidate.head_branch === "main" &&
      MAIN_CI_EVENTS.has(candidate.event) &&
      candidate.conclusion === "success",
  );
  return run?.head_sha ?? null;
}

/**
 * The workflow's decision. `compare` is GitHub's compare status of
 * `<sha>...main`: `ahead` or `identical` means `main` contains the commit.
 * A `workflow_run` deploys only the newest green commit, so an older run
 * finishing late never rolls production back; a `workflow_dispatch` may name
 * any green commit on main, which is how a human redeploys or rolls back.
 *
 * @returns {{ deploy: boolean, reason: string }}
 */
export function decideDeploy({ sha, trigger, runsForSha, recentRuns, compare }) {
  if (!SHA.test(sha ?? "")) return { deploy: false, reason: `"${sha}" is not a commit sha.` };
  if (compare !== "ahead" && compare !== "identical") {
    return { deploy: false, reason: `${sha} is not on main (compare: ${compare}).` };
  }
  const green = runsForSha.some(
    (run) =>
      run.head_sha === sha &&
      run.head_branch === "main" &&
      MAIN_CI_EVENTS.has(run.event) &&
      run.conclusion === "success",
  );
  if (!green) {
    return { deploy: false, reason: `${sha} has no green CI run on main. Nothing deploys it.` };
  }
  if (trigger === "workflow_run") {
    const newest = newestGreenSha(recentRuns);
    if (newest && newest !== sha) {
      return {
        deploy: false,
        reason: `${newest} is a newer green commit on main; its own run deploys it, so ${sha} would only roll production back.`,
      };
    }
  }
  return { deploy: true, reason: `${sha} is green on main. Deploying it to production.` };
}

function parseArgs(argv) {
  const args = { githubOutput: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--github-output") args.githubOutput = true;
    else if (flag === "--sha") args.sha = argv[++i];
    else if (flag === "--trigger") args.trigger = argv[++i];
    else if (flag === "--runs-for-sha") args.runsForSha = argv[++i];
    else if (flag === "--recent-runs") args.recentRuns = argv[++i];
    else if (flag === "--compare") args.compare = argv[++i];
    else throw new Error(`deploy-gate: unknown argument ${flag}`);
  }
  return args;
}

const readRuns = (file) => JSON.parse(readFileSync(file, "utf8")).workflow_runs ?? [];

function main(argv) {
  const [command, ...rest] = argv;
  if (command === "check") {
    const refusal = gitDeployRefusal(process.env);
    if (refusal) {
      console.error(refusal);
      return 1;
    }
    return 0;
  }
  if (command === "decide") {
    const args = parseArgs(rest);
    const { deploy, reason } = decideDeploy({
      sha: args.sha,
      trigger: args.trigger,
      runsForSha: readRuns(args.runsForSha),
      recentRuns: readRuns(args.recentRuns),
      compare: args.compare,
    });
    console.log(reason);
    if (args.githubOutput && process.env.GITHUB_OUTPUT) {
      appendFileSync(process.env.GITHUB_OUTPUT, `deploy=${deploy}\n`);
    }
    return 0;
  }
  throw new Error("deploy-gate: the command is `check` or `decide`.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
