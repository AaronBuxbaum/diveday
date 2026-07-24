# Dive operations & safety — stakeholder playbook

The safety spine (manifests, roll call, readiness, medical flags, nitrox) ships on provisional
policy and is unproven in the field. These conversations turn it into evidence. Status of record:
[human-decisions.md](../human-decisions.md) rows **H-05** (offline-manifest thresholds), **H-06**
(gear policy remainder), **H-08** (course/agency rules remainder), **H-11** (nitrox fill-station
policy), and verification rows **V-01, V-02, V-04, V-05**.

## Why this blocks rollout

- **V-02 is the single most important pre-pilot task** (the rollout says so verbatim): the
  offline manifest is differentiator #2, and until it survives a real boat — glare, wet hands,
  airplane mode — no marketing surface may claim it (claims policy in
  [marketing.md](../marketing.md)).
- Safety-critical surfaces carry AGENTS.md's hardest rules: any field-discovered manifest or
  readiness defect is a stop-the-line fix during pilots.
- Course and nitrox operations run on conservative provisional rules a real shop will exceed on
  day one; the gaps are policy questions only operators can answer.

## Who to talk to

| Stakeholder | About | When |
| --- | --- | --- |
| Dive operations lead — a named human (realistically the founder until a pilot shop's ops lead takes it) | Owns V-02/V-04 execution and the H-05/H-06 acceptance | Name them now; it's the same "write it down" exercise as H-04 |
| A friendly charter captain + their boat | The V-02 field day; later, first pilot boat day | Schedule within 30 days — needs weather, a hull, and goodwill |
| `dive-domain-expert` reviewer | Sign-off on V-02 findings and V-05 nitrox correctness (agent review per AGENTS.md) | At each review point, before merge/production |
| A gas-blending authority (instructor-trainer or fill-station operator) | H-11: fill procedure, ppO₂ ceilings, blender qualifications, O₂-clean tracking | Before any shop operates a fill station — not a pilot blocker unless the pilot fills |
| Pilot shop instructors / course director | H-08 remainder: real course prerequisites, ratios, DSD rules, refresher policy | Phase 1 week 0 |

## V-02 — the boat day (run the script, record everything)

The full script lives in the
[human verification queue](../human-decisions.md#human-verification-queue) (V-02 row). What to
have prepared so the day isn't wasted:

- **Device matrix:** at least the founder's phone plus one cheap/older phone; note exact
  device/browser/OS versions in the evidence.
- **Seeded, realistic trip** with a blocked diver and a stale-readiness case already in place
  (rehearsed beforehand as part of V-04's dry run).
- **The printed fallback** in hand — the print/PDF manifest is part of the script, not an
  afterthought ([manifest-live-first ADR](../../architecture/decisions/20260718-manifest-live-first.md),
  [offline snapshots ADR](../../architecture/decisions/20260718-offline-manifest-snapshots.md)).
- **Recording plan:** screen recording on-device, photos of the phone in glare, notes template
  matching the V-02 evidence list (freshness shown, reconciliation results, findings).
- **The stop rule** already understood: what the crew does when the device copy is missing,
  expired, or corrupt (H-05's recorded rule).

Outcome: V-02 evidence + `dive-domain-expert` sign-off, or a written decision to pilot with
print-backup-only and zero offline claims (the rollout's
[pre-decided response](../rollout.md#risks-and-pre-decided-responses)).

## V-01 and V-04 — the cheap rehearsals

- **V-01 (browser pass):** run it now; it needs a desk, not a boat. Evidence list is in the
  verification queue.
- **V-04 (pilot dry run):** seed a fictional but realistic week; rehearse check-in → prep → roll
  call end-to-end. Its checklist becomes pilot week-0's script
  ([commercial-and-industry.md](commercial-and-industry.md) owns the pilot relationship; this
  playbook owns the operational rehearsal).

## H-06 remainder — gear policy questions (for the ops lead + pilot shop)

The default-kit and computer-pricing halves are decided; still open, and best answered by a real
shop's counter staff:

- Measurement method: what does the shop actually ask for (height/weight bands vs. tried-on
  sizes), and does the booking request match it?
- Substitution authority: who may override a requested size/item, and is that visible to the
  diver?
- The safe fallback when a requested size is unavailable — the answer must fail closed at
  check-in, never silently at the dock.

## H-08 remainder — course/agency rules (for instructors)

Per course the shop actually sells: prerequisites and proof, instructor ratios, DSD/intro rules
(the no-C-card path), age minimums and junior handling, medical triggers, refresher policy (the
"refresher due" framing — see the
[certification-expiry ADR](../../architecture/decisions/20260723-certification-expiry-date-only.md)),
and the exception process (who may waive what, recorded how).

## H-11 / V-05 — nitrox (only when a shop fills)

Question list for the blending authority: fill log of record (paper sticker vs. system), accepted
ppO₂ ceilings vs. the provisional 1.4/1.6 defaults, the EANx band (provisional 22–40%), blender
qualification records, O₂-clean tank tracking, and per-agency card-acceptance rules. The
[provisional parameters](../human-decisions.md#nitrox-fills) are the strawman to correct, and
V-05 is the `dive-domain-expert` review that closes it.

## Where outcomes land

- V-rows get their evidence recorded verbatim in the
  [verification queue](../human-decisions.md#human-verification-queue); H-05/H-06/H-08/H-11 rows
  move state with dates and owners.
- A passing V-02 unlocks offline roll-call claims through [marketing.md](../marketing.md)'s
  claims policy — the claim ships only after the evidence exists, never before.
- Field defects on safety surfaces become stop-the-line fixes with regression tests, per
  AGENTS.md hard rules; policy gaps become updates to the
  [provisional defaults](../human-decisions.md#provisional-implementation-defaults--verify-before-production).
