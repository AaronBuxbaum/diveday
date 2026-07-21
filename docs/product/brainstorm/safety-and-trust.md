# Brainstorm 2 — Safety & trust

**Lens:** DiveDay touches lives. Manifests, roll call, cert gating, and medical flags are the surfaces
where a bug isn't a bug — it's a diver left on the surface or a person diving beyond their training.
"Trustworthy by inspection" (design principle #6) is a promise. This document explores how to make
*safe departure* the thing shops switch to us for, and how to earn a captain's trust the first time
they run a manifest on our app instead of a clipboard.

Grounded in [glossary.md](../glossary.md) (manifest, roll call, medical statement, cert levels,
service state, nitrox) and the M6 note in [roadmap.md](../roadmap.md): *the safety-critical
milestone — domain review required.*

---

## The trust thesis

A clipboard never crashes, never loses signal, and never silently drops a name. To replace it we must
be **as reliable as paper and more honest than memory**. Every idea below is judged on one question:
*does it make an unsafe departure harder, or does it add a way for the software to lie?*

Safety-critical surfaces get **boring code, failure-path and adversarial tests, and a
`dive-domain-expert` review** (a hard rule in AGENTS.md). Nothing here ships on vibes.

---

## A. The readiness model as a safety boundary

Phase C of [next-steps](../next-steps.md) calls for a reusable requirement/readiness result rather
than status hard-coded per screen. Treat it as *the* safety spine.

- **Typed readiness with reasons.** A booking is `ready | blocked | pending`, and *blocked* always
  carries human-readable reasons ("Deep specialty required for the wreck; on file: OW only").
  Never a bare boolean. *(M, certs/cross-cutting, big bet.)*
- **Fail closed on unknown evidence.** If required evidence is missing or unverifiable, the answer
  is *not ready* — never a silent pass. Table-driven tests over every state combination. *(M,
  certs, big bet.)*
- **One source, three views.** The same readiness result feeds the staff roster, the diver
  confirmation, and the manifest — so they can never disagree. Disagreement between screens is the
  classic safety bug. *(M, cross-cutting.)*
- **Requirement-vs-evidence separation.** Trip/site requirements live apart from a diver's cards, so
  changing a site's minimum cert re-evaluates every booking automatically. *(M, certs.)*

## B. Manifest & roll call — the nightmare-scenario surfaces

A diver left behind is the industry's worst day. The design must make that *structurally* hard.

- **No silent disappearance.** A diver with incomplete data never just vanishes from the manifest —
  they appear with an explicit blocker. Missing data is *visible*, never absent. Adversarial test:
  corrupt/partial records must still render the person. *(M, manifests, big bet.)*
- **Two-phase roll call.** Before departure *and after every dive* (per glossary). The app tracks
  the count in and the count out, and refuses to show "all clear" until out == in. *(M, manifests,
  big bet.)*
- **Buddy pairs / teams.** Optional buddy assignment so roll call can surface "diver X's buddy Y is
  not yet back." Mirrors how dives are actually run. *(M, manifests.)*
- **Headcount reconciliation.** A captain enters a physical headcount; the app cross-checks against
  the boarded list and flags any mismatch loudly. Trust the human's eyes, catch the discrepancy.
  *(M, manifests, big bet.)*
- **Tabular, exact, unambiguous.** Tabular-figure counts, icon+label states (never color alone),
  timestamps with timezone — principle #6 applied literally. *(S, manifests, quick win.)*
- **Incident-resistant audit trail.** Every boarded/not-boarded change is append-only with who and
  when, so a manifest can be reconstructed after an incident. *(M, manifests, big bet.)*

## C. Offline is a safety requirement, not a nicety

Boats lose signal. If the manifest needs Wi-Fi, it's a liability.

- **Offline-tolerant cached snapshot** with **explicit freshness** ("as of 8:42 AM — offline") and
  a reconciliation status when signal returns. Never present stale data as live. *(L, manifests,
  big bet — needs an offline ADR per next-steps Phase E.)*
- **Conflict-safe reconciliation.** Two devices editing one manifest offline must merge without
  dropping a boarding event. Append-only log makes this tractable. *(L, manifests, big bet.)*
- **Print/PDF from the same model.** The paper fallback is generated from the identical manifest
  data, so the backup can't disagree with the screen. Coast-guard-clean layout. *(M, manifests.)*
- **Degrade loudly.** If the snapshot is too old to trust, the UI says so in words a captain reads
  in glare — it does not quietly show yesterday's boat. *(S, manifests, quick win.)*

## D. Medical & waiver gating

Some medical answers require a physician sign-off — a *blocking state, not a checkbox* (glossary).

- **Referral fails closed and explains.** A referral-triggering answer blocks boarding and states
  the next step plainly ("A doctor's sign-off is needed before you can dive — here's the form").
  *(M, waivers, big bet.)*
- **Immutable signed history.** Editing a template creates a new version; signed records are never
  rewritten. Adversarial tests for stale-template signing and duplicate submission. *(M, waivers,
  big bet — per next-steps Phase B.)*
- **Tamper-evident artifacts.** Signed waiver metadata is idempotent and integrity-checked; a
  replayed or altered submission is rejected. *(M, waivers.)*
- **Expiry & resume without loss.** A pre-arrival link can expire and resume without losing entered
  data or audit trail. Polished expired-link and already-completed states. *(M, waivers.)*

## E. Cert & nitrox correctness

- **Verified vs claimed.** A diver's *claimed* level and a *staff-verified* card are different
  states; gating uses verified only. Pending/rejected/expired/insufficient are all distinct. *(M,
  certs, big bet.)*
- **Site-requirement gating at booking and check-in** — checked twice (glossary), because certs can
  change between the two moments. *(M, certs.)*
- **Nitrox guardrails.** Only nitrox-certified divers can be assigned nitrox tanks; each fill is
  O2-analyzed and logged (mix %, analysis, signature) before use. Fail closed on missing analysis.
  *(M, gear/certs, big bet — safety-critical.)*
- **Out-of-service gear is un-assignable.** Regs/BCDs past service and tanks past VIP/hydro cannot
  be handed out — the assignment UI can't even offer them. *(M, gear, big bet.)*

---

## F. Trust-building mechanics (cross-cutting)

- **Provenance on every safety fact.** Hover/tap any readiness state to see *why* and *from what
  record* — inspection over faith. *(M, cross-cutting.)*
- **Emergency-contact surfacing.** One tap from any diver on the manifest to their emergency
  contact and DAN info (glossary — "worth a field"). *(S, manifests, quick win.)*
- **Quiet, honest error handling.** Errors on safety surfaces say what happened and what to do,
  never a stack trace or a shrug. *(S, cross-cutting, quick win.)*
- **A safety-invariant test suite** run in the merge gate: capacity never exceeded, boarded never
  exceeds manifest, no dive gated on unverified certs, no nitrox to non-nitrox divers. Adversarial,
  table-driven. *(M, cross-cutting, big bet.)*
- **Threat/failure-mode review ritual** before the manifest milestone (per next-steps Phase E):
  enumerate every way a diver could be lost or mis-gated and test each. *(M, manifests.)*

## What NOT to do

- No optimistic UI on boarded/not-boarded — truth outranks feel here, always.
- No color-only safety state — icon + label + tabular figure, per principle #6.
- No silent failure — an unsafe condition must be loud; a crash is safer than a lie.
- No cleverness in safety code — boring, inspectable, over-tested (hard rule).

## Highest safety-per-effort (if picking today)

1. The typed readiness model with reasons, failing closed — **M, the spine everything else hangs on.**
2. No-silent-disappearance + two-phase roll call for the manifest — **M, the nightmare-scenario guard.**
3. Safety-invariant test suite in the merge gate — **M, catches regressions weaker agents introduce.**
4. Explicit-freshness offline snapshot — **L, but the reason a captain trusts us over Wi-Fi-bound tools.**
5. Emergency-contact + provenance surfacing — **S, quick wins that read as "this app was built by people who dive."**
