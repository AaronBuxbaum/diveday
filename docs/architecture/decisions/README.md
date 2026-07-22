# Architecture Decision Records

One record per significant, hard-to-reverse choice: frameworks, storage, auth, new runtime
dependencies, data-model spines, external services. Not for reversible detail such as component
naming or routine file moves.

Use the `adr` skill (`.claude/skills/adr/`) or copy [0000-template.md](0000-template.md).

## IDs and parallel work

Historical ADRs retain their `NNNN-slug.md` filenames and `NNNN` headings. New ADRs use a
collision-resistant `YYYYMMDD-short-slug.md` filename and the same complete id in the heading,
for example `20260718-waiver-signature-storage.md`.

Do not allocate the next integer and do not reserve an id in a branch-local ledger. Use the branch
or feature slug so independently-created ADRs normally land in different files. The repository
check validates filename/heading alignment, metadata, statuses, required sections, and duplicate ids.

Statuses: **Proposed**, **Accepted**, **Deprecated**, or **Superseded by <id>**. Never silently edit
an accepted ADR's decision; write a new record that supersedes it.

## Historical index

The table below indexes the original foundational records. New collision-resistant ADRs are found by
descriptive filename and do not need a central index entry, avoiding merge conflicts between
parallel branches.

| # | Decision | Status |
| --- | --- | --- |
| [0001](0001-nextjs-fullstack.md) | Full-stack Next.js, no separate backend | Accepted |
| [0002](0002-toolchain.md) | pnpm + Biome + Vitest + Playwright | Accepted |
| [0003](0003-repo-structure.md) | Single app at repo root, no monorepo yet | Accepted |
| [0004](0004-design-tokens.md) | Semantic CSS design tokens bound to Tailwind | Accepted |
| [0005](0005-database.md) | Postgres via Drizzle ORM, PGlite for dev/tests | Accepted |
| [0006](0006-auth.md) | Auth.js v5 credentials auth with JWT sessions | Accepted |
