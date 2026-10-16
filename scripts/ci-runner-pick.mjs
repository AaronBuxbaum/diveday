import { appendFile } from "node:fs/promises";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { RUNNER_IMAGE } from "./check-runner-image.mjs";

/**
 * Chooses where CI's non-browser jobs run: Aaron's Mac when one of its runners
 * is online, the pinned GitHub-hosted image (`RUNNER_IMAGE`) otherwise. Runs as a step of the
 * `changes` job in `.github/workflows/ci.yml`; every job that reads its answer
 * says `runs-on: ${{ fromJSON(needs.changes.outputs.runner) }}`.
 *
 * Why: the account's plan runs 40 GitHub-hosted jobs at once, and a stack of
 * pull requests asks for far more, so jobs waited a median 6.5 minutes for a
 * runner (2026-10-12; docs/engineering/mac-ci-runner-runbook.md). Every job the
 * Mac takes is a slot handed back to the Playwright and visual shards, which
 * stay on GitHub because their screenshots are compared against
 * GitHub-rendered baselines.
 *
 * It fails toward GitHub, always. No token, an API error, a fork, a kill
 * switch, or no runner online all answer the GitHub image, because the cost of
 * a wrong "GitHub" is some queue time and the cost of a wrong "Mac" is a job
 * that waits for a machine that is asleep.
 */

export const MAC_LABEL = "diveday-mac";
export const GITHUB_HOSTED = RUNNER_IMAGE;

/**
 * Whether this run may use the Mac at all. Only code that is already in this
 * repository: a push to main, or a pull request whose head branch lives here.
 * A fork's pull request never does, so a stranger's code never runs on the
 * machine (fork runs also get no secrets, so the token check would refuse it
 * too; this says it out loud).
 */
export function eligible({ eventName, repository, headRepository, ref }) {
  if (eventName === "push") return ref === "refs/heads/main";
  if (eventName === "pull_request") return Boolean(headRepository) && headRepository === repository;
  return false;
}

/** The `runs-on` value, as JSON, for a set of registered runners. */
export function pickRunner({ allowed, disabled, runners }) {
  if (!allowed || disabled) return JSON.stringify(GITHUB_HOSTED);
  const online = (runners ?? []).filter(
    (runner) =>
      runner.status === "online" && runner.labels?.some((label) => label.name === MAC_LABEL),
  );
  return JSON.stringify(online.length > 0 ? ["self-hosted", MAC_LABEL] : GITHUB_HOSTED);
}

async function listRunners(repository, token) {
  const response = await fetch(
    `https://api.github.com/repos/${repository}/actions/runners?per_page=100`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) throw new Error(`GitHub answered ${response.status} listing runners`);
  return (await response.json()).runners;
}

async function main() {
  const env = process.env;
  const allowed = eligible({
    eventName: env.EVENT_NAME,
    repository: env.REPOSITORY,
    headRepository: env.HEAD_REPOSITORY,
    ref: env.REF,
  });
  const disabled = env.MAC_RUNNER === "off";
  let runners = [];
  let note = "";
  if (allowed && !disabled) {
    if (!env.RUNNER_STATUS_TOKEN) {
      note = "No CI_RUNNER_STATUS_TOKEN secret, so the Mac is never asked.";
    } else {
      try {
        runners = await listRunners(env.REPOSITORY, env.RUNNER_STATUS_TOKEN);
      } catch (error) {
        note = `Could not list runners (${error.message}).`;
      }
    }
  }
  const runner = pickRunner({ allowed, disabled, runners });
  const where = runner === JSON.stringify(GITHUB_HOSTED) ? "GitHub-hosted runners" : "the Mac";
  const why = !allowed
    ? "This run is not eligible for the Mac."
    : disabled
      ? "MAC_RUNNER is off."
      : note;
  console.log(`Non-browser jobs run on ${where}. ${why}`.trim());
  if (env.GITHUB_OUTPUT) await appendFile(env.GITHUB_OUTPUT, `runner=${runner}\n`);
  if (env.GITHUB_STEP_SUMMARY) {
    await appendFile(
      env.GITHUB_STEP_SUMMARY,
      `Lint, typecheck, safeguards and unit tests run on ${where}. ${why}\n`,
    );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
