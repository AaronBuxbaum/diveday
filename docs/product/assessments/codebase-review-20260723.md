# Codebase review — 2026-07-23

Status: evidence-backed engineering assessment, not a roadmap commitment.

This is a whole-repository PR-style review begun at `9f83995` and reconciled through the current
`main` branch at `dc4bc1a` (including the merged owner-reporting dashboard). It turns actionable
findings into deliberately bounded tickets that a smaller implementation model can complete without
having to rediscover the architecture. Product or security decisions that need a human owner are
separated from executable tickets.

## Review confidence

The review covered:

- repository architecture, all route and server-action boundaries, auth/authz, public capability
  links, and tenant-scoping conventions;
- the schema plus high-risk database services for bookings, trips, waivers, imports, payments,
  orders, readiness, roll call, and media;
- Stripe, Resend, Twilio, Blob, offline-manifest, CSV, and clock seams;
- the unit and browser-test inventory, visual-test matrix, repository safeguards, recent merged PRs,
  and targeted searches for unsafe language/runtime patterns.

Current evidence:

- all repository safeguards pass when invoked through their installed local binaries;
- Biome passes on 382 files;
- TypeScript passes after removing stale generated `.next` route metadata;
- Vitest passes: 82 files and 698 tests;
- the repository contains 29 Playwright specs, 57 ADRs, and 99 link-checked Markdown documents;
- no `TODO`/`FIXME`, `@ts-ignore`, `dangerouslySetInnerHTML`, `eval`, or empty-catch debt was found.

The normal `pnpm check` entry point did not start because the pinned `pnpm@10.33.0` registry
signature could not be verified. That launcher failure is independent of the passing underlying
checks and should not be misreported as a code failure.

This review found strong foundations worth preserving: booking capacity writes lock the trip row;
waiver capabilities are hashed, expiring, and supersedable; medical uncertainty fails closed;
offline manifests use encrypted, non-extractable local keys plus freshness and live-readiness
checks; webhook signatures are verified; payment only clears from provider evidence; CSV export
guards formula injection; email HTML is escaped; and external services sit behind testable seams.

## How to execute these tickets

Each ticket owns a narrow slice. An implementation agent must:

1. run `pnpm task:context -- <area>` when an area is listed;
2. read the named tests before implementation and add the failing regression first;
3. preserve unrelated workspace changes and generated-migration rules;
4. run the ticket's focused checks, then `pnpm check`;
5. add e2e and Argos coverage when the ticket changes an important flow or surface;
6. request the named specialist review before merge.

Priority means: **P0** exploitable or money-truth integrity risk; **P1** next security, safety, or
data-integrity work; **P2** bounded hardening/performance work. Size is a guide for splitting work,
not an estimate.

## Immediate tickets

### CR-001 — Keep bearer capabilities out of observability

- **Priority / size:** P0 / S
- **Why PR review should have caught it:** the root layout mounts Vercel Analytics and Speed
  Insights on every route. `/waivers/[token]`, `/ready/[token]`, and `/recap/[token]` place replayable
  credentials in the pathname. The analytics clients receive the actual path/URL, not only the
  normalized route, so those credentials can leave the application.
- **Owned paths:** `src/app/layout.tsx`, a new client-only observability wrapper under `src/app/`,
  and focused tests.
- **Acceptance criteria:**
  - both Analytics and Speed Insights drop or redact events for every capability route;
  - no raw waiver, readiness, or recap token is passed to either SDK;
  - ordinary public and staff page views still report;
  - tests exercise actual and URL-encoded token-shaped paths;
  - the operator runbook records how to audit existing telemetry and rotate/revoke exposed
    capabilities where the capability type permits it.
- **Validate:** focused wrapper tests, `pnpm typecheck`, `pnpm check`.
- **Review:** `security-reviewer`.

### CR-002 — Replace permanent readiness authority with revocable capabilities

- **Priority / size:** P0 / M
- **Why PR review should have caught it:** `src/lib/readiness-links.ts` describes a stable,
  revocation-free, read-only mirror. The current `/ready/[token]` actions can issue waivers, overwrite
  emergency contacts and rental fit, toggle nitrox, and start payment. A leaked historical URL
  therefore keeps write authority indefinitely.
- **Owned paths:** `src/lib/readiness-links.ts`, `src/app/ready/[token]/**`,
  `src/db/readiness.ts`, `src/db/schema.ts`, associated tests, migration, and an ADR update.
- **Acceptance criteria:**
  - readiness capabilities have an explicit purpose, issued-at time, expiry, and revocation or
    version mechanism;
  - cancelled/deleted bookings and superseded capabilities fail closed;
  - every mutation derives booking/person/shop identity from the verified capability, never from
    caller-supplied IDs;
  - read and write authority are separated if their lifetimes differ;
  - public responses do not reveal whether a guessed booking exists;
  - expiry, replay, cancellation, cross-booking, and revocation tests are present.
- **Validate:** readiness unit tests, `e2e/readiness.spec.ts`, `pnpm check`.
- **Review:** `security-reviewer`.

### CR-003 — Authorize schedule-confirmation mutations with a capability

- **Priority / size:** P0 / S
- **Why PR review should have caught it:** public actions in
  `src/app/shop/[shopSlug]/schedule/[id]/actions.ts` accept bound `shopId`, `bookingId`, and `personId`
  for payment and rental-fit writes. Next.js documents Server Actions as independently reachable
  POST endpoints; closure encryption is not authorization.
- **Owned paths:** the schedule confirmation page/actions, the shared booking-capability service,
  and focused/e2e tests.
- **Acceptance criteria:**
  - the confirmation URL/action uses a purpose-bound, expiring capability;
  - the server derives all row identities from verified authority;
  - changed IDs, cross-shop IDs, expired tokens, and a direct action POST fail closed;
  - the normal confirmation, rental-fit, and payment-start flows remain usable.
- **Validate:** focused action tests, booking e2e, `pnpm check`.
- **Dependency / review:** align with CR-002's capability format; `security-reviewer`.

### CR-004 — Make provider-to-booking payment transitions atomic and replayable

- **Priority / size:** P0 / M
- **Why PR review should have caught it:** `markCheckoutPaidBySessionId` marks a checkout completed
  before writing booking payment rows. `applyOrderUpdate` similarly commits order truth before
  cascading it to bookings. If the second write fails, replay observes an already-final provider
  record and can permanently leave readiness/payment truth stale.
- **Owned paths:** `src/db/checkouts.ts`, `src/db/orders.ts`, `src/db/bookings.ts`, payment tests.
- **Acceptance criteria:**
  - local checkout/order and booking-payment transitions commit in one transaction;
  - reconciliation always derives booking state idempotently from the latest provider snapshot,
    even when the parent record is already final;
  - fault-injection tests fail between each write and prove replay repairs the state;
  - duplicate and out-of-order webhooks do not regress paid/refunded truth.
- **Validate:** checkout/order/payment unit tests, payment e2e, `pnpm check`.
- **Review:** `security-reviewer`.

### CR-005 — Add idempotent payment-operation intents and reconciliation

- **Priority / size:** P1 / M
- **Why PR review should have caught it:** checkout-session and invoice creation can perform Stripe
  side effects before a durable local record exists; concurrent starts can create multiple payable
  sessions. Invoice creation/refund do not consistently use deterministic Stripe idempotency keys.
- **Owned paths:** `src/lib/payments/**`, `src/db/checkouts.ts`, `src/db/orders.ts`,
  `src/db/schema.ts`, payment actions/tests, migration, and an ADR if the state machine is new.
- **Acceptance criteria:**
  - create-checkout, create-invoice, and refund operations have deterministic, shop-scoped
    idempotency keys;
  - an operation intent is durable before calling Stripe;
  - only one active checkout attempt exists per booking;
  - lost responses, local-write failures, concurrent starts, and retries converge to one provider
    object and correct local truth;
  - an owner-visible reconciliation path handles orphaned or indeterminate operations.
- **Validate:** provider contract tests, concurrency/fault tests, payment e2e, `pnpm check`.
- **Review:** `security-reviewer`.

### CR-006 — Preserve trip capacity and operational-history invariants on edit

- **Priority / size:** P1 / M
- **Why PR review should have caught it:** `updateTrip` can lower capacity below active bookings and
  can reduce planned dives after later roll-call checkpoints exist. The staff action ignores the
  update result and redirects with `notice=saved`.
- **Owned paths:** `src/db/trips.ts`, trip edit action/page, trip and roll-call tests.
- **Acceptance criteria:**
  - a transaction locks the trip and rejects capacity below the active booking count;
  - planned dives cannot be reduced below existing operational history, or historical checkpoints
    remain explicitly accessible;
  - typed failure results render specific, non-destructive staff guidance;
  - concurrent booking/edit and historical-roll-call regression tests exist.
- **Validate:** trip/roll-call unit tests, trip-edit e2e, light/dark phone/desktop snapshots,
  `pnpm check`.
- **Review:** `dive-domain-expert`.

### CR-007 — Close cross-tenant trip-child write paths

- **Priority / size:** P1 / M
- **Why PR review should have caught it:** `setTripCrew` validates that selected people belong to the
  supplied shop but does not prove the trip does. It deletes assignments by `tripId` alone.
  Several child tables and read helpers rely on a parent join rather than carrying or requiring
  `shop_id`, contrary to the repository tenant-row invariant.
- **Owned paths:** `src/db/trips.ts`, `src/db/reporting.ts`, trip-assignment/dive schema and tests,
  relevant actions, migration, architecture documentation if the tenant-row rule is refined.
- **Acceptance criteria:**
  - every trip-child read/write proves the parent trip belongs to the session shop in the same
    transaction;
  - helper signatures require shop context and cannot be called safely with only a trip UUID;
  - tenant-owned rows carry `shop_id`, or a documented database-enforced parent constraint provides
    equivalent isolation;
  - report joins scope trips, bookings, waiver records, and payment records to the same shop rather
    than trusting independently writable `shop_id` values;
  - cross-shop UUID substitution tests prove no read, delete, or insert occurs.
- **Validate:** trip DB tests, adversarial action tests, `pnpm check`.
- **Review:** `security-reviewer`.

### CR-008 — Make person identity unique under concurrent writes

- **Priority / size:** P1 / M
- **Why PR review should have caught it:** person creation uses read-then-write email matching, but
  the database has no case-insensitive, shop-scoped uniqueness constraint for active people.
  Concurrent booking/import/diver creation can split one diver's cert, waiver, and rental history.
- **Owned paths:** `src/db/schema.ts`, person/booking/import services and tests, migration.
- **Acceptance criteria:**
  - active non-null email is unique on `(shop_id, lower(email))`, with a deliberate deleted-person
    policy;
  - every write normalizes consistently and uses conflict-safe create-or-reuse behavior;
  - the migration reports or deterministically reconciles existing collisions without silently
    merging safety records;
  - mixed-case and concurrent-create tests cover booking, diver creation, and import.
- **Validate:** person/booking/import unit tests, booking/import e2e, `pnpm check`.
- **Review:** `security-reviewer` and `dive-domain-expert` for collision handling.

### CR-009 — Treat certification expiry as a shop-local calendar date

- **Priority / size:** P1 / M
- **Why PR review should have caught it:** expiry input is a date but is persisted/interpreted as a
  UTC timestamp ending at `23:59:59.999Z`. In negative UTC offsets it expires before the shop's
  local day ends. Regex validation also allows normalized impossible dates such as February 31.
- **Owned paths:** certification schema/model, `src/lib/format.ts` or a dedicated date-only helper,
  cert actions/tests, migration if the storage type changes.
- **Acceptance criteria:**
  - expiry is modeled as a date-only value or evaluated through the shop timezone;
  - invalid calendar dates fail validation rather than normalize;
  - the card remains valid through the full expiry date and expires at the next local day;
  - tests freeze boundaries in `America/St_Thomas`, `Pacific/Honolulu`, and a positive-offset zone;
  - case-normalized certification identifiers cannot create duplicate active cards.
- **Validate:** cert unit tests, cert-gating e2e, `pnpm check`.
- **Review:** `dive-domain-expert`.

### CR-010 — Make demo bootstrap concurrency-safe and retryable

- **Priority / size:** P1 / S
- **Why PR review should have caught it:** cold start checks for any shop and then seeds without a
  transaction, advisory lock, or conflict-safe inserts. Concurrent first requests can race, and a
  rejected memoized initialization promise poisons that process instance.
- **Owned paths:** `src/db/client.ts`, `src/db/seed.ts`, bootstrap tests.
- **Acceptance criteria:**
  - bootstrap is serialized or fully idempotent around the canonical demo shop;
  - a failed initialization clears the memoized promise so a later request can retry;
  - concurrent initialization produces exactly one complete demo data set;
  - partial seed failure rolls back or is safely repairable on retry;
  - no “missing demo shop” UI fallback is introduced.
- **Validate:** isolated PGlite tests plus a PostgreSQL concurrency integration test where required,
  `pnpm check`.

### CR-011 — Align upload transport with the promised 5 MB contract

- **Priority / size:** P1 / M
- **Why PR review should have caught it:** card, course, and recap UI/storage code accepts 5 MB
  images, but Next.js Server Actions default to a 1 MB request-body limit. Larger uploads can fail
  before domain validation; multi-image forms amplify the mismatch.
- **Owned paths:** upload forms/actions, storage seam, `next.config.ts` only if a deliberate bounded
  limit is chosen, upload tests/docs.
- **Acceptance criteria:**
  - choose and document either signed direct-to-Blob upload or an explicit safe server limit;
  - direct upload is preferred for multiple images and must bind object creation to authorized
    shop/capability context;
  - clients reject oversize files early and the server remains authoritative;
  - failures near 1 MB and 5 MB render friendly, actionable errors;
  - cancellation/orphan cleanup behavior is defined.
- **Validate:** storage tests, card/course/recap e2e with boundary-size fixtures, `pnpm check`.
- **Review:** `security-reviewer`.

### CR-012 — Validate, sanitize, and delete uploaded media through its lifecycle

- **Priority / size:** P1 / M
- **Why PR review should have caught it:** storage trusts caller-supplied MIME type rather than file
  bytes. Deleting a recap photo removes the database row but not the public Blob object. Uploaded
  photos can also retain EXIF location/device metadata.
- **Owned paths:** `src/lib/storage/**`, recap/course/card deletion paths, media tests and retention
  documentation.
- **Acceptance criteria:**
  - decode or magic-byte validate supported formats, constrain dimensions, strip metadata, and
    re-encode before publication;
  - deleting moderated/removed media removes or queues deletion of the provider object;
  - provider-delete failure is owner-visible and retryable without restoring the public row;
  - a bounded orphan audit/cleanup job exists;
  - disguised files, decompression bombs, EXIF, double-delete, and provider-failure tests exist.
- **Validate:** storage/provider contract tests, recap/course/card e2e, `pnpm check`.
- **Review:** `security-reviewer`.

## Follow-up tickets

### CR-013 — Put abuse controls on public write boundaries

- **Priority / size:** P1 / M
- **Why:** onboarding performs account/shop creation plus password hashing; sign-in, recap uploads,
  wait-list joins, bookings, and capability actions lack centralized per-source abuse controls.
  PR #139 explicitly deferred per-token/IP recap limits.
- **Owned paths:** auth/public actions, a shared rate-limit seam, tests, operations documentation.
- **Acceptance criteria:** bounded per-IP plus per-account/token limits as appropriate; generic
  failure responses; trusted-proxy handling; no raw token/medical/PII keys; provider outage policy;
  deterministic tests for burst, refill, and cross-tenant isolation.
- **Validate:** focused service tests, affected public-flow e2e, `pnpm check`.
- **Review:** `security-reviewer`.

### CR-014 — Harden onboarding and public mutation input schemas

- **Priority / size:** P1 / S
- **Why:** onboarding accepts any nonempty timezone, has a six-character password minimum with no
  maximum, and redirects raw exception messages. Readiness emergency-contact fields lack the bounds
  enforced by the waiver flow.
- **Owned paths:** onboarding/readiness actions, shared schemas, focused tests.
- **Acceptance criteria:** strict IANA timezone validation; deliberate password min/max; shared
  bounded contact schemas at the service boundary; generic user errors with owner-visible internal
  diagnostics; invalid/timezone/contact/oversize tests.
- **Validate:** focused tests, onboarding/readiness e2e, `pnpm check`.
- **Review:** `security-reviewer`.

### CR-015 — Serialize legal waiver-template version allocation

- **Priority / size:** P1 / S
- **Why:** `saveWaiverTemplate` computes `max(version)+1` without a lock. The unique key includes
  title although versioning is described per shop, so concurrent saves can collide or create
  ambiguous legal ordering.
- **Owned paths:** waiver schema/service/tests and migration.
- **Acceptance criteria:** per-shop serialized allocation; database uniqueness matches the legal
  versioning rule; existing conflicts receive an explicit migration report; concurrent-save and
  evidence-snapshot tests.
- **Validate:** waiver DB tests, waiver e2e, `pnpm check`.
- **Review:** `security-reviewer` and `dive-domain-expert`.

### CR-016 — Bound imports and order-entry values explicitly

- **Priority / size:** P2 / M
- **Why:** CSV parsing relies accidentally on the framework request limit and processes all rows in
  one transaction. Manual orders cast kind/quantity/amount with weak integer, enum, and upper-bound
  validation before reaching Stripe/database code.
- **Owned paths:** import and order schemas/services/actions/tests.
- **Acceptance criteria:** explicit byte/row/column/cell limits with friendly errors; a deliberate
  batching/atomicity policy; strict order kind, positive integer quantity, bounded cents/description,
  and explicit customer/booking relationship; adversarial CSV and numeric-boundary tests.
- **Validate:** import/order tests and e2e, `pnpm check`.
- **Review:** `security-reviewer` for import/export surface.

### CR-017 — Add database checks for monetary and operational invariants

- **Priority / size:** P2 / M
- **Why:** important limits currently live only in application code. Direct, concurrent, import, or
  future code paths can persist negative cents, invalid quantities, or impossible trip values.
- **Owned paths:** `src/db/schema.ts`, migration, domain tests.
- **Acceptance criteria:** focused constraints for nonnegative money, positive quantities,
  supported trip capacity/planned-dive ranges, and valid local time ranges; migration preflight
  reports invalid existing rows; application errors remain typed and user-friendly.
- **Validate:** schema/service tests against a fresh database, `pnpm check`.
- **Review:** `dive-domain-expert`.

### CR-018 — Index real search patterns before scale makes them painful

- **Priority / size:** P2 / S
- **Why:** people/shop search uses leading-wildcard `ILIKE` while comments describe indexed search;
  the schema has no matching trigram/search index. Result limits do not prevent full scans.
- **Owned paths:** search queries, schema/migration, performance test note.
- **Acceptance criteria:** choose supported trigram GIN or a normalized prefix strategy; cover the
  actual name/email/phone/title predicates; capture representative Neon query plans before/after;
  preserve PGlite test portability.
- **Validate:** search behavior tests, migration on fresh DB, recorded `EXPLAIN`, `pnpm check`.

### CR-019 — Complete visual coverage for safety-critical public surfaces

- **Priority / size:** P2 / S
- **Why:** `e2e/visual.spec.ts` has contradictory snapshot-count comments and omits active waiver and
  readiness views despite their safety-critical status and the repository's Argos rule.
- **Owned paths:** `e2e/visual.spec.ts`, deterministic seed/helpers.
- **Acceptance criteria:** seeded signed active-waiver and readiness snapshots in light/dark at
  phone/desktop sizes; moving time is frozen through the shared clock; count documentation is
  correct or derived; no masking of safety-relevant content.
- **Validate:** focused visual spec, inspect every generated image, triage the Argos build.
- **Review:** `dive-domain-expert`.

### CR-020 — Stop third-party media URLs from tracking public visitors

- **Priority / size:** P2 / M
- **Why:** legacy course and current dive-site media accept arbitrary HTTP(S) URLs rendered in public
  pages. A staff-selected host can observe visitor IP/referrer information and disappear or change.
- **Owned paths:** dive-site/course media resolver, upload/storage paths, migration/tests,
  attribution docs.
- **Acceptance criteria:** new media is uploaded to controlled storage or fetched through a safe
  allowlisted ingestion pipeline; SSRF and redirect defenses; existing licensed attribution
  preserved; legacy URLs migrate without breaking staff-provided local paths; public pages make no
  arbitrary third-party image requests.
- **Validate:** resolver/storage tests, relevant e2e and Argos snapshots, `pnpm check`.
- **Review:** `security-reviewer`.

### CR-021 — Validate canonical public host configuration

- **Priority / size:** P2 / S
- **Why:** `APP_HOST` accepts any syntactically valid URL, including non-HTTPS origins and URLs with
  credentials/path/query components, then feeds links and callbacks.
- **Owned paths:** public URL configuration helper/tests and deployment documentation.
- **Acceptance criteria:** production requires an HTTPS origin with no credentials, path, query, or
  fragment; local development permits an explicit loopback exception; startup fails with a precise
  owner-facing error; configuration tests cover malformed and deceptive values.
- **Validate:** configuration tests, `pnpm typecheck`, `pnpm check`.
- **Review:** `security-reviewer`.

## Human-owned decisions

These are material risks, but a smaller model must not silently change them:

1. **Role authority.** Current ADRs deliberately let every staff role reach nearly every staff
   surface, while the product language implies owners/managers configure money and crew/captains run
   operations. A product/security owner must decide whether payment settings, refunds, waiver
   templates, diver deletion, and trip configuration need role boundaries before an agent changes
   authorization.
2. **JWT revocation window.** Most staff mutations trust role-bearing JWT state until the next
   sign-in; import/export already rechecks current database roles. A security owner must choose the
   tolerated disable/demotion delay and whether high-risk mutations should use a shared
   `requireActiveStaffSession` database recheck.
3. **Capability migration policy.** CR-001 through CR-003 can protect new traffic, but only an owner
   can decide whether to invalidate all historical readiness/confirmation URLs immediately or allow
   a transition window.

Record those decisions in `docs/product/human-decisions.md` and the relevant ADR before assigning
implementation.

## Suggested execution order

1. CR-001 immediately stops further capability leakage.
2. CR-002 and CR-003 establish one capability model.
3. CR-004 and CR-005 make money truth atomic and recoverable.
4. CR-006 through CR-010 close safety, tenant, identity, date, and bootstrap invariants.
5. CR-011 through CR-015 harden public files and write boundaries.
6. CR-016 through CR-021 are independent, reviewable follow-ups.

Do not combine these into one large PR. Each ticket is intended to remain independently reviewable,
revertible, and attributable to its own specialist review.
