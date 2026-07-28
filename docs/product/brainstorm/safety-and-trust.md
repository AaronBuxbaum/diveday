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

- [x] **Typed readiness with reasons.** (Shipped) Booking readiness checks return explicit states with detailed explanations of missing or expired items.
- [x] **Fail closed on unknown evidence.** (Shipped) Unverified or missing cert/waiver evidence fails closed to blocked status.
- [x] **One source, three views.** (Shipped) Roster, manifest, and confirmation pages share identical readiness engine outputs.
- [x] **Requirement-vs-evidence separation.** (Shipped) Site-specific certification requirements are evaluated against dynamic diver credentials.

## B. Manifest & roll call — the nightmare-scenario surfaces

A diver left behind is the industry's worst day. The design must make that *structurally* hard.

- [x] **No silent disappearance.** (Shipped) Roster and manifest surfaces display every guest with explicit validation alerts rather than hiding them.
- [x] **Two-phase roll call.** (Shipped) Manifest tracks headcount checkpoints before departure and after every dive.
- **Buddy pairs / teams.** Optional buddy assignment so roll call can surface "diver X's buddy Y is not yet back." Mirrors how dives are actually run. *(M, manifests.)*
- **Headcount reconciliation.** A captain enters a physical headcount; the app cross-checks against the boarded list. *(M, manifests, big bet.)*
- [x] **Tabular, exact, unambiguous.** (Shipped) Icons, labels, timestamps, and layouts optimized for phone screen visibility.
- [x] **Incident-resistant audit trail.** (Shipped) Append-only boarding status history tables capture all changes.

## C. Offline is a safety requirement, not a nicety

Boats lose signal. If the manifest needs Wi-Fi, it's a liability.

- [x] **Offline-tolerant cached snapshot.** (Shipped) IndexedDB encrypted snapshots with freshness states automatically synced for trips in a 48-hour window.
- [x] **Conflict-safe reconciliation.** (Shipped) Idempotent append-only device actions reconcile with newer server events.
- [x] **Print/PDF from the same model.** (Shipped) Roster print view shares the identical manifest dataset.
- [x] **Degrade loudly.** (Shipped) Freshness status states (fresh/aging/stale) display when offline.

## D. Medical & waiver gating

Some medical answers require a physician sign-off — a *blocking state, not a checkbox* (glossary).

- [x] **Referral fails closed and explains.** (Shipped) Positive answers block check-in and require doctor sign-off uploads.
- [x] **Immutable signed history.** (Shipped) Versioned templates keep historical releases frozen; edits create new immutable versions.
- **Tamper-evident artifacts.** Signed waiver metadata is idempotent and integrity-checked. *(M, waivers.)*
- [x] **Expiry & resume without loss.** (Shipped) Progress is saved on mobile-first completion flows with clear expired/unavailable page states.

## E. Cert & nitrox correctness

- [x] **Verified vs claimed.** (Shipped) Gating is based on staff-sited or manually verified agency check entries; unverified inputs do not clear gates.
- [x] **Site-requirement gating at booking and check-in.** (Shipped) Site certification levels and specialty requirements gate enrollment.
- [x] **Nitrox guardrails.** (Shipped) Nitrox mix requests are gated by enriched-air credentials and restricted to shops offering nitrox fills.
- [Superseded] **Out-of-service gear is un-assignable.** *(Gear inventory tracking was removed in M5 in favor of direct rental size records. Lightweight service registers are unbuilt).*

---

## F. Trust-building mechanics (cross-cutting)

- [x] **Provenance on every safety fact.** (Shipped) Detailed warnings explain exactly why a diver is blocked (e.g., missing waiver version, unverified nitrox card).
- [x] **Emergency-contact surfacing.** (Shipped) sur­faced on manifest lists and collected via waivers and `/ready` flows.
- [x] **Quiet, honest error handling.** (Shipped) Clear error notifications with action items (like email resends or credential checks).
- [x] **Safety-invariant test suite.** (Shipped) CI gates enforce transactional capacity limits, checkouts, and readiness validations.
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
