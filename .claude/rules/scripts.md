---
paths:
  - "scripts/**"
  - ".claude/**"
  - ".github/**"
---

# Rules for `scripts/`, `.claude/` and `.github/`

The `pnpm check:repo` guards, the session hooks, the skills and reviewer agents, and CI. Each rule
names what enforces it; the reasoning and incidents are in
[docs/agents/repo-checks.md](../../docs/agents/repo-checks.md#the-scripts-rules).

- **Every subprocess is bounded**: `runBounded`/`readBounded` in `scripts/subprocess.mjs` with a
  ceiling from `SUBPROCESS_TIMEOUTS`; argument arrays, never a shell string built from a payload
  (an unbounded call hung `pnpm check` on 2026-08-14).
- **A hook fails open** on a bad payload, a missing binary, a timeout or its own bug; a `Stop` hook
  honours `stop_hook_active`; a refusal names the correct form. Hooks load at session start. Roster
  and reasoning: [docs/agents/session-hooks.md](../../docs/agents/session-hooks.md).
- **A guard gets a test beside it** (`scripts/check-<name>.test.mjs`, `scripts/<name>.test.mjs` for
  a hook), "leaves alone" cases included; `pnpm agent:health` lists the ones without.
- **A guard is spawned by `scripts/check-repo.mjs`** or it never runs: `pnpm check:agents` fails on
  one missing from the table, or a `check:repo` row naming the wrong count.
- **Ratchets turn one way**: `--write` banks a fall, `--absorb "<why>"` records a rise with its
  reason. `locale`'s count never reaches zero; name a deliberate one in `DELIBERATELY_IDENTICAL`.
- **The agent layer is checked** by `scripts/check-agents.mjs`: skill frontmatter, the skill index,
  `task:context` paths, every backticked path in `AGENTS.md` and these rules, hook and allowlist
  commands, and `.mcp.json` launches.
- **Always-loaded context is budgeted** by `scripts/check-context-budget.mjs` (`AGENTS.md`,
  `CLAUDE.md`, unscoped rules, model-visible skill and agent descriptions). The fix for red is to
  move the long half into `docs/` or a scoped rule and leave a pointer.
- **A skill linked in from `.agents/skills/`** has its source there and an entry in
  `skills-lock.json`; adding or removing one touches all three.
- **CI** (`.github/workflows/ci.yml`) runs the whole suites; read the CI-change-detection write-up
  before touching `scripts/check-ci-change-detection.mjs`. Every stack layer runs the whole gate
  (ADR 20261003-every-stack-layer-runs-ci).
- **Skills state how, docs state what and why**; a skill that contradicts an ADR or the code is
  fixed in the same change. A reviewer agent lists only the tools it needs.
- **Text a human will copy is written unwrapped**, in a script's output as in a doc.
