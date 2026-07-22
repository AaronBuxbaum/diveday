# Engineering workflow

How to build anything here. Written for AI agents; humans may follow along.

## Before writing code

1. Read [docs/README.md](../README.md) and the docs relevant to the task (glossary for domain
   work, principles for UI work, overview + ADRs for structural work).
2. Touching Next.js APIs? Read the relevant guide in `node_modules/next/dist/docs/` first —
   Next 16 differs from training data.
3. Check [product/roadmap.md](../product/roadmap.md) — build the current milestone's slice, not
   a future one.

## The loop

1. **Plan** the smallest vertical slice that a user could see working.
2. **Domain logic first** — pure functions in `src/lib/`, unit-tested as you go
   (`pnpm test:watch`).
3. **UI second** — token-styled (ADR-0004), copy per the voice rules
   ([design/principles.md](../design/principles.md)).
4. **Verify** — the `verify` skill: `pnpm check`, `pnpm e2e` when flows changed, and for UI
   work look at the running app (screenshot light + dark) — never ship UI you haven't seen.
5. **Document** — update any doc your change invalidates; new hard-to-reverse choice → ADR
   (`adr` skill); new domain term → glossary.
6. **Ship** — commit (imperative subject, body says why), push, keep the PR draft until CI is
   green and the checklist below passes.

## Definition of done

- [ ] `pnpm check` green; `pnpm e2e` green when flows changed
- [ ] New logic has tests that fail without it
- [ ] UI seen in browser, light + dark; design checklist passes for user-facing changes
- [ ] Docs/ADR/glossary updated in the same PR
- [ ] No leftover debug code, no `biome-ignore` without a reason string

## Rules

- **Never skip verify.** A green `pnpm check` is the floor, not the ceiling.
- **Keep agent startup non-blocking.** Do not run dependency installation, Git configuration, or
  other commands from provider `SessionStart` hooks. Remote code reviews cannot stream progress
  until those hooks return, and a failed bootstrap leaves the review stuck at its initial status.
  Run setup commands explicitly after the agent starts so their output and failures remain visible.
- **New runtime dependency = ADR** (or an entry in an existing one). Dev-tool bumps exempt.
- **Don't expand scope silently.** Adjacent problems get a note in the PR, not a drive-by fix.
- **Server actions default to inline.** A single-page mutation lives as an inline `"use server"`
  closure in that page. `src/app/actions/` is only for actions genuinely shared across pages. A large
  page that would otherwise sprawl colocates its actions and zod schemas in a sibling `actions.ts`
  (file-level `"use server"`) instead.
- **Safety-critical code** (manifests, roll call, medical flags, cert gating) prefers explicit,
  boring implementations, exhaustive tests, and a second look via the `dive-domain-expert`
  agent.
- **Secrets never enter the repo.** `.env*` is gitignored; document required vars in
  `.env.example` when they appear.
