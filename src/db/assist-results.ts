import { and, eq, inArray, sql } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import type { AppDb } from "./client";
import { assistResults } from "./schema";

/**
 * Reads and writes `assist_results`: what an assist answered, keyed by shop,
 * feature and subject, with the fingerprint of what it was asked.
 */

export type StoredAssist = { value: unknown; inputDigest: string; updatedAt: Date };

export async function readAssistResults(
  db: AppDb,
  shopId: string,
  feature: string,
  subjectKeys: readonly string[],
): Promise<Map<string, StoredAssist>> {
  if (subjectKeys.length === 0) return new Map();
  const rows = await db
    .select({
      subjectKey: assistResults.subjectKey,
      value: assistResults.value,
      inputDigest: assistResults.inputDigest,
      updatedAt: assistResults.updatedAt,
    })
    .from(assistResults)
    .where(
      and(
        eq(assistResults.shopId, shopId),
        eq(assistResults.feature, feature),
        inArray(assistResults.subjectKey, [...subjectKeys]),
      ),
    );
  return new Map(rows.map(({ subjectKey, ...row }) => [subjectKey, row]));
}

export async function readAssistResult(
  db: AppDb,
  shopId: string,
  feature: string,
  subjectKey: string,
): Promise<StoredAssist | null> {
  return (await readAssistResults(db, shopId, feature, [subjectKey])).get(subjectKey) ?? null;
}

export async function saveAssistResult(
  db: AppDb,
  input: {
    shopId: string;
    feature: string;
    subjectKey: string;
    value: unknown;
    inputDigest: string;
  },
): Promise<void> {
  const now = nowDate();
  await db
    .insert(assistResults)
    .values({ ...input, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: [assistResults.shopId, assistResults.feature, assistResults.subjectKey],
      set: {
        value: input.value,
        inputDigest: input.inputDigest,
        updatedAt: sql`excluded.updated_at`,
      },
    });
}
