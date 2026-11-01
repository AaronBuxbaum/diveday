"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { recordJuniorCardStatus } from "@/db/certification-junior";
import type { AppDb } from "@/db/client";
import {
  clearDrysuitExperienceSeen,
  type RecordDrysuitExperienceOutcome,
  recordDrysuitExperienceSeen,
} from "@/db/drysuit-experience";
import {
  createNitroxCertification,
  deleteNitroxCertification,
  restoreNitroxCertification,
  reviewNitroxCertification,
  unreviewNitroxCertification,
} from "@/db/nitrox";
import { getShopPersonName } from "@/db/people";
import {
  type CardSighting,
  type CertificationReviewRefusal,
  createCertification,
  createSpecialtyCertification,
  deleteCertification,
  deleteSpecialtyCertification,
  type LevelCardSighting,
  restoreCertification,
  restoreSpecialtyCertification,
  reviewCertification,
  reviewSpecialtyCertification,
  unreviewCertification,
  unreviewSpecialtyCertification,
} from "@/db/readiness";
import { certificationAgency, certificationLevel, diveSpecialty } from "@/db/schema";
import { clearNoCertificationDeclaration } from "@/db/self-declared-cards";
import { isPlausibleCardNumber } from "@/lib/card-number";
import { formValue, readForm } from "@/lib/form-parse";
import { revalidateAndRedirect } from "@/lib/navigation";
import { unreviewedCardState } from "@/lib/readiness";
import { noticeUrl } from "@/lib/staff-notices";
import { backTo, requireDiverActionContext, successUrl } from "./action-helpers";
import { cardForm, cardIdFromForm } from "./card-form";

// Keep form values aligned with the database enum.
const agencySchema = z.enum(certificationAgency.enumValues);
// Sighting levels must use the same closed set as stored cards.
const levelSchema = z.enum(certificationLevel.enumValues);
/**
 * Specialty cards exclude nitrox, which has its own table and gas gate.
 */
const specialtyOnlySchema = z.enum(diveSpecialty.enumValues);
// Capture and sighting share one plausibility bound because both can reach verified.
const cardNumberSchema = z.string().trim().max(120).refine(isPlausibleCardNumber);
/**
 * A staff-entered card sighting required before a diver's self-declared card
 * can become verified.
 */
const sightingSchema = z.object({
  agency: agencySchema,
  identifier: cardNumberSchema,
});
/**
 * A **level** card's sighting names the rung too. The diver's claim is what the
 * select is prefilled with, so the common submit carries it back unchanged —
 * but it arrives as a posted field that is validated against the closed ladder
 * like any other, never trusted from the row it is about to overwrite.
 */
const levelSightingSchema = sightingSchema.extend({ level: levelSchema });

/**
 * Distinguish an implausible staff-entered number from a missing sighting so
 * the form can name the field. Malformed posted agency or level stays generic;
 * those are closed enums, not free-entry fields.
 */
function sightedNumberRefused(formData: FormData): boolean {
  const fields = readForm(cardForm, formData);
  return (
    formData.has("sightedIdentifier") &&
    !cardNumberSchema.safeParse(fields.sightedIdentifier).success
  );
}

async function liveStaffName(db: AppDb, shopId: string, personId: string) {
  return (await getShopPersonName(db, shopId, personId)) ?? "staff";
}

export async function addCardAction(shopSlug: string, personId: string, formData: FormData) {
  const fields = readForm(cardForm, formData);
  const context = await requireDiverActionContext(shopSlug, personId, "not-authorized-cards");
  personId = context.personId;
  const { base, db, staff } = context;
  const card = fields.card;
  const identifier = cardNumberSchema.safeParse(fields.identifier);
  const agency = agencySchema.safeParse(fields.agency);
  if (!identifier.success || !agency.success) redirect(backTo(base, "invalid", "cards"));
  const common = {
    shopId: staff.user.shopId,
    personId,
    agency: agency.data,
    identifier: identifier.data,
  };
  // No card photo, anywhere in the model: a shop verifies a card by looking its
  // number up with the issuing agency, which is what "Mark certified" attests
  // to (ADR 20260804-card-evidence-is-the-number).
  let saved: unknown;
  if (card === "nitrox") {
    saved = await createNitroxCertification(db, common);
  } else if (card.startsWith("level:")) {
    const level = levelSchema.safeParse(card.slice("level:".length));
    if (!level.success) redirect(backTo(base, "invalid", "cards"));
    saved = await createCertification(db, { ...common, level: level.data });
  } else if (card.startsWith("specialty:")) {
    const specialty = specialtyOnlySchema.safeParse(card.slice("specialty:".length));
    if (!specialty.success) redirect(backTo(base, "invalid", "cards"));
    saved = await createSpecialtyCertification(db, { ...common, specialty: specialty.data });
  } else {
    redirect(backTo(base, "invalid", "cards"));
  }
  revalidateAndRedirect(base, backTo(base, saved ? "captured" : "invalid", "cards"));
}

/** Record what this staff member saw on the card, not an agency-lookup inference. */
export async function recordJuniorStatusAction(
  shopSlug: string,
  personId: string,
  formData: FormData,
) {
  const context = await requireDiverActionContext(shopSlug, personId, "not-authorized-cards");
  const cardId = z.uuid().safeParse(formData.get("certificationId"));
  const status = z.enum(["junior", "full"]).safeParse(formData.get("juniorStatus"));
  if (!cardId.success || !status.success) redirect(backTo(context.base, "invalid", "cards"));
  const result = await recordJuniorCardStatus(context.db, {
    shopId: context.staff.user.shopId,
    personId: context.personId,
    certificationId: cardId.data,
    byPersonId: context.staff.user.personId,
    juniorStatus: status.data,
  });
  revalidateAndRedirect(
    context.base,
    backTo(context.base, result.ok ? "captured" : "invalid", "cards"),
  );
}

/**
 * A self-declared card needs staff-entered agency and number, plus level for a
 * level card, before it can become verified.
 */
export async function reviewAction(shopSlug: string, personId: string, formData: FormData) {
  const context = await requireDiverActionContext(shopSlug, personId, "not-authorized-cards");
  personId = context.personId;
  const { base, db, staff } = context;
  // Give an implausible entered number a field-specific refusal before the
  // generic missing-sighting response; attach it to this card's form.
  if (sightedNumberRefused(formData)) {
    redirect(backTo(base, "card-number-implausible", "cards", cardIdFromForm(formData)));
  }
  const certificationId = cardIdFromForm(formData);
  // Only the sighting form posts these fields; absence is not a sighting.
  const sighting = levelSightingFromForm(formData);
  const outcome = certificationId
    ? await reviewCertification(db, {
        shopId: staff.user.shopId,
        certificationId,
        status: "verified",
        sighting,
        reviewedByPersonId: staff.user.personId,
      })
    : ({ ok: false, reason: "not_found" } as const);
  revalidateAndRedirect(
    base,
    await successUrl(context, reviewNotice(outcome), "cards", outcome.ok),
  );
}

/**
 * Parse the staff-entered agency and number. Missing or malformed values do
 * not form a sighting; the caller handles malformed numbers separately.
 */
function sightingFromForm(formData: FormData): CardSighting | undefined {
  const fields = readForm(cardForm, formData);
  if (!formData.has("sightedIdentifier")) return undefined;
  const parsed = sightingSchema.safeParse({
    agency: fields.sightedAgency,
    identifier: fields.sightedIdentifier,
  });
  return parsed.success ? parsed.data : undefined;
}

/**
 * Parse the staff-entered level with the card sighting. A missing or malformed
 * level fails closed instead of falling back to the diver's claim.
 */
function levelSightingFromForm(formData: FormData): LevelCardSighting | undefined {
  const fields = readForm(cardForm, formData);
  if (!formData.has("sightedIdentifier")) return undefined;
  const parsed = levelSightingSchema.safeParse({
    agency: fields.sightedAgency,
    identifier: fields.sightedIdentifier,
    level: fields.sightedLevel,
  });
  return parsed.success ? parsed.data : undefined;
}

function reviewNotice(
  outcome: { ok: true } | { ok: false; reason: CertificationReviewRefusal },
): string {
  if (outcome.ok) return "verified";
  if (outcome.reason === "card_sighting_required") return "card-sighting-required";
  if (outcome.reason === "duplicate_card") return "duplicate-card";
  return "invalid";
}

export async function reviewSpecialtyAction(
  shopSlug: string,
  personId: string,
  formData: FormData,
) {
  const fields = readForm(cardForm, formData);
  const context = await requireDiverActionContext(shopSlug, personId, "not-authorized-cards");
  personId = context.personId;
  const { base, db, staff } = context;
  // Give an implausible nitrox number a field-specific refusal; verification
  // opens the gas-fill gate.
  if (sightedNumberRefused(formData)) {
    redirect(backTo(base, "card-number-implausible", "cards", cardIdFromForm(formData)));
  }
  const certificationId = cardIdFromForm(formData);
  // Self-declared nitrox requires a physical-card sighting; specialty
  // verification controls depth, while nitrox verification controls gas fill.
  const outcome = certificationId
    ? fields.cardType === "nitrox"
      ? await reviewNitroxCertification(db, {
          shopId: staff.user.shopId,
          certificationId,
          status: "verified",
          sighting: sightingFromForm(formData),
          reviewedByPersonId: staff.user.personId,
        })
      : await reviewSpecialtyCertification(db, {
          shopId: staff.user.shopId,
          certificationId,
          status: "verified",
          // Self-declared specialty cards require a sighting; verification
          // controls the specialty depth gate.
          sighting: sightingFromForm(formData),
          reviewedByPersonId: staff.user.personId,
        })
    : ({ ok: false, reason: "not_found" } as const);
  revalidateAndRedirect(
    base,
    await successUrl(context, reviewNotice(outcome), "cards", outcome.ok),
  );
}

/**
 * Clears only the assertion that no certification was declared; it never edits
 * card rows or verifies a card. A staff session is required, and the staff
 * actor is recorded durably on the person row.
 */
export async function clearNoCertificationAction(
  shopSlug: string,
  personId: string,
  _formData: FormData,
) {
  const context = await requireDiverActionContext(shopSlug, personId, "not-authorized-cards");
  personId = context.personId;
  const { base, db, staff } = context;
  const cleared = await clearNoCertificationDeclaration(db, {
    shopId: staff.user.shopId,
    personId,
    byPersonId: staff.user.personId,
  });
  // The panel disappears after a clear, so report the outcome at page level.
  // A replay is a distinct no-op, not an error or a new recorded act.
  revalidateAndRedirect(
    base,
    backTo(base, cleared ? "no-certification-cleared" : "no-certification-nothing-to-clear"),
  );
}

/**
 * A staffer recording that they have seen this diver dive dry (issue #2136).
 * Clears the roster's drysuit-card advisory and nothing else; it is not a card.
 * Staff-only: this record's actions are the only writer, and the writer itself
 * re-checks roles, the note and the diver (domain review A4, security X2).
 */
const drysuitExperienceForm = z.object({ note: formValue() });

export async function recordDrysuitExperienceAction(
  shopSlug: string,
  personId: string,
  formData: FormData,
) {
  const context = await requireDiverActionContext(shopSlug, personId, "not-authorized-cards");
  personId = context.personId;
  const { base, db, staff } = context;
  const { note } = readForm(drysuitExperienceForm, formData);
  const outcome = await recordDrysuitExperienceSeen(db, {
    shopId: staff.user.shopId,
    personId,
    byPersonId: staff.user.personId,
    note: typeof note === "string" ? note : "",
  });
  revalidateAndRedirect(base, backTo(base, drysuitRecordNotice(outcome)));
}

function drysuitRecordNotice(outcome: RecordDrysuitExperienceOutcome) {
  if (outcome.ok) return "drysuit-experience-recorded";
  switch (outcome.reason) {
    case "already_recorded":
      return "drysuit-experience-unchanged";
    case "not_authorized":
      return "drysuit-experience-not-authorized";
    case "note_required":
      return "drysuit-experience-note-required";
    case "not_found":
    case "self":
    case "not_recordable":
      return "drysuit-experience-not-recordable";
  }
}

/**
 * Take a "seen diving dry" back; the advisory returns to the roster. The
 * recorder's, or an owner's or manager's (security review X3).
 */
export async function clearDrysuitExperienceAction(
  shopSlug: string,
  personId: string,
  _formData: FormData,
) {
  const context = await requireDiverActionContext(shopSlug, personId, "not-authorized-cards");
  personId = context.personId;
  const { base, db, staff } = context;
  const outcome = await clearDrysuitExperienceSeen(db, {
    shopId: staff.user.shopId,
    personId,
    byPersonId: staff.user.personId,
  });
  const notice = outcome.ok
    ? "drysuit-experience-cleared"
    : outcome.reason === "not_authorized"
      ? "drysuit-experience-not-authorized"
      : "drysuit-experience-unchanged";
  revalidateAndRedirect(base, backTo(base, notice));
}

/**
 * Delete a level card. It is a soft-archive: the card leaves the diver's list
 * and stops counting toward readiness, but the row is kept for safety history
 * (ADR 20260719-crud-archive-semantics). Replaces the old "needs correction" flow.
 */
export async function deleteCertificationAction(
  shopSlug: string,
  personId: string,
  formData: FormData,
) {
  const context = await requireDiverActionContext(shopSlug, personId, "not-authorized-cards");
  personId = context.personId;
  const { base, db, staff } = context;
  const certificationId = cardIdFromForm(formData);
  const deleted = certificationId
    ? await deleteCertification(db, {
        shopId: staff.user.shopId,
        certificationId,
        deletedByPersonId: staff.user.personId,
      })
    : false;
  const removedBy = deleted
    ? await liveStaffName(db, staff.user.shopId, staff.user.personId)
    : null;
  // Land-then-undo: the delete happens now, and the toast on the next render
  // carries the id + type so a single tap restores it (no confirm dialog).
  revalidateAndRedirect(
    base,
    deleted
      ? noticeUrl(base, "card-deleted", {
          undo: certificationId,
          cardType: "level",
          by: removedBy ?? undefined,
        })
      : backTo(base, "invalid", "cards"),
  );
}

/** Delete a specialty or nitrox card (soft-archive; dispatched by the hidden `cardType`). */
export async function deleteSpecialtyAction(
  shopSlug: string,
  personId: string,
  formData: FormData,
) {
  const fields = readForm(cardForm, formData);
  const context = await requireDiverActionContext(shopSlug, personId, "not-authorized-cards");
  personId = context.personId;
  const { base, db, staff } = context;
  const certificationId = cardIdFromForm(formData);
  const cardType = fields.cardType === "nitrox" ? "nitrox" : "specialty";
  const deleted = certificationId
    ? cardType === "nitrox"
      ? await deleteNitroxCertification(db, {
          shopId: staff.user.shopId,
          certificationId,
          deletedByPersonId: staff.user.personId,
        })
      : await deleteSpecialtyCertification(db, {
          shopId: staff.user.shopId,
          certificationId,
          deletedByPersonId: staff.user.personId,
        })
    : false;
  const removedBy = deleted
    ? await liveStaffName(db, staff.user.shopId, staff.user.personId)
    : null;
  revalidateAndRedirect(
    base,
    deleted
      ? noticeUrl(base, "card-deleted", {
          undo: certificationId,
          cardType,
          by: removedBy ?? undefined,
        })
      : backTo(base, "invalid", "cards"),
  );
}

const cardTypeSchema = z.enum(["level", "specialty", "nitrox"]);
type CardType = z.infer<typeof cardTypeSchema>;

/**
 * Undo a card archive from the land-then-undo toast. Dispatches by the card
 * type stamped into the toast, restoring the exact card that was archived; a
 * re-entered card that now owns the same number blocks the restore rather than
 * being clobbered (readiness.ts).
 */
export async function restoreCardAction(shopSlug: string, personId: string, formData: FormData) {
  const fields = readForm(cardForm, formData);
  const context = await requireDiverActionContext(shopSlug, personId, "not-authorized-cards");
  personId = context.personId;
  const { base, db, staff } = context;
  const certificationId = cardIdFromForm(formData);
  const cardType = cardTypeSchema.safeParse(fields.cardType);
  if (!certificationId || !cardType.success) redirect(base);
  const input = { shopId: staff.user.shopId, certificationId };
  const restored =
    cardType.data === "level"
      ? await restoreCertification(db, input)
      : cardType.data === "specialty"
        ? await restoreSpecialtyCertification(db, input)
        : await restoreNitroxCertification(db, input);
  // Every card now lives in one group, so an undo that could not land says so
  // beside the list it failed to return to — whichever table it came from.
  revalidateAndRedirect(
    base,
    backTo(base, restored ? "card-restored" : "card-restore-conflict", "cards"),
  );
}

/**
 * What the one-tap review did, for the control that posted it. A **value**,
 * not a redirect: see {@link markCertifiedAction}.
 */
export type MarkCertifiedResult =
  | null
  | {
      ok: true;
      /**
       * `certified` promoted a pending card; `confirmed` cleared an imported
       * card's gate; `undone` is the toast's own Undo landing.
       */
      effect: "certified" | "confirmed" | "undone";
      /**
       * The card to hand back to Undo — absent when this review cannot be
       * taken back (see `unreviewedCardState`), so a toast is never offered
       * with an Undo the server would refuse.
       */
      undo?: {
        certificationId: string;
        cardType: CardType;
        /** The review this Undo reverses, as the ISO instant (issue #2612): a later review makes it stale. */
        reviewedAt: string;
      };
    }
  | { ok: false; reason: "invalid" | "sighting-required" | "duplicate-card" | "not-undoable" };

/**
 * Row-local certification action. Returns state for its own toast and offers
 * Undo only when the server says the review is reversible. Undo is conditional
 * on the review timestamp; sightings are not undone and are refused server-side
 * here even if a caller posts the action directly.
 */
export async function markCertifiedAction(
  shopSlug: string,
  personId: string,
  _previous: MarkCertifiedResult,
  formData: FormData,
): Promise<MarkCertifiedResult> {
  const fields = readForm(cardForm, formData);
  const context = await requireDiverActionContext(shopSlug, personId, "not-authorized-cards");
  personId = context.personId;
  const { base, db, staff } = context;
  const certificationId = cardIdFromForm(formData);
  const cardType = cardTypeSchema.safeParse(fields.cardType);
  if (!certificationId || !cardType.success) return { ok: false, reason: "invalid" };
  const input = { shopId: staff.user.shopId, certificationId };

  if (fields.intent === "undo") {
    // Undo applies only to the review timestamp it was offered for.
    const offered = typeof fields.reviewedAt === "string" ? new Date(fields.reviewedAt) : null;
    if (!offered || Number.isNaN(offered.getTime())) {
      return { ok: false, reason: "not-undoable" };
    }
    const undoInput = { ...input, reviewedAt: offered };
    const undone =
      cardType.data === "level"
        ? await unreviewCertification(db, undoInput)
        : cardType.data === "specialty"
          ? await unreviewSpecialtyCertification(db, undoInput)
          : await unreviewNitroxCertification(db, undoInput);
    revalidatePath(base);
    return undone.ok ? { ok: true, effect: "undone" } : { ok: false, reason: "not-undoable" };
  }

  // No `sighting` on any branch: this action is the one-tap path only. A row
  // that needs a card in the staffer's hand is refused below with the same
  // `card_sighting_required` its own form would have raised.
  const reviewed = {
    ...input,
    status: "verified",
    reviewedByPersonId: staff.user.personId,
  } as const;
  const outcome =
    cardType.data === "level"
      ? await reviewCertification(db, reviewed)
      : cardType.data === "specialty"
        ? await reviewSpecialtyCertification(db, reviewed)
        : await reviewNitroxCertification(db, reviewed);
  revalidatePath(base);
  if (!outcome.ok) {
    return {
      ok: false,
      reason:
        outcome.reason === "card_sighting_required"
          ? "sighting-required"
          : outcome.reason === "duplicate_card"
            ? "duplicate-card"
            : "invalid",
    };
  }
  const card = outcome.certification;
  return {
    ok: true,
    // Imported cards were already verified; this action confirms them.
    effect: card.importedAt ? "confirmed" : "certified",
    // Offer Undo only when the server reports the review is reversible.
    undo:
      unreviewedCardState(card).ok && card.reviewedAt
        ? { certificationId, cardType: cardType.data, reviewedAt: card.reviewedAt.toISOString() }
        : undefined,
  };
}
