# 20260907-a-runner-registers-the-stack — A runner registers the stack, not the session

- **Status:** Accepted
- **Date:** 2026-09-07

## Context

[20260821-stacked-pull-requests](20260821-stacked-pull-requests.md) made a stack the default shape
for any branch cut while another of a session's own branches is still open. A stack has two halves.
The **shape** — each branch cut from the one below, each pull request opened with `base` set to that
branch — is plain git, and a session builds it with nothing but `git push` and a
`create_pull_request` call. **Registering** that shape is one REST call, `POST
/repos/{owner}/{repo}/stacks` with the numbers bottom to top, and it is what buys the server-side
cascading rebase, the bottom-up atomic merge, the stack view, and the
`github.event.pull_request.stack` field `.github/workflows/ci.yml` reads to skip a middle layer's
gate ([20260827-stack-ci-skips-the-middle-layers](20260827-stack-ci-skips-the-middle-layers.md)).

That one call stopped working, and nothing said so.

The 2026-08-21 ADR shipped with the correct observation — "agent sessions cannot register a stack
today", `gh` absent and `api.github.com` refused — and amended it a day later, on issue #645, with
the opposite: `gh` *was* preinstalled in cloud sessions, the proxy substituted credentials, and
`gh api repos/{owner}/{repo}/stacks` reached the endpoint. The skill and the backlog routine were
rewritten to that fact. It has since reverted. Measured in a session on 2026-09-07, against this
repository, not assumed:

| what | result |
| --- | --- |
| `which gh` | not found |
| `curl https://api.github.com/user` | 200 |
| `curl https://api.github.com/repos/AaronBuxbaum/diveday` | 403 "GitHub access is not enabled for this session" |
| the same with `Authorization: Bearer $GITHUB_TOKEN` | 403, identically |
| `git ls-remote origin` | works — the git proxy is authenticated |

So repo-scoped REST is refused outright and the CLI that used to carry it is gone. What a session
still has is the GitHub MCP server, whose tool surface has `create_pull_request` and
`update_pull_request` and no stack endpoints at all. The environment is back to exactly what the
2026-08-21 ADR described before its amendment.

The damage was silent, because the *shape* kept working. Sessions went on cutting each branch from
the one below and opening each pull request against it; only the registration failed, and a failed
registration looks like nothing. When this was written, PRs #1456 and #1457 were an open two-layer
chain both reading `"stack": null`, and the newest registered stack in the repository was #1074 —
from 2026-08-28, the day the last session that could still run `gh` did it. Nine days of chains,
none of them stacks: no cascading rebase, no bottom-up merge, and every middle layer paying the full
gate that ADR 20260827 exists to skip.

A GitHub Actions runner has what the session lost. Probed on a real runner against this repository,
on the default `secrets.GITHUB_TOKEN` with `pull-requests: write` and nothing else:

| call | result |
| --- | --- |
| `GET repos/{owner}/{repo}/stacks` | **200**, `X-Accepted-Github-Permissions: pull_requests=read` |
| `POST repos/{owner}/{repo}/stacks` with `{"pull_requests": []}` | **422** "Invalid property /pull_requests: 2 items required; only 0 were supplied", `X-Accepted-Github-Permissions: pull_requests=write` |

A 422 naming the payload is the answer that matters: the write path is reachable and authorized, and
it declined only the empty list. No personal access token, no GitHub App, and no `github/gh-stack`
extension — which still 403s on install in a session, and wraps these same endpoints anyway.

## Decision

**The registration moves off the session and onto a runner, and stops being a step anybody performs.**

`.github/workflows/stack.yml` runs on every same-repository pull request event and calls
`scripts/stack-register.mjs`, which walks the chain of open pull requests through the one that fired
— down through base refs to the default branch, and up again — and registers it, or extends the
stack that already holds its bottom. A `workflow_dispatch` input takes a pull request number, for a
chain assembled before this existed or a re-run after a refusal.

Three things follow.

1. **A session's job is unchanged and is now the whole job.** Cut each branch from the one below,
   open each pull request against it at that layer's first commit, as a draft, with a body naming
   its position. Nothing to run afterwards, nothing to wait for, nothing to leave in a closing
   message.
2. **Removing the step beats relocating it.** ADR 20260821's own measurement ("register at the first
   commit, not at the end") found that every stacking failure this repository has had lived in the
   gap between cutting a branch and getting round to the follow-up call — PR #893 walked stacking
   back over a base branch that merged and vanished while the next layer's body was still being
   written. A `workflow_dispatch`-only bridge would have put that gap back, and would additionally
   have been undispatchable until this file merged, since a dispatch only fires from the default
   branch.
3. **It refuses rather than guesses.** A stack is an ordered list and it merges bottom-up and
   atomically, so a wrong order is first noticed as the wrong pull request having landed. The
   registrar acts on exactly two shapes — a linear chain no stack holds, and a linear chain whose
   registered layers are its own bottom — and answers everything else (a fork, a cycle, two open
   pull requests on one head branch, layers spread across two stacks, a stack holding the middle of
   a chain) by naming what it saw and doing nothing. It never dissolves or reorders a stack;
   `POST .../stacks/{n}/unstack` stays a human's call, because a merge order somebody is relying on
   is not a robot's to unmake.

## Alternatives considered

- **Fix the session's access instead** — ask for `api.github.com` to be allowed through the agent
  proxy, or for stack endpoints on the GitHub MCP server. Both are the right long-term shape and
  neither is ours to ship; this repository cannot merge either one. Worth reporting upstream, and
  this decision costs nothing if one of them lands: the workflow keeps working, and a session that
  regains direct access simply has a second way to do something already done for it.
- **A `workflow_dispatch`-only bridge.** Rejected on both counts above: it restores the deferred
  step whose deferral is the measured cause of every stacking failure here, and it cannot be
  dispatched from a branch, so it would have registered nothing until it merged.
- **Give up registering and keep chained-base pull requests.** Free, and still the fallback if this
  workflow is removed — the shape is the substance, and ADR 20260821 says so. Rejected because the
  chain is exactly the half that already worked: what was missing is the cascading rebase, the
  atomic merge, and the middle-layer CI skip, all three of which are consequences of registering.
- **A personal access token in a repository secret.** Rejected as unnecessary — the default token
  is authorized, per the probe — and as a standing credential to maintain for a call that needs
  none.
- **Restore `gh` in the session by installing it.** Rejected: the CLI is not what is missing. The
  proxy refuses the request whatever sends it, as the `curl` rows above show.

## Consequences

Makes easy: stacking with no registration step at all, from any session, including one with no
GitHub write path beyond the MCP server. A chain built by a session that has never heard of stacks
is registered anyway, which is the point — the default shape now takes no discipline to get right.

Makes hard, and worth knowing: registration is now asynchronous. A session opens layer 2 and the
stack exists a minute later, so a session that reads `pull_request.stack` immediately after opening
a pull request will see `null`; read the workflow's run summary instead of racing it. And a chain
the registrar refuses stays an ordinary chained-base chain until a human reads the refusal — which
is the intended failure, but it is quiet, so the reason is printed in the job log and the run
summary rather than only in an exit code.

Commits us to: one extra ~20-second job per pull request event, on a repository whose ordinary gate
is eighty-odd jobs; and to `scripts/stack-register.mjs` tracking the stacks preview API, which is
still a preview and may change under us. If it does, the failure is a red job on a workflow nothing
else depends on, and the fallback is the chained-base shape we already produce.

Escape hatch: delete `.github/workflows/stack.yml`. Chains keep working; they stop becoming stacks.
ADR 20260821's own escape hatch — `POST .../stacks/{n}/unstack` — is unchanged and still a human's.
