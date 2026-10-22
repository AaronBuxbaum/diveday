"use server";

import { runAssist } from "@/db/assists";
import { canPersonMergeDiver } from "@/db/authz";
import { readUnsurePair } from "@/db/desk-assists";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { SAME_PERSON_FEATURE, samePersonCall, samePersonRead } from "@/lib/assists/same-person";
import { requireShopSurface } from "@/lib/session";
import { uuidParam } from "@/lib/uuid";

/**
 * **dupes**: Claude's read of a pair the duplicate check matched on the name
 * alone. It is a sentence beside the merge, never the merge: the staffer
 * still decides, and nothing is written. Only the minimised pair goes out
 * (`samePersonCall`); medical and waiver answers are not read at all.
 */
export async function readSamePersonAction(
  shopSlug: string,
  rawSourceId: string,
  rawSurvivorId: string,
): Promise<{ heading: string; lines: string[] } | null> {
  const sourceId = uuidParam(rawSourceId);
  const survivorId = uuidParam(rawSurvivorId);
  if (!sourceId || !survivorId) return null;
  const { db, shop } = await requireShopSurface(shopSlug, {
    allow: canPersonMergeDiver,
    refusal: { notice: "not-authorized-merge", landing: ["divers", sourceId] },
  });
  const pair = await readUnsurePair(db, shop.id, sourceId, survivorId);
  if (!pair) return null;
  const locale = await requestLocale(shop.defaultLocale);
  const value = await runAssist(db, {
    shopId: shop.id,
    feature: SAME_PERSON_FEATURE,
    call: samePersonCall(pair[0], pair[1], locale),
  });
  const read = samePersonRead(value);
  if (!read) return null;
  const t = staffTranslator(locale);
  return { heading: t(`deskAssists.dupes.verdict.${read.verdict}`), lines: read.reasons };
}
