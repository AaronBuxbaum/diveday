import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { PassContent, WalletPlatform } from "@/lib/wallet-passes";
import { bookings } from "./bookings";
import { appNowTimestamp } from "./columns";
import { shops } from "./core";

/** Native departure-pass snapshots. Hash-only credentials; erased with their diver. */
export const walletPasses = pgTable(
  "wallet_passes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    bookingId: uuid("booking_id").notNull(),
    platform: text("platform").$type<WalletPlatform>().notNull(),
    locale: text("locale").notNull(),
    authenticationTokenHash: text("authentication_token_hash"),
    googleObjectId: text("google_object_id"),
    contentHash: text("content_hash").notNull(),
    contentJson: jsonb("content_json").$type<PassContent>().notNull(),
    issuedAt: appNowTimestamp("issued_at").notNull(),
    updatedAt: appNowTimestamp("updated_at").notNull(),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    lastPushedAt: timestamp("last_pushed_at", { withTimezone: true }),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      name: "wallet_passes_shop_booking_fk",
      columns: [t.shopId, t.bookingId],
      foreignColumns: [bookings.shopId, bookings.id],
    }),
    uniqueIndex("wallet_passes_live_booking_platform_idx")
      .on(t.bookingId, t.platform)
      .where(sql`${t.deletedAt} is null`),
    uniqueIndex("wallet_passes_shop_id_id_idx").on(t.shopId, t.id),
    index("wallet_passes_shop_idx").on(t.shopId),
    check("wallet_passes_platform_check", sql`${t.platform} in ('apple', 'google')`),
    check(
      "wallet_passes_credentials_check",
      sql`(${t.platform} = 'apple' and ${t.authenticationTokenHash} is not null and ${t.googleObjectId} is null) or (${t.platform} = 'google' and ${t.authenticationTokenHash} is null and ${t.googleObjectId} is not null)`,
    ),
  ],
);

/** PassKit device delivery addresses, never logged or exported. */
export const walletPassRegistrations = pgTable(
  "wallet_pass_registrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    passId: uuid("pass_id").notNull(),
    deviceLibraryIdentifier: text("device_library_identifier").notNull(),
    pushToken: text("push_token").notNull(),
    createdAt: appNowTimestamp("created_at").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      name: "wallet_registrations_shop_pass_fk",
      columns: [t.shopId, t.passId],
      foreignColumns: [walletPasses.shopId, walletPasses.id],
    }),
    uniqueIndex("wallet_registrations_live_device_idx")
      .on(t.passId, t.deviceLibraryIdentifier)
      .where(sql`${t.deletedAt} is null`),
    index("wallet_registrations_shop_idx").on(t.shopId),
  ],
);
