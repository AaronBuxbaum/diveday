import { and, count, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import type { DemoRoleId } from "@/lib/demo-roles";
import type { SourceCount } from "@/lib/founder-metrics";
import type { FunnelSource } from "@/lib/funnel";
import type { SetupRequestInput } from "@/lib/setup-requests";
import type { DbExecutor } from "./client";
import { demoEntries, type SetupRequest, setupRequests } from "./schema";

/**
 * The funnel's two committed conversions, as rows DiveDay owns (ADR
 * 20261007-founder-metrics): somebody entered the live demo, and somebody asked
 * to be set up. Both are also analytics events; these rows are what the
 * founder digest counts, because an event in a vendor's dashboard is a number
 * nobody reads on a Monday.
 */

export type FunnelRange = { startsAt: Date; endsAt: Date };

/** Record one demo entry. Called from `announceDemoEntry`, after the mint succeeded. */
export async function recordDemoEntry(
  db: DbExecutor,
  input: { source: FunnelSource | "unknown"; role: DemoRoleId; at?: Date },
): Promise<void> {
  await db
    .insert(demoEntries)
    .values({ source: input.source, role: input.role, enteredAt: input.at ?? nowDate() });
}

/** Demo entries in `[startsAt, endsAt)`, by source. */
export async function countDemoEntriesBySource(
  db: DbExecutor,
  range: FunnelRange,
): Promise<SourceCount[]> {
  return db
    .select({ source: demoEntries.source, count: count() })
    .from(demoEntries)
    .where(and(gte(demoEntries.enteredAt, range.startsAt), lt(demoEntries.enteredAt, range.endsAt)))
    .groupBy(demoEntries.source);
}

/** Store one set-up request, exactly as the form validated it. */
export async function recordSetupRequest(
  db: DbExecutor,
  input: SetupRequestInput & { source: FunnelSource | "unknown"; locale: string; at?: Date },
): Promise<SetupRequest> {
  const [row] = await db
    .insert(setupRequests)
    .values({
      shopName: input.shopName,
      region: input.region,
      runsBoat: input.runsBoat,
      currentSystem: input.currentSystem,
      contactName: input.contactName,
      email: input.email,
      phone: input.phone,
      source: input.source,
      locale: input.locale,
      createdAt: input.at ?? nowDate(),
    })
    .returning();
  if (!row) throw new Error("recordSetupRequest: insert returned no row");
  return row;
}

/**
 * Set-up requests stored at or after `since`. The global cap's count
 * (`SETUP_REQUESTS_PER_HOUR`), read on `setup_requests_created_idx`.
 */
export async function countSetupRequestsSince(db: DbExecutor, since: Date): Promise<number> {
  const [row] = await db
    .select({ count: count() })
    .from(setupRequests)
    .where(gte(setupRequests.createdAt, since));
  return row?.count ?? 0;
}

/** The onboarding mail for this request left. */
export async function markSetupRequestNotified(
  db: DbExecutor,
  id: string,
  at: Date = nowDate(),
): Promise<void> {
  await db.update(setupRequests).set({ notifiedAt: at }).where(eq(setupRequests.id, id));
}

/** Set-up requests in `[startsAt, endsAt)`, by source. */
export async function countSetupRequestsBySource(
  db: DbExecutor,
  range: FunnelRange,
): Promise<SourceCount[]> {
  return db
    .select({ source: setupRequests.source, count: count() })
    .from(setupRequests)
    .where(
      and(gte(setupRequests.createdAt, range.startsAt), lt(setupRequests.createdAt, range.endsAt)),
    )
    .groupBy(setupRequests.source);
}

/**
 * Set-up requests in the range whose onboarding mail never left. The digest
 * names the number so a lead the mail lost is found on Monday, not never.
 */
export async function countUnnotifiedSetupRequests(
  db: DbExecutor,
  range: FunnelRange,
): Promise<number> {
  const [row] = await db
    .select({ count: count() })
    .from(setupRequests)
    .where(
      and(
        gte(setupRequests.createdAt, range.startsAt),
        lt(setupRequests.createdAt, range.endsAt),
        isNull(setupRequests.notifiedAt),
      ),
    );
  return row?.count ?? 0;
}

/**
 * **Erase every set-up request a person sent**, by the address they gave
 * (ADR 20261007-setup-request-form). The table belongs to no shop, so no
 * shop's erasure reaches it: this is the one way its rows leave, run when
 * someone asks DiveDay to forget them. Matched case-insensitively, because the
 * form stores the address lowered and a request to forget may not be. Returns
 * how many rows went, so the reply to the person can say so.
 */
export async function deleteSetupRequestsByEmail(db: DbExecutor, email: string): Promise<number> {
  const address = email.trim().toLowerCase();
  if (!address) return 0;
  const gone = await db
    .delete(setupRequests)
    .where(eq(sql`lower(${setupRequests.email})`, address))
    .returning({ id: setupRequests.id });
  return gone.length;
}

/**
 * The same erasure by phone number, for a person who gave one and asks by it.
 * The form stores the number as typed, so both sides are compared with only
 * their digits (and a leading `+`) kept: "+1 (305) 555-0100" and
 * "+13055550100" are one number.
 */
export async function deleteSetupRequestsByPhone(db: DbExecutor, phone: string): Promise<number> {
  const digits = normalizePhone(phone);
  if (digits.replace("+", "").length === 0) return 0;
  const gone = await db
    .delete(setupRequests)
    .where(eq(sql`regexp_replace(${setupRequests.phone}, '[^0-9+]', '', 'g')`, digits))
    .returning({ id: setupRequests.id });
  return gone.length;
}

function normalizePhone(phone: string): string {
  return phone.replace(/[^0-9+]/g, "");
}
