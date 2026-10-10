"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { issueBookingCapability } from "@/db/booking-capabilities";
import { getDb } from "@/db/client";
import { recordDiverOwnLocale } from "@/db/people";
import type { MedicalAnswers } from "@/db/schema";
import { getShopById } from "@/db/shops";
import { sendGuardianReleaseCopy } from "@/db/waiver-guardian-copy";
import { emailFreshWaiverLink, type WaiverLinkRescue } from "@/db/waiver-issue";
import { getWaiverSignerOnFile } from "@/db/waiver-signing";
import {
  completeWaiver,
  getWaiverForToken,
  saveBookingEmergencyContact,
  savePersonEmergencyContact,
  saveWaiverDraft,
  staleWaiverRecordForToken,
} from "@/db/waivers";
import { requestFirstHandLocale } from "@/i18n/request";
import { trackEvent } from "@/lib/analytics";
import { readinessLinkPath } from "@/lib/booking-capabilities";
import { nowDate } from "@/lib/clock";
import {
  type EmergencyContactSubmission,
  emergencyContactSchema,
  readEmergencyContact,
} from "@/lib/contact";
import { GUARDIAN_RELATIONSHIPS, guardianSignatureRequired, signingDate } from "@/lib/guardian";
import type { MedicalQuestionnaire } from "@/lib/medical";
import {
  medicalQuestionField,
  questionnaireForJurisdiction,
  readMedicalAnswers,
} from "@/lib/medical";
import { revalidateAndRedirect } from "@/lib/navigation";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";
import { WAIVER_FIELD_ERROR, type WaiverInvalidField } from "./waiver-fields";

/**
 * The one transactional action a dead waiver link still offers: send its owner
 * a fresh one. Nothing here hands the caller new access — the replacement link
 * goes to the address already on the booking, and only an outcome code comes
 * back to the page, so a leaked stale URL can trigger a delivery to its owner
 * and nothing more (the rules live with `emailFreshWaiverLink`).
 */

/** Outcome codes as one-word query values — the page turns each into a sentence. */
const RESCUE_PARAM: Record<WaiverLinkRescue, string> = {
  sent: "ok",
  no_email: "none",
  already_signed: "signed",
  current_link_live: "live",
  unavailable: "unavailable",
  failed: "failed",
};

export async function emailFreshWaiverLinkAction(token: string) {
  const ip = await clientIp();
  // Two nets, because they bound different abuses: the shared per-IP waiver
  // bucket (the same one the sign/save actions on this page spend from) stops
  // one client hammering many tokens, and the narrow bucket below stops many
  // clients hammering one diver's inbox.
  if (
    !(await checkRateLimit(rateLimitKey("waiver-token", ip), RATE_LIMITS.capabilityAction)).allowed
  ) {
    redirect(`/waivers/${token}?sent=rate`);
  }

  const db = await getDb();
  // The narrow bucket belongs to the **inbox**, so it is keyed by the booking
  // the stale link resolves to — not by the URL. A booking accumulates a new
  // dead token every time a link is reissued, and keying by token handed each
  // of those N leaked URLs its own full 5/hr budget: one holder with a handful
  // of old links could still spray the same mailbox N×5 times an hour. Keyed by
  // booking, every link that was ever issued for it spends from one budget.
  // A token that resolves to nothing has no inbox to protect and no booking to
  // key on, so it falls back to itself and is otherwise stopped by the per-IP
  // net above and by the `unavailable` outcome. `rateLimitKey` hashes whichever
  // it is, so neither a raw bearer token nor a booking id is ever held as a
  // literal key.
  const stale = await staleWaiverRecordForToken(db, token);
  const inboxKey = stale?.bookingId
    ? rateLimitKey("waiver-link-resend", "booking", stale.bookingId)
    : rateLimitKey("waiver-link-resend", "token", token);
  if (!(await checkRateLimit(inboxKey, RATE_LIMITS.waiverLinkResendByBooking)).allowed) {
    redirect(`/waivers/${token}?sent=rate`);
  }

  const outcome = await emailFreshWaiverLink(db, token);
  redirect(`/waivers/${token}?sent=${RESCUE_PARAM[outcome]}`);
}

/**
 * What the signing form's two doors need to know about the link they were posted through,
 * re-read at submit from the token itself: the record, the questionnaire its shop's
 * jurisdiction asks, and whether a guardian must co-sign (decided from the date of birth on
 * file, on the shop's calendar day — the rule `completeWaiver` refuses on).
 *
 * These were closures over the page's render; read here instead, the answer is the link's as it
 * stands when the diver presses the button. A link that stopped being signable between paint and
 * submit (signed elsewhere, expired, held) is answered `unavailable` before the form is read,
 * which is where the writers would have sent it anyway.
 */
async function signingContext(token: string) {
  const db = await getDb();
  const state = await getWaiverForToken(db, token);
  if (state.state !== "available") return null;
  const shop = await getShopById(db, state.record.shopId);
  if (!shop) return null;
  const signerOnFile = await getWaiverSignerOnFile(db, state.record.personId);
  return {
    record: state.record,
    recordBookingId: state.record.bookingId,
    questionnaire: questionnaireForJurisdiction(shop.jurisdiction),
    guardianRequired: guardianSignatureRequired(
      signerOnFile?.dateOfBirth,
      signingDate(nowDate(), shop.timezone),
    ),
  };
}

const signatureSchema = z.object({
  signerName: z.string().trim().max(120),
  acknowledged: z.string().optional(),
});

const completeSignatureSchema = z.object({
  signerName: z.string().trim().min(2).max(120),
  acknowledged: z.literal("on"),
});

/**
 * The guardian section as typed, for "Save and finish later" — anything goes,
 * because nothing here is evidence yet.
 */
const guardianDraftSchema = z.object({
  guardianName: z.string().trim().max(120).optional(),
  guardianRelationship: z.string().trim().max(40).optional(),
  guardianEmail: z.string().trim().max(200).optional(),
  guardianAcknowledged: z.string().max(4).optional(),
});

/**
 * The guardian section as a signature (ADR 20260907-guardian-co-signature):
 * a name, one of the two relationship codes, a reachable address, and the
 * guardian's own consent box. Applied only when the diver is a minor on the
 * signing day; an adult's form never renders these controls.
 */
const completeGuardianSchema = z.object({
  guardianName: z.string().trim().min(2).max(120),
  guardianRelationship: z.enum(GUARDIAN_RELATIONSHIPS),
  /**
   * **Optional, and the one thing it is for is a copy of what was signed**
   * (issue #1453, owner decision 2026-09-10). It was required, and nothing ever
   * sent to it — so a grandparent at a counter with no email was refused
   * outright while a third party's address sat on a signed release with no
   * reader. Blank is now accepted; a typed address that is not one is still
   * refused, so the `guardianEmail` arm of `WAIVER_FIELD_ERROR` keeps its job.
   * `guardianEvidence` re-checks the shape writer-side and is the enforcement
   * of record for anything that did not come from this form.
   */
  guardianEmail: z
    .string()
    .trim()
    .max(200)
    .refine((value) => value === "" || z.email().safeParse(value).success)
    .optional(),
  guardianAcknowledged: z.literal("on"),
});

/**
 * The guardian section as typed, for the draft — or `undefined` when the page
 * never rendered one, so an adult's draft carries no guardian and a stray
 * field in a hand-built request stores nothing.
 *
 * It takes whether a guardian is required as an argument: the two signing doors below
 * read that from the link at submit (`signingContext`). It was module-scope even while those
 * doors were closures inside the page, because a *function* in a closure's scope cannot be
 * serialised for progressive enhancement and broke the whole form with JavaScript off.
 */
function guardianDraftFrom(formData: FormData, guardianRequired: boolean) {
  if (!guardianRequired) return undefined;
  const parsed = guardianDraftSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return undefined;
  return {
    name: parsed.data.guardianName || null,
    relationship: parsed.data.guardianRelationship || null,
    email: parsed.data.guardianEmail || null,
    acknowledged: parsed.data.guardianAcknowledged === "on",
  };
}

/**
 * The field names a zod refusal names, as a set. Aliased rather than written
 * inline three times: a `ReadonlySet<PropertyKey>` parameter followed by
 * another one puts a `>` and a `<` around two lines of prose-shaped text,
 * which `pnpm check:copy` reads — correctly, by its own rule — as a JSX text
 * node in a `.tsx` file.
 */
type IssuePaths = ReadonlySet<PropertyKey>;

/** The guardian controls, in tab order, for the fallback error banner. */
const GUARDIAN_FIELDS = [
  "guardianName",
  "guardianRelationship",
  "guardianEmail",
  "guardianAcknowledged",
] as const satisfies readonly WaiverInvalidField[];

/**
 * Which control to point the fallback error banner at, in the same order a
 * keyboard user tabs through the form — medical questions, then the
 * signature name, then the agreement checkbox. `signerName`/`acknowledged`
 * now carry `required` (`minLength` too, on the name) so the browser's own
 * validation blocks-and-focuses the first invalid control before a normal
 * submit ever reaches here; this is only reached when that was bypassed (JS
 * disabled, or a non-browser client) — the zod schemas above stay the
 * enforcement of record either way.
 */
function firstInvalidWaiverField(
  signatureIssuePaths: IssuePaths,
  answers: MedicalAnswers | null,
  guardianIssuePaths: IssuePaths = new Set(),
  contactField: WaiverInvalidField | undefined = undefined,
): WaiverInvalidField | undefined {
  if (!answers) return "medical";
  // The contact section sits between the questions and the signature card, and
  // its refusal is the one a normal browser actually reaches: `required` covers
  // the two controls below it, but no markup can say "these two boxes move
  // together".
  if (contactField) return contactField;
  if (signatureIssuePaths.has("signerName")) return "signerName";
  if (signatureIssuePaths.has("acknowledged")) return "acknowledged";
  return GUARDIAN_FIELDS.find((field) => guardianIssuePaths.has(field));
}

/**
 * The box a half-filled emergency contact is refused on — the empty one, which
 * is where the diver has to type. A pair refuses nothing, and neither does a
 * section left entirely alone: both blank is the no-change case, and a blank
 * has never overwritten what the shop holds (`readEmergencyContact`).
 */
function refusedContactField(
  submitted: EmergencyContactSubmission | undefined,
): WaiverInvalidField | undefined {
  if (submitted?.kind !== "half") return undefined;
  return submitted.missing === "name" ? "emergencyContactName" : "emergencyContactPhone";
}

/**
 * Where a refused submit sends the diver back to: the same page, the refused
 * field's name, a nonce, and — when the refusal names a control — that
 * control's own `#anchor`. The anchor is what makes the refusal reachable
 * with no JavaScript at all: the browser lands the redirect on the named
 * control, where the refusal's words are rendered (a name-mismatch is the one
 * refusal a JS-less browser can actually reach — native `required` validation
 * blocks the empty-field cases before the server ever sees them). The nonce
 * (`at`) tells one attempt from the next so a diver who repeats the identical
 * mistake still gets the scroll-and-ring a remounted `FieldErrorFocus`
 * provides; only the signature-card refusals consume it, and `FlashParams`
 * strips it with the other flash params after render.
 */
function refusedSubmitPath(token: string, field: WaiverInvalidField | undefined) {
  const nonce = crypto.randomUUID().slice(0, 8);
  const anchor =
    field && WAIVER_FIELD_ERROR[field].anchor !== "medical-questionnaire"
      ? `#${WAIVER_FIELD_ERROR[field].anchor}`
      : "";
  return `/waivers/${token}?error=invalid${field ? `&field=${field}` : ""}&at=${nonce}${anchor}`;
}

/**
 * This form's questionnaire answers.
 *
 * The rule itself lives in `src/lib/medical.ts` — it is the one function that
 * decides what enters a signed medical record, it is written by three callers
 * that have to agree, and it had no test while it was a private helper here.
 * This is the `FormData` adapter over it.
 */
function readFormMedicalAnswers(
  formData: FormData,
  questionnaire: MedicalQuestionnaire,
  options: { allowIncomplete?: boolean } = {},
): MedicalAnswers | null {
  return readMedicalAnswers(
    questionnaire,
    (questionId) => {
      const value = formData.get(medicalQuestionField(questionId));
      return value === "yes" || value === "no" ? value : null;
    },
    options,
  );
}

export async function saveWaiverDraftAction(token: string, formData: FormData) {
  const ip = await clientIp();
  if (
    !(await checkRateLimit(rateLimitKey("waiver-token", ip), RATE_LIMITS.capabilityAction)).allowed
  ) {
    redirect(`/waivers/${token}?error=rate`);
  }
  const context = await signingContext(token);
  if (!context) redirect(`/waivers/${token}?error=unavailable`);
  const { record, recordBookingId, questionnaire, guardianRequired } = context;
  const parsed = signatureSchema.safeParse(Object.fromEntries(formData));
  const answers = readFormMedicalAnswers(formData, questionnaire, { allowIncomplete: true });
  if (!parsed.success || !answers) {
    const invalidField = firstInvalidWaiverField(
      parsed.success ? new Set() : new Set(parsed.error.issues.map((issue) => issue.path[0])),
      answers,
    );
    redirect(refusedSubmitPath(token, invalidField));
  }
  const db = await getDb();
  const savedDraft = await saveWaiverDraft(db, token, {
    signerName: parsed.data.signerName,
    acknowledged: parsed.data.acknowledged === "on",
    medicalAnswers: answers,
    guardian: guardianDraftFrom(formData, guardianRequired),
  });
  // A form the diver themselves just submitted through their own bearer
  // link — first-hand evidence of the language they read (docs ADR
  // 20260731-per-person-notification-locale). Captured on submit and not on
  // the page render above, because a chat app unfurling this URL for a link
  // preview also GETs the page, and that bot's `Accept-Language` is nobody's.
  // Only once the writer took the draft: a refused link (held, expired)
  // writes nothing onto the person.
  if (savedDraft) {
    await recordDiverOwnLocale(db, {
      shopId: record.shopId,
      personId: record.personId,
      locale: await requestFirstHandLocale(),
    });
  }
  // Persist the contact now too, so "save and finish later" keeps it — as a
  // pair or not at all. Both blank still keeps what's on file; one box filled
  // and the other cleared is refused below rather than spliced onto the
  // stored number. The draft is already written at this point, so the
  // refusal costs the diver nothing they typed into the rest of the form.
  const contact = emergencyContactSchema.safeParse(Object.fromEntries(formData));
  const submittedContact = contact.success
    ? readEmergencyContact({
        name: contact.data.emergencyContactName,
        phone: contact.data.emergencyContactPhone,
      })
    : undefined;
  if (savedDraft && submittedContact?.kind === "pair") {
    if (recordBookingId) {
      await saveBookingEmergencyContact(db, {
        shopId: record.shopId,
        bookingId: recordBookingId,
        name: submittedContact.name,
        phone: submittedContact.phone,
        actor: "bearer",
      });
    } else {
      await savePersonEmergencyContact(db, {
        shopId: record.shopId,
        personId: record.personId,
        name: submittedContact.name,
        phone: submittedContact.phone,
      });
    }
  }
  const refusedDraftContact = refusedContactField(submittedContact);
  if (savedDraft && refusedDraftContact) redirect(refusedSubmitPath(token, refusedDraftContact));
  revalidateAndRedirect(
    `/waivers/${token}`,
    `/waivers/${token}${savedDraft ? "?saved=1" : "?error=unavailable"}`,
  );
}

export async function completeWaiverAction(token: string, formData: FormData) {
  const ip = await clientIp();
  if (
    !(await checkRateLimit(rateLimitKey("waiver-token", ip), RATE_LIMITS.capabilityAction)).allowed
  ) {
    redirect(`/waivers/${token}?error=rate`);
  }
  const context = await signingContext(token);
  if (!context) redirect(`/waivers/${token}?error=unavailable`);
  const { record, recordBookingId, questionnaire, guardianRequired } = context;
  const parsed = completeSignatureSchema.safeParse(Object.fromEntries(formData));
  const answers = readFormMedicalAnswers(formData, questionnaire);
  // The guardian section is validated only when the page rendered one — the
  // writer decides the same way, from the date of birth on file, so a form
  // that omits it for an adult and one that includes it for a minor both
  // go through; only a minor's form missing it is refused here.
  const guardian = guardianRequired
    ? completeGuardianSchema.safeParse(Object.fromEntries(formData))
    : null;
  // Read before the refusal below, because the contact can refuse too: its
  // two boxes move together (`readEmergencyContact`), and a form that fills
  // one and clears the other is sent back to the empty box rather than
  // written as a new name onto the contact's old number.
  const contact = emergencyContactSchema.safeParse(Object.fromEntries(formData));
  const submittedContact = contact.success
    ? readEmergencyContact({
        name: contact.data.emergencyContactName,
        phone: contact.data.emergencyContactPhone,
      })
    : undefined;
  const refusedContact = refusedContactField(submittedContact);
  if (!parsed.success || !answers || (guardian && !guardian.success) || refusedContact) {
    const invalidField = firstInvalidWaiverField(
      parsed.success ? new Set() : new Set(parsed.error.issues.map((issue) => issue.path[0])),
      answers,
      guardian && !guardian.success
        ? new Set(guardian.error.issues.map((issue) => issue.path[0]))
        : new Set(),
      refusedContact,
    );
    // A refused guardian section keeps what the family typed, exactly as the
    // signature-card refusals below keep the diver's own answers.
    if (answers) {
      const typed = signatureSchema.safeParse(Object.fromEntries(formData));
      await saveWaiverDraft(await getDb(), token, {
        signerName: typed.success ? typed.data.signerName : undefined,
        acknowledged: typed.success && typed.data.acknowledged === "on",
        medicalAnswers: answers,
        guardian: guardianDraftFrom(formData, guardianRequired),
      });
    }
    redirect(refusedSubmitPath(token, invalidField));
  }
  const outcome = await completeWaiver(await getDb(), token, {
    signerName: parsed.data.signerName,
    agreed: true,
    medicalAnswers: answers,
    // Optional — a diver who skips it still signs; blanks never clobber a
    // value already on file, and a half-filled pair never reaches here.
    emergencyContact:
      submittedContact?.kind === "pair"
        ? { name: submittedContact.name, phone: submittedContact.phone }
        : undefined,
    guardian: guardian?.success
      ? {
          name: guardian.data.guardianName,
          relationship: guardian.data.guardianRelationship,
          // Blank reaches the writer as an empty string and is stored as
          // null; a malformed one never gets here.
          email: guardian.data.guardianEmail ?? "",
          agreed: true,
        }
      : undefined,
  });
  if (!outcome.ok) {
    // A refused sign-off (most often a typed name that doesn't match the
    // booking) redirects back to this same page, which re-renders from
    // scratch server-side. Without saving a draft first, that redirect
    // would silently wipe every medical answer, the emergency contact, and
    // the typed name the diver just entered — worse than the refusal
    // itself. `saveWaiverDraft` no-ops when the link is no longer
    // signable (expired/unavailable), so this is safe on every reason.
    const db = await getDb();
    await saveWaiverDraft(db, token, {
      signerName: parsed.data.signerName,
      acknowledged: parsed.data.acknowledged === "on",
      medicalAnswers: answers,
      guardian: guardianDraftFrom(formData, guardianRequired),
    });
    if (submittedContact?.kind === "pair") {
      if (recordBookingId) {
        await saveBookingEmergencyContact(db, {
          shopId: record.shopId,
          bookingId: recordBookingId,
          name: submittedContact.name,
          phone: submittedContact.phone,
          actor: "bearer",
        });
      } else {
        await savePersonEmergencyContact(db, {
          shopId: record.shopId,
          personId: record.personId,
          name: submittedContact.name,
          phone: submittedContact.phone,
        });
      }
    }
    if (outcome.reason === "name_mismatch") {
      redirect(refusedSubmitPath(token, "signerNameMismatch"));
    }
    if (outcome.reason === "invalid_medical") {
      redirect(refusedSubmitPath(token, "medical"));
    }
    if (outcome.reason === "invalid_signature") {
      redirect(refusedSubmitPath(token, undefined));
    }
    // The writer asked for a guardian this page did not render (a date of
    // birth landed on the record between paint and submit): the reload
    // renders the section, and the refusal points at its first control.
    if (outcome.reason === "guardian_required") {
      redirect(refusedSubmitPath(token, "guardianName"));
    }
    // Past the schema above, the one way a guardian section is not a
    // signature is a guardian who typed the diver's own name.
    if (outcome.reason === "guardian_invalid") {
      redirect(refusedSubmitPath(token, "guardianNameIsDiver"));
    }
    redirect(`/waivers/${token}?error=unavailable`);
  }
  // Same first-hand signal as the draft save above (docs ADR
  // 20260731-per-person-notification-locale) — signing is the strongest
  // version of it, since the diver read and agreed to the whole page.
  await recordDiverOwnLocale(await getDb(), {
    shopId: record.shopId,
    personId: record.personId,
    locale: await requestFirstHandLocale(),
  });
  await trackEvent({ name: "waiver_signed" });
  // **The guardian's copy** (issue #1453). Deferred past the response for the
  // same reason every other courtesy send is: the family is watching for
  // their signed state, and a stalled provider must never stand between them
  // and it. No-ops for an adult's release and for a family who gave no
  // address, which is where that decision is made rather than here.
  after(async () => {
    await sendGuardianReleaseCopy(await getDb(), {
      shopId: record.shopId,
      recordId: record.id,
    }).catch(() => undefined);
  });
  // A diver who just signed goes straight to "what's left" instead of a
  // signed-waiver page whose only forward path is the same link — the
  // completed-state render below still shows that page for anyone who
  // revisits this token afterward.
  const db = await getDb();
  const readyCapability = recordBookingId
    ? await issueBookingCapability(db, {
        shopId: record.shopId,
        bookingId: recordBookingId,
        purpose: "readiness",
      })
    : null;
  const readyPath = readyCapability ? readinessLinkPath(readyCapability.token) : null;
  revalidateAndRedirect(`/waivers/${token}`, readyPath ?? `/waivers/${token}`);
}
