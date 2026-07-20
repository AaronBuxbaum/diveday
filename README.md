# Scuba

Delight-first dive shop operations: **bookings, waivers, cert checks, trip prep, and boat
manifests** in one place that's a genuine pleasure to use.

Built entirely by AI agents. The repo is structured for that: [`AGENTS.md`](AGENTS.md) is the
agent entry point, [`docs/`](docs/README.md) is the project's memory (vision, dive-domain
glossary, ADRs, design principles, workflow), [`.agents/skills/`](.agents/skills/README.md)
carries the task-scoped skills, and [`.claude/agents/`](.claude/agents/) carries the reviewer
agents that encode how work gets done here.

## Quickstart

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

| Command | What |
| --- | --- |
| `pnpm check` | lint + typecheck + unit tests |
| `pnpm test` | unit tests (Vitest) |
| `pnpm e2e` | end-to-end tests (Playwright) |
| `pnpm build` | production build |

## Stack

Next.js 16 · React 19 · TypeScript strict · Tailwind 4 · Biome · Vitest · Playwright · pnpm —
rationale in [docs/architecture/decisions/](docs/architecture/decisions/README.md).

## Reading order

1. [docs/product/vision.md](docs/product/vision.md) — why this exists
2. [docs/design/principles.md](docs/design/principles.md) — what "delight-first" means concretely
3. [docs/product/roadmap.md](docs/product/roadmap.md) — where it's headed
