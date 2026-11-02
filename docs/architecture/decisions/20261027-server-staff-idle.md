# 20261027-server-staff-idle — End inactive staff sessions on the server

- **Status:** Accepted
- **Date:** 2026-10-27

## Context

An unattended counter tablet could keep a seven-day Better Auth session alive through passive
refreshes even after the desk's twelve-hour input timer stopped. Issue #3021 calls for the server
to enforce that same working-day limit, while the saved offline manifest retains its separately
approved retention and unsent roll-call behavior (H-20261023-medical-alert-for-the).

## Decision

Each database session has its own last recorded staff input. Live session reads reject it after
twelve hours, independently of Better Auth's sliding expiry and cookie cache. Only a same-origin,
authenticated staff input request advances it; passive rendering, refresh, prefetch, push and
offline synchronization do not. The update locks the session before reading the clock and refuses
expired or revoked rows. A request is bound to the session displayed in that tab, so an old tab
cannot renew a different account after another sign-in. The client coalesces input over ten seconds
and flushes pending input on page hide. A copied session cookie can still be used to simulate input;
the idle timer is not proof of a human presence.

The staff shell covers its contents when it cannot confirm the session, without deleting unsent
work. Signing in remains an explicit action. The offline manifest is a separate, saved device copy
and remains available under its own expiry and privacy rules. Existing sessions receive a
twelve-hour grace from migration; new sessions start at creation.

## Alternatives considered

- **Count every request as activity** — background refreshes could indefinitely extend a desk session.
- **Client-only timer** — a warm cookie or another request can still access staff data.

## Consequences

Each active session writes an activity timestamp at most once per ten seconds during continuous
input, with a final flush. Cross-tab revalidation requires the server; an offline staff page is
covered when its session cannot be confirmed. Revisit the limit or input policy if field evidence
shows it interrupts desk work; changing the policy and its stored timestamp needs a migration only
if the meaning of the field changes.
