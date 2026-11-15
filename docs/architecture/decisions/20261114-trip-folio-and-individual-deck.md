# 20261114-trip-folio-and-individual-deck — Organize the Trip around guest folios and individual Deck records

- **Status:** Accepted — Aaron approved the folio and individual Deck design on 2026-11-14 and requested implementation
- **Date:** 2026-11-14
- **Amends:** [20261001-logbook](20261001-logbook.md), departure navigation and boat workflow;
  [20261015-roll-call-records-readiness](20261015-roll-call-records-readiness.md), explicit physical-presence evidence

## Context

The owner found the Trip roster busy and difficult to use. Several designs were evaluated; the
accepted direction combines guest folios with a routine boat workflow that fits one phone screen.
The owner explicitly rejected every multi-person recording action, including named groups, and
approved optional buddy planning that does not organize Deck. [Implementation issue #4527](https://github.com/AaronBuxbaum/diveday/issues/4527)
records the scope and acceptance.

## Decision

The Trip has four workspaces: Guests, Equipment, The day and Record. Guests presents each person's
independent blockers and remedies in one folio; preparation, arrival and booking actions retain
their existing authority. Record is ordinary trip history with separately authorized exports.
Open Deck enters the focused boat experience explicitly.

Deck records exactly one named person per action, including crew and riders. It displays that
person's receipt before a separate Next action. Selecting, skipping, starting or advancing creates
no evidence. Progress is derived; there is no count input, group confirmation or everyone-aboard
operation. Routine states fit one small phone screen with a large primary action. The list, history,
observation timing and less frequent operations open on request; serious unresolved reports stay
visible and take priority.

An explicitly chosen observation time uses the event's existing `occurredAt`; `createdAt` retains
recording time. Neither clock establishes which evidence the recorder observed. Existing causal
reconciliation, exact-statement withdrawal, encrypted offline storage and per-event sync remain.

An explicit physical-presence exception can record one readiness-blocked person aboard before
departure without changing eligibility or check-in. It applies only to active held seats, retains
capacity constraints, records the exception intent and blocker codes, and preserves readiness
warnings. Released seats retain the existing durable boarding-sighting workflow. Ordinary boarding
still applies live readiness. The same exception intent survives retries and offline replay.

Buddy planning moves to The day behind a default-on shop feature switch. Off removes its controls,
not its history. It never determines readiness, capacity or roll-call completion.

## Alternatives considered

- **A thinner permanent roster** — still makes the captain scan and choose among many controls
- **Named group confirmation** — explicitly rejected; one action must never record multiple people
- **Automatic next-person recording** — risks a repeated tap recording another person
- **Device-only buddy visibility** — does not express the shop's optional feature choice

## Consequences

Existing domain machinery remains authoritative while its presentation changes substantially.
Browser and visual tests must exercise the new journeys; wet-hand and sunlight usability still
require actual hardware evaluation. Revisit the composition if field work exposes navigation
friction, preserving individual intent and evidence. The switch and UI are reversible; recorded
history remains append-only.
