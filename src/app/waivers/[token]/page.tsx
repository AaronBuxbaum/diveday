import type { Metadata } from "next";
import { FlashParams } from "@/components/FlashParams";
import { ShopNotice } from "@/components/ShopPageHeader";
import { ThreadShell } from "@/components/thread/ThreadShell";
import { FieldErrorFocus } from "@/components/ui/FieldErrorFocus";
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
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { DEFAULT_DIVER_LOCALE } from "@/i18n/settings";
import { readinessLinkPath } from "@/lib/booking-capabilities";
import { nowDate } from "@/lib/clock";
import { formatDateTimeTz } from "@/lib/format";
import { guardianSignatureRequired, signingDate } from "@/lib/guardian";
import { medicalProgress, medicalQuestionField, questionnaireForJurisdiction } from "@/lib/medical";
import { connectionForRoute } from "@/lib/observability/render-connection";
import { isUnresolvedMedicalHold } from "@/lib/waivers";
import { completeWaiverAction } from "./actions";
import { EmergencyContactSection } from "./EmergencyContactSection";
import { GuardianCard } from "./GuardianCard";
import { MedicalQuestionnaireSection } from "./MedicalQuestionnaireSection";
import { SignatureCard } from "./SignatureCard";
import { WaiverCompleted } from "./WaiverCompleted";
import { ExpiredLink, HeldWaiverCard, UnavailableWaiverLink } from "./WaiverDoorCards";
import { WaiverHelpLine } from "./WaiverHelpLine";
import { WaiverPacing } from "./WaiverPacing";
import { WaiverRelease } from "./WaiverRelease";
import { WaiverSignBlock } from "./WaiverSignBlock";
import { type WaiverRailSegmentId, waiverRailProgress } from "./WaiverStepRail";
import { WaiverTripMeta } from "./WaiverTripMeta";
import { WAIVER_FIELD_ERROR, type WaiverInvalidField } from "./waiver-fields";
import { railLabels } from "./waiver-rail-copy";

export async function generateMetadata(): Promise<Metadata> {
  const t = diverTranslator(await requestLocale());
  return {
    title: t("waiver.metaTitle"),
    robots: { index: false, follow: false },
  };
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
    return <UnavailableWaiverLink t={anonT} />;
  }

  // Every remaining state carries a real record, so the shop it belongs to
  // is always resolvable from here on — including "expired", which used to
  // bail out before the shop (and so its contact info) was ever loaded.
  const shop = await getShopById(db, state.record.shopId);
  if (!shop) {
    return <UnavailableWaiverLink t={anonT} />;
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
    return (
      <WaiverCompleted
        shop={shop}
        t={t}
        locale={locale}
        needsReview={needsReview}
        readyPath={readyPath}
        signedRail={signedRail}
        diveSitesList={diveSitesList}
      />
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

  const signBlock = (
    <WaiverSignBlock
      token={token}
      expiresAt={formatDateTimeTz(record.expiresAt, locale, shop.timezone)}
      t={t}
    />
  );

  return (
    <ThreadShell
      shopName={shopName}
      title={t("waiver.beforeDockTitle")}
      meta={
        <WaiverTripMeta tripHeader={tripHeader} locale={locale} timezone={shop.timezone} t={t} />
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

        <WaiverRelease record={record} t={t} />

        <form action={completeWaiverAction.bind(null, token)} className="mt-8 flex flex-col gap-10">
          <MedicalQuestionnaireSection
            questionnaire={questionnaire}
            draftResponses={draftResponses}
            primaryQuestionCount={primaryQuestionCount}
            t={t}
          />

          <EmergencyContactSection
            emergencyContact={emergencyContact}
            namedFieldError={namedFieldError}
            t={t}
          />

          <SignatureCard
            signerOnFile={signerOnFile}
            record={record}
            namedFieldError={namedFieldError}
            t={t}
          >
            {guardianRequired ? null : signBlock}
          </SignatureCard>

          {/* **The guardian's card** (ADR 20260907-guardian-co-signature): the
              second signature a minor's release takes, in the same shape as
              the first — a typed name, a consent box, the same fine print —
              plus who they are to the diver and how to reach them. It carries
              the page's one Sign button whenever it renders, so the last thing
              on the page is still the act, and nobody signs above a section
              they have not read. */}
          {guardianRequired ? (
            <GuardianCard
              diverName={signerOnFile?.fullName ?? ""}
              draftGuardian={draftGuardian}
              namedFieldError={namedFieldError}
              t={t}
            >
              {signBlock}
            </GuardianCard>
          ) : null}
        </form>
      </WaiverPacing>
      <WaiverHelpLine shop={shop} t={t} />
    </ThreadShell>
  );
}
