import { and, eq, isNull } from "drizzle-orm";
import type { ServiceWindow } from "@/lib/service-window";
import type { DbExecutor } from "./client";
import { diveSites } from "./schema";

/**
 * **A site closed this month** (loop 5, row 5; glossary "Site closure"). One
 * window per site, typed over the last, or null to open it again. Scoped to
 * the shop and its live sites; returns whether a row changed. Nothing else
 * moves: departures planned there keep their dives, and the board warns.
 */
export async function recordDiveSiteClosure(
  db: DbExecutor,
  input: { shopId: string; siteId: string; window: ServiceWindow | null },
): Promise<boolean> {
  const rows = await db
    .update(diveSites)
    .set({
      closedFrom: input.window?.from ?? null,
      closedUntil: input.window?.until ?? null,
      closureReason: input.window?.reason ?? null,
    })
    .where(
      and(
        eq(diveSites.id, input.siteId),
        eq(diveSites.shopId, input.shopId),
        isNull(diveSites.deletedAt),
      ),
    )
    .returning({ id: diveSites.id });
  return rows.length > 0;
}
