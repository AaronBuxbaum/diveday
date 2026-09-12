---
paths:
  - "scripts/**"
  - ".claude/**"
  - ".github/**"
---

# Rules for `scripts/`, `.claude/` and `.github/`

The repository's own tooling: the `pnpm check:repo` guards, the session hooks, the skills and
reviewer agents, and CI. Loaded when one of them is read.

- **Every subprocess is bounded.** A synchronous `spawnSync`/`execFileSync` in `scripts/` goes
  through `runBounded`/`readBounded` in `scripts/subprocess.mjs`, with a ceiling from
  `SUBPROCESS_TIMEOUTS` — an unbounded one is how `pnpm check` hung permanently on a cloud runner
  (2026-08-14). Argument arrays, never a shell string, when any argument comes from a payload.
- **A hook fails open.** Every script wired in `.claude/settings.json` exits 0 on an unparseable
  payload, a missing binary, a timeout, or its own bug: a hook that blocks a session because it
  broke is worse than the thing it prevents. A `Stop` hook honours `stop_hook_active` so it cannot
  loop a session against itself. A refusal names the correct form, because a guard that only says
  no gets routed around. The full roster and each hook's reasoning:
  [docs/agents/session-hooks.md](../../docs/agents/session-hooks.md). Hooks load at session start,
  so a change to one needs a restart to take effect.
- **A guard gets a test beside it.** `scripts/check-<name>.mjs` ships with
  `scripts/check-<name>.test.mjs`, and a hook with `scripts/<name>.test.mjs`; `pnpm agent:health`
  lists the ones without. The "leaves alone" cases carry at least as much weight as the refusals.
- **A guard is spawned by `scripts/check-repo.mjs`** or it never runs; `pnpm check:agents` fails on
  one that is not in the table, and on the `check:repo` row in `AGENTS.md` naming the wrong count.
- **Ratchets turn one way.** `--write` banks a fall and refuses a rise; `--absorb "<why>"` records a
  deliberate rise with its reason in the baseline diff. `copy`, `domain-strings`, `tokens`,
  `architecture`, `type-ramp`, `voice`, `logical-properties`, `bundle-reach`, `route-coverage`,
  `locale` and `context-budget` all work this way. `locale`'s count is the one that will never
  reach zero — an acronym and a course name are the same word in Spanish, so read it as
  "unexamined" and name a deliberate one in `DELIBERATELY_IDENTICAL`
  ([docs/agents/repo-checks.md](../../docs/agents/repo-checks.md)).
- **The agent layer is checked** (`scripts/check-agents.mjs`): every skill has frontmatter whose
  `name` matches its directory and a `description` (the only part every session pays for); every
  skill is in `.claude/skills/README.md` and mentioned in `AGENTS.md`; every reviewer agent is in
  the index; every `task:context` path exists; every backticked repo path in `AGENTS.md` and in
  `.claude/rules/*.md` exists; every allowlist entry and every hook command in
  `.claude/settings.json` names a real script or package script; nothing in `.mcp.json` launches
  through a package manager.
- **Always-loaded context is budgeted** (`scripts/check-context-budget.mjs`): `AGENTS.md`,
  `CLAUDE.md`, any `.claude/rules/*.md` **without** `paths:` frontmatter, and every skill's and
  agent's `description:` line. A path-scoped rule is paid for only by the session that reads a
  matching file, which is why a rule that only matters under one directory goes in `.claude/rules/`
  with `paths:` and never in `AGENTS.md`. The fix for a red budget is to move the long half into
  `docs/` or a scoped rule and leave a pointer — never to compress the prose.
- **CI** (`.github/workflows/ci.yml`) shards the unit suite four ways and runs the whole e2e and
  visual suites; a local session runs the focused forms only. `scripts/check-ci-change-detection.mjs`
  and `scripts/check-stack-ci-skip.mjs` pin how CI decides what to run — read
  [docs/agents/repo-checks.md](../../docs/agents/repo-checks.md) before touching either.
- **Skills** state *how*, docs state *what and why*; a skill that contradicts an ADR or the code is
  stale and is fixed in the same change. Keep a `description:` specific about its trigger, then
  short — the body is where length belongs. A reviewer agent lists only the tools it needs.
- **Text a human will copy is written unwrapped** — one line per paragraph — in a script's output as
  in a doc.
