import { it } from "vitest";
import { checkBoardingReconciliation } from "@/test/boarding-reconciliation-cases";
import { unseededTestDb } from "@/test/db";

it("inventories only a shop's stored keys without granting cutover or changing evidence", async () => {
  await checkBoardingReconciliation(await unseededTestDb());
});
