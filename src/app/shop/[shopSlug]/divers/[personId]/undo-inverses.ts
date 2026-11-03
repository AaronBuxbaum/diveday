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
import { restoreDiver } from "@/db/divers";
import { restoreNitroxCertification } from "@/db/nitrox";
import { addDiverNote } from "@/db/operations";
import { restoreCertification, restoreSpecialtyCertification } from "@/db/readiness";
import { cardOwner, isPersonErased } from "@/db/undo-subjects";
import { revalidateAndRedirect } from "@/lib/navigation";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import type { UndoOfferOf } from "@/lib/undo";
import { backTo, requireDiverActionContext } from "./action-helpers";

/**
 * A card archive taken back. Dispatches by the card type stamped into the
 * offer, restoring the exact card that was archived; a re-entered card that
 * now owns the same number blocks the restore rather than being clobbered
 * (readiness.ts). Every card lives in one group, so an undo that could not
 * land says so beside the list it failed to return to.
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
  const input = { shopId, certificationId: offer.undoCard };
  const restored =
    offer.cardType === "level"
      ? await restoreCertification(db, input)
      : offer.cardType === "specialty"
        ? await restoreSpecialtyCertification(db, input)
        : await restoreNitroxCertification(db, input);
  revalidateAndRedirect(
    base,
    backTo(base, restored ? "card-restored" : "card-restore-conflict", "cards"),
  );
}

/** A deleted note taken back, through the same audited insert path a new note takes. */
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
  // An erased diver's note text never comes back, whatever a URL carries.
  if (await isPersonErased(db, staff.user.shopId, personId)) {
    revalidateAndRedirect(base, backTo(base, "invalid", "notes"));
  }
  const restored = await addDiverNote(db, {
    shopId: staff.user.shopId,
    personId,
    actorPersonId: staff.user.personId,
    body: offer.noteBody,
  });
  revalidateAndRedirect(base, backTo(base, restored ? "note-added" : "invalid", "notes"));
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
