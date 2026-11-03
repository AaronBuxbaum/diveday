import { sql } from "drizzle-orm";
import { check, index, pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { CAPABILITY_PURPOSES } from "@/lib/capabilities";
import { appNowTimestamp } from "./columns";
import { people, shops } from "./core";
import { interests } from "./interests";

/**
 * Mirrors `CapabilityPurpose` in `src/lib/capabilities.ts`, which is its only
 * source: the values are read from there.
 */
export const capabilityPurpose = pgEnum("capability_purpose", CAPABILITY_PURPOSES);

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
 * token itself is never stored. The two purposes here never expire and are
 * never spent (`lifetime: "never"`, `use: "idempotent"`), so the table has no
 * `expires_at` or `revoked_at` yet: those arrive with the first purpose that
 * needs them.
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
    interestId: uuid("interest_id").references(() => interests.id),
    tokenHash: text("token_hash").notNull().unique(),
    issuedAt: appNowTimestamp("issued_at").notNull(),
  },
  (table) => [
    index("capabilities_person_idx").on(table.personId),
    index("capabilities_interest_idx").on(table.interestId),
    check(
      "capabilities_subject_by_purpose",
      sql`(${table.purpose} = 'interest_unsubscribe' and ${table.interestId} is not null and ${table.personId} is null)
        or (${table.purpose} = 'courtesy_email_unsubscribe' and ${table.personId} is not null and ${table.interestId} is null)`,
    ),
  ],
);

export type Capability = typeof capabilities.$inferSelect;
