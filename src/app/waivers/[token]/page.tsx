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
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { issueBookingCapability } from "@/db/booking-capabilities";
import { getDb } from "@/db/client";
import { recordDiverOwnLocale } from "@/db/people";
import { bookings, type MedicalAnswers, type Shop, trips } from "@/db/schema";
import { getShopById } from "@/db/shops";
import { getTripDiveSitesPeek } from "@/db/trips";
import {
  completeWaiver,
  getEmergencyContactForBooking,
  getWaiverForToken,
  requireTokenBookingId,
  saveBookingEmergencyContact,
  saveWaiverDraft,
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

type WaiverInvalidField = "medical" | "signerName" | "acknowledged";

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

/** Copy and same-page anchor for each field a fallback submit can name as missing. */
const WAIVER_FIELD_ERROR: Record<WaiverInvalidField, { textKey: DiverMessageKey; anchor: string }> =
  {
    medical: { textKey: "waiver.errorMedical", anchor: "medical-questionnaire" },
    signerName: { textKey: "waiver.errorName", anchor: "signerName" },
    acknowledged: { textKey: "waiver.errorAgreement", anchor: "acknowledged" },
  };

/** Reads every question's yes/no answer for the presented questionnaire. */
function readMedicalAnswers(
  formData: FormData,
  questionnaire: MedicalQuestionnaire,
): MedicalAnswers | null {
  const responses: Record<string, boolean> = {};
  for (const question of questionnaire.questions) {
    const value = formData.get(`q_${question.id}`);
    if (value !== "yes" && value !== "no") return null;
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
 * No default answer: `yes` is `undefined` until a draft or a previous
 * selection actually set one, and neither radio starts checked in that case
 * — the diver must make a conscious choice on every question, including the
 * medical ones, rather than silently inherit a "No" the page picked for them.
 * "Yes" renders before "No" to match the paper RSTC form's own order.
 *
 * The reassurance line under a "Yes" answer (task 41) is pure CSS, not a
 * Client Component: `group` on the fieldset plus `group-has-[…]:` on the
 * paragraph reveals it exactly when that question's "Yes" radio is checked
 * — by a click, or by `defaultChecked` prefilling a draft answer on load —
 * with no JS required and nothing to hydrate.
 */
function RadioQuestion({
  name,
  question,
  yes,
  reassurance,
}: {
  name: string;
  question: string;
  yes: boolean | undefined;
  reassurance: string;
}) {
  return (
    <fieldset className="group rounded-lg border border-border bg-surface p-4">
      <legend className="px-1 text-base font-medium">{question}</legend>
      <div className="mt-3 flex gap-3">
        <label className="flex min-h-11 items-center gap-2 rounded-lg border border-border px-4 text-base hover:bg-surface-sunken">
          <input type="radio" name={name} value="yes" defaultChecked={yes === true} required />
          Yes
        </label>
        <label className="flex min-h-11 items-center gap-2 rounded-lg border border-border px-4 text-base hover:bg-surface-sunken">
          <input type="radio" name={name} value="no" defaultChecked={yes === false} required />
          No
        </label>
      </div>
      <p className="mt-3 hidden text-sm text-muted group-has-[input[value=yes]:checked]:block">
        {reassurance}
      </p>
    </fieldset>
  );
}

// Bearer-token page (the URL is the capability, docs/engineering/
// capability-telemetry-runbook.md) — reads `params`/`searchParams`/
// `requestLocale()` unguarded, genuinely request-scoped, not in scope for
// the "use cache" hoist. See the shop layout's `instant = false` comment
// (src/app/shop/[shopSlug]/layout.tsx) for what this does and doesn't do.
export const instant = false;

export default async function WaiverPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ saved?: string; error?: string; field?: string }>;
}) {
  await connection();
  const { token } = await params;
  const { saved, error, field } = await searchParams;
  const fieldError =
    error === "invalid" && field && field in WAIVER_FIELD_ERROR
      ? WAIVER_FIELD_ERROR[field as WaiverInvalidField]
      : undefined;
  const db = await getDb();
  // A dead or expired link resolves no shop, so there is no
  // `shops.default_locale` to fall back to — negotiate from the visitor's own
  // device alone for those branches.
  const anonT = diverTranslator(await requestLocale());
  const state = await getWaiverForToken(db, token);

  if (state.state === "unavailable") {
    // No record at all reached through this token (garbage, or a link
    // superseded by a fresher one) — there is no shop to attribute it to
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
    return (
      <Unavailable
        title={t("waiver.expiredHeading")}
        text={t("waiver.expiredBody")}
        shop={shop}
        t={t}
      />
    );
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
        />
      </main>
    );
  }

  const { record } = state;
  const recordBookingId = requireTokenBookingId(record);
  const emergencyContact = await getEmergencyContactForBooking(db, recordBookingId);
  const questionnaire = questionnaireForJurisdiction(shop.jurisdiction);
  const draft = record.draftMedicalAnswers;
  /** Only pre-fill draft answers captured against this same questionnaire. */
  const draftResponses =
    draft && draft.questionnaireId === questionnaire.id ? draft.responses : undefined;
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
    error === "invalid"
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
    const answers = readMedicalAnswers(formData, questionnaire);
    if (!parsed.success || !answers) {
      const invalidField = firstInvalidWaiverField(
        parsed.success ? new Set() : new Set(parsed.error.issues.map((issue) => issue.path[0])),
        answers,
      );
      redirect(`/waivers/${token}?error=invalid${invalidField ? `&field=${invalidField}` : ""}`);
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
      redirect(`/waivers/${token}?error=invalid${invalidField ? `&field=${invalidField}` : ""}`);
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
      redirect(
        `/waivers/${token}?error=${outcome.reason === "invalid_signature" ? "invalid" : "unavailable"}`,
      );
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
      <FlashParams params={["saved", "error", "field"]} />
      <header>
        <p className="text-sm font-medium tracking-widest text-primary uppercase">{shopName}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-balance">
          {t("waiver.beforeDockTitle")}
        </h1>
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
        <p className="mt-2 text-sm text-muted">
          {t("waiver.linkExpiresAt", {
            date: formatDateTimeTz(record.expiresAt, locale, shop.timezone),
          })}
        </p>
      </header>

      {saved ? (
        <p
          role="status"
          className="mt-6 rounded-lg bg-success/10 px-4 py-3 text-sm font-medium text-success"
        >
          {t("waiver.progressSaved")}
        </p>
      ) : null}
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
      ) : null}

      {locale !== DEFAULT_DIVER_LOCALE ? (
        <p className="mt-6 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
          {t("waiver.englishOnlyNotice")}
        </p>
      ) : null}

      <section className="mt-8 rounded-lg border border-border bg-surface p-5">
        <p className="text-sm font-medium text-muted">
          {t("waiver.templateVersion", {
            title: record.templateTitle,
            version: record.templateVersion,
          })}
        </p>
        <div className="mt-3 whitespace-pre-wrap text-base leading-7">{record.templateBody}</div>
      </section>

      <form action={completeAction} className="mt-8 flex flex-col gap-6">
        <section id="medical-questionnaire">
          <QuestionnaireProgress
            total={questionnaire.questions.length}
            labelTemplate={t("waiver.questionsAnswered")}
          >
            <h2 className="text-lg font-semibold">{questionnaire.title}</h2>
            <p className="mt-1 text-sm text-muted">{questionnaire.intro}</p>
            <div className="mt-4 flex flex-col gap-3">
              {questionnaire.questions.map((question) => (
                <RadioQuestion
                  key={question.id}
                  name={`q_${question.id}`}
                  yes={draftResponses?.[question.id]}
                  question={question.prompt}
                  reassurance={t("waiver.yesReassurance")}
                />
              ))}
            </div>
          </QuestionnaireProgress>
        </section>

        <section className="rounded-lg border border-border bg-surface p-5">
          <h2 className="text-lg font-semibold">{t("waiver.emergencyContact")}</h2>
          {emergencyContact?.name && emergencyContact?.phone ? (
            // Already on file — most often captured on /ready a moment earlier,
            // since both surfaces write through the same
            // `saveBookingEmergencyContact`. Shown read-only rather than a
            // second differently-labeled capture form (UX persona Lens 17, task
            // 143); a wrong entry is corrected by staff from here on (task 144).
            <p className="mt-1 text-sm text-muted">
              {t("waiver.emergencyOnFile", {
                name: emergencyContact.name,
                phone: emergencyContact.phone,
              })}
            </p>
          ) : (
            <>
              <p className="mt-1 text-sm text-muted">{t("waiver.emergencyContactDescription")}</p>
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
            </>
          )}
        </section>

        <section className="rounded-lg border border-border bg-surface p-5">
          <h2 className="text-lg font-semibold">{t("waiver.signature")}</h2>
          <FieldGrid columns={1} className="mt-4">
            <Field label={t("waiver.typeFullName")}>
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
              className="size-4 accent-primary"
            />
            <span>{t("waiver.agreementCheckbox")}</span>
          </label>
          <p className="mt-3 text-sm text-muted">{t("waiver.signatureNote")}</p>
        </section>

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
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
 * The dead-link card (unavailable or expired). `shop`/`t` are only present
 * when the token resolved to a real record (task 45) — an "unavailable"
 * token that matched nothing at all has no shop to attribute it to, so that
 * branch still renders without contact links, by design.
 */
function Unavailable({
  title,
  text,
  shop,
  t,
}: {
  title: string;
  text: string;
  shop?: Pick<Shop, "name" | "contactEmail" | "contactPhone">;
  t?: DiverTranslator;
}) {
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-6 py-16">
      <section className="rounded-lg border border-border bg-surface p-7 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-3 text-muted">{text}</p>
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
