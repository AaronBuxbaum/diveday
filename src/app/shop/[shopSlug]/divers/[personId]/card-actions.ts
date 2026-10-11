"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { certificationForAgencyCheck, isAgencyCheckedCard } from "@/db/agency-check";
import type { AppDb } from "@/db/client";
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
import { judgeAgencyPage, PAGE_TEXT_MAX_LENGTH } from "@/lib/agency-check";
import { isPlausibleCardNumber } from "@/lib/card-number";
import { revalidateAndRedirect } from "@/lib/navigation";
import { noticeUrl } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
import { backTo, requireDiverActionContext, successUrl } from "./action-helpers";

// The pg enum itself, not a copy of it: a card the column accepts is a card the
// form must accept, and a hand-kept list is what let CMAS/RAID/GUE be refused
// here while the database was ready for them (DOM-L1).
const agencySchema = z.enum(certificationAgency.enumValues);
// Same rule, and it matters more since the card sighting started parsing the
// level: a hand-written copy that falls behind the enum makes a legitimate
// submit fail *silently* (`levelSightingFromForm` returns undefined), which
// reads to the staffer as "you did not fill the form in".
const levelSchema = z.enum(certificationLevel.enumValues);
/**
 * The specialties that live in `specialty_certifications`. Nitrox is
 * deliberately **not** one of them: it is its own table and its own gas gate,
 * so a hand-posted `card=specialty:nitrox` must not reach
 * `createSpecialtyCertification`. The picker spells that card `card=nitrox`,
 * and this closed enum is what makes anything else a refusal.
 */
const specialtyOnlySchema = z.enum(diveSpecialty.enumValues);
// The card number, on every form on this page that takes one. It is the same
// bound everywhere **on purpose**: capturing a card and sighting one are
// different acts (see `sightingSchema`) but they reach the identical `verified`
// state, so a stricter check on only one of them is a speed bump with a door
// beside it — delete the claim, capture the same "xx", tap Mark certified, and
// the `self_declared_at` provenance is gone with it.
const cardNumberSchema = z.string().trim().max(120).refine(isPlausibleCardNumber);
/**
 * The card a staffer says they are holding, when the row they are verifying is
 * still only a diver's word (`certifications.selfDeclaredAt`).
 *
 * This is the act the number check above exists for. Capturing a card is a
 * staffer entering a card the shop is looking at; a *sighting* is the single
 * moment a stranger's typing becomes `verified` — the state readiness, trip
 * admission, every course prerequisite and the nitrox fill gate read. It
 * inherited the capture form's 2–120 characters, so **"xx" certified a
 * self-declared "Instructor"**: a required box with no shape is a box a hurried
 * person fills with anything. The check itself stays loose on purpose — see
 * `isPlausibleCardNumber`.
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
 * The card a submit names, narrowed to something a `uuid` column can actually
 * be compared against — or `undefined`, which every caller below already
 * handles as "no card named" and answers with its own refusal.
 *
 * Five actions took this straight off the form and put it in
 * `eq(certifications.id, …)`. **Postgres does not coerce a malformed uuid
 * literal — it raises**, so a signed-in staffer editing the posted value turned
 * a delete, a restore or a review into a **500** where that action's own
 * "invalid" belongs one line later. Tenant isolation was never the exposure
 * (every one of those queries is narrowed by `shopId` either way); a staff
 * surface answering a typo with a stack trace instead of a sentence is.
 *
 * It is the same rule and the same helper `pnpm check:repo` already enforces on
 * dynamic route segments (`scripts/check-uuid-segments.mjs`); that script can
 * only see paths, and an id posted in a hidden field reaches the identical
 * query.
 */
function cardIdFromForm(formData: FormData): string | undefined {
  return uuidParam(String(formData.get("certificationId") ?? ""));
}

/**
 * Whether this submit carried a card sighting whose **number** is the thing
 * that was wrong.
 *
 * The distinction is the whole point. A failed `sightingSchema` parse collapses
 * to `undefined`, which is exactly what a submit carrying *no* sighting
 * returns — so a staffer who typed "xx" got `card_sighting_required`: *"Enter
 * the agency and number from the card in front of you to certify it."* They
 * had. At a busy dock that person retypes it once, gets the same sentence, and
 * then goes **around** the form: delete the claim, capture the same "xx" by
 * hand, tap Mark certified. That reaches the identical `verified` state while
 * throwing away `self_declared_at` — the stamp the incident export, the
 * "diver's word" mark and every provenance read depend on. A refusal that will
 * not say what is wrong is how a safety-critical form teaches people to route
 * around it.
 *
 * Checked on the number alone rather than the whole shape, because it is the
 * only field a staffer types free-hand; a malformed agency or level can only
 * come from a hand-built post and keeps the generic refusal.
 */
function sightedNumberRefused(formData: FormData): boolean {
  return (
    formData.has("sightedIdentifier") &&
    !cardNumberSchema.safeParse(formData.get("sightedIdentifier")).success
  );
}

async function liveStaffName(db: AppDb, shopId: string, personId: string) {
  return (await getShopPersonName(db, shopId, personId)) ?? "staff";
}

export async function addCardAction(shopSlug: string, personId: string, formData: FormData) {
  const context = await requireDiverActionContext(shopSlug, personId, "not-authorized-cards");
  personId = context.personId;
  const { base, db, staff } = context;
  const card = String(formData.get("card") ?? "");
  const identifier = cardNumberSchema.safeParse(formData.get("identifier"));
  const agency = agencySchema.safeParse(formData.get("agency"));
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

/**
 * The only review outcome is "certified" — a bad card is deleted, not marked
 * for correction.
 *
 * One tap for every card a staffer captured themselves. A **self-declared**
 * card (a diver named their own level on a public opt-in) is the exception: it
 * carries no number, and this form asks for the agency, the number **and the
 * level** off the card in the staffer's hand before it will certify anything.
 * That is the same act as capturing a card, and `reviewCertification` refuses
 * without it — as does the database, whose check constraint will not let a row
 * with a blank or absent number reach `verified`. (It read `identifier is not
 * null` until 2026-08-15, which `''` satisfies, so this sentence was true of
 * NULL and enforced by the application alone for the empty string.)
 *
 * The level is there because the likeliest wrong claim is an overstated one:
 * transcribing the number off a real Open Water card while keeping the diver's
 * typed "Instructor" would verify the one field nobody looked at.
 */
export async function reviewAction(shopSlug: string, personId: string, formData: FormData) {
  const context = await requireDiverActionContext(shopSlug, personId, "not-authorized-cards");
  personId = context.personId;
  const { base, db, staff } = context;
  // Before anything is read: a number that is not a number gets its own answer,
  // on its own box. Without this the refusal below is the one that fires, and
  // it tells the staffer to do what they just did (`sightedNumberRefused`).
  // Named: a diver can hold two self-declared cards, and a refusal that says
  // only "a card number was wrong" opens both sighting forms with the same red
  // sentence under each — including the one nobody typed in.
  if (sightedNumberRefused(formData)) {
    redirect(backTo(base, "card-number-implausible", "cards", cardIdFromForm(formData)));
  }
  const certificationId = cardIdFromForm(formData);
  // Present only on the sighting form; absent on the one-tap button, where a
  // blank parse must not turn into an empty-string "sighting".
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
 * The card the staffer says they are looking at, or undefined when this submit
 * carried none. Undefined and "they typed nothing" are the same outcome —
 * `reviewCertification` refuses either way on a row that needs a sighting — but
 * they are kept distinct here so a malformed agency is a refusal rather than a
 * silent fall-through to the shop's first enum member.
 */
function sightingFromForm(formData: FormData): CardSighting | undefined {
  if (!formData.has("sightedIdentifier")) return undefined;
  const parsed = sightingSchema.safeParse({
    agency: formData.get("sightedAgency"),
    identifier: formData.get("sightedIdentifier"),
  });
  return parsed.success ? parsed.data : undefined;
}

/**
 * {@link sightingFromForm} plus the rung the staffer read off the card.
 *
 * A submit missing or malforming the level is `undefined` — the same outcome as
 * a missing number, so `reviewCertification` refuses with
 * `card_sighting_required` rather than certifying a level nobody stated. That
 * is the point of parsing it here: the alternative, falling back to the level
 * already on the row, is precisely the diver's own claim being promoted.
 */
function levelSightingFromForm(formData: FormData): LevelCardSighting | undefined {
  if (!formData.has("sightedIdentifier")) return undefined;
  const parsed = levelSightingSchema.safeParse({
    agency: formData.get("sightedAgency"),
    identifier: formData.get("sightedIdentifier"),
    level: formData.get("sightedLevel"),
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
  const context = await requireDiverActionContext(shopSlug, personId, "not-authorized-cards");
  personId = context.personId;
  const { base, db, staff } = context;
  // The nitrox twin of the level sighting's own refusal, and it matters at
  // least as much here: this tap authorizes a gas fill.
  if (sightedNumberRefused(formData)) {
    redirect(backTo(base, "card-number-implausible", "cards", cardIdFromForm(formData)));
  }
  const certificationId = cardIdFromForm(formData);
  // One tap, the same as the level card beside it. The imported-card
  // attestation this used to forward is gone
  // (ADR 20260814-one-tap-imported-card-confirm). A self-declared nitrox card
  // still asks for the card in the staffer's hand — this tap authorizes a gas
  // fill, and nobody has seen anything yet.
  const outcome = certificationId
    ? formData.get("cardType") === "nitrox"
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
          // A specialty card the diver typed on their own readiness link asks
          // for the card in the staffer's hand, exactly as the nitrox branch
          // above does — and for a stronger reason: this tap opens a depth gate
          // past 18 m. An imported or staff-captured card is still one tap.
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
 * **"This diver never told us that"** — the eraser for a *"Not certified yet —
 * diver's word"* stamp somebody else left on their record.
 *
 * `people.no_certification_declared_at` is written by two **unauthenticated**
 * forms (the shop-wide last-minute-deal join, a full trip's wait-list join),
 * both of which resolve a person by shop + email. For a diver the shop holds no
 * card for — the ordinary case for anyone whose card was never captured —
 * anybody holding a name and an email address off any boat's manifest can mark
 * them, permanently, on the staff send lists and in every CSV the shop exports
 * from then on. Until this action the only thing that cleared it was owner-only
 * erasure, which destroys the whole record.
 *
 * **It cannot be a second way to launder a claim into evidence.** Its only
 * effect is to move this person from a *stated* absence of a card to *no
 * statement at all* — the silence of somebody nobody asked. Evidence lives in
 * the three card tables and `clearNoCertificationDeclaration` touches none of
 * them: nothing here raises a level, adds a card, or moves a row toward
 * `verified`. That direction is also what makes the gate right — a staff
 * session and no role predicate, exactly as capturing a card has always been,
 * since this is a weaker act than a capture. H-48 is the open product-owner
 * question about who may *sight* a card, and this deliberately does not
 * pre-empt it by inventing a narrower rule for a smaller thing.
 *
 * The correction is not itself invisible: it is stamped on the row with the
 * staff member who made it (`people.no_certification_cleared_by_person_id`),
 * which outlives the retention window an `activity_events` line would be pruned
 * on, and travels in the export beside the statement it corrects.
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
  // Both outcomes are page-level, deliberately, and this is the one place on
  // this record where that is the *right* answer rather than a shortcut: the
  // panel holding this control renders only while the stamp is set, so on
  // success it is gone, and on the no-op it was never there. A notice has to
  // land somewhere that survives the state change it reports.
  //
  // The no-op gets its own code rather than the generic `invalid`. A replayed
  // submit or a double tap **succeeded** — the record already says what the
  // staffer wanted it to say — and answering *"Check the details and try
  // again"* in a danger tone tells them their correction failed when it did
  // not. Reporting it as a fresh success would be the opposite lie, putting
  // their name on an act that did not happen.
  revalidateAndRedirect(
    base,
    backTo(base, cleared ? "no-certification-cleared" : "no-certification-nothing-to-clear"),
  );
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
  const context = await requireDiverActionContext(shopSlug, personId, "not-authorized-cards");
  personId = context.personId;
  const { base, db, staff } = context;
  const certificationId = cardIdFromForm(formData);
  const cardType = formData.get("cardType") === "nitrox" ? "nitrox" : "specialty";
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
  const context = await requireDiverActionContext(shopSlug, personId, "not-authorized-cards");
  personId = context.personId;
  const { base, db, staff } = context;
  const certificationId = cardIdFromForm(formData);
  const cardType = cardTypeSchema.safeParse(formData.get("cardType"));
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
      undo?: { certificationId: string; cardType: CardType };
    }
  | { ok: false; reason: "invalid" | "sighting-required" | "duplicate-card" | "not-undoable" };

/**
 * **Mark certified, in place — and take it back.**
 *
 * Every other write on this record redirects, which is right for a form whose
 * outcome is a sentence beside it. This one is a **row-level tap in a list**,
 * and a redirect made it the most expensive act on the page: the route's own
 * `loading.tsx` painted over a ~6,400px record, the `#cards` anchor threw the
 * viewport somewhere the staffer had not asked to be, and a desk working down
 * a stack of cards paid that for every single one. So it revalidates and
 * returns; the row settles where it is (`ReviewRowActions` on the reviews queue
 * is the same shape, for the same reason).
 *
 * Returning also buys the thing the banner could not: an **Undo**. "Certification
 * marked verified. It counts toward readiness." was a sentence explaining a
 * status word the row already wears — and it left a mis-tap on the wrong row
 * with no way back but deleting the card. The toast says less and offers more.
 *
 * `intent=undo` routes to the un-review writers, which refuse a card whose
 * review was a *sighting*: that rewrites the row from the card in the staffer's
 * hand and there is nothing to put back. Those cards never reach this action —
 * they wear `CardSightingForm` instead — and the server refuses regardless,
 * because a posted form is caller-controlled.
 */
export async function markCertifiedAction(
  shopSlug: string,
  personId: string,
  _previous: MarkCertifiedResult,
  formData: FormData,
): Promise<MarkCertifiedResult> {
  const context = await requireDiverActionContext(shopSlug, personId, "not-authorized-cards");
  personId = context.personId;
  const { base, db, staff } = context;
  const certificationId = cardIdFromForm(formData);
  const cardType = cardTypeSchema.safeParse(formData.get("cardType"));
  if (!certificationId || !cardType.success) return { ok: false, reason: "invalid" };
  const input = { shopId: staff.user.shopId, certificationId };

  if (formData.get("intent") === "undo") {
    const undone =
      cardType.data === "level"
        ? await unreviewCertification(db, input)
        : cardType.data === "specialty"
          ? await unreviewSpecialtyCertification(db, input)
          : await unreviewNitroxCertification(db, input);
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
    // An imported card was already `verified` on arrival; this tap confirmed
    // it rather than certifying it, and the two must not claim the same thing.
    effect: card.importedAt ? "confirmed" : "certified",
    undo:
      card.selfDeclaredAt || card.issuedByShopAt
        ? undefined
        : { certificationId, cardType: cardType.data },
  };
}

/**
 * What a check with the agency did, for the control that asked. A value, not a
 * redirect, for the same reason as {@link MarkCertifiedResult}.
 */
export type AgencyCheckResult =
  | null
  | {
      ok: true;
      /** The agency's page named this diver at this level, and the card is certified. */
      verdict: "match";
      undo?: { certificationId: string };
    }
  | { ok: true; verdict: "undone" }
  | {
      ok: true;
      /** The diver is on the page, this level is not: the staffer reads it. */
      verdict: "level_unconfirmed";
      evidence: string;
    }
  | { ok: true; verdict: "no_record" | "unreadable" }
  | { ok: false; reason: "invalid" | "not-undoable" };

/**
 * **Certify a card from the agency's own page** (H-105).
 *
 * The DiveDay browser extension, in the staffer's own browser, typed this
 * diver into the agency's lookup page and handed back the page's text. The
 * verdict is decided here, from the card and diver as the database holds them
 * (`certificationForAgencyCheck`), never from anything the browser claims, and
 * `judgeAgencyPage` is narrow: only the diver's name beside the claimed
 * level's own wording certifies. Anything else returns a verdict and writes
 * nothing. A match certifies through the ordinary review, stamped
 * `agencyCheckedAt` with the agency's matching words as the note, and is
 * undone the way a one-tap review is.
 */
export async function agencyCheckAction(
  shopSlug: string,
  personId: string,
  _previous: AgencyCheckResult,
  formData: FormData,
): Promise<AgencyCheckResult> {
  const context = await requireDiverActionContext(shopSlug, personId, "not-authorized-cards");
  personId = context.personId;
  const { base, db, staff } = context;
  const certificationId = cardIdFromForm(formData);
  if (!certificationId) return { ok: false, reason: "invalid" };
  const shopId = staff.user.shopId;

  if (formData.get("intent") === "undo") {
    // Only the review a check made, on this diver: never a sighting or a
    // one-tap review, which have their own Undo.
    if (!(await isAgencyCheckedCard(db, { shopId, personId, certificationId }))) {
      return { ok: false, reason: "not-undoable" };
    }
    const undone = await unreviewCertification(db, { shopId, certificationId });
    revalidatePath(base);
    return undone.ok ? { ok: true, verdict: "undone" } : { ok: false, reason: "not-undoable" };
  }

  const pageText = formData.get("pageText");
  if (typeof pageText !== "string") return { ok: false, reason: "invalid" };
  const card = await certificationForAgencyCheck(db, { shopId, personId, certificationId });
  if (!card) return { ok: false, reason: "invalid" };
  const judged = judgeAgencyPage({
    ...card.query,
    level: card.level,
    pageText: pageText.slice(0, PAGE_TEXT_MAX_LENGTH),
  });
  if (judged.verdict === "level_unconfirmed") {
    return { ok: true, verdict: "level_unconfirmed", evidence: judged.evidence };
  }
  if (judged.verdict !== "match") return { ok: true, verdict: judged.verdict };

  const outcome = await reviewCertification(db, {
    shopId,
    certificationId,
    status: "verified",
    reviewedByPersonId: staff.user.personId,
    reviewNote: judged.evidence,
    agencyChecked: true,
  });
  revalidatePath(base);
  if (!outcome.ok) return { ok: false, reason: "invalid" };
  return { ok: true, verdict: "match", undo: { certificationId } };
}
