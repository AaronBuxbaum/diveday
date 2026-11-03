import type { AppDb } from "@/db/client";
import { seedFailedRefund } from "./seed-failed-refund";
import { seedPaidAfterClose } from "./seed-paid-after-close";

/**
 * Money the shop owes back, two ways: 2b. a diver paid on a checkout DiveDay
 * had already closed (issue #2335); 2c. a refund Stripe accepted and later
 * reported failed (issue #2291).
 */
export async function seedOwedMoney(db: AppDb, shopId: string, now: Date): Promise<void> {
  await seedPaidAfterClose(db, shopId, now);
  await seedFailedRefund(db, shopId, now);
}
