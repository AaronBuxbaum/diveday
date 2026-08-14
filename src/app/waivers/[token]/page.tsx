import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { z } from "zod";
import { DiveSitesPeek } from "@/components/DiveSitesPeek";
import { EarnedMoment } from "@/components/EarnedMoment";
import { FlashParams } from "@/components/FlashParams";
import { SubmitButton } from "@/components/SubmitButton";
import { TokenPageHeader } from "@/components/TokenPageHeader";
import { buttonClass } from "@/components/ui/button";
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
  getWaiverForToken,
  requireTokenBookingId,
  saveBookingEmergencyContact,
  saveWaiverDraft,
  staleWaiverRecordForToken,
} from "@/db/waivers";
import { type DiverMessageKey, type DiverTranslator, diverTranslator } from "@/i18n/messages";
import { requestFirstHandLocale, requestLocale } from "@/i18n/request";
import { DEFAULT_DIVER_LOCALE } from "@/i18n/settings";
import { trackEvent } from "@/lib/analytics";
import { readinessLinkPath } from "@/lib/booking-capabilities";
import { emergencyContactSchema } from "@/lib/contact";
import { telHref } from "@/lib/course-inquiry";
import { formatDateTimeTz, formatShortDate, formatTimeRangeTz } from "@/lib/format";
import type { MedicalQuestionnaire } from "@/lib/medical";
import { questionnaireForJurisdiction } from "@/lib/medical";
import { revalidateAndRedirect } from "@/lib/navigation";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";
import { noticeFromParam, noticeRole } from "@/lib/staff-notices";
import { emailFreshWaiverLinkAction } from "./actions";
import { MedicalQuestionnaireFields } from "./MedicalQuestionnaireFields";
import { QuestionnaireProgress } from "./QuestionnaireProgress";

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
    const value = formData.get(`q_${question.id}`);
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
 * The step markers that make "do this" read differently from "read this": the
 * release above the form is an unboxed document, and each thing the diver
 * actually acts on — health check, emergency contact, signature — announces
 * itself as a numbered step. The number is decorative (`aria-hidden`); the
 * heading text is what assistive tech reads, so the published questionnaire
 * title passes through unreworded.
 */
function StepHeading({ number, children }: { number: number; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden="true"
        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary tabular-nums"
      >
        {number}
      </span>
      <h2 className="text-lg font-semibold">{children}</h2>
    </div>
  );
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
      <Unavailable
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
      <Unavailable
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
    const bookingId = requireTokenBookingId(state.record);
    const booking = await db
      .select({ tripId: bookings.tripId })
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .limit(1)
      .then((rows) => rows[0]);

    const diveSitesList = booking?.tripId ? await getTripDiveSitesPeek(db, booking.tripId) : [];

    const readyCapability = await issueBookingCapability(db, {
      shopId: state.record.shopId,
      bookingId,
      purpose: "readiness",
    });
    const readyPath = readyCapability ? readinessLinkPath(readyCapability.token) : null;
    return (
      <main className="mx-auto w-full max-w-xl flex-1 px-6 py-16">
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

        <DiveSitesPeek
          sites={diveSitesList}
          heading={t("waiver.scheduledSites")}
          subheading={t("waiver.sitesPeek")}
          t={t}
        />
      </main>
    );
  }

  const { record } = state;
  const recordBookingId = requireTokenBookingId(record);
  const emergencyContact = await getEmergencyContactForBooking(db, recordBookingId);
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
  const tripHeader = await db
    .select({ title: trips.title, startsAt: trips.startsAt, endsAt: trips.endsAt })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(eq(bookings.id, recordBookingId))
    .limit(1)
    .then((rows) => rows[0] ?? null);
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
      await saveBookingEmergencyContact(db, {
        shopId: record.shopId,
        bookingId: recordBookingId,
        name: contact.data.emergencyContactName,
        phone: contact.data.emergencyContactPhone,
      });
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
        await saveBookingEmergencyContact(db, {
          shopId: record.shopId,
          bookingId: recordBookingId,
          name: contact.data.emergencyContactName,
          phone: contact.data.emergencyContactPhone,
        });
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
    const readyCapability = await issueBookingCapability(db, {
      shopId: record.shopId,
      bookingId: recordBookingId,
      purpose: "readiness",
    });
    const readyPath = readyCapability ? readinessLinkPath(readyCapability.token) : null;
    revalidateAndRedirect(`/waivers/${token}`, readyPath ?? `/waivers/${token}`);
  }

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-6 py-10 sm:py-16">
      <FlashParams params={["saved", "error", "field", "at"]} />
      <TokenPageHeader eyebrow={shopName} title={t("waiver.beforeDockTitle")}>
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
      </TokenPageHeader>

      {/* One flash surface, never a stack. A refused submit and a saved draft
          arrive on different redirects, so at most one has something to say —
          and the refusal wins if both codes ever land on one URL. A refusal
          that names a control in the signature card is not here at all: its
          words render beside that control and `FieldErrorFocus` below carries
          the reader to them. The English-only note is not a flash either; it
          sits with the document it is about, below. */}
      {errorText ? (
        <p
          id="waiver-error"
          role="alert"
          className="mt-6 rounded-lg bg-danger/10 px-4 py-3 text-sm font-medium text-danger"
        >
          {errorText}{" "}
          {fieldError ? (
            <a href={`#${fieldError.anchor}`} className="underline underline-offset-2">
              {t("waiver.errorJumpToField")}
            </a>
          ) : null}
        </p>
      ) : saved ? (
        <p
          role="status"
          className="mt-6 rounded-lg bg-success/10 px-4 py-3 text-sm font-medium text-success"
        >
          {t("waiver.progressSaved")}
        </p>
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
      <section className="mt-10">
        <p className="border-b border-border pb-3 text-sm font-medium text-muted">
          {t("waiver.templateVersion", {
            title: record.templateTitle,
            version: record.templateVersion,
          })}
        </p>
        {locale !== DEFAULT_DIVER_LOCALE ? (
          // Attached to the document it is about — the reader meets the "this
          // text is English-only" warning at the top of the English text, not
          // as a third bar stacked under the page title.
          <p className="mt-4 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
            {t("waiver.englishOnlyNotice")}
          </p>
        ) : null}
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
            total={
              questionnaire.questions.filter((question) => question.section === "primary").length
            }
            labelTemplate={t.raw("waiver.questionsAnswered")}
          >
            <StepHeading number={1}>{questionnaire.title}</StepHeading>
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
                dentalHeading: t("waiver.dentalHeading"),
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
          <StepHeading number={2}>{t("waiver.emergencyContact")}</StepHeading>
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
            signing, not while reading the page title. */}
        <section className="rounded-xl border border-border bg-surface p-5">
          <StepHeading number={3}>{t("waiver.signature")}</StepHeading>
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
          {/* The actions live in the signature block — signing is what this
              card is, so its button belongs on it (principle 10: actions ride
              on their objects), and "Save and finish later" sits beside the
              expiry fine print that explains why you'd want it. */}
          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="submit"
              formAction={saveDraftAction}
              // Drafts intentionally accept partial answers — the new
              // `required` on signerName/acknowledged (and the pre-existing
              // one on each medical radio) would otherwise let the browser
              // block a legitimate "save what I have so far" submit.
              formNoValidate
              className={buttonClass({
                variant: "secondary",
                className: `text-(color:--color-foreground) ${labelTextBase}`,
              })}
            >
              {t("waiver.saveForLater")}
            </button>
            <SubmitButton
              pendingLabel={t("waiver.signing")}
              className={buttonClass({
                size: "lg",
                className: `disabled:opacity-70 ${labelTextBase}`,
              })}
            >
              {t("waiver.signButton")}
            </SubmitButton>
          </div>
          <p className="mt-4 text-sm text-muted">{t("waiver.signatureNote")}</p>
          <p className="mt-1 text-sm text-muted">
            {t("waiver.linkExpiresAt", {
              date: formatDateTimeTz(record.expiresAt, locale, shop.timezone),
            })}
          </p>
        </section>
      </form>
      <p className="mt-8 text-center text-sm text-muted">
        {shop.contactEmail || shop.contactPhone
          ? t.rich("waiver.needHelpContact", {
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
          : t("waiver.needHelpPlain", { shop: shopName })}
      </p>
    </main>
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

const NOTICE_TONE: Record<"success" | "danger" | "neutral", string> = {
  success: "bg-success/10 text-success",
  danger: "bg-danger/10 text-danger",
  neutral: "bg-surface-sunken text-muted",
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
    <Unavailable
      title={t("waiver.expiredHeading")}
      text={t("waiver.expiredBody")}
      shop={shop}
      t={t}
    >
      <FlashParams params={["sent"]} />
      {notice ? (
        <p
          role={noticeRole(notice.tone)}
          className={`mt-4 rounded-lg px-4 py-3 text-sm font-medium ${NOTICE_TONE[notice.tone]}`}
        >
          {t(notice.key)}
        </p>
      ) : null}
      {/* A signature already on file is the one outcome with nothing left to
          send — offering the button again would only invite a pointless email. */}
      {sent === "signed" ? null : (
        <form action={emailFreshWaiverLinkAction.bind(null, token)} className="mt-5">
          <SubmitButton pendingLabel={t("waiver.sendingFreshLink")} className={buttonClass()}>
            {t("waiver.emailFreshLink")}
          </SubmitButton>
        </form>
      )}
    </Unavailable>
  );
}

/**
 * The dead-link card (unavailable or expired). `shop`/`t` are only present
 * when the token resolved to a real record (task 45) — an "unavailable"
 * token that matched nothing at all has no shop to attribute it to, so that
 * branch still renders without contact links, by design. `children` is where
 * a card that can offer a way forward puts it, above the contact fallback.
 */
function Unavailable({
  title,
  text,
  shop,
  t,
  children,
}: {
  title: string;
  text: string;
  shop?: Pick<Shop, "name" | "contactEmail" | "contactPhone">;
  t?: DiverTranslator;
  children?: React.ReactNode;
}) {
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-6 py-16">
      <section className="rounded-lg border border-border bg-surface p-7 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-3 text-muted">{text}</p>
        {children}
        {shop && t ? (
          <p className="mt-4 text-sm text-muted">
            {shop.contactEmail || shop.contactPhone
              ? t.rich("waiver.needHelpContact", {
                  shop: shop.name,
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
              : t("waiver.needHelpPlain", { shop: shop.name })}
          </p>
        ) : null}
      </section>
    </main>
  );
}
