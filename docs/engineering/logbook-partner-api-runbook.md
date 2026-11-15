# Garmin and Suunto partner logbook APIs

The `logbook-connections` feature contains server-only, mock-tested beta protocol adapters.
It is not a connected-account product flow. There are no callback routes, persistent grants,
background synchronization or API workout imports in this layer. The working product path remains
file import with preview, selection and confirmation. `requireLogbookDataContract` refuses API
import. Do not remove that gate just because credentials have been obtained.

## Credentials and approvals

Obtain credentials for DiveDay's own approved business application. Store client secrets and
subscription keys in the deployment secret manager when a consuming service is implemented;
never send them through chat, commit them, put them in a URL or return them to a browser.
No environment variables are consumed by this adapter-only layer. Clients accept an explicit
server-side `LogbookProviderConfig`; documentation below names requirements, not configured values.

| Provider | Application requirements | Values needed after approval |
| --- | --- | --- |
| Garmin Business Activity API | Apply to the Garmin Connect Developer Program, confirm the Activity API entitlement and current technical contract | Application client ID/secret; registered HTTPS redirect URI; explicit `garminTokenHost` selection confirmed in the approved portal |
| Suunto Cloud | Company/organization partner approval and API agreement; Developer API subscription for testing, then Production API approval | OAuth client ID/secret; registered HTTPS redirect URI; API subscription key for future data calls |

Garmin's [Business Activity API](https://developer.garmin.com/gc-developer-program/enterprise/activity-api/)
uses user consent and provides activity data after device synchronization. Its
[program FAQ](https://developer.garmin.com/gc-developer-program/enterprise/program-faq/)
places detailed technical documentation in the approved portal. The
[Personal API](https://developer.garmin.com/gc-developer-program/personal/personal-faq/)
is unsuitable for this commercial service serving multiple users; do not collect personal API keys.

Suunto's [partner process](https://apizone.suunto.com/) and
[quickstart](https://apizone.suunto.com/how-to-start) distinguish application credentials from the
API subscription key. Separate applications/environments need the account arrangements described
in the [FAQ](https://apizone.suunto.com/faq). A key does not prove production approval or partnership.
Follow the providers' agreements when arranging developer access. Do not paste confidential portal
materials into an unauthorized service; supply contract details only through an approved channel.

## Implemented Garmin contract

The public [OAuth2 PKCE PDF](https://developerportal.garmin.com/sites/default/files/OAuth2PKCE_1.pdf)
documents the following operations (pages 2–5):

- Consent at `https://connect.garmin.com/oauth2Confirm`, with S256 PKCE and state correlation.
- Authorization-code exchange and refresh at the documented token service, using form parameters
  and client authentication; honor returned expiry and rotating refresh tokens.
- Identity through `GET https://apis.garmin.com/wellness-api/rest/user/id`.
- Permissions through `GET https://apis.garmin.com/wellness-api/rest/user/permissions`.
- Registration deletion through `DELETE https://apis.garmin.com/wellness-api/rest/user/registration`,
  required by that document on disconnect and account deletion.

**Token hostname conflict:** the linked PDF uses `diauth.garmin.com`, while the other official
[PDF](https://developerportal.garmin.com/sites/default/files/OAuth2PKCE.pdf) uses
`connectapi.garmin.com` for the same `/di-oauth2-service/oauth/token` path. No authoritative version
precedence was established. The adapter requires the explicit `diauth` or `connectapi` setting;
it never silently selects or falls back between them. Confirm the current host through approved
partner access and an authorized test account before using it.

The permission example in the public PDF is malformed JSON. The adapter accepts a bounded valid
JSON string array and refuses invented wrappers. Confirm the real response and required Activity
API permissions with the approved contract. These public operations do not establish a workout
list, backfill, FIT-download or webhook-verification contract.

## Implemented Suunto contract

The official quickstart documents authorization at
`https://cloudapi-oauth.suunto.com/oauth/authorize` and code exchange at
`https://cloudapi-oauth.suunto.com/oauth/token`, using HTTP Basic client authentication.
The quickstart's token example includes expiry, scope and a refresh token. The adapter also accepts
an access-only response, following [OAuth 2.0 section 5.1](https://datatracker.ietf.org/doc/html/rfc6749#section-5.1),
where refresh tokens are optional; this is mock-tested tolerance, not observed Suunto behavior. The documented JWT
`user` claim supplies correlation only; it is never a local login or authorization assertion.

The quickstart identifies `GET https://cloudapi.suunto.com/v2/workouts`; the FAQ documents Bearer
and `Ocp-Apim-Subscription-Key` headers. This research did not establish its response envelope,
paging parameters or per-workout download operation, so the adapter does not fetch this resource.

Suunto's state return, PKCE, refresh and API revocation behavior were not established from the
readable public contract. Authorization requests include state and a future callback must refuse
missing/mismatched state. Refresh refuses with `documentation_required`. Revoke reports
`manualRevocationRequired`, makes no request and never claims remote revocation succeeded.
Do not persist or advertise a usable Suunto connection until its complete lifecycle is verified.

## Requirements before enabling account connection and data import

1. Confirm approved application identity, business entitlement, current endpoints and registered
   HTTPS redirect URIs. Verify consent decline, state return, PKCE, token expiry and rotation with
   an explicitly authorized test account. No live verification was performed for this layer.
2. Establish single-use OAuth state and browser binding, plus explicit account-owner consent to
   share with the named shop/person. Derive tenant/actor from a live session; recheck authorization
   after provider calls. A recap, waiver or unrelated bearer token must expose no connection or
   history authority. Do not treat provider claims as local authentication.
3. Seal scope-bound credentials at rest and serialize refresh/disconnect against erasure, account
   removal and shop deletion. Verify revocation, bounded retries and credential destruction. Garmin
   registration deletion must be performed and failures surfaced; local token removal alone must
   not be reported as completed remote revocation. Obtain Suunto's approved lifecycle contract.
4. Obtain approved activity list/paging, stable identifiers, download/content-type and rate-limit
   contracts; webhook authentication, replay/retry and permission/deletion notifications; retention
   and data-deletion obligations. Never send credentials to arbitrary URLs returned in a payload.
5. Test representative consented/sanitized exports for dive types, profiles, units, gases and
   timezone transitions. API data must enter existing person-scoped preview/select/confirmation and
   idempotent commit. Preserve unknown fields and provenance. Never write operational dive,
   readiness, roll-call, recency or no-fly inputs. Mock success is not vendor compatibility proof.

## Verification and failure behavior

Tests inject HTTP responses; no credentials or authenticated vendor calls are used. Requests are
HTTPS to fixed hosts, redirects are refused, JSON bodies/time are bounded, and errors contain finite
codes without provider bodies, credentials or URLs. There are no automatic transport retries.
Authorization helpers return URLs for a server caller; this layer does not launch consent or connect
accounts itself. The server-only architecture guard prevents these clients entering a browser bundle.

Normal public Suunto API navigation returned a JavaScript placeholder to the text reader; pinned
Chromium also encountered `ERR_CERT_AUTHORITY_INVALID`. Certificate validation was preserved. This
is a documentation-access limitation, not proof of a provider outage or missing API capability.
