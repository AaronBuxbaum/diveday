# 20261027-junior-card-evidence — Record junior card evidence explicitly

- **Status:** Accepted
- **Date:** 2026-10-27

## Context

Issue #2810 exposed agency differences: a NAUI junior card keeps its restrictions
until a full replacement is issued, and SDI junior qualifications can require a
separate upgrade. DiveDay stores neither card wording nor actual underwater groups.
An age or lookup result alone cannot establish that a card was upgraded. The product
owner chose agency-specific safeguards and a staff-verification path on 2026-10-27.

## Decision

Each level card has an unknown, junior, or full state. Only a live staff member may
record a sighting of a verified card; their identity, time and every correction are
retained with the card. Existing and imported cards start unknown. An agency lookup
never sets the state. A deleted card retains its history; person erasure removes it.

Depth and supervision uncertainties are staff advisories, including when no site
maximum is known. They do not change admission or boarding readiness. More than one
verified card is considered, and an uncertain card cannot be cleared by assuming
what another card means. One-tap party suggestions leave unresolved restrictions
for staff; a manual team is a decision, not evidence of an underwater group.

A shop may require a certified adult with 15–17-year-olds for one-tap party teams;
the setting defaults off. The server re-reads the policy on the write.

## Alternatives considered

- **Infer from age or a lookup** — cannot establish whether a replacement card exists.
- **Block boarding** — a site maximum is not a dive plan and the crew may resolve the facts.

## Consequences

Staff must verify facts the shop has not recorded. A junior age does not stand for
all agency standards, and a warning is not a compliance certificate. Review the
policy when card evidence or instructor standards change; migrating the explicit
sightings and their history is required before replacing this model. This amends the
age-only junior depth provision of [20260730-site-depth-and-diver-age-surfaces](20260730-site-depth-and-diver-age-surfaces.md),
without changing its other decisions.
