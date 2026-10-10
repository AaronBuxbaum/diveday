"use server";
import { anonymizeDiver } from "@/db/anonymize";
import { canPersonDeleteDiver, canPersonErasePersonalData, canPersonMergeDiver } from "@/db/authz";
import { DIVER_MERGE_FIELDS, type DiverMergeChoices, mergeDiverRecords } from "@/db/diver-merge";
import { deleteDiver, getDiverProfile, restoreDiver } from "@/db/divers";
import { eraseGuardianEmail } from "@/db/guardian-erasure";
import { revalidateAndRedirect } from "@/lib/navigation";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
import { backTo, requireDiverActionContext } from "./action-helpers";

/**
 * Merge the route's diver into the record posted as `survivorId`, from the
 * side-by-side preview (`merge/[survivorId]`). Every posted value is untrusted:
 * the survivor id is parsed as a uuid, each field choice is read only as
 * `"source"` (anything else keeps the kept record's value), and the domain
 * transaction checks the shop, both records' state, the diver role, a shared
 * departure, the different-people acknowledgement and live owner/manager
 * authorization again before moving anything. A refusal lands back on the
 * preview beside the button, so the staffer reads it where they decided.
 */
export async function mergeDiverAction(shopSlug: string, personId: string, formData: FormData) {
  const context = await requireDiverActionContext(
    shopSlug,
    personId,
    "not-authorized-merge",
    "merge",
  );
  personId = context.personId;
  const { base, db, staff } = context;
  if (!(await canPersonMergeDiver(db, staff.user.shopId, staff.user.personId))) {
    revalidateAndRedirect(base, backTo(base, "not-authorized-merge"));
    return;
  }
  const survivorId = uuidParam(String(formData.get("survivorId") ?? ""));
  if (!survivorId || survivorId === personId) {
    revalidateAndRedirect(base, backTo(base, "merge-invalid", "merge"));
    return;
  }
  const choices: DiverMergeChoices = {};
  for (const field of DIVER_MERGE_FIELDS) {
    if (formData.get(`keep_${field}`) === "source") choices[field] = "source";
  }

  const result = await mergeDiverRecords({
    db,
    shopId: staff.user.shopId,
    personId,
    survivorId,
    actorPersonId: staff.user.personId,
    choices,
    // The checkbox posts the acknowledgement the staffer read, and only when ticked.
    acknowledged: String(formData.get("acknowledgement") ?? "") || undefined,
  });
  if (!result.ok) {
    if (result.reason === "not_authorized") {
      revalidateAndRedirect(base, backTo(base, "not-authorized-merge"));
      return;
    }
    // A staff record has no preview to return to (the page answers it 404).
    if (result.reason === "not_found" || result.reason === "staff_record") {
      revalidateAndRedirect(base, backTo(base, "merge-invalid", "merge"));
      return;
    }
    const preview = shopPath(staff.user.shopSlug, "divers", personId, "merge", survivorId);
    revalidateAndRedirect(preview, noticeUrl(preview, `merge-${result.reason}`, { form: "merge" }));
    return;
  }

  const survivorBase = shopPath(staff.user.shopSlug, "divers", result.survivorId);
  revalidateAndRedirect(survivorBase, noticeUrl(survivorBase, "merged"));
}

export async function deletePersonAction(shopSlug: string, personId: string, _formData: FormData) {
  const context = await requireDiverActionContext(
    shopSlug,
    personId,
    "not-authorized-delete",
    "remove",
  );
  personId = context.personId;
  const { base, db, staff } = context;
  // Soft-deleting a person frees their email and pulls them from shop work —
  // owner/manager only (H-14, ADR 20260724-role-authorization).
  if (!(await canPersonDeleteDiver(db, staff.user.shopId, staff.user.personId))) {
    revalidateAndRedirect(base, backTo(base, "not-authorized-delete", "remove"));
    return;
  }
  const deleted = await deleteDiver(db, staff.user.shopId, personId);
  const roster = shopPath(staff.user.shopSlug, "divers");
  revalidateAndRedirect(
    roster,
    // No hand-rolled `encodeURIComponent` any more — `noticeUrl` escapes every
    // value it merges.
    deleted ? noticeUrl(roster, "deleted", { deleted: personId }) : base,
  );
}

/**
 * Put a removed diver back on the active roster, from their own record.
 *
 * The roster has its own copy of this bound to the undo toast; this is the one
 * that still works tomorrow, once the toast is long gone and the only way back
 * is the `?filter=removed` view and the record it links to. Same owner/manager
 * gate as the removal it reverses (H-14, ADR 20260724-role-authorization),
 * re-read from the database like every other mutation on this page.
 *
 * `restoreDiver` refuses rather than clobbers when an active diver has since
 * claimed this one's email (CR-008), and refuses an erased record outright —
 * both land here as `restore-refused`, which says what to do about it.
 */
export async function restorePersonAction(shopSlug: string, personId: string, _formData: FormData) {
  const context = await requireDiverActionContext(
    shopSlug,
    personId,
    "not-authorized-delete",
    "restore",
  );
  personId = context.personId;
  const { base, db, staff } = context;
  if (!(await canPersonDeleteDiver(db, staff.user.shopId, staff.user.personId))) {
    revalidateAndRedirect(base, backTo(base, "not-authorized-delete", "restore"));
    return;
  }
  const restored = await restoreDiver(db, staff.user.shopId, personId);
  // The two outcomes cannot land in the same place. A refusal leaves the diver
  // removed, so the restore card — and its `#removed-heading` anchor — are both
  // still there to receive it. Success removes both: naming the form would put
  // the confirmation in a card that no longer renders, and the anchor would
  // scroll to a heading that no longer exists. Success goes to the page notice.
  if (restored) {
    revalidateAndRedirect(base, backTo(base, "restored"));
    return;
  }
  revalidateAndRedirect(base, backTo(base, "restore-refused", "restore"));
}

/**
 * Erase a diver's personal and medical data (ADR 20260802-diver-data-erasure).
 *
 * Unlike removal, this cannot be undone and there is no notice offering to undo
 * it. Four things stand between a mis-click and an irreversible write: the gate
 * is owner-only and re-read from the database, `anonymizeDiver` re-checks it
 * again for itself, the diver must already be **deleted**, and the staffer must
 * type the diver's name to confirm — the confirmation is verified here against
 * the stored record, not trusted from a hidden field the form could have
 * carried unchanged.
 */
export async function erasePersonAction(shopSlug: string, personId: string, formData: FormData) {
  const context = await requireDiverActionContext(
    shopSlug,
    personId,
    "not-authorized-erase",
    "erase",
  );
  personId = context.personId;
  const { base, db, staff } = context;
  if (!(await canPersonErasePersonalData(db, staff.user.shopId, staff.user.personId))) {
    revalidateAndRedirect(base, backTo(base, "not-authorized-erase", "erase"));
    return;
  }
  // `includeRemoved`: a diver already off the active roster is exactly who an
  // erasure request tends to name, and without this the name check reads null
  // and reports a mismatch against a record that is right there on screen.
  const profile = await getDiverProfile(db, staff.user.shopId, personId, { includeRemoved: true });
  // **An erasure runs on a deleted record only**, which is the same rule the
  // page renders by. Deleting first is reversible, it is the state an erasure
  // request describes anyway, and it makes the one-way write a second decision
  // rather than a scroll to the bottom of a record somebody opened for another
  // reason. Enforced here and not only in the page, because a tab left open on
  // a record that was deleted and then restored would otherwise post an erase
  // at a diver who is back on the roster.
  //
  // The refusal carries no `?form=`: on a live record the erase section is not
  // rendered at all, so an outcome filed under `erase` would land in a section
  // that does not exist. It reads in the page banner, above the Delete control
  // it is asking the staffer to use.
  //
  // A record that reads back as nothing at all falls through to the name check
  // below, which is the honest answer for it: there is no name to match.
  if (profile && !profile.person.deletedAt) {
    revalidateAndRedirect(base, backTo(base, "erase-requires-delete"));
    return;
  }
  const typed = String(formData.get("confirmName") ?? "").trim();
  if (!profile || typed.toLowerCase() !== profile.person.fullName.trim().toLowerCase()) {
    revalidateAndRedirect(base, backTo(base, "erase-name-mismatch", "erase"));
    return;
  }
  const result = await anonymizeDiver(db, {
    shopId: staff.user.shopId,
    personId,
    actorPersonId: staff.user.personId,
  });
  // "Erased" and "erased, but Stripe still owes something" are different facts,
  // and a compliance action must not report the weaker one as the stronger
  // (ADR 20260803-processor-erasure-obligations). The outstanding work is on the
  // reports page; this notice is what sends someone to look.
  const erasedNotice =
    result.ok && result.owedProcessorErasures > 0 ? "erased-processor-owed" : "erased";
  const roster = shopPath(staff.user.shopSlug, "divers");
  revalidateAndRedirect(
    roster,
    result.ok ? noticeUrl(roster, erasedNotice) : backTo(base, "erase-refused", "erase"),
  );
}

/**
 * **Erase a co-signing guardian's email address, and nothing else** (H-103,
 * issue #1673).
 *
 * The same owner-only gate as the diver's erasure, re-read here and again
 * inside `eraseGuardianEmail`, because a server action is reachable without the
 * page that draws its form. The staffer types the address to confirm, and it
 * is compared with the one the form named — never trusted alone — while the
 * domain call refuses any address that is not on this diver's releases in this
 * shop. Unlike the diver's erasure it runs on a live record: the minor stays a
 * diver, and only the parent's address goes.
 */
export async function eraseGuardianEmailAction(
  shopSlug: string,
  personId: string,
  formData: FormData,
) {
  const context = await requireDiverActionContext(
    shopSlug,
    personId,
    "not-authorized-guardian-email",
    "guardian-email",
  );
  personId = context.personId;
  const { base, db, staff } = context;
  if (!(await canPersonErasePersonalData(db, staff.user.shopId, staff.user.personId))) {
    revalidateAndRedirect(base, backTo(base, "not-authorized-guardian-email", "guardian-email"));
    return;
  }
  const email = String(formData.get("email") ?? "").trim();
  const typed = String(formData.get("confirmEmail") ?? "").trim();
  if (!email || typed.toLowerCase() !== email.toLowerCase()) {
    revalidateAndRedirect(base, backTo(base, "guardian-email-mismatch", "guardian-email"));
    return;
  }
  const result = await eraseGuardianEmail(db, {
    shopId: staff.user.shopId,
    personId,
    email,
    actorPersonId: staff.user.personId,
  });
  const notice = result.ok
    ? "guardian-email-erased"
    : result.reason === "not_authorized"
      ? "not-authorized-guardian-email"
      : "guardian-email-not-found";
  revalidateAndRedirect(base, backTo(base, notice, "guardian-email"));
}
