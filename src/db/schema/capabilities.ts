import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import {
  CAPABILITY_PURPOSES,
  type CapabilityPurpose,
  type CapabilitySubject,
  expiringPurposes,
  purposesNaming,
  spentPurposes,
} from "@/lib/capabilities";
import { appNowTimestamp } from "./columns";
import { people, shops } from "./core";
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
 * `capabilities_subject_by_purpose` holds every row to exactly the subject its
 * purpose names. Facts about the thing a capability opens stay on that thing.
 *
 * `token_hash` is the SHA-256 of the token (`src/lib/bearer-tokens.ts`); the
 * token itself is never stored. `used_at` is set only on a purpose a use
 * spends (`use: "once"`). `expires_at` is set on exactly the purposes that
 * expire (`lifetime: "expires"`). `revoked_at` marks a link a newer mint
 * superseded (`reissue: "supersedes"`); a revoked row opens nothing but stays,
 * so its page can still say the link is no longer available.
 */
export const capabilities = pgTable(
  "capabilities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    purpose: capabilityPurpose("purpose").notNull(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    personId: uuid("person_id").references(() => people.id),
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
  },
  (table) => [
    index("capabilities_person_idx").on(table.personId),
    index("capabilities_interest_idx").on(table.interestId),
    // An interest capability can only name an interest of its own shop, so an
    // erasure, a merge or a demo reset scoped by shop always finds it.
    foreignKey({
      name: "capabilities_shop_interest_fkey",
      columns: [table.shopId, table.interestId],
      foreignColumns: [interests.shopId, interests.id],
    }),
    check(
      "capabilities_subject_by_purpose",
      sql`(${table.purpose}::text in (${naming("interest")}) and ${table.interestId} is not null and ${table.personId} is null and ${table.sentTo} is null)
        or (${table.purpose}::text in (${naming("person")}) and ${table.personId} is not null and ${table.interestId} is null and ${table.sentTo} is null)
        or (${table.purpose}::text in (${naming("shop_address")}) and ${table.sentTo} is not null and ${table.sentTo} = lower(${table.sentTo}) and ${table.personId} is null and ${table.interestId} is null)`,
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
    // An erasure sweeps a shop's links by the address they went to.
    index("capabilities_sent_to_idx").on(table.shopId, table.sentTo),
  ],
);

export type Capability = typeof capabilities.$inferSelect;
