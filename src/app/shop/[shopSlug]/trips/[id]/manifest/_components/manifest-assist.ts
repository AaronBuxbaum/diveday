import { assistsAvailable } from "@/db/assists";

/**
 * Whether the manifest offers an AI draft. Kept out of the page because the
 * page binds the crew's medical alert actions, and a module that touches the
 * alert must not reach the assist seam (`scripts/check-assist-prompts.mjs`).
 */
export async function manifestCanAssist(
  db: Parameters<typeof assistsAvailable>[0],
  shopId: string,
  departureCheckpoint: boolean,
): Promise<boolean> {
  return !departureCheckpoint && (await assistsAvailable(db, shopId));
}
