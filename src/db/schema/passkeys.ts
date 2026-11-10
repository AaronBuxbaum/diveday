import { sql } from "drizzle-orm";
import { bigint, check, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { accountSessions } from "./accounts";
import { appNowTimestamp } from "./columns";
import { shops, userAccounts } from "./core";

/** Public credential material only. The authenticator never sends its private key. */
export const accountPasskeys = pgTable(
  "account_passkeys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    userAccountId: uuid("user_account_id")
      .notNull()
      .references(() => userAccounts.id, { onDelete: "cascade" }),
    credentialId: text("credential_id").notNull().unique(),
    publicKey: text("public_key").notNull(),
    counter: bigint("counter", { mode: "number" }).notNull().default(0),
    name: text("name").notNull(),
    createdAt: appNowTimestamp("created_at").notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("account_passkeys_live_account_idx")
      .on(table.userAccountId)
      .where(sql`${table.deletedAt} is null`),
    check("account_passkeys_counter", sql`${table.counter} >= 0`),
    check("account_passkeys_name", sql`length(${table.name}) between 1 and 80`),
  ],
);

/** One-use browser-bound ceremony machinery, hard deleted on consumption. */
export const accountPasskeyChallenges = pgTable(
  "account_passkey_challenges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Anonymous sign-in has no account or shop until its credential is verified.
    shopId: uuid("shop_id").references(() => shops.id, { onDelete: "cascade" }),
    userAccountId: uuid("user_account_id").references(() => userAccounts.id, {
      onDelete: "cascade",
    }),
    accountSessionId: uuid("account_session_id").references(() => accountSessions.id, {
      onDelete: "cascade",
    }),
    tokenHash: text("token_hash").notNull().unique(),
    challenge: text("challenge").notNull(),
    ceremony: text("ceremony").notNull().$type<"sign-in" | "register" | "step-up">(),
    purpose: text("purpose").$type<"money" | "export" | "backup" | "security">(),
    origin: text("origin").notNull(),
    rpId: text("rp_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: appNowTimestamp("created_at").notNull(),
  },
  (table) => [
    index("account_passkey_challenges_expiry_idx").on(table.expiresAt),
    check(
      "account_passkey_challenges_binding",
      sql`(${table.ceremony} = 'sign-in' and ${table.userAccountId} is null and ${table.accountSessionId} is null and ${table.shopId} is null and ${table.purpose} is null) or (${table.ceremony} in ('register', 'step-up') and ${table.userAccountId} is not null and ${table.accountSessionId} is not null and ${table.shopId} is not null and ((${table.ceremony} = 'register' and ${table.purpose} is null) or (${table.ceremony} = 'step-up' and ${table.purpose} is not null and ${table.purpose} in ('money', 'export', 'backup', 'security'))))`,
    ),
  ],
);
