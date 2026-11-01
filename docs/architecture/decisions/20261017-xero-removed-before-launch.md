# 20261017-xero-removed-before-launch — Xero is removed before launch, and one revert brings it back

- **Status:** Accepted
- **Date:** 2026-10-17

## Context

[20260907-xero-beside-quickbooks](20260907-xero-beside-quickbooks.md) added Xero as a fourth
connector beside QuickBooks, with its own adapter, callback route, settings card, two env keys and
delivery tests. Both do the same job, pushing each paid order as a sale and each refund as a refund
record, and nothing about them is shared code, so carrying two doubles what an accounting change
touches. DiveDay has no shops yet (H-20260815-no-legacy). Aaron decided on 2026-10-17 to keep QuickBooks, remove
Xero, and keep the way back short because Xero may return (issue #2818).

## Decision

- **Xero is removed in one commit**: the adapter and both its test files, the callback route, the
  Settings card and its actions, the registry, dispatcher and backfill entries, the `xero` value
  of `integration_provider` (a migration that first deletes any Xero rows), `XERO_CLIENT_ID` and
  `XERO_CLIENT_SECRET`, the en-US and es-ES strings, the e2e line and the live docs.
- **Restoring it is `git revert` of that commit.** Find it with
  `git log --grep "Remove the Xero connector"`. Nothing Xero-related lives in any other commit, so
  the revert is whole. Reverting restores the code, the enum value and the env keys, not the rows
  the migration deleted; a returning Xero shop reconnects.
- **The deploy window is accepted.** The previous release still serves the Xero connect and callback while the migration runs. No tenant has a Xero row (H-20260815-no-legacy), so a connect attempt in that window fails the migration or 500s, and both outcomes are acceptable.
- **Runbook:** revoke DiveDay in Xero connected apps; delete `XERO_*` from Vercel.
- **QuickBooks, Shopify and Zapier are unchanged.** Their shared tables and the provider-agnostic
  dispatcher stay as they were.
- **A shop that wants Xero before it returns** uses the Zapier hook, as before 2026-09-07.

## Alternatives considered

- **Keep both connectors** — carries a second adapter and test suite for a market no shop has yet.
- **Hide Xero behind a flag** — leaves the code, the enum value and the env keys to rot; a revert
  is cheaper and honest.
- **A shared accounting helper** — the two APIs differ too much for it to save anything.

## Consequences

- **Easy:** one accounting path to test and explain; the integrations page lists three cards.
- **Hard:** a Xero shop has no direct connector. A returning Xero needs the revert merged with
  whatever changed in the shared integration code since.
- **Commits us to:** keeping the removal commit self-contained. A later change that mentions Xero
  outside it makes the revert partial.
