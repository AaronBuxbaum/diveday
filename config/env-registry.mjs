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
 * - `harness` -- the Playwright harness sets it on the servers it starts
 *   (`playwright.config.ts`, `e2e/servers.ts`). Nobody supplies it, it goes to
 *   no target, and a deployment carrying it is misconfigured, so these rows
 *   are `forbiddenInProduction`.
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

/**
 * Whether being absent is legitimate. Every row says what its absence switches
 * off (`absent`), and for nearly all of them that is a supported state -- a
 * local run has no Stripe account and nowhere to ship logs. A row marked
 * `requiredInProduction: true` is the exception: its absence from a production
 * deployment is a security gap, not a feature turned off, so
 * `pnpm check:env` refuses it when run with VERCEL_ENV=production.
 * `forbiddenInProduction: true` is the mirror image: a value whose *presence*
 * in production is the gap, refused by the same check.
 */

const LOCAL = ["local"];
const VERCEL = ["vercel"];
const LOCAL_AND_VERCEL = ["local", "vercel"];
const LOCAL_AND_GITHUB = ["local", "github"];
const NOWHERE = [];

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
      "The three DATABASE_POOL_* values tune the request-time pool for load testing",
      "or a different plan; each falls back to a default in src/lib/db-pool-config.ts.",
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
      {
        key: "DATABASE_POOL_MAX",
        from: "manual",
        targets: VERCEL,
        absent: "the pool size is src/lib/db-pool-config.ts's default",
      },
      {
        key: "DATABASE_POOL_IDLE_TIMEOUT_MS",
        from: "manual",
        targets: VERCEL,
        absent: "as DATABASE_POOL_MAX",
      },
      {
        key: "DATABASE_POOL_CONNECTION_TIMEOUT_MS",
        from: "manual",
        targets: VERCEL,
        absent: "as DATABASE_POOL_MAX",
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
      "Dedicated signing keys for three bearer-token families, each optional. Unset,",
      "recap links (src/lib/recap-links.ts) and buddy links (src/lib/buddy-tokens.ts)",
      "sign with a key derived from AUTH_SECRET, and the waiver integrity seal",
      "(src/lib/waiver-integrity.ts) signs with AUTH_SECRET itself. So rotating",
      "AUTH_SECRET with these unset breaks every recap and buddy link in flight and",
      "makes every sealed waiver verify as invalid. Setting or changing one later has",
      "the same effect on what it signs: set WAIVER_INTEGRITY_SECRET only before the",
      "first waiver is sealed, and never rotate it without re-sealing.",
    ],
    keys: [
      {
        key: "RECAP_LINK_SECRET",
        from: "manual",
        targets: VERCEL,
        absent: "recap links sign with a key derived from AUTH_SECRET",
      },
      {
        key: "BUDDY_LINK_SECRET",
        from: "manual",
        targets: VERCEL,
        absent: "buddy links sign with a key derived from AUTH_SECRET",
      },
      {
        key: "WAIVER_INTEGRITY_SECRET",
        from: "manual",
        targets: VERCEL,
        absent: "waiver integrity seals sign with AUTH_SECRET",
      },
    ],
  },
  {
    doc: [
      "Transactional email through AWS SES (ADR 20260803-ses-sole-email-provider,",
      "superseding 20260802-ses-adapter-and-webhook). The friendly sender name is",
      'supported (for example, "Blue Mantis <bookings@ses.dive.day>"). Keep all four',
      "values server-only -- none may use a NEXT_PUBLIC_ prefix. Credentials belong to",
      "the diveday-ses-sender IAM user, never the cdk-deployer or reg-suit-bot ones.",
      "Also requires the AWS-side production-access request and DKIM DNS verification",
      "for ses.dive.day -- see docs/engineering/infrastructure-runbook.md. SES_AWS_REGION",
      "is its own value rather than the estate's region: the sandbox is per region, so",
      "mail keeps its own stack and its own constant even while the two agree (ADR",
      "20260910-one-region-in-us-east-2).",
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
      "Where the two operational alerts land -- a trial started (operator_alert new_account)",
      "and someone tried the live demo (operator_alert demo_started), ADR",
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
      "Who reads the founder's Monday digest: last week's north star, demo entries",
      "and set-up requests by source, and shops stalled between activation steps",
      "(ADR 20261007-founder-metrics). A person's address, not a shared mailbox,",
      "which is why it is configuration rather than a constant. Not a secret.",
    ],
    keys: [
      {
        key: "FOUNDER_DIGEST_EMAIL",
        from: "manual",
        // Vercel only: the cron that sends it runs there, and a workstation has
        // no business mailing the founder a digest of its dev database.
        targets: VERCEL,
        absent:
          "the nightly founder-metrics run still computes and logs the numbers, but no digest is sent",
      },
    ],
  },
  {
    doc: [
      "The founder's demo-quiet key (ADR 20260805-demo-try-alerts, amendment",
      "2026-10-09). Opening /api/demo/quiet?key=<this value> once in a browser",
      "marks it as the founder's, so a demo he opens from it sends no alert. It",
      "opens nothing else: shops are created through single-use setup links (ADR",
      "20261009-single-use-setup-links), never a standing key. Any long random",
      "string (openssl rand -base64 32); change it to unmark every browser. Keys",
      "shorter than 24 characters, and the dev key written in this repository,",
      "are ignored.",
    ],
    keys: [
      {
        key: "DEMO_QUIET_KEY",
        from: "manual",
        // Vercel only: a dev run has its own fallback, and the production key
        // has no business in every workstation's generated .env.local.
        targets: VERCEL,
        absent:
          "no browser can be marked, so every demo try alerts the founder. A dev run falls back to a fixed non-production key",
      },
    ],
  },
  {
    doc: [
      "The demo sign-in switch (ADR 20260724-per-visitor-demo-shops; read in",
      "src/lib/demo-bypass.ts). Unset, the shared demo password signs in to a demo",
      "shop's staff accounts, and only a demo shop's. `off` turns that off for a",
      "deployment that should never have a demo tenant (a self-hosted install, a",
      "compliance-scoped environment); `on` turns it back on. Anything else is read",
      "as off, so a typo never reads as consent. DEMO_SHOP_TTL_DAYS and",
      "DEMO_SHOP_MAX_LIVE bound the per-visitor demo shops: how long one lives before",
      "the nightly reaper clears it, and how many may exist at once.",
    ],
    keys: [
      {
        key: "DIVEDAY_DEMO_BYPASS",
        from: "manual",
        targets: VERCEL,
        absent: "the demo bypass is on",
      },
      {
        key: "DEMO_SHOP_TTL_DAYS",
        from: "manual",
        targets: VERCEL,
        absent:
          "a minted demo shop is reaped after 7 days (a non-positive or non-numeric value reads as unset)",
      },
      {
        key: "DEMO_SHOP_MAX_LIVE",
        from: "manual",
        targets: VERCEL,
        absent:
          "at most 200 minted demo shops exist at once (a non-positive or non-numeric value reads as unset)",
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
      "Mail divers send back (ADR 20260907-two-way-inbox). SES's receipt rule stores",
      "each message in the inbound bucket and publishes a notification to its own",
      "SNS topic; /api/webhooks/email-inbound verifies the envelope, reads the",
      "object with the SES sender's own credentials (the stack grants that user",
      "s3:GetObject on this one bucket), and files it on the diver's record. The",
      "receiving domain is compiled in (inbound.ses.dive.day, under the sending",
      "identity so it needs no second verification); EMAIL_INBOUND_DOMAIN is an",
      "override for a fork, and set *empty* it switches the reply-to address off,",
      "leaving the confirmed front-desk Reply-To in place.",
    ],
    keys: [
      {
        key: "EMAIL_INBOUND_SNS_TOPIC_ARN",
        from: "stack",
        targets: LOCAL_AND_VERCEL,
        absent: "replies to DiveDay email are not received; the webhook answers 503",
      },
      {
        key: "EMAIL_INBOUND_S3_BUCKET",
        from: "stack",
        targets: LOCAL_AND_VERCEL,
        absent: "replies to DiveDay email are not received; the webhook answers 503",
      },
      {
        key: "EMAIL_INBOUND_DOMAIN",
        from: "manual",
        targets: LOCAL_AND_VERCEL,
        absent:
          "the compiled default inbound.ses.dive.day is the reply-to domain, which is right for every deployment that *is* DiveDay",
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
      "enabled, for invoice.paid, invoice.voided, invoice.payment_failed,",
      "checkout.session.completed, checkout.session.async_payment_succeeded,",
      "checkout.session.async_payment_failed, checkout.session.expired, account.updated,",
      "account.application.deauthorized, charge.refunded, charge.refund.updated,",
      "charge.dispute.created, charge.dispute.updated, charge.dispute.closed (ADR",
      "20261009-stripe-reversals-reach-diveday; charge.refund.updated is issue #2291),",
      "payout.paid, payout.failed and payout.canceled (ADR 20261012-payouts-reach-diveday).",
      "Keep the two secrets in 1Password. They never enter the AWS",
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
      "The canonical demo shop's Stripe test-mode connection (ADR",
      "20261009-demo-test-mode-payments). STRIPE_DEMO_ACCOUNT_ID is an acct_ id",
      "connected to the platform in test mode; STRIPE_DEMO_SECRET_KEY is the",
      "platform's test-mode key (sk_test_ or rk_test_ only, anything else is",
      "refused). With both set, the demo's public trip pages take a card at",
      "booking through the normal checkout, and every call about that account uses",
      "the test key, never STRIPE_SECRET_KEY. STRIPE_TEST_WEBHOOK_SECRET signs a",
      "test-mode endpoint at /api/webhooks/stripe listening to connected accounts;",
      "on a live platform its events are acted on only for the demo's account.",
      "Keep them in 1Password; they reach Vercel from .env.manual.",
    ],
    keys: [
      {
        key: "STRIPE_DEMO_ACCOUNT_ID",
        from: "manual",
        targets: VERCEL,
        absent: "the demo books without payment, as a shop with no Stripe account does",
      },
      {
        key: "STRIPE_DEMO_SECRET_KEY",
        from: "manual",
        targets: VERCEL,
        absent:
          "the demo is not connected; a demo account id set without it gets no key at all, never the live one",
      },
      {
        key: "STRIPE_TEST_WEBHOOK_SECRET",
        from: "manual",
        targets: LOCAL_AND_VERCEL,
        absent:
          "test-mode checkouts (the demo's, or a test-mode deployment's) are not confirmed by webhook",
      },
    ],
  },
  {
    doc: [
      "DiveDay's own subscription billing: what a shop pays DiveDay, on DiveDay's own",
      "Stripe account (ADR 20261007-subscription-billing). Deliberately separate from the",
      "STRIPE_* Connect keys above, which move divers' money to shops: a restricted key",
      "here (Customers, Checkout Sessions, Customer Portal sessions: write) cannot touch a",
      "connected account. BILLING_STRIPE_WEBHOOK_SECRET signs /api/webhooks/billing,",
      "configured on the account itself (not Connected accounts) for",
      "checkout.session.completed, customer.subscription.created/updated/deleted and",
      "invoice.paid. BILLING_STRIPE_PRICE_ID is the one recurring monthly price. All three",
      "or none: until every one is set, Settings > Billing says billing is not turned on",
      "and the webhook answers 503. The steps are in docs/engineering/manual-actions.md",
      "(stripe-billing-setup). Keep them in 1Password; they reach Vercel from .env.manual.",
    ],
    keys: [
      {
        key: "BILLING_STRIPE_SECRET_KEY",
        from: "manual",
        targets: LOCAL_AND_VERCEL,
        absent: "Settings > Billing says billing is not turned on yet; nothing is charged",
      },
      {
        key: "BILLING_STRIPE_WEBHOOK_SECRET",
        from: "manual",
        targets: LOCAL_AND_VERCEL,
        absent:
          "billing counts as not turned on; /api/webhooks/billing answers 503 so Stripe keeps retrying",
      },
      {
        key: "BILLING_STRIPE_PRICE_ID",
        from: "manual",
        targets: LOCAL_AND_VERCEL,
        absent: "billing counts as not turned on; there is nothing to subscribe to",
      },
    ],
  },
  {
    doc: [
      "The pricing A/B test (ADR 20261022-pricing-ab-test): flat monthly fee vs a share",
      "of the card money a shop takes through DiveDay. Every value is optional; changing",
      "one is an edit here and a redeploy. PRICING_TEST=on turns the percent arm on",
      "(anything else is off). PRICING_PERCENT_SPLIT 0-100 (default 50) is the percent",
      "of new visitors and shops put in the percent arm. PRICING_FLAT_MONTHLY_CENTS",
      "0-100000 (default 9900). PRICING_PERCENT_BASIS_POINTS 0-1000 (default 300, i.e.",
      "3%). PRICING_PERCENT_MONTHLY_CENTS 0-100000 (default 0) is a base fee on top of",
      "the percent. One invalid value sends all five back to their defaults, test off.",
      "A subscriber keeps the numbers Checkout sold it whatever these say later.",
      "BILLING_STRIPE_PERCENT_PRICE_ID is a metered price on a Stripe Billing Meter at",
      "$0.01 a unit, and BILLING_STRIPE_PERCENT_METER_EVENT that meter's event name:",
      "both or neither. Without them a percent-plan shop's Billing page says billing for",
      "its plan is not on, and the monthly close writes statements but reports nothing.",
    ],
    keys: [
      {
        key: "PRICING_TEST",
        from: "manual",
        targets: LOCAL_AND_VERCEL,
        absent: "the test is off: every visitor and shop sees and pays the flat plan",
      },
      {
        key: "PRICING_PERCENT_SPLIT",
        from: "manual",
        targets: LOCAL_AND_VERCEL,
        absent: "half of new visitors and shops are put in the percent arm while the test is on",
      },
      {
        key: "PRICING_FLAT_MONTHLY_CENTS",
        from: "manual",
        targets: LOCAL_AND_VERCEL,
        absent: "the flat plan is today's published price",
      },
      {
        key: "PRICING_PERCENT_BASIS_POINTS",
        from: "manual",
        targets: LOCAL_AND_VERCEL,
        absent: "the percent plan is 3% of the month's card money through DiveDay",
      },
      {
        key: "PRICING_PERCENT_MONTHLY_CENTS",
        from: "manual",
        targets: LOCAL_AND_VERCEL,
        absent: "the percent plan has no monthly base fee",
      },
      {
        key: "BILLING_STRIPE_PERCENT_PRICE_ID",
        from: "manual",
        targets: LOCAL_AND_VERCEL,
        absent: "the percent plan cannot be sold yet; its Billing page offers no button",
      },
      {
        key: "BILLING_STRIPE_PERCENT_METER_EVENT",
        from: "manual",
        targets: LOCAL_AND_VERCEL,
        absent: "the percent plan cannot be sold yet, and no month's fee is reported to Stripe",
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
      "Web Push for manifest changes (ADR 20260804-manifest-web-push). A VAPID keypair",
      "(`npx web-push generate-vapid-keys`) and a mailto: or https: contact the push",
      "service can reach. All three or none: a partial set reads as unset. Keep the",
      "private key in 1Password; rotating the pair orphans every existing subscription.",
    ],
    keys: [
      {
        key: "VAPID_PUBLIC_KEY",
        from: "manual",
        targets: VERCEL,
        absent: "the push opt-in does not render and no manifest change is pushed",
      },
      {
        key: "VAPID_PRIVATE_KEY",
        from: "manual",
        targets: VERCEL,
        absent: "as VAPID_PUBLIC_KEY",
      },
      {
        key: "VAPID_SUBJECT",
        from: "manual",
        targets: VERCEL,
        absent: "as VAPID_PUBLIC_KEY",
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
      "Encryption key for secrets DiveDay stores: each staffer's two-factor secret and",
      "recovery codes, each shop's WhatsApp access token and connector credentials, and",
      "queued notifications (ADR 20260802-whatsapp-cloud-api-per-shop). Derived from",
      "APP_SECRET_SEED. Never rotate it in one step: put the old value in",
      "SECRET_ENCRYPTION_KEY_PREVIOUS first, which opens what the old key sealed while the",
      "new one seals everything written from then on. The rotation runbook is in",
      "docs/engineering/infrastructure-runbook.md. A production deploy without it fails",
      "at build (`pnpm check:env` under VERCEL_ENV=production); previews are not asked.",
    ],
    keys: [
      {
        key: "SECRET_ENCRYPTION_KEY",
        from: "derived",
        targets: LOCAL_AND_VERCEL,
        requiredInProduction: true,
        absent:
          "every staffer who turned on two-factor is locked out: sign-in demands the second " +
          "factor, and neither the authenticator code nor a recovery code can be checked without " +
          "this key. Two-factor cannot be turned on, the WhatsApp settings page says so and " +
          "refuses to store anything, a waiver link is " +
          "minted fresh on every send instead of the diver being handed the one they already have, " +
          "and the notification retry queue stores nothing and drains nothing -- a send the provider " +
          "refuses transiently is dropped rather than retried (notification.queue_seal_unavailable). " +
          "Rotating it without SECRET_ENCRYPTION_KEY_PREVIOUS has the same lockout, and rows " +
          "already queued under the old key are parked as sealed_payload_unreadable and not re-sent.",
      },
      {
        key: "SECRET_ENCRYPTION_KEY_PREVIOUS",
        from: "manual",
        targets: LOCAL_AND_VERCEL,
        absent:
          "no rotation is in progress, and only SECRET_ENCRYPTION_KEY opens anything. Remove it " +
          "only once every two-factor account has signed in since the rotation (each secret is " +
          "re-sealed then) and has replaced recovery codes issued before it: those stay hashed " +
          "under this key, and stop working when it goes.",
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
      "ArcGIS location services -- the maps' place names drawn as sharp vector text",
      "(src/lib/basemap.ts). NEXT_PUBLIC_ because the browser sends it with every",
      "label request; restrict the key to DiveDay's domains in the ArcGIS dashboard.",
      "Vercel needs it in Production and Preview: a preview build inlines it too.",
    ],
    keys: [
      {
        key: "NEXT_PUBLIC_ARCGIS_API_KEY",
        from: "manual",
        targets: LOCAL_AND_VERCEL,
        absent: "the maps keep Esri's raster place labels, which blur on a retina screen",
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
      "The distributed rate-limit store (ADR 20260801-distributed-rate-limit-store):",
      "an Upstash Redis database's REST URL and token, read by src/lib/rate-limit.ts.",
      "Vercel's Upstash for Redis integration sets both on the project under these",
      "KV_ names; otherwise paste them from the Upstash console. Vercel only: a local run, the e2e fleet and CI use",
      "the in-process store on purpose. Absent in production, every limit is per",
      "serverless instance and so multiplied by however many are warm -- the app",
      "logs rate_limit.memory_store_in_production once per instance, and",
      "`pnpm check:env` fails when it runs with VERCEL_ENV=production and either",
      "is unset.",
    ],
    keys: [
      {
        key: "KV_REST_API_URL",
        from: "manual",
        targets: VERCEL,
        requiredInProduction: true,
        absent:
          "rate limits fall back to a per-instance in-memory store, so sign-in, password reset and public booking limits are bypassable by fan-out",
      },
      {
        key: "KV_REST_API_TOKEN",
        from: "manual",
        targets: VERCEL,
        requiredInProduction: true,
        absent: "as KV_REST_API_URL",
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
      "Claude assists (ADR 20261018-claude-assists). Unset, every assist is dark and",
      "each feature works exactly as it does without Claude; DIVEDAY_DISABLE_EXTERNAL_HTTP=1",
      "darkens them too. The per-shop monthly cap is in USD (default 15); at the cap a",
      "shop's assists go dark until the first of the next UTC month. A demo shop's cap",
      "is 1, and every demo together goes dark at the shared demo allowance (10).",
    ],
    keys: [
      {
        key: "ANTHROPIC_API_KEY",
        from: "manual",
        targets: LOCAL_AND_VERCEL,
        absent:
          "every Claude assist is dark and the anthropic_spend ceiling reports not_configured",
      },
      {
        key: "DIVEDAY_CLAUDE_SHOP_MONTHLY_CAP_USD",
        from: "manual",
        targets: LOCAL_AND_VERCEL,
        absent: "each shop's Claude assists are capped at $15 a month",
      },
      {
        key: "DIVEDAY_CLAUDE_DEMO_SHOP_MONTHLY_CAP_USD",
        from: "manual",
        targets: LOCAL_AND_VERCEL,
        absent: "each demo shop's Claude assists are capped at $1 a month",
      },
      {
        key: "DIVEDAY_CLAUDE_DEMO_MONTHLY_CAP_USD",
        from: "manual",
        targets: LOCAL_AND_VERCEL,
        absent: "every demo shop together is capped at $10 a month",
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
      "",
      "Reads go through CloudFront, never the bucket: the bucket blocks all public",
      "access and grants GetObject only to that distribution, whose behaviours",
      "enumerate the six public prefixes (arrival, courses, dive-sites, recap,",
      "shop-heroes, shop-logos). The same bucket holds import-waivers/,",
      "import-receipts/ and medical-clearances/ -- medical and financial records and",
      "physicians' evaluations, read only server-side -- so nothing at the edge may",
      "reach them (issues #1013, #1252, #1352).",
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
        absent: "falls back to the direct S3 bucket endpoint, which answers 403 to every viewer",
        // The CloudFront distribution's domain -- the alternate one from
        // cdk.json's mediaDomainName when set, otherwise the *.cloudfront.net
        // name AWS assigns. It is not decoration in either case: three
        // allowlists derive from this single value (the CSP img-src in
        // src/lib/content-security-policy.ts, the image-optimizer patterns in
        // next.config.ts, and isManagedStorageUrl in
        // src/lib/storage/blob-host.ts), and media URLs are stored absolute, so
        // changing it strands every row written before the change.
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
      "(infra/lib/infra-stack.ts S2). Locally these values are only for running",
      "`pnpm visual`; CI assumes the GitHub OIDC role instead of using static AWS",
      "credentials. The bucket name is also sent to GitHub Actions as a repository",
      "secret. Never sent to Vercel -- the application does not read them. The region is here because",
      "the bucket moved with the estate and two callers were still pointing at the",
      "old one, which reads as an empty baseline rather than an error.",
    ],
    keys: [
      {
        key: "REG_SUIT_AWS_REGION",
        from: "stack",
        targets: LOCAL,
        absent: "`pnpm visual` reaches for the baseline bucket in the wrong region",
      },
      {
        key: "REG_SUIT_S3_BUCKET_NAME",
        from: "stack",
        targets: LOCAL_AND_GITHUB,
        absent: "`pnpm visual` cannot compare against a baseline",
      },
      {
        key: "REG_SUIT_AWS_ACCESS_KEY_ID",
        from: "stack",
        targets: LOCAL,
        absent: "as REG_SUIT_S3_BUCKET_NAME",
      },
      {
        key: "REG_SUIT_AWS_SECRET_ACCESS_KEY",
        from: "stack",
        targets: LOCAL,
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
  {
    doc: [
      "The e2e harness's own switches, set by playwright.config.ts on every server it",
      "starts and never anywhere else. DIVEDAY_E2E=1 re-opens the /api/test/* routes in",
      "a production runtime; DIVEDAY_E2E_SECRET is the bearer token those routes also",
      "require (src/lib/e2e-test-routes.ts). Both stay closed while DATABASE_URL is",
      "set, and `pnpm check:env` fails a production build that carries either one.",
    ],
    keys: [
      {
        key: "DIVEDAY_E2E",
        from: "harness",
        targets: NOWHERE,
        forbiddenInProduction: true,
        absent: "the /api/test/* routes are closed in a production runtime",
      },
      {
        key: "DIVEDAY_E2E_SECRET",
        from: "harness",
        targets: NOWHERE,
        forbiddenInProduction: true,
        absent: "every /api/test/* route refuses, whatever else is set",
      },
    ],
  },
];

/** Every entry, flattened, in `.env.example` order. */
export const ENV_ENTRIES = ENV_GROUPS.flatMap((group) => group.keys);

/** Every key name, in `.env.example` order. */
export const ENV_KEYS = ENV_ENTRIES.map((entry) => entry.key);

/** Keys that appear in more than one row. Empty in a valid registry. */
export const duplicateKeys = (keys = ENV_KEYS) => [
  ...new Set(keys.filter((key, index) => keys.indexOf(key) !== index)),
];

// Refused at import, because every generated file inherits a duplicate row: two
// `KEY=` lines in `.env.example`, `.env.manual` and `.env.vercel`, and the
// Vercel upload refuses the last of those (scripts/import-vercel-env.mjs).
const duplicated = duplicateKeys();
if (duplicated.length > 0) {
  throw new Error(
    `config/env-registry.mjs registers ${duplicated.join(", ")} more than once. Keep one row per key.`,
  );
}

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

/** Keys a production deployment must carry; see `requiredInProduction` above. */
export const keysRequiredInProduction = () =>
  ENV_ENTRIES.filter((entry) => entry.requiredInProduction === true).map((entry) => entry.key);

/** Keys a production deployment must not carry; see `forbiddenInProduction` above. */
export const keysForbiddenInProduction = () =>
  ENV_ENTRIES.filter((entry) => entry.forbiddenInProduction === true).map((entry) => entry.key);

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
