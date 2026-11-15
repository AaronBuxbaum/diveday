# 20261115-logbook-partner-protocol-adapters — Gate logbook API imports on verified partner contracts

- **Status:** Accepted
- **Date:** 2026-11-15

## Context

Aaron requested logbook API integration and will obtain credentials. Public official documents
establish useful OAuth operations but not a complete safe data-import contract. A key cannot
establish response schemas, data-owner consent, revocation or erasure behavior. Existing personal
computer evidence must remain separate from operational safety data.

The [partner API runbook](../../engineering/logbook-partner-api-runbook.md) records the sources,
implemented operations and concrete setup requirements. Garmin's two public OAuth PDFs disagree on
the token hostname; Suunto's readable public documentation leaves critical lifecycle and data
operations unestablished. Detailed partner materials must be handled under the relevant agreements.

## Decision

Implement server-only, mock-tested beta protocol adapters with an explicit provider allowlist and
capability descriptions. Garmin implements documented S256 PKCE, code exchange, refresh rotation,
identity, permissions and registration deletion. Require an explicit documented token-host selection
and confirmation through approved partner access; never silently fall back between hosts.

Suunto implements its documented authorization-code exchange and identity correlation. Do not
invent refresh or revocation operations. An unsupported refresh refuses; revoke explicitly reports
manual action and does not claim remote success. Provider identities never assert local authority.

Bound response sizes and time, refuse redirects, and return finite error codes without provider
bodies, credentials or URLs. No new dependency, persistence, callback route, connected-account UI
or workout fetch is introduced. No credentials are configured or collected by this layer.

Keep API import disabled through an explicit contract gate. A future consuming service must bind
single-use state/PKCE to the authenticated browser, tenant, provider and account owner; seal scoped
credentials; coordinate refresh/disconnect and erasure; verify upstream revocation; and establish
approved activity schemas and download contracts. Supported data then enters the existing explicit
personal preview and idempotent confirmation. File import remains the usable product path.

## Alternatives considered

- **Infer undocumented data endpoints or schemas** — beta labelling cannot make an invented contract safe.
- **Use Garmin Personal API keys** — unsuitable for a commercial service serving multiple users.
- **Enable account connections before lifecycle support** — creates sensitive retained grants without a complete consent and removal path.
- **Wait without implementation** — published protocol operations and their adversarial tests can be delivered now.

## Consequences

Approved credentials and contracts can be integrated behind an existing tested provider seam.
Actual API-to-logbook import remains blocked, and no live interoperability or partnership is claimed.
Once approved contracts and representative fixtures are available, add the scoped connection service
and importer in a new change; no existing personal or operational data migration is needed.
