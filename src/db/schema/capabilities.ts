import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  CAPABILITY_PURPOSES,
  type CapabilityPurpose,
  type CapabilitySubject,
  expiringPurposes,
  onePerPersonPurposes,
  platformPurposes,
  purposesNaming,
  reusablePurposes,
  spentPurposes,
} from "@/lib/capabilities";
import { appNowTimestamp } from "./columns";
import { people, shops, userAccounts } from "./core";
import { setupRequests } from "./funnel";
import { interests } from "./interests";

/**
 * Mirrors `CapabilityPurpose` in `src/lib/capabilities.ts`, which is its only
 * source: the values are read from there.
 */
export const capabilityPurpose = pgEnum("capability_purpose", CAPABILITY_PURPOSES);

/** A SQL list of purposes, read from `CAPABILITY_POLICY` so a check cannot disagree with it. */
function sqlList(purposes: CapabilityPurpose[]) {
  return sql.raw(purposes.map((purpose) => `'${purpose}'`).join(", "));
}

const naming = (subject: CapabilitySubject) => sqlList(purposesNaming(subject));

/**
 * **Every bearer capability that has moved off its own table** (issue #2710).
 * A row is one hashed link, for one purpose, opening one subject. What the
 * purpose may do (its subject, its lifetime, whether a use spends it) is one
 * record in `CAPABILITY_POLICY` (`src/lib/capabilities.ts`), and every read and
 * write goes through `src/db/capabilities.ts`, whose verify carries the purpose
 * in its predicate: a token minted for one purpose never resolves as another.
 *
 * The subject is a typed nullable column per kind, not a polymorphic id, so
 * each one is a real foreign key and an erasure or a merge can find it.
 * `shop_id` is null exactly on a purpose whose policy `scope` is `platform`
 * (an account token names a sign-in account, not a shop's records):
 * `capabilities_scope_by_purpose` holds that both ways (ADR
 * 20261105-capabilities-shop-id-nullable).
 * `capabilities_subject_by_purpose` holds every row to exactly the subject its
 * purpose names. Facts about the thing a capability opens stay on that thing.
 *
 * `token_hash` is the SHA-256 of the token (`src/lib/bearer-tokens.ts`); the
 * token itself is never stored. `used_at` is set only on a purpose a use
 * spends (`use: "once"`). `expires_at` is set on exactly the purposes that
 * expire (`lifetime: "expires"`). `revoked_at` marks a link a newer mint
 * superseded (`reissue: "supersedes"`) or that was turned off; a revoked row
 * opens nothing but stays, so its page can still say the link is no longer
 * available.
 */
export const capabilities = pgTable(
  "capabilities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    purpose: capabilityPurpose("purpose").notNull(),
    /** Null exactly on a `platform` purpose (`capabilities_scope_by_purpose`). */
    shopId: uuid("shop_id").references(() => shops.id),
    personId: uuid("person_id").references(() => people.id),
    /** A `user_account` purpose's subject: the sign-in account an account token proves. */
    userAccountId: uuid("user_account_id").references(() => userAccounts.id),
    /** A `setup_request` purpose's subject; the link goes with its request. */
    setupRequestId: uuid("setup_request_id").references(() => setupRequests.id, {
      onDelete: "cascade",
    }),
    /**
     * The shop a spent setup link opened, set in the transaction that created
     * it: which request became which shop. Cleared if that shop is deleted;
     * the spend stands. Only ever on `shop_setup`.
     */
    spentByShopId: uuid("spent_by_shop_id").references(() => shops.id, { onDelete: "set null" }),
    // Bound to the row's own shop by the composite key below, not a bare id.
    interestId: uuid("interest_id"),
    /** A `shop_address` purpose's subject: the lower-cased address the link was mailed to. */
    sentTo: text("sent_to"),
    tokenHash: text("token_hash").notNull().unique(),
    issuedAt: appNowTimestamp("issued_at").notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    /** Set on exactly the purposes that expire (`CAPABILITY_POLICY[purpose].lifetime`). */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    /** A newer link of the same purpose superseded this one; it opens nothing. */
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    /**
     * A reusable purpose's last successful use (a calendar client's fetch), so
     * staff can tell a live subscription from a URL nobody pasted anywhere.
     * Coarse on purpose: a client polls often. Only on `use: "reusable"`.
     */
    lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),
    /**
     * True exactly on a `person` purpose of which a person holds one live link
     * (`per: "subject"`: the calendar feeds), as `capabilities_one_live_by_purpose`
     * holds. It exists for the partial unique index below: an index predicate
     * must be immutable, which an enum-to-text cast is not, and a purpose added
     * in a migration cannot be named as an enum literal in the transaction that
     * adds it, so the index names these rows by this column instead.
     */
    oneLive: boolean("one_live").notNull().default(false),
  },
  (table) => [
    index("capabilities_person_idx").on(table.personId),
    index("capabilities_interest_idx").on(table.interestId),
    index("capabilities_user_account_idx").on(table.userAccountId),
    index("capabilities_setup_request_idx").on(table.setupRequestId),
    // One live link per person and purpose where the policy says so (the
    // calendar feeds): the mint's revoke under the person-row lock is the rule,
    // this is its backstop.
    uniqueIndex("capabilities_live_person_purpose_idx")
      .on(table.personId, table.purpose)
      .where(sql`${table.oneLive} and ${table.usedAt} is null and ${table.revokedAt} is null`),
    index("capabilities_spent_by_shop_idx").on(table.spentByShopId),
    // One live account token per account and purpose: the mint's revoke under
    // the account-row lock is the rule, this is its backstop.
    uniqueIndex("capabilities_live_account_purpose_idx")
      .on(table.userAccountId, table.purpose)
      .where(
        sql`${table.userAccountId} is not null and ${table.usedAt} is null and ${table.revokedAt} is null`,
      ),
    // An interest capability can only name an interest of its own shop, so an
    // erasure, a merge or a demo reset scoped by shop always finds it.
    foreignKey({
      name: "capabilities_shop_interest_fkey",
      columns: [table.shopId, table.interestId],
      foreignColumns: [interests.shopId, interests.id],
    }),
    check(
      "capabilities_subject_by_purpose",
      sql`(${table.purpose}::text in (${naming("interest")}) and ${table.interestId} is not null and ${table.personId} is null and ${table.sentTo} is null and ${table.userAccountId} is null and ${table.setupRequestId} is null)
        or (${table.purpose}::text in (${naming("person")}) and ${table.personId} is not null and ${table.interestId} is null and ${table.sentTo} is null and ${table.userAccountId} is null and ${table.setupRequestId} is null)
        or (${table.purpose}::text in (${naming("shop_address")}) and ${table.sentTo} is not null and ${table.sentTo} = lower(${table.sentTo}) and ${table.personId} is null and ${table.interestId} is null and ${table.userAccountId} is null and ${table.setupRequestId} is null)
        or (${table.purpose}::text in (${naming("user_account")}) and ${table.userAccountId} is not null and ${table.personId} is null and ${table.interestId} is null and ${table.sentTo} is null and ${table.setupRequestId} is null)
        or (${table.purpose}::text in (${naming("setup_request")}) and ${table.setupRequestId} is not null and ${table.personId} is null and ${table.interestId} is null and ${table.sentTo} is null and ${table.userAccountId} is null)`,
    ),
    // A platform purpose names no shop, and every other purpose names one.
    check(
      "capabilities_scope_by_purpose",
      sql`(${table.shopId} is null) = (${table.purpose}::text in (${sqlList(platformPurposes())}))`,
    ),
    // Only a purpose a use spends is ever marked used.
    check(
      "capabilities_used_only_when_spent",
      sql`${table.usedAt} is null or ${table.purpose}::text in (${sqlList(spentPurposes())})`,
    ),
    // A purpose that expires always carries its deadline, and no other does.
    check(
      "capabilities_expiry_by_purpose",
      sql`(${table.expiresAt} is not null) = (${table.purpose}::text in (${sqlList(expiringPurposes())}))`,
    ),
    // `one_live` mirrors the purpose's policy, so the index above cannot miss a row.
    check(
      "capabilities_one_live_by_purpose",
      sql`${table.oneLive} = (${table.purpose}::text in (${sqlList(onePerPersonPurposes())}))`,
    ),
    // Only a reusable purpose records its last use.
    check(
      "capabilities_accessed_only_when_reusable",
      sql`${table.lastAccessedAt} is null or ${table.purpose}::text in (${sqlList(reusablePurposes())})`,
    ),
    // Only a setup link records the shop it opened.
    check(
      "capabilities_spent_by_shop_only_setup",
      sql`${table.spentByShopId} is null or ${table.purpose}::text in (${naming("setup_request")})`,
    ),
    // An erasure sweeps a shop's links by the address they went to.
    index("capabilities_sent_to_idx").on(table.shopId, table.sentTo),
  ],
);

export type Capability = typeof capabilities.$inferSelect;
