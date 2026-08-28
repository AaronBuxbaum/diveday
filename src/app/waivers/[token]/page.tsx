import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { z } from "zod";
import { DiveSitesPeek } from "@/components/DiveSitesPeek";
import { EarnedMoment } from "@/components/EarnedMoment";
import { ExpiredLinkCard } from "@/components/ExpiredLinkCard";
import { FlashParams } from "@/components/FlashParams";
import { ShopNotice } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { THREAD_MEASURE_CLASS, ThreadShell } from "@/components/thread/ThreadShell";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { FieldErrorFocus } from "@/components/ui/FieldErrorFocus";
import { controlClass, Field, FieldGrid, FormStatus } from "@/components/ui/form";
import { issueBookingCapability } from "@/db/booking-capabilities";
import { getDb } from "@/db/client";
import { recordDiverOwnLocale } from "@/db/people";
import { bookings, type MedicalAnswers, people, type Shop, trips } from "@/db/schema";
import { getShopById } from "@/db/shops";
import { getTripDiveSitesPeek } from "@/db/trips";
import {
  completeWaiver,
  getEmergencyContactForBooking,
  getEmergencyContactForPerson,
  getWaiverForToken,
  saveBookingEmergencyContact,
  savePersonEmergencyContact,
  saveWaiverDraft,
  staleWaiverRecordForToken,
} from "@/db/waivers";
import { fill, pluralForm } from "@/i18n/fill";
import { type DiverMessageKey, type DiverTranslator, diverTranslator } from "@/i18n/messages";
import { requestFirstHandLocale, requestLocale } from "@/i18n/request";
import { DEFAULT_DIVER_LOCALE } from "@/i18n/settings";
import { trackEvent } from "@/lib/analytics";
import { readinessLinkPath } from "@/lib/booking-capabilities";
import { emergencyContactSchema } from "@/lib/contact";
import { telHref } from "@/lib/contact-links";
import { formatDateTimeTz, formatShortDate, formatTimeRangeTz } from "@/lib/format";
import type { MedicalQuestionnaire } from "@/lib/medical";
import { medicalProgress, medicalQuestionField, questionnaireForJurisdiction } from "@/lib/medical";
import { revalidateAndRedirect } from "@/lib/navigation";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";
import { noticeFromParam, noticeRole } from "@/lib/staff-notices";
import { emailFreshWaiverLinkAction } from "./actions";
import { MedicalQuestionnaireFields } from "./MedicalQuestionnaireFields";
import { QuestionnaireProgress } from "./QuestionnaireProgress";
import { WaiverPacing } from "./WaiverPacing";
import {
  WAIVER_RAIL_TOTAL,
  type WaiverRailSegmentId,
  WaiverStepRail,
  waiverRailProgress,
} from "./WaiverStepRail";

export async function generateMetadata(): Promise<Metadata> {
  const t = diverTranslator(await requestLocale());
  return {
    title: t("waiver.metaTitle"),
    robots: { index: false, follow: false },
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

type WaiverInvalidField = "medical" | "signerName" | "signerNameMismatch" | "acknowledged";

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
  signatureIssuePaths: ReadonlySet<PropertyKey>,
  answers: MedicalAnswers | null,
): WaiverInvalidField | undefined {
  if (!answers) return "medical";
  if (signatureIssuePaths.has("signerName")) return "signerName";
  if (signatureIssuePaths.has("acknowledged")) return "acknowledged";
  return undefined;
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

/** Copy and same-page anchor for each field a fallback submit can name as missing. */
const WAIVER_FIELD_ERROR: Record<WaiverInvalidField, { textKey: DiverMessageKey; anchor: string }> =
  {
    medical: { textKey: "waiver.errorMedical", anchor: "medical-questionnaire" },
    signerName: { textKey: "waiver.errorName", anchor: "signerName" },
    // A typed name that isn't the diver's own — same field, different fix, so
    // it gets its own sentence rather than the generic "type your full name".
    signerNameMismatch: { textKey: "waiver.errorNameMismatch", anchor: "signerName" },
    acknowledged: { textKey: "waiver.errorAgreement", anchor: "acknowledged" },
  };

/** Reads only applicable questions; a closed Box is stored as an explicit no. */
function readMedicalAnswers(
  formData: FormData,
  questionnaire: MedicalQuestionnaire,
  options: { allowIncomplete?: boolean } = {},
): MedicalAnswers | null {
  const responses: Record<string, boolean> = {};
  for (const question of questionnaire.questions) {
    if (question.parentId && responses[question.parentId] !== true) {
      responses[question.id] = false;
      continue;
    }
    const value = formData.get(medicalQuestionField(question.id));
    if (value !== "yes" && value !== "no") {
      if (options.allowIncomplete) continue;
      return null;
    }
    responses[question.id] = value === "yes";
  }
  return {
    questionnaireId: questionnaire.id,
    questionnaireVersion: questionnaire.version,
    responses,
  };
}

/**
 * `buttonClass` bakes in `text-sm`, and a plain `text-base` in `className` loses
 * the cascade because Tailwind emits `.text-sm` after `.text-base`. This waiver
 * is read at arm's length on a dock, so its actions keep their 16px label via
 * the token-valued utility, which does win.
 */
const labelTextBase = "text-(length:--text-base) leading-6";

/**
 * The rail's three names, in the reader's own language. One resolver, because
 * both states that render a rail — the page a diver is filling in and the
 * completed state — have to say the same three words.
 */
function railLabels(t: DiverTranslator): Record<WaiverRailSegmentId, string> {
  return {
    release: t("waiver.railRelease"),
    medical: t("waiver.railMedical"),
    sign: t("waiver.railSign"),
  };
}

/**
 * "2 of 3 done", pluralised against the reader's negotiated locale rather than
 * the server process's — `pluralForm` defaults to the runtime's own locale,
 * which on a server is whatever the box was booted with and is nobody's.
 */
function railDoneLabel(t: DiverTranslator, locale: string, done: number): string {
  return fill(
    pluralForm(
      done,
      { one: t.raw("waiver.railProgressOne"), other: t.raw("waiver.railProgressOther") },
      locale,
    ),
    { done, total: WAIVER_RAIL_TOTAL },
  );
}

/**
 * What makes "do this" read differently from "read this": the release above the
 * form is an unboxed document with no heading at all, and each thing the diver
 * acts on — health check, emergency contact, signature — announces itself with
 * one. The published questionnaire title passes through unreworded.
 *
 * **These headings carry no numbers, and the page has exactly one scale of
 * progress.** They used to be numbered 1-2-3, which was fine while it was the
 * page's only enumeration; the step rail's arrival made it the second, and the
 * two disagreed — the rail counts Release · Medical · Sign (ADR
 * 20260827-the-divers-thread, decision 5) and the numbering counted the medical
 * form, the emergency contact and the signature. So a diver read "2 of 3 done"
 * at the top of the same viewport as "step 2 of 3" in the body, over two
 * different memberships, and the step the two quietly disagreed about — the
 * emergency contact — is the one worth not losing (glossary: a name *and* a
 * reachable number, "on file" only when both are there). The rail is the scale;
 * these are section headings, and the contact keeps its own.
 */
function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-lg font-semibold">{children}</h2>;
}

// `instant = true`: this route has a real static shell. Every request-scoped
// read below sits inside this segment's `loading.tsx` boundary, so the frame
// paints without waiting on the request and the data streams into it —
// and `next build` fails if that ever stops being true.
// See ADR 20260804-instant-navigation.
export const instant = true;

export default async function WaiverPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{
    saved?: string;
    error?: string;
    field?: string;
    sent?: string;
    at?: string;
  }>;
}) {
  await connection();
  const { token } = await params;
  // `at` is the refusal's own nonce, minted by the actions below on every
  // refused submit. It exists so a *repeat* of the identical refusal (same
  // wrong name twice) still remounts `FieldErrorFocus` and re-runs the
  // scroll-and-ring — without it the second attempt renders an unchanged tree
  // and the effect never fires again (see FieldErrorFocus's own docstring).
  const { saved, error, field, sent, at } = await searchParams;
  // `Object.hasOwn`, not `in` — `field` is attacker-supplied and `in` walks
  // the prototype chain (`?field=toString` would mint a fieldError whose
  // anchor is a built-in function).
  const fieldError =
    error === "invalid" && field && Object.hasOwn(WAIVER_FIELD_ERROR, field)
      ? WAIVER_FIELD_ERROR[field as WaiverInvalidField]
      : undefined;
  // A refusal that names a control in the signature card renders *beside that
  // control* (Field `error` / the line under the checkbox), never as a page
  // banner — the rule in docs/design/forms-and-controls.md. The banner below
  // keeps only what has no single control to sit with: the medical section,
  // the generic incomplete, and the link-level refusals.
  const signatureCardError =
    fieldError && fieldError.anchor !== "medical-questionnaire" ? fieldError : undefined;
  const db = await getDb();
  // A dead or expired link resolves no shop, so there is no
  // `shops.default_locale` to fall back to — negotiate from the visitor's own
  // device alone for those branches.
  const anonT = diverTranslator(await requestLocale());
  const state = await getWaiverForToken(db, token);

  if (state.state === "unavailable") {
    // A rescue send supersedes the very record that asked for it, so this
    // token stops resolving through `getWaiverForToken` the moment the diver
    // uses the button below — as does an old link a staff reissue replaced.
    // Resolve the stale record so the redirect back here (and every later
    // refresh of the same URL) lands on the rescue card with its confirmation,
    // rather than a dead end that reads as if the tap broke the link.
    const stale = await staleWaiverRecordForToken(db, token);
    const staleShop = stale ? await getShopById(db, stale.shopId) : null;
    if (staleShop) {
      const staleT = diverTranslator(await requestLocale(staleShop.defaultLocale));
      return <ExpiredLink token={token} shop={staleShop} t={staleT} sent={sent} />;
    }
    // No record at all reached through this token (garbage, or a completed
    // link long since replaced) — there is no shop to attribute it to
    // without weakening the token model's own guarantee that a bearer token
    // reveals only its own record.
    return (
      <ExpiredLinkCard
        title={anonT("waiver.unavailableHeading")}
        text={anonT("waiver.unavailableBody")}
      />
    );
  }

  // Every remaining state carries a real record, so the shop it belongs to
  // is always resolvable from here on — including "expired", which used to
  // bail out before the shop (and so its contact info) was ever loaded.
  const shop = await getShopById(db, state.record.shopId);
  if (!shop) {
    return (
      <ExpiredLinkCard
        title={anonT("waiver.unavailableHeading")}
        text={anonT("waiver.unavailableBody")}
      />
    );
  }
  const shopName = shop.name;
  const locale = await requestLocale(shop.defaultLocale);
  const t = diverTranslator(locale);

  if (state.state === "expired") {
    return <ExpiredLink token={token} shop={shop} t={t} sent={sent} />;
  }

  if (state.state === "completed") {
    const needsReview = state.record.status === "medical_review";
    const bookingId = state.record.bookingId;
    const booking = bookingId
      ? await db
          .select({ tripId: bookings.tripId })
          .from(bookings)
          .where(eq(bookings.id, bookingId))
          .limit(1)
          .then((rows) => rows[0])
      : null;

    const diveSitesList = booking?.tripId ? await getTripDiveSitesPeek(db, booking.tripId) : [];

    const readyCapability = bookingId
      ? await issueBookingCapability(db, {
          shopId: state.record.shopId,
          bookingId,
          purpose: "readiness",
        })
      : null;
    const readyPath = readyCapability ? readinessLinkPath(readyCapability.token) : null;
    // **The medical step does not tick on a hold.** A record the shop is
    // holding for a written sign-off is signed and received, and its medical
    // side is *open* — the copy three lines above says a doctor must confirm
    // before this diver can go out. A rail closing at "3 of 3 done" under that
    // sentence is the product turning its own blocking state into a checkbox
    // (glossary, **Waiver / release**), and the diver who reads the last thing
    // on the page walks away believing the paperwork is finished.
    const signedRail = waiverRailProgress({
      medicalAnswered: 0,
      medicalTotal: 0,
      medicalStillOpen: needsReview,
      signed: true,
    });
    // The `<main>` below wears the same gutter as the signing form this diver
    // just came from: the outcome screen used to sit on a taller `py-16` on a
    // phone than the flow that led to it.
    return (
      <main className={THREAD_MEASURE_CLASS}>
        <EarnedMoment
          as="h1"
          eyebrow={shopName}
          title={needsReview ? t("capability.waiverReceived") : t("capability.waiverDone")}
        >
          <p>{needsReview ? t("waiver.medicalReview") : t("waiver.signedBody")}</p>
          {needsReview ? (
            <>
              {/* Corrected copy from the 2026-07-30 UX persona review (task
                  44): a "yes" answer needs a *physician's* written
                  clearance — the shop only receives and checks for that
                  sign-off, it never grants medical clearance itself, and
                  this never promises a timeline the diver's own doctor
                  controls. */}
              <p className="mt-3">{t("waiver.medicalReviewNext")}</p>
              <p className="mt-3 font-medium text-foreground">
                {shop.contactEmail && shop.contactPhone
                  ? t.rich("waiver.medicalContactBoth", {
                      shop: shopName,
                      phoneNumber: shop.contactPhone,
                      emailAddress: shop.contactEmail,
                      phone: (chunks) => (
                        <a href={telHref(shop.contactPhone ?? "")} className="hover:underline">
                          {chunks}
                        </a>
                      ),
                      email: (chunks) => (
                        <a href={`mailto:${shop.contactEmail}`} className="hover:underline">
                          {chunks}
                        </a>
                      ),
                    })
                  : shop.contactPhone
                    ? t.rich("waiver.medicalContactPhoneOnly", {
                        shop: shopName,
                        phoneNumber: shop.contactPhone,
                        phone: (chunks) => (
                          <a href={telHref(shop.contactPhone ?? "")} className="hover:underline">
                            {chunks}
                          </a>
                        ),
                      })
                    : shop.contactEmail
                      ? t.rich("waiver.medicalContactEmailOnly", {
                          shop: shopName,
                          emailAddress: shop.contactEmail,
                          email: (chunks) => (
                            <a href={`mailto:${shop.contactEmail}`} className="hover:underline">
                              {chunks}
                            </a>
                          ),
                        })
                      : t("waiver.medicalContactNone", { shop: shopName })}
              </p>
            </>
          ) : null}
          {readyPath ? (
            <Link href={readyPath} className={buttonClass({ className: "mt-5" })}>
              {t("waiver.seeWhatsLeft")}
            </Link>
          ) : null}
        </EarnedMoment>

        {/* The rail's closing frame: the same three segments the signing page
            carried. It is the only thing on this screen that answers "is that
            everything?" in the vocabulary the diver was reading two taps ago —
            the earned moment above celebrates, and a celebration is not an
            inventory. Sign settles here and only here: a typed name and a
            ticked box are not a signature until `completeWaiver` has taken
            them. Medical settles here too, *unless* the record is on a hold, in
            which case this closes at two with an open ring beside it. */}
        <WaiverStepRail
          className="mt-8"
          progress={signedRail}
          labels={railLabels(t)}
          doneLabel={railDoneLabel(t, locale, signedRail.done)}
        />

        <DiveSitesPeek sites={diveSitesList} heading={t("waiver.scheduledSites")} t={t} />
      </main>
    );
  }

  const { record } = state;
  const recordBookingId = record.bookingId;
  const emergencyContact = recordBookingId
    ? await getEmergencyContactForBooking(db, recordBookingId)
    : await getEmergencyContactForPerson(db, record.shopId, record.personId);
  // The name this release has to be signed under (`completeWaiver` refuses
  // anything else). Shown as the field's hint so the rule is guidance before
  // it is ever a refusal — and it discloses nothing this booking-scoped
  // bearer link doesn't already stand for.
  const [signerOnFile] = await db
    .select({ fullName: people.fullName })
    .from(people)
    .where(eq(people.id, record.personId))
    .limit(1);
  const questionnaire = questionnaireForJurisdiction(shop.jurisdiction);
  const draft = record.draftMedicalAnswers;
  /** Only pre-fill draft answers captured against this same questionnaire. */
  const draftResponses =
    draft &&
    draft.questionnaireId === questionnaire.id &&
    draft.questionnaireVersion === questionnaire.version
      ? draft.responses
      : undefined;
  // The trip this waiver is for (task 42) — named on the page itself so the
  // diver can verify what they're signing for, rather than trusting a link
  // that names only the shop.
  const tripHeader = recordBookingId
    ? await db
        .select({ title: trips.title, startsAt: trips.startsAt, endsAt: trips.endsAt })
        .from(bookings)
        .innerJoin(trips, eq(trips.id, bookings.tripId))
        .where(eq(bookings.id, recordBookingId))
        .limit(1)
        .then((rows) => rows[0] ?? null)
    : null;
  /**
   * The fixed list of questions the diver is handed. The follow-ups their own
   * answers open are deliberately not in it — see `QuestionnaireProgress`.
   */
  const primaryQuestionCount = questionnaire.questions.filter(
    (question) => question.section === "primary",
  ).length;
  /**
   * **Where the saved draft already stands, so the first paint is honest.**
   * `WaiverPacing`'s live count is a delegated listener and cannot see an
   * answer given before it mounted; without these two figures the HTML ships
   * "0 of 3 done" over radios the server has just rendered checked. The page
   * knows both, so it hands them over rather than leaving the client to
   * discover them a bundle later — or, with JavaScript off, never.
   *
   * `remaining - primaryRemaining` is exactly the blanks inside a Box the
   * diver's own yes opened: `medicalProgress` counts *applicable* questions,
   * so a Box nothing opened is not in either figure.
   */
  const draftAnswers: Readonly<Record<string, boolean | undefined>> = draftResponses ?? {};
  const draftProgress = medicalProgress(questionnaire, draftAnswers);
  const draftAnsweredFields = questionnaire.questions
    .filter(
      (question) =>
        question.section === "primary" && typeof draftAnswers[question.id] === "boolean",
    )
    .map((question) => medicalQuestionField(question.id));
  /**
   * **The rail becomes a navigator only after a refusal**, and only for the one
   * segment that owns the refused field. A refused submit lands the reader back
   * at the top of a page whose problem is several hundred pixels down, and the
   * rail is the thing already sitting there. Nothing ever links *forward*: a
   * diver cannot tap "Sign" to skip the release.
   */
  const railAnchors: Partial<Record<WaiverRailSegmentId, string>> = fieldError
    ? fieldError.anchor === "medical-questionnaire"
      ? { medical: fieldError.anchor }
      : { sign: fieldError.anchor }
    : {};
  const errorText =
    error === "invalid" && !signatureCardError
      ? t(fieldError?.textKey ?? "waiver.incomplete")
      : error === "unavailable"
        ? t("waiver.linkInactive")
        : error === "rate"
          ? t("waiver.rateLimited")
          : undefined;

  async function saveDraftAction(formData: FormData) {
    "use server";
    const ip = await clientIp();
    if (
      !(await checkRateLimit(rateLimitKey("waiver-token", ip), RATE_LIMITS.capabilityAction))
        .allowed
    ) {
      redirect(`/waivers/${token}?error=rate`);
    }
    const parsed = signatureSchema.safeParse(Object.fromEntries(formData));
    const answers = readMedicalAnswers(formData, questionnaire, { allowIncomplete: true });
    if (!parsed.success || !answers) {
      const invalidField = firstInvalidWaiverField(
        parsed.success ? new Set() : new Set(parsed.error.issues.map((issue) => issue.path[0])),
        answers,
      );
      redirect(refusedSubmitPath(token, invalidField));
    }
    const db = await getDb();
    // A form the diver themselves just submitted through their own bearer
    // link — first-hand evidence of the language they read (docs ADR
    // 20260731-per-person-notification-locale). Captured on submit and not on
    // the page render above, because a chat app unfurling this URL for a link
    // preview also GETs the page, and that bot's `Accept-Language` is nobody's.
    await recordDiverOwnLocale(db, {
      shopId: record.shopId,
      personId: record.personId,
      locale: await requestFirstHandLocale(),
    });
    const savedDraft = await saveWaiverDraft(db, token, {
      signerName: parsed.data.signerName,
      acknowledged: parsed.data.acknowledged === "on",
      medicalAnswers: answers,
    });
    // Persist the contact now too, so "save and finish later" keeps it — blanks
    // never overwrite what's on file.
    const contact = emergencyContactSchema.safeParse(Object.fromEntries(formData));
    if (savedDraft && contact.success) {
      if (recordBookingId) {
        await saveBookingEmergencyContact(db, {
          shopId: record.shopId,
          bookingId: recordBookingId,
          name: contact.data.emergencyContactName,
          phone: contact.data.emergencyContactPhone,
        });
      } else {
        await savePersonEmergencyContact(db, {
          shopId: record.shopId,
          personId: record.personId,
          name: contact.data.emergencyContactName,
          phone: contact.data.emergencyContactPhone,
        });
      }
    }
    revalidateAndRedirect(
      `/waivers/${token}`,
      `/waivers/${token}${savedDraft ? "?saved=1" : "?error=unavailable"}`,
    );
  }

  async function completeAction(formData: FormData) {
    "use server";
    const ip = await clientIp();
    if (
      !(await checkRateLimit(rateLimitKey("waiver-token", ip), RATE_LIMITS.capabilityAction))
        .allowed
    ) {
      redirect(`/waivers/${token}?error=rate`);
    }
    const parsed = completeSignatureSchema.safeParse(Object.fromEntries(formData));
    const answers = readMedicalAnswers(formData, questionnaire);
    if (!parsed.success || !answers) {
      const invalidField = firstInvalidWaiverField(
        parsed.success ? new Set() : new Set(parsed.error.issues.map((issue) => issue.path[0])),
        answers,
      );
      redirect(refusedSubmitPath(token, invalidField));
    }
    const contact = emergencyContactSchema.safeParse(Object.fromEntries(formData));
    // Same first-hand signal as the draft save above (docs ADR
    // 20260731-per-person-notification-locale) — signing is the strongest
    // version of it, since the diver read and agreed to the whole page.
    await recordDiverOwnLocale(await getDb(), {
      shopId: record.shopId,
      personId: record.personId,
      locale: await requestFirstHandLocale(),
    });
    const outcome = await completeWaiver(await getDb(), token, {
      signerName: parsed.data.signerName,
      agreed: true,
      medicalAnswers: answers,
      // Optional — a diver who skips it still signs; blanks never clobber a
      // value already on file.
      emergencyContact: contact.success
        ? {
            name: contact.data.emergencyContactName,
            phone: contact.data.emergencyContactPhone,
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
      });
      if (contact.success) {
        if (recordBookingId) {
          await saveBookingEmergencyContact(db, {
            shopId: record.shopId,
            bookingId: recordBookingId,
            name: contact.data.emergencyContactName,
            phone: contact.data.emergencyContactPhone,
          });
        } else {
          await savePersonEmergencyContact(db, {
            shopId: record.shopId,
            personId: record.personId,
            name: contact.data.emergencyContactName,
            phone: contact.data.emergencyContactPhone,
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
      redirect(`/waivers/${token}?error=unavailable`);
    }
    await trackEvent({ name: "waiver_signed" });
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

  return (
    <ThreadShell
      shopName={shopName}
      title={t("waiver.beforeDockTitle")}
      meta={
        <>
          <p className="mt-2 text-base text-muted">{t("waiver.beforeDockDescription")}</p>
          {tripHeader ? (
            <p className="mt-3 text-base font-medium text-foreground">
              {t("waiver.tripHeader", {
                trip: tripHeader.title,
                when: formatShortDate(tripHeader.startsAt, locale, shop.timezone),
                time: formatTimeRangeTz(
                  tripHeader.startsAt,
                  tripHeader.endsAt,
                  locale,
                  shop.timezone,
                ),
              })}
            </p>
          ) : null}
        </>
      }
    >
      <FlashParams params={["saved", "error", "field", "at"]} />

      {/* **The step rail, and everything that reads its count** (ADR
          20260827-the-divers-thread, decision 5). `WaiverPacing` wraps from
          here down because the rail sits above the release and the sticky
          questionnaire counter sits inside the form, and both read one count
          off one delegated listener. */}
      <WaiverPacing
        labels={railLabels(t)}
        anchors={railAnchors}
        progressOne={t.raw("waiver.railProgressOne")}
        progressOther={t.raw("waiver.railProgressOther")}
        medicalTotal={primaryQuestionCount}
        initialAnswered={draftAnsweredFields}
        initialFollowUpsRemaining={draftProgress.remaining - draftProgress.primaryRemaining}
        locale={locale}
      >
        {/* **One notice grammar** — the four treatments this page grew, one per
            message, converge on `ShopNotice`: tone tint, status mark, words.
            They stack in one slot above the release rather than scattering down
            the page.

            At most one *flash* has something to say: a refused submit and a
            saved draft arrive on different redirects, and the refusal wins if
            both codes ever land on one URL. A refusal that names a control in
            the signature card is not here at all — its words render beside that
            control and `FieldErrorFocus` below carries the reader to them.

            The English-only note is not a flash; it is a standing fact about
            the document underneath, so it renders alongside whatever the flash
            is saying rather than replacing it, and it is second because a
            refusal is the answer to something the diver just did. */}
        {errorText || saved || locale !== DEFAULT_DIVER_LOCALE ? (
          <div className="mt-6 flex flex-col gap-3">
            {errorText ? (
              <ShopNotice tone="danger" role="alert">
                {errorText}{" "}
                {fieldError ? (
                  <a href={`#${fieldError.anchor}`} className="underline underline-offset-2">
                    {t("waiver.errorJumpToField")}
                  </a>
                ) : null}
              </ShopNotice>
            ) : saved ? (
              <ShopNotice tone="success">{t("waiver.progressSaved")}</ShopNotice>
            ) : null}
            {locale !== DEFAULT_DIVER_LOCALE ? (
              <ShopNotice tone="warning">{t("waiver.englishOnlyNotice")}</ShopNotice>
            ) : null}
          </div>
        ) : null}
        {/* The refusal redirect lands the reader back at the top of a long page;
            this scrolls them to the refused control, focuses it, and rings it
            briefly — and the control's own error text (rendered beside it, per
            docs/design/forms-and-controls.md) is waiting there to say why. Keyed
            on the submit's nonce so an identical repeat refusal remounts and
            re-fires. Only for refusals that name a real control: "medical" names
            a whole section, and focusing eleven fieldsets at once helps nobody —
            the banner's jump link handles that one. */}
        {signatureCardError ? (
          <FieldErrorFocus
            key={`${signatureCardError.anchor}:${at ?? ""}`}
            field={signatureCardError.anchor}
          />
        ) : null}

        {/* The release reads as a document, not a widget: no card, no box — a
            quiet titled rule above, the text set at reading size, a closing rule
            below. The form after it is where the boxes are, so "read this" and
            "do this" stop looking like the same component. */}
        <section className="mt-8">
          <p className="border-b border-border pb-3 text-sm font-medium text-muted">
            {t("waiver.templateVersion", {
              title: record.templateTitle,
              version: record.templateVersion,
            })}
          </p>
          {/* `wrap-anywhere`, not just `whitespace-pre-wrap`. A shop's waiver text
              is pasted in, usually out of a PDF or a word processor, and real
              releases carry runs a line break can't fall inside: a signature rule
              of underscores, a policy URL, a long insurer name. `pre-wrap` alone
              only breaks at whitespace, so one of those lays the page out wider
              than the phone it is being signed on — measured at 455px against a
              390px viewport. `body { overflow-x: clip }` then stops the sideways
              scroll but not the widened layout viewport, which is what shows as
              empty space beside the page (2026-08-06 review). */}
          <div
            data-waiver-template-body
            className="mt-4 wrap-anywhere whitespace-pre-wrap border-b border-border pb-8 text-base leading-7"
          >
            {record.templateBody}
          </div>
        </section>

        <form action={completeAction} className="mt-8 flex flex-col gap-10">
          <section id="medical-questionnaire">
            <QuestionnaireProgress
              total={primaryQuestionCount}
              labelTemplateOne={t.raw("waiver.questionsAnsweredOne")}
              labelTemplateOther={t.raw("waiver.questionsAnsweredOther")}
            >
              <SectionHeading>{questionnaire.title}</SectionHeading>
              {/* The published form's directions paragraph used to sit here. It
                  asked the diver to memorise which question numbers carry an
                  asterisk and then apply the rule to their own answers, which is
                  work the page can do for them — `MedicalQuestionnaireFields`
                  now states the outcome underneath the questions at the moment
                  it becomes true (2026-08-06 review). The wording itself is
                  unchanged and still on file in `RSTC_QUESTIONNAIRE.intro`; only
                  where the diver meets it has moved. */}
              <MedicalQuestionnaireFields
                questionnaire={questionnaire}
                initialResponses={draftResponses}
                copy={{
                  yesLabel: t("waiver.answerYes"),
                  noLabel: t("waiver.answerNo"),
                  referralReassurance: t("waiver.yesReassurance"),
                  followUpReassurance: t("waiver.yesOpensFollowUps"),
                  outcomeClear: t("waiver.outcomeClear"),
                  outcomeReferral: t("waiver.outcomeReferral"),
                  outcomeFollowUpsOpen: t("waiver.outcomeFollowUpsOpen"),
                }}
              />
            </QuestionnaireProgress>
          </section>

          {/* No card here: the heading, helper line, and the two fields carry
              the section by themselves (principle 10 — type and space before
              boxes). The one card left in the form is the signature block. */}
          <section>
            <SectionHeading>{t("waiver.emergencyContact")}</SectionHeading>
            {/* Editable whether or not something is on file. It used to go
                read-only the moment a contact existed, on the reasoning that a
                correction was staff work — but this is the one screen a diver
                fills in the week before a trip, and the person they'd name has
                often changed since they booked. `saveBookingEmergencyContact`
                never lets a blank overwrite a stored value, so re-showing the
                fields can only ever improve what the crew has. */}
            {emergencyContact?.name && emergencyContact?.phone ? (
              <p className="mt-2 text-sm text-muted">
                {t("waiver.emergencyOnFile", {
                  name: emergencyContact.name,
                  phone: emergencyContact.phone,
                })}{" "}
                {t("waiver.emergencyContactChangeHint")}
              </p>
            ) : (
              <p className="mt-2 text-sm text-muted">{t("waiver.emergencyContactDescription")}</p>
            )}
            <FieldGrid columns={2} className="mt-4">
              <Field label={t("waiver.contactName")}>
                <input
                  name="emergencyContactName"
                  autoComplete="name"
                  maxLength={120}
                  defaultValue={emergencyContact?.name ?? ""}
                  className={controlClass}
                />
              </Field>
              <Field label={t("waiver.contactPhone")}>
                <input
                  name="emergencyContactPhone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  maxLength={40}
                  defaultValue={emergencyContact?.phone ?? ""}
                  className={controlClass}
                />
              </Field>
            </FieldGrid>
          </section>

          {/* The signature block is the one card in the form — the formal act at
              the end of a paper release gets the same visual weight here. The
              link's own expiry sits in its fine print, next to "Save and finish
              later", because "can I come back to this?" is asked at the moment of
              signing, not while reading the page title.
              No `title` prop: the heading is a `SectionHeading`, and the
              sections have to announce themselves identically whether or not
              one happens to be boxed. `padding="lg"` is the card someone
              works *inside*, and on a phone it is the `p-5` this already had. */}
          <SectionCard padding="lg">
            <SectionHeading>{t("waiver.signature")}</SectionHeading>
            <FieldGrid columns={1} className="mt-4">
              <Field
                label={t("waiver.typeFullName")}
                description={
                  signerOnFile
                    ? t("waiver.typeFullNameHint", { name: signerOnFile.fullName })
                    : undefined
                }
                // The refusal renders on the field it names — `Field` puts the
                // words under the control and wires `aria-invalid` +
                // `aria-describedby` for us — so the reader `FieldErrorFocus`
                // scrolls here finds the reason waiting beside the ringed box,
                // not a ring with its explanation stranded at the top of the
                // page.
                error={
                  signatureCardError?.anchor === "signerName"
                    ? t(signatureCardError.textKey)
                    : undefined
                }
              >
                <input
                  id="signerName"
                  name="signerName"
                  autoComplete="name"
                  required
                  minLength={2}
                  maxLength={120}
                  defaultValue={record.draftSignerName ?? ""}
                  className={controlClass}
                />
              </Field>
            </FieldGrid>
            <label className="mt-4 flex min-h-11 items-center gap-3 text-base">
              <input
                id="acknowledged"
                name="acknowledged"
                type="checkbox"
                value="on"
                required
                defaultChecked={record.draftAcknowledged}
                // The checkbox isn't a `Field`, so its refusal wiring is by
                // hand: the same aria pair `Field`'s `error` prop provides,
                // pointing at the message rendered just below.
                aria-invalid={signatureCardError?.anchor === "acknowledged" ? "true" : undefined}
                aria-describedby={
                  signatureCardError?.anchor === "acknowledged" ? "acknowledged-error" : undefined
                }
                className="size-4 accent-primary"
              />
              <span>{t("waiver.agreementCheckbox")}</span>
            </label>
            {signatureCardError?.anchor === "acknowledged" ? (
              <FormStatus id="acknowledged-error" className="mt-2">
                {t(signatureCardError.textKey)}
              </FormStatus>
            ) : null}
            {/* **One primary** (ADR 20260827-the-divers-thread, decision 5).
                Sign and "Save and finish later" used to share a row as two
                buttons, which on a phone stacked them at inverted weight — the
                bordered secondary above the primary — so the page's one act
                was the second thing a thumb reached. Sign is now the full
                width of the card it belongs to, and saving demotes to a text
                link on the line with the expiry sentence that explains why
                you'd want it. It is still a real submit, so it still works with
                no JavaScript at all. */}
            <SubmitButton
              pendingLabel={t("waiver.signing")}
              className={buttonClass({
                size: "lg",
                className: `mt-6 w-full disabled:opacity-70 ${labelTextBase}`,
              })}
            >
              {t("waiver.signButton")}
            </SubmitButton>
            <p className="mt-4 text-sm text-muted">{t("waiver.signatureNote")}</p>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-muted">
              <button
                type="submit"
                formAction={saveDraftAction}
                // Drafts intentionally accept partial answers — the `required`
                // on signerName/acknowledged (and the pre-existing one on each
                // medical radio) would otherwise let the browser block a
                // legitimate "save what I have so far" submit.
                formNoValidate
                // `link`, flush: reads as inline text and still claims the
                // 44px target `base` bakes in — the wrapper's own answer to
                // "a control that is not the primary act".
                className={buttonClass({ variant: "link", size: "sm", flush: true })}
              >
                {t("waiver.saveForLater")}
              </button>
              <span aria-hidden="true">·</span>
              <span>
                {t("waiver.linkExpiresAt", {
                  date: formatDateTimeTz(record.expiresAt, locale, shop.timezone),
                })}
              </span>
            </div>
          </SectionCard>
        </form>
      </WaiverPacing>
      <p className="mt-8 text-center text-sm text-muted">
        {shop.contactEmail || shop.contactPhone
          ? t.rich("common.needHelpContact", {
              shop: shopName,
              link: (chunks) => (
                <a
                  href={
                    shop.contactEmail
                      ? `mailto:${shop.contactEmail}`
                      : telHref(shop.contactPhone ?? "")
                  }
                  className="font-medium text-primary hover:underline"
                >
                  {chunks}
                </a>
              ),
            })
          : t("common.needHelpPlain", { shop: shopName })}
      </p>
    </ThreadShell>
  );
}

/**
 * What the rescue send actually did, as one-word codes on the URL — the
 * action never puts a sentence (or an address, or a token) in the query
 * string, so this page picks the words in the reader's own language, the same
 * pattern `/ready`'s notices use.
 */
const RESCUE_NOTICES: Record<
  string,
  { tone: "success" | "danger" | "neutral"; key: DiverMessageKey }
> = {
  ok: { tone: "success", key: "waiver.freshLinkSent" },
  signed: { tone: "success", key: "waiver.freshLinkAlreadySigned" },
  // A newer link for this booking is still signable, so nothing was reissued —
  // reissuing would have killed it and taken the diver's saved answers with it.
  // Point them at their inbox without naming the address, same as every other
  // notice on this card.
  live: { tone: "success", key: "waiver.freshLinkCurrentLive" },
  none: { tone: "neutral", key: "waiver.freshLinkNoEmail" },
  unavailable: { tone: "danger", key: "waiver.freshLinkUnavailable" },
  failed: { tone: "danger", key: "waiver.freshLinkFailed" },
  rate: { tone: "danger", key: "waiver.rateLimited" },
};

/**
 * A waiver link that can no longer be signed, with the way out on it. The
 * diver mails themselves a fresh link instead of chasing the shop for one —
 * and because a waiver URL *is* its capability, the replacement is only ever
 * sent to the address already on the booking. The address is never shown or
 * confirmed back here (anyone holding the stale URL is reading this page, so
 * even a masked "n…@…" would be a disclosure), and the new token never
 * reaches this page at all. The shop's own contact details stay underneath as
 * the fallback for the outcomes mail can't fix.
 */
function ExpiredLink({
  token,
  shop,
  t,
  sent,
}: {
  token: string;
  shop: Pick<Shop, "name" | "contactEmail" | "contactPhone">;
  t: DiverTranslator;
  sent?: string;
}) {
  // `Object.hasOwn`, not `RESCUE_NOTICES[sent]` — `sent` is attacker-supplied
  // and a bare lookup walks the prototype (src/lib/staff-notices.ts).
  const notice = noticeFromParam(sent, RESCUE_NOTICES);
  return (
    <ExpiredLinkCard
      title={t("waiver.expiredHeading")}
      text={t("waiver.expiredBody")}
      shop={shop}
      t={t}
    >
      <FlashParams params={["sent"]} />
      {/* The fourth of the four banner treatments this page had grown, and the
          last one to converge (ADR 20260827-the-divers-thread, decision 5): the
          rescue outcome speaks the same notice grammar as the refusal, the
          saved draft and the English-only note, rather than a private tone map
          of its own. */}
      {notice ? (
        <ShopNotice tone={notice.tone} role={noticeRole(notice.tone)}>
          {t(notice.key)}
        </ShopNotice>
      ) : null}
      {/* A signature already on file is the one outcome with nothing left to
          send — offering the button again would only invite a pointless email. */}
      {sent === "signed" ? null : (
        <form action={emailFreshWaiverLinkAction.bind(null, token)}>
          <SubmitButton pendingLabel={t("waiver.sendingFreshLink")} className={buttonClass()}>
            {t("waiver.emailFreshLink")}
          </SubmitButton>
        </form>
      )}
    </ExpiredLinkCard>
  );
}
