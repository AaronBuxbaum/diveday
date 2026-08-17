# 20260816-e2e-server-process-groups — Supervise each e2e Next server as a process group

- **Status:** Accepted
- **Date:** 2026-08-16

## Context

On 2026-08-15 two `next-server` processes had survived for sixteen days after
their owner exited. They were reparented to init, listened on no TCP port, and
held 3.6 GB of resident memory between them. The original processes were killed
before their environment and file descriptors were captured, so their precise
origin cannot be proven retrospectively.

The e2e topology is the strongest code-level suspect: Playwright starts one
`next start` per worker, and the Next command can create a `next-server`
descendant. A direct `webServer.command` gives Playwright no repository-owned
supervisor to clean up if the runner is interrupted between setup and teardown.
Local `reuseExistingServer` also turns a leftover process into a silent stale
build instead of an immediate port-collision signal.

## Decision

Playwright starts `scripts/e2e-server.mjs` in its own detached process group. The
supervisor keeps `next start` inside that group, forwards normal termination
signals to the direct child, and uses synchronous exit cleanup as a final
bounded kill of that child. Playwright's group teardown reaps the child and any
descendants. The supervisor also watches its launcher PID and inherited stdin;
if Playwright crashes or is killed before teardown, it terminates Next itself
instead of becoming an orphan. It never searches for or kills an unrelated
`next-server`. Local runs do not reuse an existing server; a port collision is
reported so the orphan can be inspected with `node scripts/stray-processes.mjs
--list` before any cleanup.

## Alternatives considered

- **Keep Playwright's direct `next start` command.** Rejected because the
  repository has no signal/exit cleanup boundary for the Next process and its
  descendants.
- **Keep `reuseExistingServer` on local runs.** Rejected because it converts a
  stale process into a successful run against the wrong build; a loud port
  collision is the useful failure while the process can still be inspected.
- **Kill every `next-server` before e2e.** Rejected because it would hide the
  lifecycle bug and could terminate another session's live server.

## Consequences

- A normal Playwright teardown and an interrupted teardown both use the same
  process-group boundary for the Next process and its descendants.
- A crashed Playwright launcher is detected by the supervisor rather than
  leaving a server behind indefinitely.
- A stale server cannot silently serve an old build to a local run.
- The historical pair's exact parent command remains unknown; this decision
  records and fixes the likely e2e teardown boundary without claiming evidence
  that was not captured.
