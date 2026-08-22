// Bounded subprocess calls for scripts/.
//
// Every synchronous `spawnSync`/`execFileSync` in this directory goes through
// one of the two wrappers below, because an unbounded one is how `pnpm check`
// was found hanging permanently on a cloud runner (2026-08-14): a wedged
// grandchild produces no output, no exit and no diagnosis, which is
// indistinguishable from slow work. `scripts/check-repo.mjs` fixed its own
// entry point with a detached process group and a SIGKILL to the whole group;
// the calls here are *synchronous*, so they cannot do that -- libuv owns the
// wait -- and they use Node's own `timeout` option instead, which kills the
// direct child. That is enough for every call site in this repo: each one is
// either a leaf binary (`git`, `aws`, `gh`, `cdk`) or a wrapper whose orphaned
// grandchild is harmless (`pnpm exec vercel` finishes one HTTP call; a `next
// build` on a Vercel builder dies with the container). The property that
// matters is that the *script* stops waiting.
//
// `killSignal` is SIGKILL rather than Node's default SIGTERM, deliberately and
// everywhere: a process that has wedged is exactly the kind that ignores a
// polite signal, and a bound that a hung child can decline is not a bound.
//
// Nothing here logs the command's environment, its stdin, or its output. Half
// these calls carry live AWS credentials in `env`, one writes a secret to the
// child's stdin, and the call sites carry comments explaining the CodeQL
// clear-text-logging findings that shaped them. A timeout message names the
// binary and the argv -- which the caller already chose to make visible in `ps`
// -- the elapsed bound, and nothing else.

import { execFileSync, spawnSync } from "node:child_process";

/**
 * The conventional shell exit code for "killed by a timeout" (`timeout(1)`).
 * `spawnSync` reports a killed child as `status: null`, which every caller here
 * turns into a bare `1` and loses; this keeps a timeout distinguishable from an
 * ordinary failure in an exit code someone reads off a CI log.
 */
export const TIMEOUT_EXIT_CODE = 124;

/**
 * The ceiling for each kind of call, in one table so the judgment behind each
 * one is written down rather than repeated as a magic number at a call site.
 *
 * These are backstops against a wedge, not budgets. A ceiling that fires on a
 * legitimately slow run is worse than no ceiling at all -- killing a live `cdk
 * deploy` abandons the operator mid-CloudFormation without rolling anything
 * back -- so each is set generously past the slowest honest run of that call
 * and no tighter.
 */
export const SUBPROCESS_TIMEOUTS = {
  /** One local `git` read (`rev-parse`, `log`, `blame`, `archive`). No network. */
  git: 60_000,
  /**
   * One `ps` read of the whole process table. Purely local and normally a few
   * milliseconds; the ceiling is here because the one caller
   * (`stray-processes.mjs`) runs as a `Stop` hook on every turn, and a hook
   * that can hang is the exact failure it was written to report.
   */
  processTable: 10_000,
  /** One AWS CLI API call: `sts`, `ssm`, `secretsmanager`, `s3control`. */
  awsApi: 60_000,
  /**
   * `aws login` -- a browser round trip a human has to click through, so this
   * is minutes rather than the seconds the rest of the AWS calls get. It is
   * also the single most likely call in this repo to wedge: `interactive` is
   * derived from the absence of `CI`, so an agent session on a cloud runner
   * reaches it and then waits for a browser nobody will ever open.
   */
  awsLogin: 300_000,
  /** `cdk synth` / `cdk diff` -- a local TypeScript compile and template render. */
  cdkSynth: 900_000,
  /**
   * `cdk deploy` / `cdk bootstrap`. This stack creates no CloudFront
   * distribution, so a real deploy is minutes; the ceiling is three quarters of
   * an hour anyway, because the cost of cutting a real deploy off is far higher
   * than the cost of noticing a hang 45 minutes late instead of 15.
   */
  cdkDeploy: 2_700_000,
  /** One `vercel env` call. */
  vercelCli: 120_000,
  /** One `gh` call. */
  ghCli: 120_000,
  /** A sibling script in this repo that only reads and writes files. */
  nodeScript: 120_000,
  /**
   * A sibling script the post-deploy wizard hands a whole step to, each of
   * which makes its own series of *already bounded* network calls -- pushing
   * twenty Vercel variables at `vercelCli` apiece, or a `gh` round trip per
   * repository variable. This has to sit comfortably above the sum of those,
   * or the parent kills a child that is making honest progress.
   */
  wizardStep: 900_000,
  /**
   * One `drizzle-kit check` -- a read of the committed `drizzle/` folder with
   * no database connection anywhere in it, and under a second in practice.
   * The ceiling is a minute because the caller
   * (`scripts/check-migration-graph.mjs`) runs inside `check:repo`, whose own
   * per-check bound is 90s: a wedge here has to report itself as a named
   * command rather than as the parent's anonymous timeout.
   */
  drizzleKitCheck: 60_000,
  /** `pnpm db:migrate` inside the production build, while the previous release still serves. */
  migrate: 300_000,
  /**
   * `pnpm build`. Matches Vercel's own 45-minute build ceiling: this exists so
   * the rule has no exception, not because it is expected to fire first.
   */
  build: 2_700_000,
};

/** Whether a `spawnSync` result or a caught `execFileSync` error is a timeout kill. */
export function isTimeout(errorOrResult) {
  if (!errorOrResult) return false;
  const error = errorOrResult instanceof Error ? errorOrResult : errorOrResult.error;
  return error?.code === "ETIMEDOUT";
}

function timeoutMessage(command, args, timeoutMs) {
  const argv = [command, ...(args ?? [])].join(" ");
  return `\`${argv}\` did not finish within ${timeoutMs / 1000}s and was killed. Nothing here waits on it any longer; rerun that command yourself to see what it is blocked on.`;
}

function requireBound(timeoutMs, caller) {
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(
      `${caller} needs a timeoutMs. Pick one from SUBPROCESS_TIMEOUTS in scripts/subprocess.mjs, or add a new entry there with the reasoning for its ceiling.`,
    );
  }
}

/**
 * `spawnSync` with a required bound. Returns the ordinary `spawnSync` result,
 * so an existing `if (result.status !== 0)` keeps working; a timeout reports
 * itself on stderr and comes back as {@link TIMEOUT_EXIT_CODE} with a `result.error`
 * that says which command wedged rather than Node's bare `spawnSync git ETIMEDOUT`.
 */
export function runBounded(command, args, { timeoutMs, ...options } = {}) {
  requireBound(timeoutMs, "runBounded");
  const result = spawnSync(command, args, {
    killSignal: "SIGKILL",
    ...options,
    timeout: timeoutMs,
  });
  if (!isTimeout(result)) return result;
  const message = timeoutMessage(command, args, timeoutMs);
  console.error(message);
  return {
    ...result,
    status: TIMEOUT_EXIT_CODE,
    error: Object.assign(new Error(message), { code: "ETIMEDOUT" }),
  };
}

/**
 * `execFileSync` with a required bound. Returns its stdout unchanged; a timeout
 * throws an `ETIMEDOUT` error naming the command, and any other failure rethrows
 * the original error untouched so a caller reading `error.stderr` (the
 * `ParameterNotFound` case in import-vercel-env.mjs) still sees it.
 */
export function readBounded(command, args, { timeoutMs, ...options } = {}) {
  requireBound(timeoutMs, "readBounded");
  try {
    return execFileSync(command, args, {
      killSignal: "SIGKILL",
      ...options,
      timeout: timeoutMs,
    });
  } catch (error) {
    if (!isTimeout(error)) throw error;
    // A fresh error rather than the original: Node's message is `spawnSync aws
    // ETIMEDOUT`, which names neither the subcommand that wedged nor the bound
    // it blew. `stdout`/`stderr` are carried across because callers read them.
    throw Object.assign(new Error(timeoutMessage(command, args, timeoutMs)), {
      code: "ETIMEDOUT",
      stdout: error.stdout,
      stderr: error.stderr,
    });
  }
}
