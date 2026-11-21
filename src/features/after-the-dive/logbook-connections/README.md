# Partner logbook protocols

Server-only, mock-tested beta OAuth adapters for Garmin Business and Suunto Cloud. This layer
implements only published protocol operations. It does not connect an account, persist credentials,
create a callback route, fetch workouts or import personal evidence. The existing file-import flow
remains the usable product path. `requireLogbookDataContract` refuses API import until the approved
activity/download and lifecycle contract is established and tested. Keys alone do not unlock it.

Garmin supports S256 PKCE, authorization-code exchange, rotating refresh tokens, identity,
permissions and registration deletion. The token host must be selected explicitly from the two
hosts published in conflicting official PDFs, then confirmed through the approved partner portal.
Suunto supports its documented code exchange and identity correlation; its refresh method refuses,
and revoke reports that the user must revoke through Suunto. State return and live interoperability
remain unverified. All providers remain beta.

Tokens stay in server memory, and provider errors contain only finite codes. No credentials appear
in errors or logs. Requests use fixed HTTPS hosts, reject redirects, enforce timeout/body limits and
perform no automatic retries. Provider tokens and identities are never local authentication proof.

A future connected-account layer must bind single-use state and PKCE to the authenticated browser,
shop, account owner and provider; recheck live authorization before and after network calls; seal
scope-bound credentials; serialize refresh/disconnect; handle provider revocation and erasure before
allowing use; and feed supported data into the existing explicit personal preview/confirmation.
A recap or other unrelated bearer token must grant none of those powers. No operational dive,
readiness, roll-call, recency or no-fly input may be written.

Setup, public evidence and the precise missing contracts:
[partner API runbook](../../../../docs/engineering/logbook-partner-api-runbook.md).
