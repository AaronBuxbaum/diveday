/**
 * **A release's drafts, one per door** (issue #4130): what a counter code, a
 * mailed release link or the seat's thread typed before signing. Each door
 * reads and writes only its own row, so two doors typing at once never erase
 * each other. Callers reach a door only through a key `waivers-completion.ts`
 * verified; nothing here checks a capability.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import type { DraftShopAnswers } from "@/lib/waiver-questions";
import type { DbExecutor } from "./client";
import {
  type DraftGuardian,
  type MedicalAnswers,
  type WaiverDraft,
  type WaiverDraftDoor,
  waiverDrafts,
} from "./schema";

/** One door of one release: the thread has no link, every other door is one link. */
export type DraftDoor = {
  readonly shopId: string;
  readonly recordId: string;
  readonly door: WaiverDraftDoor;
  readonly linkId: string | null;
};

function sameDoor(door: DraftDoor) {
  return and(
    eq(waiverDrafts.shopId, door.shopId),
    eq(waiverDrafts.waiverRecordId, door.recordId),
    eq(waiverDrafts.door, door.door),
    door.linkId === null
      ? sql`${waiverDrafts.linkId} is null`
      : eq(waiverDrafts.linkId, door.linkId),
  );
}

/** The draft this door saved, or null when it saved none. Never another door's. */
export async function readWaiverDraft(
  db: DbExecutor,
  door: DraftDoor,
): Promise<WaiverDraft | null> {
  const [draft] = await db.select().from(waiverDrafts).where(sameDoor(door)).limit(1);
  return draft ?? null;
}

/**
 * Writes this door's draft. A field left `undefined` keeps what the door last
 * saved (an empty row starts it null); every other door's draft is untouched.
 */
export async function recordDoorDraft(
  db: DbExecutor,
  door: DraftDoor,
  fields: {
    signerName: string | null;
    acknowledged: boolean;
    medicalAnswers: MedicalAnswers;
    guardian?: DraftGuardian;
    shopAnswers?: DraftShopAnswers | null;
    medicalAlert?: string | null;
    now: Date;
  },
): Promise<void> {
  const set = {
    signerName: fields.signerName,
    acknowledged: fields.acknowledged,
    medicalAnswers: fields.medicalAnswers,
    savedAt: fields.now,
    ...(fields.guardian === undefined ? {} : { guardian: fields.guardian }),
    ...(fields.shopAnswers === undefined ? {} : { shopAnswers: fields.shopAnswers }),
    ...(fields.medicalAlert === undefined ? {} : { medicalAlert: fields.medicalAlert }),
  };
  await db
    .insert(waiverDrafts)
    .values({
      shopId: door.shopId,
      waiverRecordId: door.recordId,
      door: door.door,
      linkId: door.linkId,
      ...set,
    })
    .onConflictDoUpdate({
      target: [waiverDrafts.waiverRecordId, waiverDrafts.door, waiverDrafts.linkId],
      set,
    });
}

/**
 * Deletes every door's draft of these releases: on signing (what was typed is
 * now what was signed), when a pending link moves to another diver (a draft
 * belongs to whoever typed it), and on erasure. A hard delete: a draft is
 * unsubmitted state with no reader once its release is signed or moved.
 */
export async function clearWaiverDrafts(
  db: DbExecutor,
  shopId: string,
  recordIds: readonly string[],
): Promise<void> {
  if (recordIds.length === 0) return;
  await db
    .delete(waiverDrafts)
    .where(
      and(eq(waiverDrafts.shopId, shopId), inArray(waiverDrafts.waiverRecordId, [...recordIds])),
    );
}
