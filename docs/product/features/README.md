# Features

The single home for DiveDay's unbuilt and not-yet-built work, in every shape it comes in: a
sequenced roadmap slice, a concrete open ticket, a raw one-line brainstorm idea, or an AI/ML
concept. Consolidated here 2026-08-01 so a feature idea has exactly one place to live instead of
four — before this, the roadmap, the persona-review backlog, and brainstorm ideas were three
separate top-level files, and AI ideas were themselves split across a brainstorm note and a
specialist audit's ML & data section.

| File | What it holds | Update when… |
| --- | --- | --- |
| [roadmap.md](roadmap.md) | **The most authoritative file here** — sequenced open work, unscheduled candidate subsystems, the engineering-enablement backlog, north-star measures, and human-owned production gates | scope shifts; when an item ships, move it to [../shipped.md](../shipped.md) |
| [story-backlog.md](story-backlog.md) | Open, partial, or review-blocked tickets carried out of the 2026-07-30 persona review, cross-referenced to the persona/lens each serves | a ticket is picked up (close it out) or a new gap is found against [../personas.md](../personas.md) |
| [brainstorm.md](brainstorm.md) | Non-canonical idea backlog — raw, unfiltered opportunity notes that don't require AI. Nothing here is approved scope | you want to record a feature idea; never cite it as a decision |
| [participant-types.md](participant-types.md) | One scoped-but-unscheduled subsystem: snorkellers and boat riders on a diver's departure — different prices, different gates, the same head count | the scope changes, or a pilot shop's answer to the C3 call-script questions moves an assumption in it |
| [ai-ml.md](ai-ml.md) | Every AI/ML-shaped idea in one place — raw brainstorm assistants alongside the specialist audit's eight prompt-ready ML & data tasks | you have an idea that needs AI, model-based extraction, or natural-language generation — do not start a second AI-ideas file elsewhere |

## How the four files relate

Read them as a funnel, least to most committed:

1. **[brainstorm.md](brainstorm.md) / [ai-ml.md](ai-ml.md)** — raw ideas, unscoped, no commitment.
2. **[story-backlog.md](story-backlog.md)** — concrete gaps a review already found, but not yet
   sequenced.
3. **[roadmap.md](roadmap.md)** — sequencing guidance, the closest thing to a plan (still "not a
   contract").

An idea earns its way up this list — from a bullet in `brainstorm.md`/`ai-ml.md` to a numbered slot
in `roadmap.md` with a milestone and, where the rule requires it, an ADR — rather than being built
straight from a brainstorm entry.

## Rules

- **This folder is ideas and sequencing, not delivery status.** What's already built lives in
  [../shipped.md](../shipped.md); check there first so you don't propose something that already
  exists.
- When a roadmap item ships or a backlog ticket closes, remove it here and record the delivery in
  [../shipped.md](../shipped.md) (with its ADR link) instead of leaving it marked done.
- [../rollout.md](../rollout.md) (go-to-market) and [../human-decisions.md](../human-decisions.md)
  (the gate register) point *into* this folder for feature detail — they sequence and gate, they
  don't duplicate a feature write-up that belongs here. Keep it that way: if you find yourself
  describing a feature in either of those files, move the description here and leave a link.
- The GitHub issue tracker's `needs-triage` label (see
  [../../agents/issue-tracker.md](../../agents/issue-tracker.md)) is the inbox *upstream* of this
  folder, not a fifth file in it: an agent files a thought there mid-change, and when the human
  accepts it, the decision moves here (or into [../human-decisions.md](../human-decisions.md), or
  becomes an ADR) and the issue is closed. Never leave an accepted item living in both places.
- Dated buyer/rival analyses under `docs/product/assessments/` (see [the doc map](../../README.md)
  for the full list) feed this folder — a surviving recommendation belongs here (usually
  `roadmap.md`), not left sitting only in the assessment.
