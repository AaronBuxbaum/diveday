# Papercuts log

A running log of anything that slowed down development — a confusing error, a misleading tool
failure, a config gotcha, a dead end that cost real time. It lives in the repo, not in a home
directory: most sessions here run in ephemeral cloud containers that don't keep anything outside
the checkout, so a file under `~/` wouldn't survive to help the next session.

Entries live one-per-file in `papercuts/`, named `YYYY-MM-DD-<slug>.md`, instead of appended lines
in one shared file. That's deliberate: many sessions can run here at once (see AGENTS.md's
"Parallel work"), and a shared log file that every session appends to is a merge-conflict magnet.
A new file per entry is just a new path — nothing to conflict with.

- When you lose time mid-session to something that turned out to be a papercut (not a bug in this
  repo's own code, and not something a skill or another `docs/agents/` file already explains),
  create `papercuts/<today>-<short-slug>.md` with four lines: `Date:`, `Project:` (the app/area,
  e.g. `manifests`, `stripe-connect`, `e2e`), `Symptom:`, `Fix:`.
- Before spending time on a tooling failure that looks unrelated to the actual task (an obscure
  CLI error, an environment quirk, a flaky-looking command that isn't a known flake), grep
  `papercuts/` for the symptom — the fix may already be recorded.
