# company-identity

This module owns the company identity use case and publishes its contract through `index.ts`.

## Owns

- `rules.ts`: the operating company's registered name, postal address and confirmed governing law, and the founder's name.

## Does not own

The sentences that carry them (`marketing.terms.contact.operator`, `marketing.privacy.contact.operator`,
`marketing.about.founderRole`) and the pages that render them stay in their existing layers.

## Invariants

These are facts Aaron supplied on 2026-11-11, never copy and never inferred. The company and Massachusetts governing law are named
on `/terms` and `/privacy` (confirmed on #4323); the founder's name signs `/about` and appears nowhere else.
