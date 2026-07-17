# Architecture Decision Records

One record per significant, hard-to-reverse choice: frameworks, storage, auth, new runtime
dependencies, data-model spines, external services. Not for reversible detail (component naming,
file moves).

Use the `adr` skill (`.claude/skills/adr/`) or copy [0000-template.md](0000-template.md).
Number sequentially, kebab-case slug, link it from the table below and from
[overview.md](../overview.md) if it changes the stack table.

Statuses: **Accepted** → possibly **Superseded by NNNN**. Never edit an accepted ADR's decision —
write a new one that supersedes it.

## Index

| # | Decision | Status |
| --- | --- | --- |
| [0001](0001-nextjs-fullstack.md) | Full-stack Next.js, no separate backend | Accepted |
| [0002](0002-toolchain.md) | pnpm + Biome + Vitest + Playwright | Accepted |
| [0003](0003-repo-structure.md) | Single app at repo root, no monorepo yet | Accepted |
| [0004](0004-design-tokens.md) | Semantic CSS design tokens bound to Tailwind | Accepted |
| [0005](0005-database.md) | Postgres via Drizzle ORM, PGlite for dev/tests | Accepted |
