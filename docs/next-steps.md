# Next steps — plan of record (2026-07-18)

Status: **ACTIVE**. Sequencing for the next stretch of work, plus the findings of an
architecture review of the sibling project **Sybaris** (`AaronBuxbaum/sybaris`) — a much
larger AI-agent-built product whose process has survived ~130 ADRs, parallel agent sessions,
and multiple harnesses. Mark items done with a dated note as they ship; when everything here
is shipped or superseded, fold the survivors into the permanent docs and archive this file.

Three goals drive the ordering, per Aaron:

1. **Delight and features** — keep shipping visible product (M3 waivers next).
2. **Clean architecture** — adopt Sybaris's proven seams before integrations arrive, not after.
3. **An agent-optimal platform** — token-efficient sessions, safe parallel work across
   *different* AI providers/harnesses, and tooling that lets weaker models than today's ship
   high-quality work.

---

## 1. Where we are

M0–M2 are shipped: foundation, domain spine (shop/person/trip/booking, multi-tenant), staff
auth, trip scheduling/management with crew assignment, and the public no-account booking flow
with transactional capacity enforcement. The docs/skills/agents layer exists and works. CI is
green on `main`.

What we don't yet have: any external integration (email, e-sign, payments), any coordination
protocol for parallel agent sessions, and several cheap token-economy rules Sybaris learned
the hard way.

## 2. Product: the next slices

The [roadmap](product/roadmap.md) owns sequencing; nothing here reorders it. This section
sharpens the next two milestones into buildable slices.

### M3 — Waivers (next)

Vertical slice, in order:

1. **Schema + domain**: `waiver_templates` (per shop, versioned text), `waiver_signatures`
   (per booking person, signed-at, template version, signature payload), medical statement
   answers with a **physician-referral blocking state**. Schema work follows the
   `schema-change` skill; medical blocking is safety-critical → boring code, failure-path
   tests, `dive-domain-expert` review.
2. **E-signature seam first** (see §3.2): `SignatureProvider` interface with a
   draw-on-canvas + typed-consent default implementation. Write the ADR before the UI.
3. **Pre-arrival signing flow**: booking confirmation links to a phone-friendly signing page;
   no account required (same posture as booking).
4. **Status roll-up on the booking**: staff see waiver state per diver on the trip manage
   page — this is the seed of M4's "ready to board" roll-up, so name the states carefully.

Delight moments to design in (not bolt on): the post-signing "you're all set — see you at the
dock" screen; waiver status chips that make the manage roster feel alive; zero legalese in UI
copy outside the waiver text itself.

### M4 — Cert checks (after M3)

Card capture, verification workflow, trip requirements, "ready to board" roll-up combining
waiver + cert. The roll-up is the delight centerpiece: one glance answers "can everyone on
this manifest dive today?"

### Delight backlog (small, slot between milestones)

- **Booking countdown/anticipation**: confirmation page and (later) emails that build
  excitement — days-to-dive, site conditions placeholder, what-to-bring.
- **Empty states as invitations**: every staff surface's zero-state should teach the next
  action (some already do; audit the rest during M3's design review).
- **Print quality**: manifests (M6) will need print CSS; trial it early on the trip roster.

## 3. Sybaris review — what we pull in, adapt, or skip

Reviewed: `AGENTS.md`, `docs/03-architecture.md`, `docs/13-agent-coordination.md`,
`docs/archive/REVIEW-2026-07-02-ai-process-token-efficiency.md`, `.claude/skills/` (12
skills), schema/migration workflow, and the provider-seam implementations. Sybaris is
Next.js + Drizzle + Auth.js + PGlite-in-dev like us, so its process lessons transfer almost
directly; its scale (424 doc files, 130+ ADRs) previews exactly where scuba's current
conventions will break.

### 3.1 Pull in now (cheap, prevents known failures)

**Collision-resistant ADR ids.** Our sequential `0007-…` scheme guarantees id collisions the
first time two agent sessions run in parallel from the same `main`. Sybaris's fix: new ADRs
use `ADR-YYYYMMDD-short-slug` (one file per ADR, no central index to conflict on); existing
numeric ADRs stay valid history. Plus a **backstop unit test** that scans
`docs/architecture/decisions/` for duplicate ids, required sections, and file/id mismatch —
mechanical enforcement instead of asking every model to remember the rule.

**Timestamped Drizzle migrations.** Same collision, worse blast radius: two parallel schema
PRs both generate `0003_*.sql`. Set `migrations: { prefix: "timestamp" }` in
`drizzle.config.ts`. Sybaris ultimately needed a CI "Schema Migration Finalizer" that owns
`drizzle/` writes entirely; that's overkill at our size (see §3.3), but the timestamp prefix
is one line and removes the filename half of the problem today.

**Concurrent-work protocol** (new section in AGENTS.md + workflow doc, condensed from
Sybaris `docs/13`):

- No branch-local reservations — a ledger row added on a branch is invisible to every other
  pending PR, so it reserves nothing. Coordination lives in **PR-visible places**: unique
  branch slugs, draft PRs opened *early*, PR titles/descriptions, labels.
- Before declaring work done: `git fetch origin main && git merge --no-commit --no-ff
  origin/main` — resolve conflicts yourself, don't wait for a human to notice a red merge
  status. A PR with conflicts is not finished work.
- Schema PRs are the one serialized resource: label them (`schema`) and merge them one at a
  time until we need a finalizer.

**Context & token economy** (new section in AGENTS.md, adapted from Sybaris's review doc):

- **Do-not-read list**: `pnpm-lock.yaml`, `drizzle/` (schema questions → `src/db/schema.ts`),
  `.next/`, `playwright-report/`, `test-results/`, `node_modules` (except
  `next/dist/docs/`).
- **Quiet reporters**: iterate with `pnpm exec vitest run <file> --reporter=dot` and
  `pnpm exec playwright test <spec> --reporter=line`. Only failing output carries
  information; passing output is pure token cost.
- **Targeted reads**: offset/limit around the symbol, search before read. Tests-as-spec is
  already our rule; keep it.
- **CI logs**: fetch only the failed step's tail, never whole job logs.
- **Validation ownership**: while iterating, run the narrowest useful check (one test file,
  one spec, or bare `pnpm typecheck`). `pnpm check` stays the pre-commit bar, run **once**
  before commit — not replayed after every edit. CI runs the full matrix; judge the PR on CI.

**Honesty + stop rules** (AGENTS.md): report failing checks verbatim; state explicitly what
could not be verified; **three failed fix attempts on one symptom → stop, write down what's
known/ruled out, re-diagnose** (goes in the `debug` skill). These matter most for weaker
models, which are more prone to thrash and to optimistic summaries.

**`orient` skill.** Sybaris found every session re-derives "where does X live" by listing
directories. Our AGENTS.md route map is good; a tiny `orient` skill (reading order, route
map pointer, token-economy rules, do-not-read list) gives lower-capability models a single
cheap entry point instead of hoping they synthesize it.

### 3.2 Pull in with M3+ (architecture: the provider-seam pattern)

The single best structural idea in Sybaris: **every external capability lives behind a tiny
interface in `src/lib/<capability>/`, with a stub/mock implementation shipped first**, chosen
by env var. Their `AIProvider`, `PaymentProvider`, `LegalReviewProvider`, and `notify()`
boundary all follow it. Consequences we want: features are fully testable with zero infra
(PGlite posture extended to vendors), vendor choice becomes a config change + ADR instead of
a refactor, and no vendor SDK import ever leaks outside its seam directory.

Applied to our roadmap:

| Seam | Milestone | Shape |
| --- | --- | --- |
| `SignatureProvider` | M3 | `createSignatureRequest` / `verify`; v1 = draw-on-canvas + typed consent, in-house; vendor API slot-in later |
| `notify()` single event boundary | M2 leftover → M7 | one function owns "something happened"; v1 writes in-app/console, email provider slides in behind it without touching call sites |
| `PaymentProvider` | M7 | checkout/cancel/`parseWebhook` → one `applyBillingEvent()`; v1 stub = everything paid |

Rule to adopt with the first seam (ADR it): **vendor SDKs and HTTP calls only inside the
seam directory; the app imports the interface.** Zod-validate at every seam boundary.

### 3.3 Adapt later, when scale demands (watch for the trigger)

- **CI Schema Migration Finalizer** (CI regenerates `drizzle/` per schema PR, serialized by
  an Actions concurrency lock). Trigger: the first real migration collision or >2 schema PRs
  routinely in flight. Until then, timestamp prefix + serialized schema merges suffice.
- **Doc sharding + compiled aggregates** (per-entity/per-feature shard files; aggregates
  gitignored and compiled by a script, so parallel PRs never conflict on a big doc).
  Trigger: any tracked doc that many PRs append to. Adopt the *principle* now: **never
  create a tracked generated file, and never create a doc that every PR must edit** (our
  one-file-per-ADR rule is already this).
- **Coverage gates with ratchet** (Sybaris: 85% stmts / 75% branches over `src/db` +
  `src/lib`, thresholds only ever go up, exclusions must be honest). Adopt at M3 when
  waiver/medical logic lands — it converts "write good tests" from judgment into mechanism,
  which is exactly what weaker models need.

### 3.4 Skip (doesn't fit scuba)

- Ingestion/catalog pipeline, verification/labeling system, interaction budgets — product
  machinery for a curation service; no analog here.
- AI-feature seam (`src/lib/ai/`) — nothing on our roadmap needs an LLM at runtime. If a
  feature ever does (e.g. briefing-note drafting), the seam pattern in §3.2 is the template.
- Static-shells-CSR-default ADR — driven by their SEO-irrelevance; our public schedule and
  booking pages *want* server rendering.

## 4. The agent platform — multi-provider, token-lean, weak-model-safe

Sybaris's meta-lesson: **conventions enforced by memory don't survive session boundaries;
conventions enforced by tests and tools do.** Everything below is mechanism, not exhortation.

### 4.1 Harness neutrality (multiple AI providers in parallel)

- `AGENTS.md` is the canonical instruction file (industry-neutral name); `CLAUDE.md` just
  includes it — already true, keep it that way. Keep AGENTS.md free of harness-specific tool
  names; harness-specific config stays under `.claude/` (and `.cursor/` etc. if they
  appear), each thin and pointing at the shared docs/skills.
- Skills are plain markdown playbooks: Claude Code loads them on demand; any other harness
  can be told "read `.claude/skills/<name>/SKILL.md` before doing X". Add that one line to
  AGENTS.md so non-Claude agents actually find them.
- Parallel safety across providers comes from §3.1: collision-resistant ids, timestamped
  migrations, PR-visible coordination, no tracked generated files, trial-merge before done.
  None of it assumes agents share a harness, memory, or even a vendor.

### 4.2 Token economy

The §3.1 "Context & token economy" section is the always-loaded core. Two supporting habits:
AGENTS.md stays telegraphic (Sybaris caps theirs ~100 lines; ours is similar — resist
growth, push detail into skills/docs), and scripts that run in agent shells print one summary
line, not per-file logs (our screenshot script already does; keep it policy).

### 4.3 Tooling for lower-capability models

Assume future sessions run cheaper models. They deliver quality when the repo makes the
right move the obvious move and catches the wrong move mechanically:

1. **Backstop tests for conventions** — extend CI to enforce what currently lives in prose:
   ADR id/format test (§3.1); a dependency-direction test (`src/lib/` importing `src/app/`
   fails); a semantic-token test (raw hex / palette-scale classes in `src/app/**` fail —
   today this is only caught by review).
2. **Skills as recipes, not essays** — every skill gives exact commands, exact file paths,
   and a "known pitfalls" list. Audit existing skills against this bar during M3; add
   `orient` (§3.1).
3. **Checklists at the exit** — a PR template mirroring the workflow's definition-of-done,
   so "did you look at the UI in dark mode" is a checkbox a weak model must claim, not a
   norm it must recall.
4. **Adversarial invariant tests** — every invariant (capacity never oversells; canceled
   trips take no bookings; medical block gates signing) gets a test that actively tries to
   violate it. Make this an explicit policy line in `engineering/testing.md` at M3.
5. **Guardrails skill for safety-critical surfaces** — one page listing the invariants, the
   files that own them, the required failure-path tests, and the mandatory
   `dive-domain-expert` review, so a session touching manifests/medical/cert code gets the
   full constraint set in one read. Write it at M4 when cert gating lands (M3's medical
   blocking is its first entry).
6. **Stop rules** — the three-strikes re-diagnosis rule (§3.1) bounds thrash, which is the
   dominant failure mode of weaker models.

## 5. Sequenced action list

**Now (process PRs, before M3 code):**

1. AGENTS.md: add Context & token economy, concurrent-work protocol, honesty/stop rules,
   one-line skills pointer for non-Claude harnesses (§3.1, §4.1).
2. `drizzle.config.ts`: timestamp migration prefix (§3.1).
3. ADR id scheme switch + backstop test for ADR format/uniqueness (§3.1) — record via an ADR
   using the new scheme.
4. Backstop tests: dependency direction, semantic tokens (§4.3.1).
5. `orient` skill; fold quiet-reporter guidance into `verify` and the three-strikes rule
   into `debug` (§3.1, §4.3).
6. PR template with the definition-of-done checklist (§4.3.3).

**M3 (feature + architecture):**

7. Waivers slice per §2, starting with the `SignatureProvider` seam + ADR (§3.2).
8. Coverage gate with ratchet policy (§3.3); adversarial-invariant policy line in
   `engineering/testing.md` (§4.3.4).
9. `notify()` boundary if booking confirmations land here rather than M7 (§3.2).

**M4:**

10. Cert checks + "ready to board" roll-up (§2); `guardrails` skill (§4.3.5).

**Triggers to watch (no action until they fire):** migration collision → CI finalizer;
every-PR-edits-it doc → sharding + compile step (§3.3).
