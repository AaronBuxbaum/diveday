import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/**
 * Registers a chain of chained-base pull requests as a GitHub **stack**, from a
 * runner rather than from a session.
 *
 * The shape of a stack is plain git — each branch cut from the one below, each
 * pull request opened with `base` set to that branch — and a session builds it
 * with nothing but `git push` and `create_pull_request`. Registering that shape
 * is the part that buys the cascading rebase, the bottom-up atomic merge, the
 * stack view, and the `github.event.pull_request.stack` field
 * `.github/workflows/ci.yml` reads to skip a middle layer's gate (ADR
 * 20260821-stacked-pull-requests, ADR 20260827-stack-ci-skips-the-middle-layers).
 * It is one REST call — and that one call is what stopped working.
 *
 * **Why a runner and not the session.** The ADR's 2026-08-22 amendment recorded
 * that cloud sessions could reach the endpoint themselves: `gh` was preinstalled
 * and the agent proxy substituted credentials on `gh api`. Neither half is true
 * any more. Measured in a session on 2026-09-07, not assumed:
 *
 *   which gh                                            -> not found
 *   curl https://api.github.com/repos/{owner}/{repo}     -> 403 "GitHub access is
 *                                                          not enabled for this
 *                                                          session"
 *   curl https://api.github.com/user                     -> 200
 *
 * so repo-scoped REST is refused outright, with or without an `Authorization`
 * header, and the only writable GitHub path left to a session is the GitHub MCP
 * server — whose tool surface has `create_pull_request` and no stack endpoints
 * at all. That is exactly the situation the ADR described *before* its
 * amendment, and it left the repository with chained-base pull requests nobody
 * could register: PRs #1456 and #1457 were an open two-layer chain reading
 * `"stack": null` when this was written, and the newest registered stack in the
 * repository was #1074, from 2026-08-28.
 *
 * A GitHub Actions runner has what the session lost, and the probe that
 * established it ran against this repository:
 *
 *   GET  repos/{owner}/{repo}/stacks   -> 200, X-Accepted-Github-Permissions:
 *                                         pull_requests=read
 *   POST repos/{owner}/{repo}/stacks   -> 422 "Invalid property /pull_requests:
 *   with {"pull_requests": []}            2 items required; only 0 were
 *                                         supplied", X-Accepted-Github-
 *                                         Permissions: pull_requests=write
 *
 * A 422 naming the payload is the answer that matters: the write path is
 * reachable and authorized for the **default** `secrets.GITHUB_TOKEN` with
 * `pull-requests: write`, and it declined only the empty list. No personal
 * access token, no app, no extension — `github/gh-stack` still 403s on install
 * in a session, and is not needed here.
 *
 * **So the session's job is unchanged and the registration is nobody's job.**
 * A session cuts each branch from the one below and opens each pull request
 * against it, exactly as before; `.github/workflows/stack.yml` sees the
 * resulting pull request event and calls this. Removing the step is better than
 * relocating it: the step being deferred is what ADR
 * 20260821-stacked-pull-requests measured as the cause of every stacking
 * failure this repository has had.
 *
 * This never dissolves a stack, never reorders one, and never touches a chain it
 * does not fully understand — see `planRegistration`, which answers `refuse` for
 * every shape it cannot account for. A stack is undone by hand
 * (`POST .../stacks/{n}/unstack`), because doing it automatically would mean
 * this file could unmake a merge order a human is relying on.
 */

const API = "https://api.github.com";

/** GitHub refuses a stack of fewer than two, and caps one at a hundred. */
export const MIN_LAYERS = 2;
export const MAX_LAYERS = 100;

/**
 * The chain of open pull requests through `start`, bottom to top.
 *
 * Walks **down** from `start` — each pull request's base ref is the head ref of
 * the one below — until it reaches `defaultBranch`, then walks **up** the same
 * way. Both directions matter: a chain is normally registered by the event that
 * opens its top layer (down-walk only), but a body edit on layer 1 of an
 * existing chain arrives with everything above it, and answering that with a
 * one-layer chain would leave the stack unregistered until something else
 * happened to fire.
 *
 * Returns `{ chain }` on success and `{ error }` on any shape that is not a
 * linear chain rooted on the default branch. Every one of those is a refusal
 * rather than a best guess: a stack is an *ordered* list, and a wrong order
 * merges the wrong thing first.
 */
export function chainThrough(pulls, start, defaultBranch) {
  const byHead = new Map();
  for (const pull of pulls) {
    if (byHead.has(pull.head.ref)) {
      return { error: `two open pull requests share the head branch \`${pull.head.ref}\`` };
    }
    byHead.set(pull.head.ref, pull);
  }

  const below = [];
  const seen = new Set([start.number]);
  let cursor = start;
  while (cursor.base.ref !== defaultBranch) {
    const next = byHead.get(cursor.base.ref);
    if (!next) {
      return {
        error: `#${cursor.number} is based on \`${cursor.base.ref}\`, which is neither \`${defaultBranch}\` nor the head of an open pull request`,
      };
    }
    if (seen.has(next.number)) {
      return { error: `the base refs below #${start.number} form a cycle` };
    }
    seen.add(next.number);
    below.unshift(next);
    cursor = next;
  }

  const childrenOf = new Map();
  for (const pull of pulls) {
    childrenOf.set(pull.base.ref, [...(childrenOf.get(pull.base.ref) ?? []), pull]);
  }

  const above = [];
  cursor = start;
  for (;;) {
    const next = childrenOf.get(cursor.head.ref) ?? [];
    if (next.length === 0) break;
    if (next.length > 1) break; // reported by the fork pass below, which sees the whole chain
    if (seen.has(next[0].number)) {
      return { error: `the base refs above #${start.number} form a cycle` };
    }
    seen.add(next[0].number);
    above.push(next[0]);
    cursor = next[0];
  }

  const chain = [...below, start, ...above];

  // A fork anywhere in the chain, not merely above where the walk started. A
  // branch point *below* `start` is invisible to both walks — the down-walk
  // follows one base ref and never asks who else shares it — and it is the
  // dangerous half: each sibling's own chain reads as linear, so the first
  // sibling registers, and the second then looks like an ordinary extension of
  // a stack whose top is not its base at all. Caught by a test rather than by
  // reasoning; the walks alone answered "linear" for a chain that was not.
  for (const pull of chain) {
    const children = childrenOf.get(pull.head.ref) ?? [];
    if (children.length > 1) {
      return {
        error: `\`${pull.head.ref}\` is the base of ${children.length} open pull requests (${children.map((child) => `#${child.number}`).join(", ")}), so the chain forks and is not a stack`,
      };
    }
  }

  return { chain };
}

/**
 * What to do with `chain`, given every stack the repository already has.
 *
 * Four answers, and three of them do nothing:
 *
 * - `skip`   — fewer than two layers, or more than a hundred. Not a stack yet.
 * - `none`   — already registered, exactly as it stands.
 * - `create` — no layer is in a stack: `POST .../stacks` with all of them.
 * - `add`    — the layers already registered are a *prefix* of this chain, and
 *              the rest sit above the stack's top: `POST .../stacks/{n}/add`.
 * - `refuse` — anything else.
 *
 * The prefix condition on `add` is the load-bearing half. GitHub documents the
 * endpoint as extending a stack, and a layer opened above the current top is the
 * only shape this repository's workflow actually produces — so that is the only
 * shape acted on. Inserting into the middle, re-rooting a stack, or reconciling
 * two stacks that each hold part of one chain are all real states a human could
 * create by hand, all of them ambiguous about merge order, and none of them
 * worth guessing at from a robot that cannot ask.
 */
export function planRegistration(chain, stacks) {
  const numbers = chain.map((pull) => pull.number);

  if (numbers.length < MIN_LAYERS) {
    return { op: "skip", why: `#${numbers[0]} is a chain of one — nothing to register yet` };
  }
  if (numbers.length > MAX_LAYERS) {
    return {
      op: "refuse",
      why: `a chain of ${numbers.length} exceeds the ${MAX_LAYERS}-layer cap`,
    };
  }

  const holding = stacks.filter((stack) =>
    (stack.pull_requests ?? []).some((pull) => numbers.includes(pull.number)),
  );

  if (holding.length === 0) return { op: "create", numbers };
  if (holding.length > 1) {
    return {
      op: "refuse",
      why: `layers of this chain are spread across stacks ${holding.map((stack) => `#${stack.number}`).join(", ")}; unstack them and re-register by hand`,
    };
  }

  const stack = holding[0];
  const members = (stack.pull_requests ?? []).map((pull) => pull.number);
  const missing = numbers.filter((number) => !members.includes(number));
  if (missing.length === 0) return { op: "none", stack: stack.number, why: "already registered" };

  const registered = numbers.filter((number) => members.includes(number));
  const prefix = numbers.slice(0, registered.length);
  const isPrefix = prefix.every((number) => members.includes(number));
  if (!isPrefix) {
    return {
      op: "refuse",
      stack: stack.number,
      why: `stack #${stack.number} holds ${registered.map((n) => `#${n}`).join(", ")}, which is not the bottom of this chain (${numbers.map((n) => `#${n}`).join(" -> ")})`,
    };
  }

  return { op: "add", stack: stack.number, numbers: missing };
}

/** One line saying what happened, for the job log and the run summary. */
export function describe(plan, chain) {
  const order = chain.map((pull) => `#${pull.number}`).join(" -> ");
  switch (plan.op) {
    case "skip":
      return `Nothing to register: ${plan.why}.`;
    case "none":
      return `Chain ${order} is already stack #${plan.stack}.`;
    case "create":
      return `Registered ${order} as a new stack.`;
    case "add":
      return `Added ${plan.numbers.map((n) => `#${n}`).join(", ")} to stack #${plan.stack}. Chain: ${order}.`;
    default:
      return `Left alone: ${plan.why}.`;
  }
}

async function request(pathname, { token, method = "GET", body } = {}) {
  const response = await fetch(`${API}${pathname}`, {
    method,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${method} ${pathname} -> ${response.status}: ${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) : null;
}

/** Every open pull request, following `Link` pagination the simple way. */
async function openPulls(repo, token, call = request) {
  const pulls = [];
  for (let page = 1; page <= 10; page += 1) {
    const batch = await call(`/repos/${repo}/pulls?state=open&per_page=100&page=${page}`, {
      token,
    });
    pulls.push(...batch);
    if (batch.length < 100) break;
  }
  return pulls;
}

/** The one write a plan implies, or nothing. */
async function perform(plan, repo, token, call) {
  if (plan.op === "create") {
    await call(`/repos/${repo}/stacks`, {
      token,
      method: "POST",
      body: { pull_requests: plan.numbers },
    });
  } else if (plan.op === "add") {
    await call(`/repos/${repo}/stacks/${plan.stack}/add`, {
      token,
      method: "POST",
      body: { pull_requests: plan.numbers },
    });
  }
}

/**
 * `call` is injected so the test can drive the retry below without a network.
 *
 * **Two runs of this can be in flight at once, and that is deliberate.** The
 * workflow's concurrency lane is one *pull request*, not the repository: a
 * repository-wide lane looked like the way to serialise two layers of one chain
 * opening together, and it is not — GitHub keeps the in-progress run and the
 * newest queued one and **cancels every other queued run in the group**, which
 * is the trap `.github/workflows/ci.yml` records costing five main commits their
 * visual baseline on 2026-09-01. Observed here too, first time out: three of the
 * five runs of this workflow were cancelled before they registered anything. A
 * cancelled registration is a silent one, which is the exact failure this whole
 * change exists to remove — so losing a run is strictly worse than racing.
 *
 * Racing is therefore handled rather than prevented. Both runs read "no stack
 * yet" and both POST; one wins and the loser's request is refused. On a refusal
 * this re-reads the stacks and re-plans once, and the ordinary outcome is that
 * the chain is now registered, which is success and says so.
 */
export async function run(env, call = request) {
  const repo = env.GITHUB_REPOSITORY;
  const token = env.GITHUB_TOKEN;
  // A positive integer, not merely an integer: `Number("")` is 0, so an
  // unresolved workflow expression would otherwise sail through the guard and
  // spend two API calls looking up pull request #0.
  const number = Number(env.STACK_PULL_REQUEST);
  if (!repo || !token || !Number.isInteger(number) || number < 1) {
    throw new Error(
      "stack-register needs GITHUB_REPOSITORY, GITHUB_TOKEN and a positive STACK_PULL_REQUEST in the environment.",
    );
  }

  const pulls = await openPulls(repo, token, call);
  const start = pulls.find((pull) => pull.number === number);
  if (!start) return `#${number} is not an open pull request in ${repo}; nothing to register.`;

  const defaultBranch = env.STACK_DEFAULT_BRANCH || "main";
  const { chain, error } = chainThrough(pulls, start, defaultBranch);
  if (error) return `Left alone: ${error}.`;

  const plan = planRegistration(chain, await call(`/repos/${repo}/stacks`, { token }));
  try {
    await perform(plan, repo, token, call);
  } catch (failure) {
    const second = planRegistration(chain, await call(`/repos/${repo}/stacks`, { token }));
    if (second.op === "none")
      return `${describe(second, chain)} (a concurrent run got there first.)`;
    if (second.op === plan.op) throw failure;
    await perform(second, repo, token, call);
    return describe(second, chain);
  }

  return describe(plan, chain);
}

// Imported by the test, which must not make a request or exit the process.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const summary = await run(process.env);
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFile } = await import("node:fs/promises");
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  }
}
