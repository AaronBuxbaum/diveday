/**
 * Every environment variable DiveDay reads, and the three facts about each one
 * that anything else needs to know: **who produces it**, **where it goes**, and
 * **whether being absent is legitimate**.
 *
 * This file exists because those facts used to live in four places that nothing
 * kept in agreement -- the key list in `.env.example`, the produced-here list in
 * `infra/lib/infra-stack.ts`, the may-be-overridden-locally sets in
 * `scripts/distribute-env.mjs`, and a growing pile of hand-written skip cases in
 * `scripts/check-env.mjs`. `PLACES_AWS_ACCESS_KEY_ID` was in three of them and
 * missing from the fourth, so a key typed into `.env.local` by hand outlived
 * every later deploy, rode into Vercel Production, and left the deployed address
 * lookup signing with an access key AWS had never issued for a week
 * (ADR 20260812-env-provenance-registry).
 *
 * Plain `.mjs` rather than TypeScript because all three consumers must import
 * it: the `scripts/*.mjs` tooling runs under bare `node`, `infra/` is a separate
 * CDK app with its own tsconfig, and `src/` is the Next application. Types come
 * from inference -- the exported literal is `const`-asserted by the `.d.mts`
 * beside it.
 *
 * ## Adding a variable
 *
 * Add it to a group here and nothing else. `.env.example` is generated from
 * this file, the credentials secret is generated from that, the three target
 * files are generated from the secret plus `.env.manual`, and `pnpm check:env`
 * reads the same rows. `pnpm check:repo` fails if `.env.example` has drifted.
 */

/**
 * Who produces a value.
 *
 * - `stack` -- `infra/lib/infra-stack.ts` mints or names it. There is no local
 *   override, deliberately: an IAM access key is not a preference, and a
 *   private copy is a stale copy waiting to happen.
 * - `derived` -- `scripts/distribute-env.mjs` computes it from `APP_SECRET_SEED`
 *   through HKDF. Stack-produced by another name.
 * - `manual` -- no system can mint it. A human pastes it from a third-party
 *   console or 1Password. These, and only these, are what `.env.manual` holds.
 *
 * There used to be a fourth, `constant`: a non-secret identifier of DiveDay's
 * own, checked in here and carried through Secrets Manager to Vercel on every
 * deploy. Five keys held it -- the public origin, the SES sender, the Stripe
 * Connect client id, the Sentry DSN, and reg-suit's GitHub client id -- and
 * what they had in common is that this repository already knew every one of
 * them. The deployment was being told a value it could have read.
 *
 * That round trip was not free. The sender's address contains a space, so it
 * had to be written quoted, and the quotes arrived at SES as part of the
 * address: every production email failed for an unknown stretch while dev, CI,
 * and the tests stayed green (issue #517). So those values moved into the code
 * that reads them, behind `src/lib/configured.ts`, and their variables survive
 * only as overrides for a fork or a self-hosted instance.
 *
 * This registry is now exactly what its name says -- values that genuinely
 * come from somewhere else -- and a value this repository knows does not
 * belong in it. That is the rule, not an accident of the five being gone.
 */

/**
 * Where a value is sent. `local` is the generated `.env.local` a dev run reads,
 * `vercel` the deployed environment, `github` the Actions secrets the visual
 * suite needs. A value appears in a target only if that target consumes it --
 * `APP_SECRET_SEED` never leaves a workstation, and the `REG_SUIT_*` credentials
 * are CI's, not the application's.
 */

const LOCAL = ["local"];
const LOCAL_AND_VERCEL = ["local", "vercel"];
const LOCAL_AND_GITHUB = ["local", "github"];

export const ENV_GROUPS = [
  {
    doc: [
      "Production only. Vercel's Neon integration injects these automatically into",
      "the deployed environment; nothing to set by hand there. Only fill this in if",
      "you're pointing a local run at a real Neon database on purpose.",
      "",
      "DATABASE_URL is the pooled (PgBouncer) connection used at request time",
      "(src/db/client.ts). If set manually, use sslmode=verify-full; the app",
      "normalizes legacy sslmode=require/prefer/verify-ca values to that explicit",
      "mode at runtime and during migrations. DATABASE_URL_UNPOOLED is the direct",
      "connection used for schema migrations (`pnpm db:migrate`), since DDL over a",
      "transaction-mode pooler is unreliable; it falls back to DATABASE_URL.",
    ],
    keys: [
      {
        key: "DATABASE_URL",
        from: "manual",
        targets: LOCAL_AND_VERCEL,
        absent:
          "a local run falls back to an embedded PGlite database, auto-migrated and auto-seeded",
      },
      {
        key: "DATABASE_URL_UNPOOLED",
        from: "manual",
        targets: LOCAL_AND_VERCEL,
        absent: "migrations fall back to DATABASE_URL",
      },
    ],
  },
  {
    doc: [
      "Required in production (NextAuth fails loudly without it there); dev/test",
      "fall back to a hardcoded non-production secret. Derived from APP_SECRET_SEED",
      "below. Do not generate or rotate it alone.",
    ],
    keys: [{ key: "AUTH_SECRET", from: "derived", targets: LOCAL_AND_VERCEL }],
  },
  {
    doc: [
      "Transactional email through AWS SES (ADR 20260803-ses-sole-email-provider,",
      "superseding 20260802-ses-adapter-and-webhook). The friendly sender name is",
      'supported (for example, "Blue Mantis <bookings@ses.dive.day>"). Keep all four',
      "values server-only -- none may use a NEXT_PUBLIC_ prefix. Credentials belong to",
      "the diveday-ses-sender IAM user, never the cdk-deployer or reg-suit-bot ones.",
      "Also requires the AWS-side production-access request and DKIM DNS verification",
      "for ses.dive.day -- see docs/engineering/infrastructure-runbook.md.",
    ],
    keys: [
      {
        key: "SES_AWS_REGION",
        from: "stack",
        targets: LOCAL_AND_VERCEL,
        absent: "no mail is sent",
      },
      {
        key: "SES_AWS_ACCESS_KEY_ID",
        from: "stack",
        targets: LOCAL_AND_VERCEL,
        absent: "no mail is sent",
      },
      {
        key: "SES_AWS_SECRET_ACCESS_KEY",
        from: "stack",
        targets: LOCAL_AND_VERCEL,
        absent: "no mail is sent",
      },
    ],
  },
  {
    doc: [
      "Where the two operational alerts land -- a trial started (new_account_alert)",
      "and someone tried the live demo (demo_started_alert), ADR",
      "20260805-demo-try-alerts. Not a secret: an address, not a credential.",
    ],
    keys: [
      {
        key: "OPS_ALERT_EMAIL",
        from: "manual",
        targets: LOCAL_AND_VERCEL,
        absent:
          "both alerts go to the ALERT_EMAIL mailbox in src/lib/platform-mail.ts, which is the right answer for every deployment that *is* DiveDay. Only a fork, a staging deploy, or a self-hosted instance has one to set",
      },
    ],
  },
  {
    doc: [
      "SNS topic ARN for /api/webhooks/ses (SesEventNotificationsTopicArn output).",
      "Verified messages whose own TopicArn doesn't match this are rejected even if",
      "correctly signed, so a differently-sourced SNS message can't be replayed here.",
    ],
    keys: [
      {
        key: "SES_SNS_TOPIC_ARN",
        from: "stack",
        targets: LOCAL_AND_VERCEL,
        absent: "delivery events are not accepted",
      },
    ],
  },
  {
    doc: [
      "Stripe Connect: shops bring their own Standard Stripe account (ADR",
      "20260719-stripe-connect-orders). STRIPE_SECRET_KEY is the *platform* account's",
      "secret key -- once a shop completes OAuth this key acts on its behalf via a",
      "Stripe-Account header, so no per-shop credential is stored.",
      "The Connect client id that pairs with this key is compiled in",
      "(CONNECT_CLIENT_ID in src/lib/payments/connect.ts) rather than deployed;",
      "register the /api/stripe/connect/callback URL on DiveDay's own origin there as",
      "the single redirect URL for every shop. STRIPE_WEBHOOK_SECRET signs /api/webhooks/stripe,",
      'configured against that URL with "listen to events on Connected accounts"',
      "enabled. Keep the two secrets in 1Password. They never enter the AWS",
      "credentials secret -- they reach Vercel from .env.manual.",
    ],
    keys: [
      {
        key: "STRIPE_SECRET_KEY",
        from: "manual",
        targets: LOCAL_AND_VERCEL,
        absent: "the connect button and order creation report not_configured",
      },
      {
        key: "STRIPE_WEBHOOK_SECRET",
        from: "manual",
        targets: LOCAL_AND_VERCEL,
        absent:
          'orders work but paid/void status only updates via the manual "Refresh status" action',
      },
    ],
  },
  {
    doc: [
      "Courtesy SMS reminders through AWS SNS (ADR 20260802-sns-sms-adapter). A",
      "distinct IAM user from SES_AWS_* (least privilege: sns:Publish only).",
      "SNS_SENDER_ID is an optional alphanumeric sender label, not supported in every",
      "country (notably the US).",
    ],
    keys: [
      {
        key: "SNS_AWS_REGION",
        from: "stack",
        targets: LOCAL_AND_VERCEL,
        absent: "SMS reports not_configured rather than sending",
      },
      {
        key: "SNS_AWS_ACCESS_KEY_ID",
        from: "stack",
        targets: LOCAL_AND_VERCEL,
        absent: "SMS reports not_configured rather than sending",
      },
      {
        key: "SNS_AWS_SECRET_ACCESS_KEY",
        from: "stack",
        targets: LOCAL_AND_VERCEL,
        absent: "SMS reports not_configured rather than sending",
      },
      {
        key: "SNS_SENDER_ID",
        from: "manual",
        targets: LOCAL_AND_VERCEL,
        absent: "messages carry the carrier's default sender",
      },
    ],
  },
  {
    doc: [
      "Amazon Location Service, for the settings address type-ahead (ADR",
      "20260804-aws-location-address-lookup). Server-side only -- there is no browser",
      "key, so nothing to referrer-restrict. Its own IAM user rather than the",
      "SES/SNS ones (least privilege: geo-places:Autocomplete and nothing else).",
    ],
    keys: [
      {
        key: "PLACES_AWS_REGION",
        from: "stack",
        targets: LOCAL_AND_VERCEL,
        absent: "the address card is exactly the five text boxes it has always been",
      },
      {
        key: "PLACES_AWS_ACCESS_KEY_ID",
        from: "stack",
        targets: LOCAL_AND_VERCEL,
        absent: "the address card is exactly the five text boxes it has always been",
      },
      {
        key: "PLACES_AWS_SECRET_ACCESS_KEY",
        from: "stack",
        targets: LOCAL_AND_VERCEL,
        absent: "the address card is exactly the five text boxes it has always been",
      },
    ],
  },
  {
    doc: [
      "SMS delivery receipts (ADR 20260802-sms-delivery-receipts). SNS has no",
      "delivery webhook for a direct-to-phone Publish -- receipts go to CloudWatch",
      "Logs -- so an AWS-side forwarder republishes each one to this topic, which",
      "/api/webhooks/sms verifies with the same SNS envelope check the SES webhook",
      "uses. SmsDeliveryReceiptsTopicArn from the CDK stack.",
    ],
    keys: [
      {
        key: "SMS_SNS_TOPIC_ARN",
        from: "stack",
        targets: LOCAL_AND_VERCEL,
        absent: "the endpoint answers 503 and sends still work; only the outcome is unknown",
      },
    ],
  },
  {
    doc: [
      "WhatsApp via Meta Embedded Signup (ADR 20260802-whatsapp-embedded-signup,",
      "docs/engineering/whatsapp-cloud-api-runbook.md). DiveDay's own Meta app, not a",
      "shop's: every shop's WhatsApp Business Account is subscribed to it, which is",
      "what lets one webhook endpoint verify every shop's delivery events.",
      "META_WHATSAPP_WEBHOOK_VERIFY_TOKEN is any string you also enter in Meta's",
      "webhook configuration; it only guards the one-time subscription handshake.",
    ],
    keys: [
      {
        key: "META_APP_ID",
        from: "manual",
        targets: LOCAL_AND_VERCEL,
        absent:
          'the settings page shows "coming soon" and no shop can connect -- Embedded Signup requires Meta app review and business verification first',
      },
      {
        key: "META_APP_SECRET",
        from: "manual",
        targets: LOCAL_AND_VERCEL,
        absent: "as META_APP_ID",
      },
      {
        key: "META_WHATSAPP_SIGNUP_CONFIG_ID",
        from: "manual",
        targets: LOCAL_AND_VERCEL,
        absent: "as META_APP_ID",
      },
      {
        key: "META_WHATSAPP_WEBHOOK_VERIFY_TOKEN",
        from: "manual",
        targets: LOCAL_AND_VERCEL,
        absent: "as META_APP_ID",
      },
    ],
  },
  {
    doc: [
      "Encryption key for third-party credentials DiveDay stores on a shop's behalf --",
      "today, each shop's WhatsApp access token (ADR",
      "20260802-whatsapp-cloud-api-per-shop). Derived from APP_SECRET_SEED. Rotating",
      "it without re-sealing the existing rows degrades every connected shop back to",
      "SMS -- read the WhatsApp runbook before rotating.",
    ],
    keys: [
      {
        key: "SECRET_ENCRYPTION_KEY",
        from: "derived",
        targets: LOCAL_AND_VERCEL,
        absent:
          "the WhatsApp settings page says so and refuses to store anything, and a waiver link is " +
          "minted fresh on every send instead of the diver being handed the one they already have",
      },
    ],
  },
  {
    doc: [
      "Structured-log shipping to CloudWatch Logs (ADR 20260806-cloudwatch-log-shipping,",
      "docs/engineering/cloudwatch-observability-runbook.md). Every line src/lib/log.ts",
      "already writes to stdout is also buffered and sent to CLOUDWATCH_LOG_GROUP,",
      "where it stays queryable for a month and where the metric filters in",
      "infra/lib/observability.ts count the codes worth alarming on. Its own IAM user",
      "(least privilege: CreateLogStream and PutLogEvents on that one group, no read",
      "access to any of it). All four or nothing -- a partial set reads as unset.",
    ],
    keys: [
      {
        key: "CLOUDWATCH_AWS_REGION",
        from: "stack",
        targets: LOCAL_AND_VERCEL,
        absent:
          "the console line is unchanged and nothing is shipped -- the normal state locally, where there is nowhere to ship to and a developer's own stdout should not reach the production log group",
      },
      {
        key: "CLOUDWATCH_AWS_ACCESS_KEY_ID",
        from: "stack",
        targets: LOCAL_AND_VERCEL,
        absent: "as CLOUDWATCH_AWS_REGION",
      },
      {
        key: "CLOUDWATCH_AWS_SECRET_ACCESS_KEY",
        from: "stack",
        targets: LOCAL_AND_VERCEL,
        absent: "as CLOUDWATCH_AWS_REGION",
      },
      {
        key: "CLOUDWATCH_LOG_GROUP",
        from: "stack",
        targets: LOCAL_AND_VERCEL,
        absent: "as CLOUDWATCH_AWS_REGION",
      },
    ],
  },
  {
    doc: [
      "Amazon CloudWatch RUM -- real-user session, geography, and device context to go",
      "with the Core Web Vitals metrics (ADR 20260806-cloudwatch-rum-and-vitals). All",
      "five are NEXT_PUBLIC_ because the browser is the only consumer, and none is a",
      "secret: the Cognito identity pool hands the same credential to every visitor",
      "and it can do exactly one thing, rum:PutRumEvents on one app monitor.",
      "NEXT_PUBLIC_RUM_SAMPLE_RATE is the cost lever, 0..1; anything unparseable or",
      "out of range falls back to 1 (record every session).",
    ],
    keys: [
      {
        key: "NEXT_PUBLIC_RUM_APP_MONITOR_ID",
        from: "stack",
        targets: LOCAL_AND_VERCEL,
        absent:
          "no SDK is ever fetched and the page is unchanged -- the Core Web Vitals half needs none of this and keeps working on its own",
      },
      {
        key: "NEXT_PUBLIC_RUM_IDENTITY_POOL_ID",
        from: "stack",
        targets: LOCAL_AND_VERCEL,
        absent: "as NEXT_PUBLIC_RUM_APP_MONITOR_ID",
      },
      {
        key: "NEXT_PUBLIC_RUM_GUEST_ROLE_ARN",
        from: "stack",
        targets: LOCAL_AND_VERCEL,
        absent: "as NEXT_PUBLIC_RUM_APP_MONITOR_ID",
      },
      {
        key: "NEXT_PUBLIC_RUM_REGION",
        from: "stack",
        targets: LOCAL_AND_VERCEL,
        absent: "as NEXT_PUBLIC_RUM_APP_MONITOR_ID",
      },
      {
        key: "NEXT_PUBLIC_RUM_SAMPLE_RATE",
        from: "manual",
        targets: LOCAL_AND_VERCEL,
        absent: "every session is recorded",
      },
    ],
  },
  {
    doc: [
      "Scheduled pre-trip reminders (ADR 20260721-scheduled-reminder-cadence). Vercel",
      "Cron calls GET /api/cron/reminders daily with this as a bearer token (the Hobby",
      "plan caps crons at daily; the cadence buckets are >=24h wide so a daily run",
      "never misses one). Derived from APP_SECRET_SEED.",
    ],
    keys: [
      {
        key: "CRON_SECRET",
        from: "derived",
        targets: LOCAL_AND_VERCEL,
        absent:
          "the endpoint is unavailable (503), so nothing can trigger reminder sends by accident",
      },
    ],
  },
  {
    doc: [
      "Provider usage guardrails (ADR 20260806-provider-usage-guardrails,",
      "docs/engineering/cost-guardrails-runbook.md). GET /api/cron/usage polls Vercel's",
      "and Neon's own usage APIs daily and emails ALERT_EMAIL when a ceiling in",
      "src/lib/cost-guardrails.ts is approached. Alert-only: nothing is ever disabled",
      "or throttled. Prefixed USAGE_ rather than VERCEL_/NEON_ because VERCEL_ is the",
      "namespace Vercel injects its own system variables into.",
      "",
      "USAGE_VERCEL_TOKEN is a Vercel access token with billing read scope;",
      "USAGE_VERCEL_TEAM_ID is the team the charges are billed to (team_...).",
      "USAGE_NEON_API_KEY is a Neon API key; USAGE_NEON_ORG_ID is the org the",
      "consumption endpoint reports for (org-...). Each pair is all-or-nothing: a",
      "token without its id reads as not configured.",
    ],
    keys: [
      {
        key: "USAGE_VERCEL_TOKEN",
        from: "manual",
        targets: LOCAL_AND_VERCEL,
        absent:
          "the affected ceiling reports not_configured, which is deliberately *not* the same as ok anywhere it is shown",
      },
      {
        key: "USAGE_VERCEL_TEAM_ID",
        from: "manual",
        targets: LOCAL_AND_VERCEL,
        absent: "as USAGE_VERCEL_TOKEN",
      },
      {
        key: "USAGE_NEON_API_KEY",
        from: "manual",
        targets: LOCAL_AND_VERCEL,
        absent: "as USAGE_VERCEL_TOKEN",
      },
      {
        key: "USAGE_NEON_ORG_ID",
        from: "manual",
        targets: LOCAL_AND_VERCEL,
        absent: "as USAGE_VERCEL_TOKEN",
      },
    ],
  },
  {
    doc: [
      "Media object storage for course photos, recap memories, dive site maps, and",
      "shop logos (AWS-8, docs/architecture/aws-migration-dossier.md). Replaces Vercel",
      "Blob with an S3 bucket in the DiveDay AWS account. The diveday-media-uploader",
      "IAM user (infra/lib/infra-stack.ts S11b) holds scoped PutObject and DeleteObject",
      "permissions on the media bucket.",
    ],
    keys: [
      {
        key: "MEDIA_BUCKET_NAME",
        from: "stack",
        targets: LOCAL_AND_VERCEL,
        absent: "image uploads report not_configured and fall back to local dev stubs",
      },
      {
        key: "MEDIA_AWS_REGION",
        from: "stack",
        targets: LOCAL_AND_VERCEL,
        absent: "as MEDIA_BUCKET_NAME",
      },
      {
        key: "MEDIA_AWS_ACCESS_KEY_ID",
        from: "stack",
        targets: LOCAL_AND_VERCEL,
        absent: "as MEDIA_BUCKET_NAME",
      },
      {
        key: "MEDIA_AWS_SECRET_ACCESS_KEY",
        from: "stack",
        targets: LOCAL_AND_VERCEL,
        absent: "as MEDIA_BUCKET_NAME",
      },
      {
        key: "MEDIA_PUBLIC_URL_BASE",
        from: "stack",
        targets: LOCAL_AND_VERCEL,
        absent: "uses the direct S3 virtual-hosted bucket endpoint",
      },
    ],
  },
  {
    doc: [
      "Outbound integrations a shop connects for itself (src/features/integrations).",
      "Each is one DiveDay-owned app registration with the provider, shared by every",
      "shop: the per-shop half is an OAuth grant sealed into shop_integrations, never",
      "a variable. Zapier needs no registration at all -- a shop pastes its own hook",
      "URL -- so it has no key here. Absent, the provider's card on",
      "/shop/<slug>/settings/integrations says it is unavailable and refuses to start",
      "an authorization; nothing else in the app changes.",
    ],
    keys: [
      {
        key: "SHOPIFY_CLIENT_ID",
        from: "manual",
        targets: LOCAL_AND_VERCEL,
        absent: "Shopify cannot be connected; the card reads not configured",
      },
      {
        key: "SHOPIFY_CLIENT_SECRET",
        from: "manual",
        targets: LOCAL_AND_VERCEL,
        absent: "as SHOPIFY_CLIENT_ID",
      },
      {
        key: "SHOPIFY_API_VERSION",
        from: "manual",
        targets: LOCAL_AND_VERCEL,
        absent: "uses the Admin API version pinned in src/features/integrations/shopify.ts",
      },
      {
        key: "QUICKBOOKS_CLIENT_ID",
        from: "manual",
        targets: LOCAL_AND_VERCEL,
        absent: "QuickBooks cannot be connected; the card reads not configured",
      },
      {
        key: "QUICKBOOKS_CLIENT_SECRET",
        from: "manual",
        targets: LOCAL_AND_VERCEL,
        absent: "as QUICKBOOKS_CLIENT_ID",
      },
      {
        key: "QUICKBOOKS_ENVIRONMENT",
        from: "manual",
        targets: LOCAL_AND_VERCEL,
        absent: "defaults to sandbox, so nothing reaches a real company file",
      },
    ],
  },
  {
    doc: [
      "DiveDay's own scheduled logical export -- the platform recovery layer, not the",
      "per-shop one (ADR 20260812-platform-backup-runner,",
      "docs/engineering/backup-and-restore-runbook.md S2). GET /api/cron/platform-backup",
      "builds every non-demo shop's export bundle weekly and PUTs it to DiveDay's own",
      "private, versioned bucket. The credential is the diveday-backup-uploader IAM user",
      "(infra/lib/infra-stack.ts S11), which can PutObject and nothing else -- no read, no",
      "list, no delete -- so a leak cannot read a shop's exported waivers back out.",
      "",
      "All four or nothing: a half-configured uploader looks configured and silently",
      "stores nothing, which is the one failure a backup cannot afford.",
    ],
    keys: [
      {
        key: "PLATFORM_BACKUP_BUCKET",
        from: "stack",
        targets: LOCAL_AND_VERCEL,
        absent:
          "the weekly platform backup answers 501 and stores nothing; the shop-owned backups in S2b are unaffected",
      },
      {
        key: "PLATFORM_BACKUP_AWS_REGION",
        from: "stack",
        targets: LOCAL_AND_VERCEL,
        absent: "as PLATFORM_BACKUP_BUCKET",
      },
      {
        key: "PLATFORM_BACKUP_AWS_ACCESS_KEY_ID",
        from: "stack",
        targets: LOCAL_AND_VERCEL,
        absent: "as PLATFORM_BACKUP_BUCKET",
      },
      {
        key: "PLATFORM_BACKUP_AWS_SECRET_ACCESS_KEY",
        from: "stack",
        targets: LOCAL_AND_VERCEL,
        absent: "as PLATFORM_BACKUP_BUCKET",
      },
    ],
  },
  {
    doc: [
      "reg-suit visual regression testing via S3. The reg-suit-bot IAM user",
      "(infra/lib/infra-stack.ts S2). CI reads the same values as GitHub Actions",
      "repository secrets; locally they are only for running `pnpm visual`. Never sent",
      "to Vercel -- the application does not read them.",
    ],
    keys: [
      {
        key: "REG_SUIT_S3_BUCKET_NAME",
        from: "stack",
        targets: LOCAL_AND_GITHUB,
        absent: "`pnpm visual` cannot compare against a baseline",
      },
      {
        key: "REG_SUIT_AWS_ACCESS_KEY_ID",
        from: "stack",
        targets: LOCAL_AND_GITHUB,
        absent: "as REG_SUIT_S3_BUCKET_NAME",
      },
      {
        key: "REG_SUIT_AWS_SECRET_ACCESS_KEY",
        from: "stack",
        targets: LOCAL_AND_GITHUB,
        absent: "as REG_SUIT_S3_BUCKET_NAME",
      },
    ],
  },
  {
    doc: [
      "CDK-generated root material for AUTH_SECRET, SECRET_ENCRYPTION_KEY, and",
      "CRON_SECRET. It is only an input to scripts/distribute-env.mjs: never put it in",
      "Vercel, GitHub, or another deployed environment.",
    ],
    keys: [
      {
        key: "APP_SECRET_SEED",
        from: "stack",
        targets: LOCAL,
        absent: "the three derived secrets fall back to their non-production defaults",
      },
    ],
  },
];

/** Every entry, flattened, in `.env.example` order. */
export const ENV_ENTRIES = ENV_GROUPS.flatMap((group) => group.keys);

/** Every key name, in `.env.example` order. */
export const ENV_KEYS = ENV_ENTRIES.map((entry) => entry.key);

const byKey = new Map(ENV_ENTRIES.map((entry) => [entry.key, entry]));

/** The registry row for a key, or undefined for one this app does not read. */
export const envEntry = (key) => byKey.get(key);

/** Keys with a given provenance, in file order. */
export const keysFrom = (...from) =>
  ENV_ENTRIES.filter((entry) => from.includes(entry.from)).map((entry) => entry.key);

/**
 * Whether a human is the only possible source. These are exactly the lines
 * `.env.manual` carries, and the only ones anybody is ever asked to fill in.
 */
export const isManual = (key) => byKey.get(key)?.from === "manual";

/**
 * Whether the deployed stack decides this value, directly or through the seed.
 * There is no local override for these: `.env.manual` holding one is an error,
 * not a preference.
 */
export const isStackProduced = (key) => {
  const from = byKey.get(key)?.from;
  return from === "stack" || from === "derived";
};

/** Whether a target file carries this key at all. */
export const goesTo = (key, target) => Boolean(byKey.get(key)?.targets.includes(target));

/**
 * Whether `.env.manual` may speak for this key.
 *
 * Exactly what a human is the source of. What may never be overridden is a
 * credential the stack mints, which is a different question and has its own
 * answer above.
 *
 * This is `isManual` today, and kept as its own name because it answers a
 * different question: `isManual` is "who fills this in", this is "may
 * `.env.manual` hold it at all". They agreed for one reason -- the only
 * non-manual overridable rows were the checked-in constants, and those are
 * gone (see the provenance note at the top). Collapsing the two would bake
 * that coincidence into the shape of the file.
 */
export const isOverridable = (key) => isManual(key);
