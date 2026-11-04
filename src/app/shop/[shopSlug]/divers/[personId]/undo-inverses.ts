/**
 * **The diver record's ways back** (issue #2764): the inverse of each removal
 * on this record that offers Undo, as rows of the one undo registry
 * (`src/app/actions/undo-registry.ts`) rather than server actions of their own.
 *
 * Not a `"use server"` module: nothing here is callable from the client. The
 * only door is `undoAction`, which parses the offer (`src/lib/undo.ts`) and
 * hands it here. Each inverse opens with the same preamble and the same live
 * gate as the removal it reverses, and calls the `src/db` restore that holds
 * the real re-checks.
 */
import { canPersonDeleteDiver } from "@/db/authz";
import { type CardRestoreOutcome, restoreCard } from "@/db/card-restore";
import { restoreDiver } from "@/db/divers";
import { restoreDiverNote as restoreDeletedDiverNote } from "@/db/operations";
import { cardOwner, isPersonErased } from "@/db/undo-subjects";
import { revalidateAndRedirect } from "@/lib/navigation";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import type { UndoOfferOf } from "@/lib/undo";
import { backTo, requireDiverActionContext } from "./action-helpers";

/** Where each outcome of a card's Undo lands, beside the card list. */
const CARD_RESTORE_NOTICES = {
  restored: "card-restored",
  conflict: "card-restore-conflict",
  not_found: "card-restore-gone",
  undo_expired: "card-restore-expired",
  system_archived: "card-restore-system",
} as const satisfies Record<CardRestoreOutcome, string>;

/**
 * A card archive taken back (issues #2764, #3701). Restores the exact card
 * that was archived, and only when a staffer deleted it by hand in the last 15
 * minutes: `restoreCard` asks that of the row, refuses a card DiveDay set aside
 * or one deleted too long ago, refuses a re-entered card's number rather than
 * clobbering it, and writes the restore to the activity log under this
 * staffer. Every card lives in one group, so an undo that could not land says
 * so beside the list it failed to return to.
 */
export async function restoreDiverCard(
  shopSlug: string,
  offer: UndoOfferOf<"diver-card">,
): Promise<never> {
  const { base, db, personId, staff } = await requireDiverActionContext(
    shopSlug,
    offer.undoPerson,
    "not-authorized-cards",
  );
  const shopId = staff.user.shopId;
  // The offer is typed by whoever holds the URL: the card must be this
  // record's own, and an erased diver's card stays archived.
  const owned = (await cardOwner(db, shopId, offer.cardType, offer.undoCard)) === personId;
  if (!owned || (await isPersonErased(db, shopId, personId))) {
    revalidateAndRedirect(base, backTo(base, "card-restore-conflict", "cards"));
  }
  const outcome = await restoreCard(db, {
    shopId,
    kind: offer.cardType,
    certificationId: offer.undoCard,
    restoredByPersonId: staff.user.personId,
  });
  revalidateAndRedirect(base, backTo(base, CARD_RESTORE_NOTICES[outcome], "cards"));
}

/**
 * A deleted note taken back by its id (issue #3701): the same row, written by
 * whoever wrote it, and only a deleted note of this record. The offer never
 * carries the note's words, so a URL cannot put text of its author's choosing
 * on a record under this staffer's name.
 */
export async function restoreDiverNote(
  shopSlug: string,
  offer: UndoOfferOf<"diver-note">,
): Promise<never> {
  const { base, db, personId, staff } = await requireDiverActionContext(
    shopSlug,
    offer.undoPerson,
    "not-authorized-notes",
    "notes",
  );
  // An erased diver's note never comes back, whatever a URL carries.
  if (await isPersonErased(db, staff.user.shopId, personId)) {
    revalidateAndRedirect(base, backTo(base, "invalid", "notes"));
  }
  const restored = await restoreDeletedDiverNote(db, {
    shopId: staff.user.shopId,
    personId,
    noteId: offer.undoNote,
    actorPersonId: staff.user.personId,
  });
  revalidateAndRedirect(base, backTo(base, restored ? "note-restored" : "invalid", "notes"));
}

/**
 * A removed diver put back on the active roster — from the roster's toast
 * right after the removal, or from the record's restore card any day after.
 * Same owner/manager gate as the removal it reverses
 * (H-20260724-staff-role-reach, ADR 20260724-role-authorization), re-read from
 * the database.
 *
 * `restoreDiver` refuses rather than clobbers when an active diver has since
 * claimed this one's email (CR-008), and refuses an erased record outright —
 * both land as `restore-refused`, which says what to do about it.
 */
export async function restoreDiverRemoval(
  shopSlug: string,
  offer: UndoOfferOf<"diver-removal">,
): Promise<never> {
  const { base, db, personId, staff } = await requireDiverActionContext(
    shopSlug,
    offer.undoPerson,
    "not-authorized-delete",
    "restore",
  );
  const roster = shopPath(shopSlug, "divers");
  const allowed = await canPersonDeleteDiver(db, staff.user.shopId, staff.user.personId);
  const restored = allowed && (await restoreDiver(db, staff.user.shopId, personId));
  if (offer.undoFrom === "roster") {
    const notice = !allowed ? "not-authorized" : restored ? "restored" : "restore-refused";
    revalidateAndRedirect(roster, noticeUrl(roster, notice));
  }
  if (!allowed) revalidateAndRedirect(base, backTo(base, "not-authorized-delete", "restore"));
  // The two outcomes cannot land in the same place. A refusal leaves the diver
  // removed, so the restore card — and its `#removed-heading` anchor — are both
  // still there to receive it. Success removes both: naming the form would put
  // the confirmation in a card that no longer renders, and the anchor would
  // scroll to a heading that no longer exists. Success goes to the page notice.
  revalidateAndRedirect(
    base,
    restored ? backTo(base, "restored") : backTo(base, "restore-refused", "restore"),
  );
}
