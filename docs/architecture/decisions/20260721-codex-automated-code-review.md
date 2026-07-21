# 20260721-codex-automated-code-review — Automated Codex review on every non-main push

- **Status:** Accepted
- **Date:** 2026-07-21

## Context

Every developer on this repo is an AI agent (see AGENTS.md). `pnpm check` and the e2e suite catch
semantic and behavioral regressions, but neither reads a diff for the things a second reviewer
catches: risky patterns, missed edge cases, drift from AGENTS.md conventions (semantic tokens,
`Field`/`buttonClass` wrappers, tests traveling with behavior). Today that second read only happens
if a human or another agent is asked for it explicitly.

## Decision

Add `.github/workflows/code-review.yml`, triggered on `push` to any branch except `main`
(`branches-ignore: [main]`):

- Runs `openai/codex-action@v1` with a prompt that reviews `git diff origin/main...HEAD` — the
  changes on the branch not yet on `main` — against correctness, safety-critical surfaces
  (manifests, roll call, cert gating, medical flags), and the AGENTS.md conventions above.
- The job is gated on `secrets.OPENAI_API_KEY` being set (`if: secrets.OPENAI_API_KEY != ''`), so
  it stays dormant — CI unaffected — until a human adds the secret, the same activation pattern as
  `ARGOS_TOKEN` (see `20260721-argos-visual-regression.md`).
- The action's `final-message` output is posted as a commit comment via `actions/github-script`
  and `contents: write`, so the review is visible on the pushed commit regardless of whether a PR
  exists yet for the branch.
- `permission-profile: ":workspace"` and `safety-strategy: drop-sudo` follow the action's
  documented defaults for a read-mostly review task; Codex is not given push/write access to the
  repo, only read access to the checked-out workspace.

## Alternatives considered

- **Trigger on `pull_request` instead of `push`** — the action's own example workflow does this,
  and it can post inline PR comments instead of a commit comment. Rejected because it was explicitly
  requested to fire on push (except `main`), which also reviews commits pushed to branches before a
  PR is opened.
- **GitHub Copilot's `request_copilot_review`** — already available via the GitHub MCP server, no
  new secret required. Rejected for this task because it must run automatically in CI on every
  push, not be invoked on demand, and the task specifically calls for the Codex action.
- **Post to job summary only, no commit comment** — simpler, no extra permission, but easy to miss;
  a commit comment surfaces in the GitHub UI without opening the Actions run.

## Consequences

- New CI-only dependency on `openai/codex-action@v1` and an OpenAI-billed API key; no runtime or
  `package.json` dependency.
- Activation requires a one-time manual step: add `OPENAI_API_KEY` to the repository's Actions
  secrets. Until then the job is skipped and CI is unaffected.
- Every non-main push now costs one Codex review call; a busy branch (many small pushes) multiplies
  cost. If that becomes a problem, the lever is narrowing the trigger (e.g. only on PR branches, or
  debounced via `concurrency` — already in place per-ref) or dropping to `pull_request` triggering.
- The review is advisory only — nothing blocks the push or fails CI on Codex's findings. Escalating
  to a required check would need `pull_request` triggering plus a status check, which is a bigger
  change than the automatic-review behavior requested here.
