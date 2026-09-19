/**
 * Cancels the CI runs of a stack's middle layers, the moment they become middle
 * layers.
 *
 * `.github/workflows/ci.yml` already skips every job on a middle layer, read
 * straight off `github.event.pull_request.stack` in the event payload. That
 * answers the question at *dispatch*, and a stack's layers do not become middle
 * layers at dispatch. They become middle layers later, when somebody opens a
 * pull request above them:
 *
 *   1. A session opens layer B. B is the top of a two-layer stack, so its run
 *      is the full gate — the right answer at the time.
 *   2. Ninety seconds later the same session opens layer C on top of B.
 *   3. B is a middle layer now, and its sixteen jobs are still running. No
 *      `if:` can reach back into a run that has already started.
 *
 * That is the shape the "stack by default" rule in AGENTS.md produces on every
 * multi-layer scope, and it is the half of Graphite's behaviour skipping alone
 * does not buy. `.github/workflows/stack.yml` registers the chain on the same
 * event that creates the problem, so it is also the natural place to fix it:
 * this runs straight after the registration, off the same walk of the chain.
 *
 * **Whole runs, because GitHub cancels nothing smaller.** The REST API has
 * `POST /actions/runs/{id}/cancel` and no per-job equivalent — the workflow-jobs
 * endpoints are all reads. Cancelling the whole run used to be unthinkable
 * here: a stacked layer's reg-suit baseline was the head commit of the layer
 * below, so killing a middle layer's run killed the snapshot the layer above
 * was keyed to, and the layer above would poll S3 for twenty minutes and then
 * report every surface as new under a reassuring `Changed: 0`. Every layer is
 * keyed to the stack's fork point from the default branch now
 * (`scripts/reg-suit-keys.mjs`), which the default branch's own run published
 * long ago, so a middle layer's run is owed to nobody and cancelling it costs
 * nothing (ADR 20260919-stack-ci-cancels-superseded-layers).
 *
 * Three rails, because this is the one part of the stack machinery that
 * destroys work rather than declining to do it:
 *
 *   1. **Only the middle.** Never the bottom, which is the layer next to merge,
 *      and never the top, which is what a session building upward is reading.
 *   2. **Only this repository's CI workflow, only on a layer's own head
 *      branch, and never on the default branch.** Three independent filters for
 *      one decision, because the failure they prevent — cancelling a push to
 *      `main`, whose `visual-report` publishes the snapshot every later run is
 *      keyed to — is the documented worst failure this pipeline has.
 *   3. **It is never the reason the workflow goes red.** A cancel that 409s
 *      because the run finished a second earlier is the ordinary case, not an
 *      error. Every path here returns a sentence and throws nothing.
 */

/** The only workflow whose runs this may cancel. */
export const CI_WORKFLOW = "ci.yml";

/**
 * A run in one of these has work left to stop. GitHub spells "not finished"
 * several ways and adds to the list over time, so the set is stated positively
 * rather than as "anything but completed" — an unfamiliar status is left alone.
 */
export const LIVE_STATUSES = new Set([
  "queued",
  "in_progress",
  "waiting",
  "pending",
  "requested",
  "action_required",
]);

/**
 * A ceiling on one invocation. Nothing legitimate cancels more than a handful
 * of runs: a chain is capped at a hundred layers and only the middle ones
 * qualify, each with at most a run or two alive. A number far above that means
 * the chain or the filters are wrong, and a bug that sweeps the repository's
 * runs is worse than a stack that keeps paying for one.
 */
export const MAX_CANCELLATIONS = 25;

/** How many runs one read asks for, and how many reads a layer may cost. */
export const RUNS_PER_PAGE = 100;
export const MAX_RUN_PAGES = 5;

/**
 * The layers of `chain` that are neither the bottom nor the top.
 *
 * `chain` is ordered bottom to top, so this is the plain middle of it. A chain
 * of two has no middle, which is why opening the second layer of a stack
 * cancels nothing.
 */
export function middleLayers(chain) {
  return chain.length < 3 ? [] : chain.slice(1, -1);
}

/**
 * The runs from `runs` this may cancel, given the branch they were asked for.
 *
 * Every rail in rule 2 above is applied here rather than trusted to the query
 * string, so a future caller that forgets a filter still cannot cancel a run on
 * the default branch or a run belonging to another workflow.
 */
export function cancellableRuns(runs, { headRef, defaultBranch }) {
  return (runs ?? []).filter(
    (run) =>
      run &&
      LIVE_STATUSES.has(run.status) &&
      run.head_branch === headRef &&
      run.head_branch !== defaultBranch &&
      typeof run.path === "string" &&
      run.path.endsWith(`/${CI_WORKFLOW}`),
  );
}

/**
 * Every live CI run on one layer's head branch, across as many pages as it
 * takes to be sure there are none left.
 *
 * A single page is not enough, even though in practice it always is. `ci.yml`
 * keeps one concurrency lane per ref with `cancel-in-progress: true`, so a
 * branch has at most an in-progress run and a queued one at any moment — but
 * that is a fact about a different file, and a function whose contract is
 * "every live run" must not quietly depend on it. Reading one page and calling
 * it done was this function's first version, and Sourcery was right to say so
 * on #1892.
 *
 * Two stopping rules, so the usual case still costs one request:
 *
 * - **A short page is the end of the runs.** The same idiom `openPulls` in
 *   `scripts/stack-register.mjs` uses. A pull request branch that has not run
 *   CI a hundred times stops here, which is nearly all of them.
 * - **A page with nothing live on it is the end of the live ones.** Runs come
 *   back newest first, and a run still going cannot be older than a hundred
 *   runs that have already finished on the same single-lane branch.
 *
 * `MAX_RUN_PAGES` bounds the rest. A branch that somehow has more live runs
 * than that is already past `MAX_CANCELLATIONS`, so the extra reads would buy
 * nothing the ceiling would let us act on.
 */
async function liveRunsFor(headRef, { repo, token, defaultBranch, call }) {
  const live = [];
  for (let page = 1; page <= MAX_RUN_PAGES; page += 1) {
    const body = await call(
      `/repos/${repo}/actions/workflows/${CI_WORKFLOW}/runs?branch=${encodeURIComponent(headRef)}&per_page=${RUNS_PER_PAGE}&page=${page}`,
      { token },
    );
    const batch = body?.workflow_runs ?? [];
    const found = cancellableRuns(batch, { headRef, defaultBranch });
    live.push(...found);
    if (found.length === 0 || batch.length < RUNS_PER_PAGE) break;
  }
  return live;
}

/**
 * Cancel every live CI run belonging to a middle layer of `chain`.
 *
 * Returns one sentence for the job log and the run summary, and never throws:
 * a stack that registered correctly must not be reported as a failure because
 * a cancellation raced the run finishing.
 *
 * @param call the same injected request function `scripts/stack-register.mjs` uses
 */
export async function cancelMiddleLayerRuns({ chain, repo, token, defaultBranch, call }) {
  const middle = middleLayers(chain);
  if (middle.length === 0) return "No middle layer to quiet.";

  const cancelled = [];
  const failed = [];

  for (const layer of middle) {
    const headRef = layer.head?.ref;
    if (!headRef) continue;
    let runs;
    try {
      runs = await liveRunsFor(headRef, { repo, token, defaultBranch, call });
    } catch (error) {
      failed.push(`#${layer.number} (could not be read: ${error.message})`);
      continue;
    }

    for (const run of runs) {
      if (cancelled.length >= MAX_CANCELLATIONS) {
        failed.push(`stopped at the ${MAX_CANCELLATIONS}-run ceiling`);
        break;
      }
      try {
        await call(`/repos/${repo}/actions/runs/${run.id}/cancel`, { token, method: "POST" });
        cancelled.push(`#${layer.number} (run ${run.id})`);
      } catch (error) {
        // The ordinary case: the run completed between the read and the write,
        // and GitHub answers 409. Nothing to do and nothing to report as wrong.
        failed.push(`#${layer.number} run ${run.id} (${error.message.slice(0, 120)})`);
      }
    }
  }

  const middleNames = middle.map((layer) => `#${layer.number}`).join(", ");
  if (cancelled.length === 0 && failed.length === 0) {
    return `Middle layers ${middleNames} had no CI run left to cancel.`;
  }
  const parts = [];
  if (cancelled.length > 0) {
    parts.push(`Cancelled superseded CI on ${cancelled.join(", ")}`);
  }
  if (failed.length > 0) {
    parts.push(`${cancelled.length > 0 ? "left alone" : "Left alone"}: ${failed.join("; ")}`);
  }
  return `${parts.join("; ")}.`;
}
