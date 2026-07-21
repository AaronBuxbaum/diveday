# DiveDay skill library

Task-scoped playbooks for the AI sessions that build this project — concrete file paths, exact
commands, known pitfalls — so a session executes recurring workflows correctly without
re-deriving them from the full doc set.

Skills complement, never override, `AGENTS.md` and `docs/`. If a skill contradicts an ADR or the
code, the ADR/code wins — fix the skill in the same commit; skills are documentation and fall
under the same sync duties (docs/README.md).

## Index

| Skill | Use when |
|---|---|
| `new-feature` | Implementing any feature end to end — the full loop from docs to shipped slice |
| `verify` | Before every commit; whenever asked to confirm something works |
| `design-review` | After building or changing any user-facing surface |
| `schema-change` | Editing `src/db/schema.ts`; anything needing new persistent state |
| `debug` | Any failing test, red CI, flaky spec, or bug report — before attempting fixes |
| `e2e-and-argos` | Adding/changing a user-facing flow or surface; a visual baseline diffing on time; deciding what needs an e2e spec or Argos snapshot |
| `adr` | Recording or superseding a significant, hard-to-reverse decision |

Reviewer agents (`.claude/agents/`): `design-critic` (delight principles), `dive-domain-expert`
(dive-industry correctness — required for safety-critical surfaces).

## Maintenance

- A skill states *how* to do a recurring task; a doc under `docs/` states *what the product is
  and why*. Don't move product truth into skills — link to it.
- When a workflow changes (new CI job, renamed script, new harness), update the affected skill in
  the same commit.
- Keep frontmatter `description` fields specific about triggers — they are how sessions decide to
  load the skill.