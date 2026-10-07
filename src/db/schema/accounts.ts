import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { people, shops, userAccounts } from "./core";

/**
 * Sign-in machinery around `user_accounts`: tokens, sessions, step-ups,
 * security state, and the auth-provider tables.
 */

export const accountTokenPurpose = pgEnum("account_token_purpose", [
  "email_verification",
  "password_reset",
  "invite",
]);

/**
 * A hashed, expiring, one-time bearer token proving control of a user
 * account's own email address — confirming a freshly created account, or
 * authorizing a password reset (20260725-account-lifecycle-emails). Shaped
 * like `waiver_records`'/`booking_capabilities`' tokens, not
 * `recap-links.ts`'s stateless one: a password-reset token is a bearer
 * credential over account takeover and must be individually revocable.
 * Issuing a fresh token for the same account+purpose supersedes any prior
 * outstanding one, exactly like a reissued waiver link.
 */
export const accountTokens = pgTable(
  "account_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userAccountId: uuid("user_account_id")
      .notNull()
      .references(() => userAccounts.id),
    purpose: accountTokenPurpose("purpose").notNull(),
    /** SHA-256 hash only — the raw bearer token is shown once when issued. */
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("account_tokens_account_purpose_idx").on(table.userAccountId, table.purpose)],
);

/**
 * A signed-in session — better-auth's `session` model, mapped here by name
 * for consistency with `account_tokens` rather than better-auth's default
 * `session`. Unlike the JWT next-auth used (ADR-0006), this row is the
 * session: `token` is what the cookie carries, and revoking sign-in means
 * deleting or expiring this row rather than waiting out a JWT's lifetime.
 *
 * `personId`/`shopId`/`shopSlug`/`roles` are a snapshot taken once, at
 * sign-in, by the credentials plugin (src/lib/auth.ts) — exactly what
 * next-auth's `jwt()` callback used to snapshot onto the token. A role change
 * takes effect on next sign-in, not instantly; ADR-0006 already accepted this
 * and this migration does not change it. `roles` only ever backs the edge
 * proxy's coarse UI redirect — every privileged mutation re-reads live roles
 * from `person_roles` via `loadActiveStaffRoles` (src/db/authz.ts), which
 * never trusts this snapshot.
 */
export const accountSessions = pgTable(
  "account_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userAccountId: uuid("user_account_id")
      .notNull()
      .references(() => userAccounts.id),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    shopSlug: text("shop_slug").notNull(),
    roles: jsonb("roles").notNull().$type<string[]>(),
    /** `people.full_name` at sign-in — the "Hi, {name}" greeting and invite emails read this off the session rather than a fresh join. */
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("account_sessions_user_account_idx").on(table.userAccountId)],
);

/** Encrypted TOTP seed plus one-time recovery-code hashes for an account. */
export const accountSecurity = pgTable("account_security", {
  userAccountId: uuid("user_account_id")
    .primaryKey()
    .references(() => userAccounts.id, { onDelete: "cascade" }),
  totpSecretSealed: text("totp_secret_sealed"),
  totpEnabledAt: timestamp("totp_enabled_at", { withTimezone: true }),
  recoveryCodeHashes: jsonb("recovery_code_hashes").$type<string[]>().notNull().default([]),
  lastTotpStep: bigint("last_totp_step", { mode: "number" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const securityStepUpPurpose = pgEnum("security_step_up_purpose", [
  "money",
  "export",
  "backup",
]);

/** Short-lived, session-bound grants produced by a second-factor challenge. */
export const accountStepUps = pgTable(
  "account_step_ups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userAccountId: uuid("user_account_id")
      .notNull()
      .references(() => userAccounts.id, { onDelete: "cascade" }),
    accountSessionId: uuid("account_session_id")
      .notNull()
      .references(() => accountSessions.id, { onDelete: "cascade" }),
    purpose: securityStepUpPurpose("purpose").notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("account_step_ups_session_purpose_idx").on(
      table.accountSessionId,
      table.purpose,
      table.expiresAt,
    ),
    index("account_step_ups_account_expires_idx").on(table.userAccountId, table.expiresAt),
    check(
      "account_step_ups_expiry_after_verification",
      sql`${table.expiresAt} > ${table.verifiedAt}`,
    ),
  ],
);

/**
 * better-auth's `account` model — one row per login provider linked to a
 * user. Required adapter scaffolding, functionally unused here: sign-in goes
 * through a custom credentials plugin that verifies against
 * `user_accounts.hashed_password` directly (src/lib/credentials.ts) and never
 * writes a provider row, and no OAuth provider is configured. Named away from
 * "account" since that word already means a shop's connected Stripe/WhatsApp
 * account elsewhere in this schema.
 */
export const authProviderAccounts = pgTable("auth_provider_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userAccountId: uuid("user_account_id")
    .notNull()
    .references(() => userAccounts.id),
  providerId: text("provider_id").notNull(),
  accountId: text("account_id").notNull(),
  /**
   * The seven columns better-auth's `account` model writes when an OAuth
   * provider or its own credentials flow is configured. Nothing here writes
   * them today and nothing reads them, but they are not optional: 1.7.3's
   * adapter compares this table against the model on the first request and
   * refuses to serve any request while a column it writes is missing
   * (issue #1588). `password` in particular is better-auth's own place for a
   * credentials hash and stays empty — ours lives on
   * `user_accounts.hashed_password`, which is the column
   * `verifyCredentials` reads.
   */
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * better-auth's `verification` model — required adapter scaffolding,
 * functionally unused here: email verification, password reset, and staff
 * invites all run through the existing, unrelated `account_tokens` system
 * (src/db/account-tokens.ts), not better-auth's own flows.
 */
export const authVerifications = pgTable("auth_verifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AccountSecurity = typeof accountSecurity.$inferSelect;

export type AccountStepUp = typeof accountStepUps.$inferSelect;

export type SecurityStepUpPurpose = (typeof securityStepUpPurpose.enumValues)[number];
