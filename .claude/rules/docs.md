---
paths:
  - "docs/**"
---

# Rules for `docs/`

Loaded when a document is read. [docs/README.md](../../docs/README.md) is the map and says which
doc to update when.

- **Docs travel with the change.** A doc a change invalidates is fixed in the same PR; a new domain
  concept goes in the glossary; a significant, hard-to-reverse choice is an ADR under
  `docs/architecture/decisions/` with a collision-resistant `YYYYMMDD-short-slug` id (the **adr**
  skill) — never the next integer. Product truth lives in `docs/`, not in a skill.
- **Text a human will copy is written unwrapped.** A support case, an outreach email, an incident
  note — anything a reader selects and pastes into a mailbox, a form, or a chat box — gets one line
  per paragraph and one per bullet, however long, in a document and in a chat reply alike. Markdown
  prose here wraps at 100 columns; a paste block is not prose, and its wraps survive the copy as
  hard breaks that ragged every paragraph in the destination and mark the message as machine-made.
  The worked examples are the SES case text in
  [engineering/ses-email-runbook.md](../../docs/engineering/ses-email-runbook.md), the incident comms
  templates in [engineering/incident-response-runbook.md](../../docs/engineering/incident-response-runbook.md),
  and [product/pilot-kit/cold-email-template.md](../../docs/product/pilot-kit/cold-email-template.md).
- **Design canvases** (`docs/design/canvases/<YYYYMMDD-slug>/`) argue in pictures and are dated,
  illustrative, and superseded rather than freshened; the ADR carries the decisions and is what
  code obeys; [design/surfaces.md](../../docs/design/surfaces.md) holds the one idea per surface.
  Never commit the seeded payload — it is build output. `pnpm check:design-canvases` enforces the
  mechanics; [design/design-artifacts.md](../../docs/design/design-artifacts.md) sets what a canvas
  may claim.
- **Human-owned decisions** live in [product/human-decisions.md](../../docs/product/human-decisions.md);
  an agent records an outcome there only when a human made the call. Unbuilt work lives in
  [product/features/](../../docs/product/features/README.md); shipped slices move to
  [product/shipped.md](../../docs/product/shipped.md).
- **Follow-ups are GitHub issues** labelled `needs-triage`, never a doc section
  ([agents/issue-tracker.md](../../docs/agents/issue-tracker.md)'s "Filing a follow-up").
- **Marketing and public-page copy** follows [product/marketing.md](../../docs/product/marketing.md)'s
  claims policy and [design/brand.md](../../docs/design/brand.md)'s voice; `pnpm check:voice`
  refuses the mechanical tells, and the **brand-voice** skill covers the rest.
- Links are checked: `pnpm check:docs` (`scripts/check-doc-links.mjs`) fails on a broken path or
  a heading anchor that does not exist, across `docs/`, `AGENTS.md`, the skills and these rules.
- Long-form reasoning belongs here, not in `AGENTS.md`: every session loads that file in full, so a
  rule's *why* and its incident history move into `docs/agents/` and leave a pointer
  (`pnpm check:context-budget`).
