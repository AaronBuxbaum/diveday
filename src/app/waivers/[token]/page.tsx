import type { Metadata } from "next";
import Link from "next/link";
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
import { ChoiceRow, controlClass, Field, FieldGrid, FormStatus } from "@/components/ui/form";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import { issueBookingCapability } from "@/db/booking-capabilities";
import { getDb } from "@/db/client";
import { getShopById } from "@/db/shops";
import { getTripDiveSitesPeek } from "@/db/trips";
import { getBookingTripId, getWaiverSignerOnFile, getWaiverTripHeader } from "@/db/waiver-signing";
import {
  getEmergencyContactForBearer,
  getEmergencyContactForPerson,
  getWaiverForToken,
  staleWaiverRecordForToken,
} from "@/db/waivers";
import { fill, pluralForm } from "@/i18n/fill";
import { diverGuardianRelationshipOptions } from "@/i18n/guardian-labels";
import { type DiverTranslator, diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { DEFAULT_DIVER_LOCALE } from "@/i18n/settings";
import { readinessLinkPath } from "@/lib/booking-capabilities";
import { nowDate } from "@/lib/clock";
import { telHref } from "@/lib/contact-links";
import { formatDateTimeTz, formatShortDate, formatTimeRangeTz } from "@/lib/format";
import { guardianSignatureRequired, signingDate } from "@/lib/guardian";
import { medicalProgress, medicalQuestionField, questionnaireForJurisdiction } from "@/lib/medical";
import { connectionForRoute } from "@/lib/observability/render-connection";
import { isUnresolvedMedicalHold } from "@/lib/waivers";
import { completeWaiverAction, saveWaiverDraftAction } from "./actions";
import { MedicalQuestionnaireFields } from "./MedicalQuestionnaireFields";
import { QuestionnaireProgress } from "./QuestionnaireProgress";
import { ExpiredLink, HeldWaiverCard } from "./WaiverDoorCards";
import { WaiverPacing } from "./WaiverPacing";
import {
  WAIVER_RAIL_TOTAL,
  type WaiverRailSegmentId,
  WaiverStepRail,
  waiverRailProgress,
} from "./WaiverStepRail";
import { WAIVER_FIELD_ERROR, type WaiverInvalidField } from "./waiver-fields";

export async function generateMetadata(): Promise<Metadata> {
  const t = diverTranslator(await requestLocale());
  return {
    title: t("waiver.metaTitle"),
    robots: { index: false, follow: false },
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
  return <h2 className={SECTION_TITLE_CLASS}>{children}</h2>;
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
  await connectionForRoute("/waivers/[token]");
  const { token } = await params;
  // `at` is the refusal's own nonce, minted by the actions below on every refused submit. It
  // exists so a *repeat* of the identical refusal (same wrong name twice) still remounts
  // `FieldErrorFocus` and re-runs the scroll-and-ring — without it the second attempt renders an
  // unchanged tree and the effect never fires again (see FieldErrorFocus's own docstring).
  const { saved, error, field, sent, at } = await searchParams;
  // `Object.hasOwn`, not `in` — `field` is attacker-supplied and `in` walks
  // the prototype chain (`?field=toString` would mint a fieldError whose
  // anchor is a built-in function).
  const fieldError =
    error === "invalid" && field && Object.hasOwn(WAIVER_FIELD_ERROR, field)
      ? WAIVER_FIELD_ERROR[field as WaiverInvalidField]
      : undefined;
  // A refusal that names a control renders *beside that control* (Field
  // `error` / the line under the checkbox), never as a page banner — the rule
  // in docs/design/forms-and-controls.md. That is the signature card, the
  // guardian's card, and the emergency contact's two boxes. The banner below
  // keeps only what has no single control to sit with: the medical section,
  // the generic incomplete, and the link-level refusals.
  const namedFieldError =
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
  if (state.state === "held") return <HeldWaiverCard shop={shop} t={t} />;

  if (state.state === "completed") {
    // A diver revisiting their own still-live link after a physician cleared
    // them was told a doctor still had to confirm — one surface saying "held"
    // while every staff surface said cleared (issue #1252, security review N1).
    const needsReview = isUnresolvedMedicalHold(state.record);
    const bookingId = state.record.bookingId;
    const bookingTripId = bookingId ? await getBookingTripId(db, bookingId) : null;

    const diveSitesList = bookingTripId ? await getTripDiveSitesPeek(db, bookingTripId) : [];

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
    ? await getEmergencyContactForBearer(db, recordBookingId)
    : await getEmergencyContactForPerson(db, record.shopId, record.personId);
  // The name this release has to be signed under (`completeWaiver` refuses
  // anything else). Shown as the field's hint so the rule is guidance before
  // it is ever a refusal — and it discloses nothing this booking-scoped
  // bearer link doesn't already stand for.
  const signerOnFile = await getWaiverSignerOnFile(db, record.personId);
  /**
   * **A minor signs twice** (ADR 20260907-guardian-co-signature). Decided from
   * the date of birth the shop holds, on the shop's calendar day this page is
   * being signed — the same rule `completeWaiver` refuses on, so the section
   * is never rendered for a diver the writer would not ask, and never absent
   * for one it would. No date on file reads as an adult (H-08's fail-open).
   */
  const guardianRequired = guardianSignatureRequired(
    signerOnFile?.dateOfBirth,
    signingDate(nowDate(), shop.timezone),
  );
  const draftGuardian = record.draftGuardian;
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
  const tripHeader = recordBookingId ? await getWaiverTripHeader(db, recordBookingId) : null;
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
    error === "invalid" && !namedFieldError
      ? t(fieldError?.textKey ?? "waiver.incomplete")
      : error === "unavailable"
        ? t("waiver.linkInactive")
        : error === "rate"
          ? t("waiver.rateLimited")
          : undefined;

  /**
   * **One primary** (ADR 20260827-the-divers-thread, decision 5). Sign and
   * "Save and finish later" used to share a row as two buttons, which on a
   * phone stacked them at inverted weight — the bordered secondary above the
   * primary — so the page's one act was the second thing a thumb reached. Sign
   * is the full width of the card it belongs to, and saving demotes to a text
   * link on the line with the expiry sentence that explains why you'd want it.
   * It is still a real submit, so it still works with no JavaScript at all.
   *
   * Rendered once, in the **last** card: the diver's signature card for an
   * adult, the guardian's card for a minor (ADR 20260907-guardian-co-signature).
   */
  const signBlock = (
    <>
      <SubmitButton
        pendingLabel={t("waiver.signing")}
        className={buttonClass({
          className: `mt-6 w-full disabled:opacity-70 ${labelTextBase}`,
        })}
      >
        {t("waiver.signButton")}
      </SubmitButton>
      <p className="mt-4 text-sm text-muted">{t("waiver.signatureNote")}</p>
      {/* Two facts on one line from `sm`, split by the dot; stacked below it,
          with no dot. The row used to wrap, and the wrap fell after the dot:
          "Save and finish later ·" on one line at 390, the expiry alone on
          the next (K-340). It never wraps now — from `sm` a sentence too long
          for the line (the Spanish pair all but fills the 478px card)
          wraps inside its own span beside the link, which does not shrink.
          From `sm` the link ends the card, and the unseen half of its 44px
          box sank into the card's padding instead of adding to it: 38px under
          these words against 30px over the heading (K-493). The row lines its
          words up by their baseline, which the pulled-up margin cannot move;
          below `sm` the expiry sits under the link, so the box stays whole. */}
      <div className="mt-1 flex items-baseline gap-x-2 text-sm text-muted max-sm:flex-col max-sm:items-start">
        <button
          type="submit"
          formAction={saveWaiverDraftAction.bind(null, token)}
          // Drafts intentionally accept partial answers — the `required`
          // on signerName/acknowledged (and the pre-existing one on each
          // medical radio) would otherwise let the browser block a
          // legitimate "save what I have so far" submit.
          formNoValidate
          // `link`, flush: reads as inline text and still claims the
          // 44px target `base` bakes in — the wrapper's own answer to
          // "a control that is not the primary act".
          className={buttonClass({
            variant: "link",
            size: "sm",
            flush: true,
            outdent: "block-end-wide",
            className: "shrink-0",
          })}
        >
          {t("waiver.saveForLater")}
        </button>
        <span aria-hidden="true" className="max-sm:hidden">
          ·
        </span>
        <span>
          {t("waiver.linkExpiresAt", {
            date: formatDateTimeTz(record.expiresAt, locale, shop.timezone),
          })}
        </span>
      </div>
    </>
  );

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
        {namedFieldError ? (
          <FieldErrorFocus
            key={`${namedFieldError.anchor}:${at ?? ""}`}
            field={namedFieldError.anchor}
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

        <form action={completeWaiverAction.bind(null, token)} className="mt-8 flex flex-col gap-10">
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
                {/* The number is set whole: it broke after "+1-305-555-" at 390
                    (K-257). A `nowrap` span, never non-breaking hyphens, so a
                    number copied off the page still dials; the bundle glues the
                    dot before it to both sides. */}
                {t.rich("waiver.emergencyOnFile", {
                  name: emergencyContact.name,
                  phone: emergencyContact.phone,
                  nowrap: (chunks) => <span className="whitespace-nowrap">{chunks}</span>,
                })}{" "}
                {t("waiver.emergencyContactChangeHint")}
              </p>
            ) : (
              <p className="mt-2 text-sm text-muted">{t("waiver.emergencyContactDescription")}</p>
            )}
            {/* A half-filled pair is refused on the empty box, in the same
                shape as every other refusal on this page: the words under the
                control the reader was just sent to, not a banner at the top. */}
            <FieldGrid columns={2} className="mt-4">
              <Field
                label={t("waiver.contactName")}
                error={
                  namedFieldError?.anchor === "emergencyContactName"
                    ? t(namedFieldError.textKey)
                    : undefined
                }
              >
                <input
                  id="emergencyContactName"
                  name="emergencyContactName"
                  autoComplete="name"
                  maxLength={120}
                  defaultValue={emergencyContact?.name ?? ""}
                  className={controlClass}
                />
              </Field>
              <Field
                label={t("waiver.contactPhone")}
                error={
                  namedFieldError?.anchor === "emergencyContactPhone"
                    ? t(namedFieldError.textKey)
                    : undefined
                }
              >
                <input
                  id="emergencyContactPhone"
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
                  namedFieldError?.anchor === "signerName" ? t(namedFieldError.textKey) : undefined
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
            <ChoiceRow
              type="checkbox"
              id="acknowledged"
              name="acknowledged"
              value="on"
              required
              defaultChecked={record.draftAcknowledged}
              // The checkbox isn't a `Field`, so its refusal wiring is by
              // hand: the same aria pair `Field`'s `error` prop provides,
              // pointing at the message rendered just below.
              aria-invalid={namedFieldError?.anchor === "acknowledged" ? "true" : undefined}
              aria-describedby={
                namedFieldError?.anchor === "acknowledged" ? "acknowledged-error" : undefined
              }
              // Last in the card when the guardian's card carries the Sign
              // button, and then its target's unseen half sat under the
              // agreement, 37px to the border against 30px over the heading
              // (K-493). It gives that half back only while it ends the card.
              outdent="block-end"
              className="mt-4 text-base"
            >
              {t("waiver.agreementCheckbox")}
            </ChoiceRow>
            {namedFieldError?.anchor === "acknowledged" ? (
              <FormStatus id="acknowledged-error" className="mt-2">
                {t(namedFieldError.textKey)}
              </FormStatus>
            ) : null}
            {guardianRequired ? null : signBlock}
          </SectionCard>

          {/* **The guardian's card** (ADR 20260907-guardian-co-signature): the
              second signature a minor's release takes, in the same shape as
              the first — a typed name, a consent box, the same fine print —
              plus who they are to the diver and how to reach them. It carries
              the page's one Sign button whenever it renders, so the last thing
              on the page is still the act, and nobody signs above a section
              they have not read. */}
          {guardianRequired ? (
            <SectionCard padding="lg">
              <SectionHeading>{t("waiver.guardianHeading")}</SectionHeading>
              <p className="mt-2 text-sm text-muted">
                {t("waiver.guardianIntro", { name: signerOnFile?.fullName ?? "" })}
              </p>
              <FieldGrid columns={2} className="mt-4">
                <Field
                  label={t("waiver.guardianName")}
                  error={
                    namedFieldError?.anchor === "guardianName"
                      ? t(namedFieldError.textKey)
                      : undefined
                  }
                >
                  <input
                    id="guardianName"
                    name="guardianName"
                    autoComplete="off"
                    required
                    minLength={2}
                    maxLength={120}
                    defaultValue={draftGuardian?.name ?? ""}
                    className={controlClass}
                  />
                </Field>
                <Field
                  label={t("waiver.guardianEmail")}
                  // Optional since issue #1453, and the description says what
                  // giving one buys — an address collected under no stated
                  // purpose is the wrong end of the promise.
                  description={t("waiver.guardianEmailDescription")}
                  error={
                    namedFieldError?.anchor === "guardianEmail"
                      ? t(namedFieldError.textKey)
                      : undefined
                  }
                >
                  <input
                    id="guardianEmail"
                    name="guardianEmail"
                    type="email"
                    inputMode="email"
                    autoComplete="off"
                    maxLength={200}
                    defaultValue={draftGuardian?.email ?? ""}
                    className={controlClass}
                  />
                </Field>
              </FieldGrid>
              <FieldGrid columns={1} className="mt-4">
                <Field
                  label={t("waiver.guardianRelationship", {
                    name: signerOnFile?.fullName ?? "",
                  })}
                  error={
                    namedFieldError?.anchor === "guardianRelationship"
                      ? t(namedFieldError.textKey)
                      : undefined
                  }
                >
                  <select
                    id="guardianRelationship"
                    name="guardianRelationship"
                    required
                    defaultValue={draftGuardian?.relationship ?? ""}
                    className={controlClass}
                  >
                    <option value="" disabled>
                      {t("waiver.guardianRelationshipChoose")}
                    </option>
                    {diverGuardianRelationshipOptions(t).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </FieldGrid>
              <ChoiceRow
                type="checkbox"
                id="guardianAcknowledged"
                name="guardianAcknowledged"
                value="on"
                required
                // Kept across a refusal, like the diver's own box above: a
                // family that hit one refusal should not have to re-read and
                // re-tick the agreement to try the next answer.
                defaultChecked={draftGuardian?.acknowledged ?? false}
                aria-invalid={
                  namedFieldError?.anchor === "guardianAcknowledged" ? "true" : undefined
                }
                aria-describedby={
                  namedFieldError?.anchor === "guardianAcknowledged"
                    ? "guardianAcknowledged-error"
                    : undefined
                }
                className="mt-4 text-base"
              >
                {t("waiver.guardianAgreementCheckbox")}
              </ChoiceRow>
              {namedFieldError?.anchor === "guardianAcknowledged" ? (
                <FormStatus id="guardianAcknowledged-error" className="mt-2">
                  {t(namedFieldError.textKey)}
                </FormStatus>
              ) : null}
              {signBlock}
            </SectionCard>
          ) : null}
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
