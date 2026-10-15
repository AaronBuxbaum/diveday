import { randomBytes } from "node:crypto";
import { type SQL, sql } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import { shops } from "@/db/schema";

/**
 * A fresh shop on a real-Postgres scratch database, with a unique slug so two
 * suites on one server never collide. For `*.postgres.test.ts` files only.
 */
export async function raceShop(db: AppDb, name = "Race Reef") {
  const suffix = randomBytes(4).toString("hex");
  const [shop] = await db
    .insert(shops)
    .values({ name: `${name} ${suffix}`, slug: `race-${suffix}`, timezone: "UTC" })
    .returning();
  if (!shop) throw new Error("shop insert returned no row");
  return shop;
}

/** The lock a counter (a ticket number, a template version) takes on its shop. */
export const shopCounterLock = (shopId: string): SQL =>
  sql`select id from shops where id = ${shopId} for no key update`;

/**
 * What every insert naming the shop holds until it commits: the foreign-key
 * check's `KEY SHARE`. A shop lock taken `for update` waits behind this; one
 * taken `for no key update` does not (fourth review, row 16).
 */
export const insertInFlight = (shopId: string): SQL =>
  sql`select id from shops where id = ${shopId} for key share`;

/**
 * Settles with the call's result, or with `"parked"` when it is still waiting
 * after `ms`: the shape of a write queued behind a lock it should not need.
 */
export async function withinOrParked<T>(call: Promise<T>, ms = 3_000): Promise<T | "parked"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const parked = new Promise<"parked">((resolve) => {
    timer = setTimeout(() => resolve("parked"), ms);
  });
  try {
    return await Promise.race([call, parked]);
  } finally {
    clearTimeout(timer);
  }
}
