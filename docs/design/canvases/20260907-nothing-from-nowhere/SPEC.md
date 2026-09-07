# Nothing from nowhere — implementation spec

The implementation half of [the canvas](README.md), for the session that builds a slice. Its
authority is bounded as [design-artifacts.md](../../design-artifacts.md) sets: below the ADR
([20260907-nothing-from-nowhere](../../../architecture/decisions/20260907-nothing-from-nowhere.md)),
above the artboards, expiring per slice once the slice ships. Interface names here are proposals
until code exists; behaviour a listed acceptance test pins is not.

Only slice 18f is specified so far. The other five run on the ADR and the artboards alone.

## 18f — the departure on the lock screen

**Decided 2026-09-07 (H-69 b, Aaron Buxbaum, in session): yes.** The owner's words were "we
definitely want the wallet pass". Two things follow from the ruling that the ADR's recommendation
did not say:

1. **The slice is built now and ships dark.** The ADR recommended filing it `waiting-on-external`
   and building nothing ahead of the certificate. The owner wants it, so the code lands first and
   the feature lights up when the credentials arrive: with no Apple or Google credential configured
   the thread renders exactly what it renders today, every pass route answers 404, and the cron does
   nothing. That is the same "renders nothing when it is not true" escape hatch every move on the
   canvas already has.
2. **The credentials are manual steps, not blockers.** They enter the manual-actions registry
   (§17 of `infra/lib/infra-stack.ts`) and `config/env-registry.mjs` as `manual` values, and the
   thread's line appears the day they are pasted in.

### The one idea

A departure the diver has booked, on the surface a phone shows without being asked: the lock screen,
the morning of, in the shop's colours, updating itself when the plan moves. Nothing else: no
barcode, no booking id, no price, no waiver or medical state, no emergency contact, and never the
thread's URL, which is the diver's own capability and does not belong on a card that gets shown
around. The counter keeps checking people in by name.

### User journeys the slice must keep working

- **J1, the tap.** Yara opens her thread (`/ready/<token>`) on her iPhone after booking Thursday's
  7:00 Two-Tank Reef. Beside *Add to calendar* is *Add to Wallet*. She taps it; Safari offers the
  pass; she adds it. The pass shows the shop's name in the shop's colour, the departure, Thu Sep 3,
  dock call 6:30 AM, departs 7:00 AM, Mantis II, her name, and the meeting place. On the back: the
  crew, the sites, the shop's phone, and one sentence saying the plan can move and the pass will
  follow.
- **J2, the morning of.** At 5:30 AM Thursday the pass surfaces on her lock screen on its own,
  because its relevant time is the dock call.
- **J3, the plan moves.** On Tuesday the shop moves the boat to 8:00 (`trips.revision` bumps, the
  calendar's `SEQUENCE` with it). Within ten minutes Yara's phone is told the pass changed; it
  fetches the new one and shows dock call 7:30, departs 8:00. Nothing else on the pass changed.
- **J4, the stage.** At 7:40 Thursday the crew taps *Boarding* on the manifest. The pass's header
  reads *Boarding*, the way the thread and the storefront already say it (budget rule 4 of ADR
  20260904). *Home* is the last word it will show; a stage the crew did not set is absent.
- **J5, Android.** Same thread on a Pixel: the same *Add to Wallet* line opens Google Wallet's
  save sheet with the same facts and the same colour. Updates arrive the same way.
- **J6, cancelled.** Yara cancels, or the shop takes the departure off the board. The pass is
  voided on its next update (Apple shows it struck through; Google marks it inactive). It is never
  silently left saying 7:00 on a boat that is not sailing.
- **J7, nothing configured.** A DiveDay with no credentials pasted in shows the thread exactly as
  today, and `/ready/<token>/wallet` is a 404.
- **J8, erasure.** A diver's erasure (`anonymize.ts`) voids their passes, strips the name from the
  stored content, and removes their device registrations.

### What the pass carries

One pass per booking per platform, in the shop's brand where set (`deriveBrandTheme(shop.brandColor)`,
`src/lib/brand.ts`) and DiveDay's own tokens for a shop that set none (`DIVEDAY_BRAND_COLOR`,
`BRAND_INK`). Every string is rendered server-side through the message bundle in the **locale
stored on the pass at issue** (the reader's `requestLocale()` at tap time), with times in
`shop.timezone` through `src/lib/format.ts`; the cron has no request to negotiate a locale from,
which is why it is stored.

| Slot (Apple `generic` style) | Content | Source |
| --- | --- | --- |
| `logoText` | the shop's name | `shops.name` |
| `headerFields[0]` | the crew-set stage word, or absent | `latestTripStage` (`src/db/trip-stages.ts`), `diver.json` stage keys |
| `primaryFields[0]` | the departure's title | `trips.title` |
| `secondaryFields` | date · dock call · departs | `trips.startsAt`, `shops.dockCallMinutes` |
| `auxiliaryFields` | boat · diver's name | trip boat, `people` |
| `backFields` | meeting place (`meetingPointLabel`/`Address`, else the shop's address), crew (`tripPublicCrew`), sites (`listTripDives`), the shop's phone, the one sentence about the plan moving | as named |
| `relevantDate` | the dock call instant (ISO 8601) | derived |
| `expirationDate` | the trip's return plus one day (`hasReturned` semantics, `src/lib/trips.ts`) | derived |
| `voided` | `true` when the booking is cancelled, the trip deleted, or the diver erased | derived |
| colours | `backgroundColor` = theme `primary`, `foregroundColor` and `labelColor` = theme `primaryForeground`, as `rgb(r, g, b)` | `BrandTheme` |
| images | `icon.png` / `icon@2x.png` / `icon@3x.png` = DiveDay's bubble mark, bundled under the module; no `logo.png` in v1, `logoText` carries the shop | bundled |
| barcode | **none** | — |
| `serialNumber` | the `wallet_passes` row id | — |
| `authenticationToken` | a bearer token from `createBearerToken()` (Apple requires ≥ 16 characters); only its hash is stored | `src/lib/bearer-tokens.ts` |
| `webServiceURL` | `${origin}/api/wallet` (https; Apple refuses http outside a developer-mode device) | `src/lib/configured.ts` |
| `passTypeIdentifier`, `teamIdentifier`, `organizationName` | env; the shop's name | env |

The Google object (`genericObject`) mirrors it: `cardTitle` the shop's name, `header` the title,
`subheader` the date line, `textModulesData` for dock call, departs, boat, diver, meeting place and
the plan sentence, `hexBackgroundColor` the theme primary, `state: ACTIVE | INACTIVE` for voided,
`validTimeInterval` from issue to the expiration above. No barcode, no links module.

### Interfaces

A feature module, `src/features/wallet-pass/`, with `index.ts` as its whole public surface and a
`README.md` in the shape of `src/features/calendar-sync/README.md`. It may import `@/lib/**` and
`@/db/**`, never `@/app/**` (`pnpm check:architecture`).

```ts
// src/features/wallet-pass/index.ts — the whole public surface
export type WalletPlatform = "apple" | "google";

/** Which platforms have credentials. Empty means the feature is dark everywhere. */
export function configuredWalletPlatforms(env?: NodeJS.ProcessEnv): readonly WalletPlatform[];

/** The pure content builder: everything a pass says, before signing. Deterministic. */
export function buildPassContent(input: PassContentInput): PassContent;
export function passContentHash(content: PassContent): string; // sha256 of a canonical JSON

/** Issue (or return the live) pass row for a booking on a platform; mints the auth token once. */
export function issueWalletPass(db, input: { bookingId: string; platform: WalletPlatform; locale: string }): Promise<IssuedWalletPass>;

/** Render the signed .pkpass bytes for a pass row (Apple). Throws when Apple is not configured. */
export function renderApplePass(db, passId: string): Promise<{ bytes: Uint8Array; lastModified: Date }>;

/** The Google "Save to Wallet" URL for a pass row: a signed JWT carrying the full object. */
export function googleSaveUrl(db, passId: string): Promise<string>;

/** Apple's PassKit web service, as functions the four routes call. Every one authenticates by
 *  the pass's own token (`Authorization: ApplePass <token>`), compared by hash in constant time. */
export const applePassService: {
  register(db, args: { deviceLibraryIdentifier: string; passTypeIdentifier: string; serialNumber: string; pushToken: string; token: string }): Promise<201 | 200 | 401 | 404>;
  unregister(db, args: { deviceLibraryIdentifier; passTypeIdentifier; serialNumber; token }): Promise<200 | 401 | 404>;
  updatedSince(db, args: { deviceLibraryIdentifier; passTypeIdentifier; passesUpdatedSince?: string }): Promise<{ serialNumbers: string[]; lastUpdated: string } | 204>;
  latest(db, args: { passTypeIdentifier; serialNumber; token; ifModifiedSince?: Date }): Promise<{ bytes; lastModified } | 304 | 401 | 404>;
};

/** The cron body: re-render every live pass whose content hash moved, push, record. */
export function pushChangedWalletPasses(db, opts: { now?: Date; limit?: number }): Promise<{ examined: number; pushed: number; failed: number }>;

/** Erasure hook, called from anonymize.ts inside its transaction. */
export function voidWalletPassesForPerson(tx, args: { shopId: string; personId: string }): Promise<void>;
```

Two tables in `src/db/schema.ts` (schema-change skill; migration via `pnpm db:generate`):

```
wallet_passes
  id uuid pk, shop_id fk, booking_id fk, platform text check in ('apple','google'),
  locale text not null, authentication_token_hash text (apple: not null; google: null),
  google_object_id text (google only), content_hash text not null, content_json jsonb not null,
  issued_at, updated_at (moves when content_hash moves), last_pushed_at, voided_at, deleted_at
  unique (booking_id, platform) where deleted_at is null
wallet_pass_registrations
  id uuid pk, pass_id fk, device_library_identifier text, push_token text, created_at, deleted_at
  unique (pass_id, device_library_identifier) where deleted_at is null
```

`content_json` is what `latest` renders from, so the web service never recomputes a pass under a
request; the cron is the only writer of `content_json`/`content_hash` after issue. `updated_at` is
what `updatedSince` and `If-Modified-Since` compare against.

Routes (`src/app/`), all thin:

| Route | What |
| --- | --- |
| `GET /ready/[token]/wallet` | Verifies the booking capability as the thread page does (`verifyBookingCapability`, purpose `readiness`). Picks by `User-Agent`: iOS/iPadOS/macOS Safari → `302` to `…/wallet/apple`; Android → `302` to `…/wallet/google`; anything else → a small page with both links. `404` when nothing is configured. |
| `GET /ready/[token]/wallet/apple` | Issues (or reuses) the Apple pass and streams `application/vnd.apple.pkpass`, `Content-Disposition: attachment; filename="<slug>.pkpass"`. |
| `GET /ready/[token]/wallet/google` | Issues (or reuses) the Google pass and `302`s to `https://pay.google.com/gp/v/save/<jwt>`. |
| `POST /api/wallet/v1/devices/[deviceLibraryIdentifier]/registrations/[passTypeIdentifier]/[serialNumber]` | register (`201` new, `200` known, `401`, `404`) |
| `DELETE …/registrations/[passTypeIdentifier]/[serialNumber]` | unregister |
| `GET /api/wallet/v1/devices/[deviceLibraryIdentifier]/registrations/[passTypeIdentifier]?passesUpdatedSince=` | serials updated since (`204` when none) |
| `GET /api/wallet/v1/passes/[passTypeIdentifier]/[serialNumber]` | the latest pass, `304` on `If-Modified-Since`, `Last-Modified` set |
| `POST /api/wallet/v1/log` | Apple's device log lines → `log()` at info, always `200` |
| `GET /api/cron/wallet-passes` | `pushChangedWalletPasses`, `CRON_SECRET`-gated like `trip-series`, with a Sentry cron monitor; `*/10 * * * *` in `vercel.json` |

The `/ready/[token]/wallet*` paths are capability URLs: `redactCapabilityUrl` already covers the
`/ready/[token]` prefix, so nothing new is needed for telemetry, but the routes must never log the
token or the pass's authentication token (`docs/engineering/capability-telemetry-runbook.md`).

Delivery:

- **Apple push** is APNs over HTTP/2 (`node:http2`, no dependency) to `api.push.apple.com:443`,
  authenticated with the Pass Type ID certificate and key as the TLS client credential, topic
  (`apns-topic`) = the pass type identifier, body `{}`. A `410` from APNs soft-deletes that
  registration.
- **Google update** is `PATCH https://walletobjects.googleapis.com/walletobjects/v1/genericObject/{id}`
  with an OAuth2 access token obtained by the service-account JWT-bearer grant
  (`https://oauth2.googleapis.com/token`, scope `https://www.googleapis.com/auth/wallet_object.issuer`),
  signed RS256 with `node:crypto`; no dependency. The class `${issuerId}.diveday-departure` is
  inserted once per issuer on first use (`409` is fine).
- **Signing** the Apple manifest is the one new runtime dependency: `passkit-generator@3.5.8`
  (MIT; it brings `node-forge`, `joi`, `do-not-zip`, `tslib`). The ADR names it. Apple's WWDR G4
  intermediate certificate is public and is **bundled** in the module, not configured
  (`config/env-registry.mjs`'s rule: a value the repository already knows is not configuration).

Configuration, all `from: "manual"` in `config/env-registry.mjs`, with `absent:` naming the dark
state, then `node scripts/render-env-example.mjs --write`:

| Key | What |
| --- | --- |
| `APPLE_PASS_TYPE_ID` | e.g. `pass.app.diveday.departure` |
| `APPLE_TEAM_ID` | the ten-character team id |
| `APPLE_PASS_CERTIFICATE_PEM` | the Pass Type ID certificate |
| `APPLE_PASS_KEY_PEM` | its private key |
| `APPLE_PASS_KEY_PASSPHRASE` | optional |
| `GOOGLE_WALLET_ISSUER_ID` | the issuer id |
| `GOOGLE_WALLET_SERVICE_ACCOUNT_JSON` | the service account key file, as one JSON string |

Two manual actions in §17's registry (`infra/lib/infra-stack.ts`, regenerated into
`docs/engineering/manual-actions.md` with `pnpm test infra -u`): *Enroll in the Apple Developer
Program, create a Pass Type ID and its certificate* (category Accounts; the yearly fee; the cert
is also the APNs credential for passes); *Create a Google Wallet issuer account and a service
account with the Wallet Object Issuer role* (the issuer must be granted access in the Google Pay &
Wallet Console). Each names the env keys it produces.

Copy, in `src/i18n/locales/{en-US,es-ES}/diver.json` under `wallet.*`: the thread line
(`addToWallet`), the field labels (date, dock call, departs, boat, diver, meeting place, crew,
sites, phone), the plan sentence, the two-link fallback page's two labels, and the pass's
accessibility text. Spanish goes through `src/i18n/locales/es-ES/README.md` first.

Observability: three `$.event` codes in `infra/lib/observability.ts`'s registry —
`wallet_pass.issued`, `wallet_pass.pushed`, `wallet_pass.push_failed` — with a metric on the third
and an alarm at the runbook's usual threshold; `docs/engineering/cloudwatch-observability-runbook.md`
gains the row.

Retention: `wallet_pass_registrations` older than 30 days past their pass's expiration are pruned
by the weekly retention cron (`src/lib/retention.ts` gains the window; `src/db/retention.ts` the
prune); `wallet_passes` are soft-deleted with their booking and never pruned by this slice.

### Acceptance tests

Unit (Vitest), all under `src/features/wallet-pass/` unless said:

1. `buildPassContent` is deterministic and pure: same input, same JSON; two inputs differing only
   in `trips.startsAt` differ only in the three time fields; a set stage adds exactly one header
   field and an unset one adds none; a cancelled booking sets `voided`; the name is the diver's and
   no field contains the capability token, a booking id, a price, or a URL (a test greps the
   canonical JSON for `/ready/`, `http`, `$`, the booking id and the token).
2. `renderApplePass` produces a zip whose `manifest.json` lists every file with its SHA-1, whose
   `signature` is a detached PKCS#7 over the manifest that verifies against a **test certificate
   generated in the test** with `node-forge` (never a checked-in key), whose `pass.json` has no
   `barcode`/`barcodes`, and whose `webServiceURL` is https.
3. `googleSaveUrl` yields a JWT whose signature verifies with the test key's public half and whose
   payload carries one `genericObjects` entry with `hexBackgroundColor` equal to the brand primary.
4. `applePassService`: wrong token → `401`; unknown serial → `404`; register twice → `201` then
   `200`; `latest` with `If-Modified-Since` ≥ `updated_at` → `304`; `updatedSince` returns only
   serials whose `updated_at` is after the given instant and `204` when none. All against
   `createTestDb()`.
5. `pushChangedWalletPasses`: a moved `starts_at` changes the hash and pushes once; a second run
   pushes nothing; a recorded stage pushes; a `410` from the (stubbed) APNs client soft-deletes the
   registration; a Google `PATCH` is sent with the changed object; failures are counted, logged as
   `wallet_pass.push_failed`, and do not stop the batch.
6. `configuredWalletPlatforms` returns `[]` with no env, and the thread's page composition test
   (`src/app/ready/[token]/page.composition.test.ts`) pins that *Add to Wallet* renders only when it
   is non-empty.
7. `anonymize.test.ts` gains: an erased diver's passes are voided, their `content_json` carries no
   name, and their registrations are soft-deleted.
8. A route test walks `src/app/api/wallet/**` and pins that no handler logs `token`,
   `authenticationToken` or the `Authorization` header.

E2E (`e2e/`), one spec, `wallet-pass.spec.ts`: with the e2e servers given a **runtime-generated**
test certificate and key in env (`e2e/servers.ts`; nothing checked in), the thread shows *Add to
Wallet*, tapping it with an iPhone user agent downloads a `.pkpass` whose `pass.json` names the
demo shop; with the env absent the line is not rendered. Register the route in
`scripts/route-coverage.json`. No visual capture: the line is one quiet link in an existing row.

### What the slice must not do

- Put the capability URL, a booking id, a barcode, a price, or any waiver, medical or emergency
  fact on either pass.
- Log a capability token or a pass token anywhere, including Apple's `/v1/log` relay.
- Show the line, or answer anything but `404` on the pass routes, when no platform is configured.
- Touch the manifest, the roll call, the counter, or the four revision writers: the cron reads
  `trips.revision`'s consequences; it does not change how the revision moves.
- Check in a secret: the test certificate is generated at test time.
- Add a dependency beyond `passkit-generator`.

### The standing obligation

The thread's `TripActions` (or the component that renders the line) and the module's `index.ts`
name ADR 20260907-nothing-from-nowhere in their doc comments; tests 1, 2 and 6 pin the rules; the
README's slice table row 18f moves to `shipped` with the files and the tests; roadmap section 18
notes it; `surfaces.md`'s thread entry drops "Proposed".
