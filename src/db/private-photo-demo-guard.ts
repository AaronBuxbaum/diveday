import { and, eq } from "drizzle-orm";
import { lockBoardingCertificationEvidence } from "./boarding-certification-snapshot";
import type { DbExecutor } from "./client";
import { privatePersonPhotoUploads } from "./schema";

export const DEMO_PRIVATE_PHOTO_CLEANUP_REQUIRED = "demo_private_photo_cleanup_required";

/** Called inside the enclosing reset/reap transaction, before it deletes anything. */
export async function clearCompletedDemoPhotoObligations(tx: DbExecutor, shopId: string) {
  // Same fence as photo staging, publication, merge and erasure. The caller's
  // transaction must retain it through all destructive work.
  await lockBoardingCertificationEvidence(tx, shopId, "rewrite");
  const rows = await tx
    .select()
    .from(privatePersonPhotoUploads)
    .where(eq(privatePersonPhotoUploads.shopId, shopId));
  if (rows.some((row) => row.state !== "retired" || !row.putFinished || !row.cleanAfterPut)) {
    // Keep the shop, its people and all cleanup obligations intact. A staffer
    // removes active photos; uncertain uploads require provider reconciliation.
    throw new Error(DEMO_PRIVATE_PHOTO_CLEANUP_REQUIRED);
  }
  await tx
    .delete(privatePersonPhotoUploads)
    .where(
      and(
        eq(privatePersonPhotoUploads.shopId, shopId),
        eq(privatePersonPhotoUploads.state, "retired"),
        eq(privatePersonPhotoUploads.putFinished, true),
        eq(privatePersonPhotoUploads.cleanAfterPut, true),
      ),
    );
}
