import { and, desc, eq, isNull } from "drizzle-orm";
import type { DbExecutor } from "@/db/client";
import { waiverTemplates } from "@/db/schema";

/**
 * Every live version of a shop's release, newest first. Test support only: the
 * app reads the current version (`getCurrentWaiverTemplate`) and never the
 * history, so the tests that check a save wrote the next version read it here.
 */
export async function waiverTemplateHistory(db: DbExecutor, shopId: string) {
  return db
    .select()
    .from(waiverTemplates)
    .where(and(eq(waiverTemplates.shopId, shopId), isNull(waiverTemplates.deletedAt)))
    .orderBy(desc(waiverTemplates.version));
}
