#!/usr/bin/env node
// Orders a stack's CI runs against each other: the bottom layer first, the top
// layer next, the middle layers last.
//
// Why. A stacked pull request is an ordered chain, and every layer pays the
// whole gate — lint, typecheck, four unit shards, a build, eight
// Playwright/visual shards — and pays it again above every cascading rebase
// (ADR 20260821-stacked-pull-requests). A five-layer stack therefore asks for
// eighty-odd concurrent jobs the moment it is pushed, and they all compete for
// the same runner pool. Nothing about that queue is ordered by what a human is
// actually waiting on:
//
//   - The **bottom** is the layer that merges next. Its red is the only red
//     that can block the whole stack, and until it is green nothing above it
//     can land.
//   - The **top** contains every layer beneath it, so its green is the closest
//     thing the stack has to a statement about the merged result.
//   - A **middle** layer is neither. It merges only as part of a group that a
//     lower or upper layer's run has already spoken for, and it is the layer
//     whose signal a reviewer reaches last.
//
// So a middle layer yields: it holds its expensive jobs until the bottom and
// the top have finished theirs, and the runners it would have taken go to the
// two layers somebody is reading. It is a *yield*, not a skip — every layer
// still runs the full gate, because a per-layer green is what branch protection
// evaluates at merge time and a layer that never ran cannot be merged on its
// own.
//
// **The visual path is deliberately not gated by this** — `.github/workflows/ci.yml`
// leaves `build`, `visual` and `visual-report` outside the `needs:` this script
// feeds. A stacked layer's reg-suit baseline is the head commit of the layer
// directly below it, and its `visual-report` polls S3 for that snapshot
// (`scripts/wait-for-baseline.mjs`). Gate the visual path on this and the top
// layer waits up to twenty minutes for a snapshot the middle layer beneath it
// is not allowed to publish until the top layer finishes — a deadlock whose
// visible form is the pipeline's worst failure, "compared nothing, reported
// everything as new". Keeping the captures ungated leaves that chain exactly as
// it is today.
//
// Three rules, in the order they matter, and they are the same three
// `scripts/wait-for-baseline.mjs` is written to:
//
//   1. **It is never the reason a run goes red, or a check goes missing.**
//      Every path exits 0. A 404 from the preview endpoint, a rate limit, an
//      unrecognised payload: say so, and let the gate open.
//   2. **It always ends.** A wait whose only exit is a success marker is the
//      nine-hour loop AGENTS.md was written around. `DEFAULT_DEADLINE_MS` is
//      the exit; the layers going green is the shortcut.
//   3. **Only a middle or top layer waits at all.** Anything this script cannot
//      confidently place in a stack is `solo`, which waits for nothing.
import { appendFileSync } from "node:fs";
import process from "node:process";

const API = "https://api.github.com";

/** A commit sha, as it goes into a query string. Anything else is a bug. */
const COMMIT_SHA = /^[0-9a-f]{40}$/;
/** `owner/name`, as it goes into a URL path. */
const REPO_SLUG = /^[\w.-]+\/[\w.-]+$/;

/** Pages of `GET /stacks` to read before giving up on finding this one. The
 *  list comes back newest first, so an open stack is on the first page. */
const MAX_STACK_PAGES = 3;
/** Whole-wait ceiling. The bottom's own longest path (build -> visual ->
 *  visual-report) is budgeted at 35 minutes, so this is "one full gate, near
 *  enough" rather than "both of them end to end" — past it the middle layer
 *  simply runs, which is today's behaviour. */
export const DEFAULT_DEADLINE_MS = 40 * 60_000;
export const DEFAULT_INTERVAL_MS = 30_000;
/** How long a layer with no CI run at all is given before it counts as clear.
 *  A layer whose branch was pushed a moment ago has no run yet; a layer that
 *  will never have one must not hold the gate open for the full deadline. */
export const DEFAULT_GRACE_MS = 5 * 60_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Where this pull request sits in `stack`, and which layers it yields to.
 *
 * Only *open* layers count. A merged or closed layer has already landed (or
 * been abandoned), so the bottom of a stack is the lowest layer still in
 * flight — which after a bottom-up merge is the layer GitHub has just
 * retargeted onto `main`, exactly the one that should now run first.
 *
 * `yieldTo` is the priority order stated as a dependency: bottom yields to
 * nothing, top yields to the bottom, middle yields to both ends.
 */
export function resolveStackPosition(stack, prNumber) {
  const layers = (stack?.pull_requests ?? []).filter(
    (pr) => pr && pr.state === "open" && !pr.merged_at && Number.isInteger(pr.number),
  );
  const index = layers.findIndex((pr) => pr.number === prNumber);
  // Not in it, or the only thing left in it: nothing to be ordered against.
  if (index === -1 || layers.length < 2) return { position: "solo", yieldTo: [] };

  const bottom = layers[0];
  const top = layers[layers.length - 1];
  if (index === 0) return { position: "bottom", yieldTo: [] };
  if (index === layers.length - 1) return { position: "top", yieldTo: [bottom] };
  return { position: "middle", yieldTo: [bottom, top] };
}

/** A layer's head sha, or null when the payload is not the shape we expect. */
export function headSha(layer) {
  const sha = layer?.head?.sha;
  return typeof sha === "string" && COMMIT_SHA.test(sha) ? sha : null;
}

/**
 * The stack containing `prNumber`, or null.
 *
 * There is no `GET /pulls/{n}/stack` (checked, 404) and `?state=open` is not
 * honoured, so this reads the repository's stacks newest-first and stops at the
 * one that names this pull request. Bounded by `MAX_STACK_PAGES` rather than
 * "until the pages run out": a repository accumulates closed stacks forever and
 * a gate that walks all of them is a slower gate every month.
 */
export async function findStack({ repo, prNumber, request, log = console.log }) {
  for (let page = 1; page <= MAX_STACK_PAGES; page++) {
    const stacks = await request(`/repos/${repo}/stacks?per_page=100&page=${page}`);
    if (!Array.isArray(stacks)) {
      log(
        `stack-ci-priority: /stacks answered with something that is not a list — treating as solo.`,
      );
      return null;
    }
    if (stacks.length === 0) return null;
    const found = stacks.find((stack) =>
      (stack?.pull_requests ?? []).some((pr) => pr?.number === prNumber),
    );
    if (found) return found;
  }
  log(
    `stack-ci-priority: #${prNumber} is on none of the first ${MAX_STACK_PAGES} pages of stacks — treating as solo.`,
  );
  return null;
}

/**
 * Whether a layer's CI has stopped competing for runners.
 *
 * "Stopped" is `status: completed`, whatever the conclusion — a red bottom
 * layer has finished asking for runners just as surely as a green one, and
 * holding the middle layer hostage to somebody else's fix is not the trade this
 * gate is making.
 *
 * A cancelled run counts too, which is what makes a cascading rebase safe here:
 * the old run is cancelled the moment the new head is pushed, so the wait ends
 * rather than blocking on a sha nobody will ever build again. The cost is that
 * the wait can end slightly early, which is the harmless direction — early
 * means "behaves like today".
 */
export async function layerIsClear({ repo, workflow, sha, request, elapsedMs, graceMs }) {
  const runs = await request(
    `/repos/${repo}/actions/workflows/${workflow}/runs?head_sha=${sha}&per_page=20`,
  );
  const list = Array.isArray(runs?.workflow_runs) ? runs.workflow_runs : [];
  if (list.length === 0) return elapsedMs >= graceMs;
  return list.every((run) => run?.status === "completed");
}

/**
 * Polls until every layer in `yieldTo` has finished its CI, or the deadline
 * passes. Resolves either way; it has no failing outcome.
 */
export async function waitForLayers({
  repo,
  workflow,
  yieldTo,
  request,
  deadlineMs = DEFAULT_DEADLINE_MS,
  intervalMs = DEFAULT_INTERVAL_MS,
  graceMs = DEFAULT_GRACE_MS,
  now = () => Date.now(),
  wait = sleep,
  log = console.log,
}) {
  const targets = yieldTo
    .map((layer) => ({ number: layer.number, sha: headSha(layer) }))
    .filter((target) => target.sha);
  if (targets.length === 0) return { ok: true, reason: "no layer to wait for" };

  const started = now();
  let pending = targets;

  for (;;) {
    const elapsedMs = now() - started;
    const stillPending = [];
    for (const target of pending) {
      const clear = await layerIsClear({
        repo,
        workflow,
        sha: target.sha,
        request,
        elapsedMs,
        graceMs,
      }).catch((error) => {
        // Rule 1: an API hiccup opens the gate for that layer rather than
        // holding it shut on no information.
        log(`stack-ci-priority: could not read #${target.number}'s runs (${error.message}).`);
        return true;
      });
      if (!clear) stillPending.push(target);
    }
    pending = stillPending;

    if (pending.length === 0) {
      return {
        ok: true,
        reason: `every layer ahead of this one finished after ${Math.round(elapsedMs / 60_000)} minute(s)`,
      };
    }
    if (elapsedMs + intervalMs >= deadlineMs) {
      return {
        ok: false,
        reason: `gave up after ${Math.round(deadlineMs / 60_000)} minutes with ${pending
          .map((target) => `#${target.number}`)
          .join(", ")} still running`,
      };
    }
    log(
      `stack-ci-priority: waiting on ${pending.map((t) => `#${t.number}`).join(", ")} ` +
        `(${Math.round(elapsedMs / 1000)}s elapsed).`,
    );
    await wait(intervalMs);
  }
}

/** The one door to the API: a bearer GET that throws on anything but a 200. */
export function githubRequest(token) {
  return async (path) => {
    const res = await fetch(`${API}${path}`, {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28",
      },
    });
    if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
    return res.json();
  };
}

/** `position=middle` on its own line, the way `$GITHUB_OUTPUT` wants it. */
export function outputLine(position) {
  return `position=${position}\n`;
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY ?? "";
  const workflow = process.env.CI_WORKFLOW_FILE || "ci.yml";
  const prNumber = Number(process.env.PR_NUMBER);
  const token = process.env.GH_TOKEN ?? "";
  const outputPath = process.env.GITHUB_OUTPUT;
  const deadlineMs = Number(process.env.STACK_WAIT_SECONDS || 0) * 1000 || DEFAULT_DEADLINE_MS;

  const emit = (position) => {
    if (outputPath) appendFileSync(outputPath, outputLine(position));
  };

  // Rule 3. Everything below this line needs all three, and none of them is
  // worth guessing at: a malformed repo slug or workflow name would go into a
  // URL path, and a missing pull request number cannot be placed in a stack.
  if (!REPO_SLUG.test(repo) || !Number.isInteger(prNumber) || prNumber <= 0 || !token) {
    console.log("stack-ci-priority: not a pull request run this script can place — running now.");
    emit("solo");
    return;
  }
  if (!/^[\w.-]+\.ya?ml$/.test(workflow)) {
    console.log(`stack-ci-priority: "${workflow}" is not a workflow file name — running now.`);
    emit("solo");
    return;
  }

  const request = githubRequest(token);
  // A 404 here is the ordinary answer for a repository without the stacks
  // preview, not an error worth a red check.
  const stack = await findStack({ repo, prNumber, request }).catch((error) => {
    console.log(`stack-ci-priority: could not read this repository's stacks (${error.message}).`);
    return null;
  });

  const { position, yieldTo } = stack
    ? resolveStackPosition(stack, prNumber)
    : { position: "solo", yieldTo: [] };
  emit(position);

  if (yieldTo.length === 0) {
    console.log(
      `stack-ci-priority: #${prNumber} is ${position === "solo" ? "not a stacked layer" : "the bottom of its stack"} — running now.`,
    );
    return;
  }

  console.log(
    `stack-ci-priority: #${prNumber} is the ${position} of stack #${stack.number}. The bottom ` +
      `merges next and the top speaks for the merged result, so this layer yields its lint, ` +
      `typecheck, unit and Playwright jobs to ${yieldTo.map((l) => `#${l.number}`).join(" and ")} ` +
      `for up to ${Math.round(deadlineMs / 60_000)} minutes. Its visual captures are already ` +
      `running: the layer above is keyed to them.`,
  );

  const result = await waitForLayers({ repo, workflow, yieldTo, request, deadlineMs });
  console.log(`stack-ci-priority: ${result.reason}. Running.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    // Rule 1. Not ordering the queue is the status quo; this script failing
    // must never be worse than not having it.
    console.log(
      `::warning title=Stack CI priority skipped::stack-ci-priority could not order this layer ` +
        `(${error.message}). Running the full gate now, which is the behaviour without it.`,
    );
  });
}
