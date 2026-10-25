import type { Metadata } from "next";
import Link from "next/link";
import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { AutoOpenDetails } from "@/components/AutoOpenDetails";
import { FlashParams } from "@/components/FlashParams";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { canPersonManageWaiverTemplates } from "@/db/authz";
import { courseFormResignImpact, listCourseForms } from "@/db/course-forms";
import {
  getCurrentWaiverTemplate,
  getSignedWaiverRecordForShop,
  listWaiverIntegrityAudit,
  signedRecordViewParam,
  standingWaiverExposure,
} from "@/db/waivers";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { formatShortDate } from "@/lib/format";
import { OPERATIONAL_HORIZON_DAYS } from "@/lib/operational-window";
import { requireShopSurface } from "@/lib/session";
import { type NoticeTone, shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
import { DEFAULT_WAIVER_BODY, isSampleRelease } from "@/lib/waivers";
import { type CourseFormNotice, CourseFormsSection } from "./_components/CourseFormsSection";
import type { PublishReleaseCopy } from "./_components/PublishRelease";
import { ReleaseForm } from "./_components/ReleaseForm";
import { ReleasePdfDraft } from "./_components/ReleasePdfDraft";
import {
  StandardQuestionnaire,
  shopQuestionHealthWords,
  shopQuestionsCopy,
} from "./_components/ShopQuestionsPanel";
import { SignedRecordsSection } from "./_components/SignedRecordsSection";
import { saveWaiverAction } from "./actions";

// `instant = true` asserts that navigating *into* this page paints
// immediately — this segment's `loading.tsx`, with no request read above it.
// Since the staff shell became synchronous (issue 1446) that holds for a cold,
// direct visit too: the shell's session, shop row and nav stream in beside the
// page from `ShopChrome` rather than above it, so the route gets a static
// shell and its own reads are the only ones the reader waits on. See ADR
// 20260804-instant-navigation.
export const instant = true;

export const metadata: Metadata = {
  title: "Waivers — DiveDay",
};

/**
 * **The waiver surface, as one page** (ADR 20260827-people-not-lists,
 * decision 4; the language is ADR 20260827-clearwater-surface-language).
 *
 * The release a shop publishes and the signatures standing against it are one
 * subject read in one sitting — "what does it say, and who has agreed to it" —
 * and a tab strip made them two destinations that could disagree. The strip,
 * the shell layout that held it, and `waivers/signatures/page.tsx` are gone
 * (H-49); the old URL is a 308 Route Handler that keeps `?record=` and
 * `?page=`.
 *
 * **The release is a door and the signed records are the page.** The editor
 * opens in place from one control, and on the `#release` fragment or any
 * `?notice=` a publish bounced back with; everything it does is unchanged.
 *
 * Two decisions live in the parts below, each with its own doc comment and its
 * own rule test:
 *
 * - **`PublishRelease`** — materiality is a recorded choice, and then one
 *   Publish. H-54's semantics are untouched: `saveWaiverAction` still writes
 *   the same decision from the same `material` field, `standingWaiverExposure`
 *   is still counted before the save, and a material publish still puts every
 *   standing signature back in the queue. Only the shape of the asking moved.
 * - **`SignatureLog`** — the evidence trail as a day-grouped ledger, with
 *   integrity as a badge only when it is not valid.
 *
 * Security-sensitive: this is staff read access to signed, medical-adjacent
 * records. The gate is `canPersonManageWaiverTemplates` — the same one the
 * editor has always run, never a looser one now that the log shares the page —
 * and every query is scoped to the shop `requireShopSurface` resolved from the
 * *session*, never the `shopSlug` route param (which that helper additionally
 * refuses outright when it disagrees with the session). A `record` id copied
 * from another shop resolves to nothing: `getSignedWaiverRecordForShop`
 * filters on `shopId` too.
 */
export default async function WaiversPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{
    notice?: string;
    count?: string;
    page?: string;
    record?: string;
    form?: string;
    q?: string;
    view?: string;
  }>;
}) {
  const { shopSlug } = await params;
  const {
    notice,
    count,
    page,
    record: recordParam,
    form: formParam,
    q,
    view: viewParam,
  } = await searchParams;
  // **Find a signed release in one line** (third UX review, item 31): the
  // diver's name, email or phone, and two views a reviewer goes looking for.
  const query = q?.trim() ?? "";
  const view = signedRecordViewParam(viewParam);
  // `waiver_records.id` is a `uuid` column, so a truncated or hand-edited
  // `?record=` does not resolve to nothing — it throws `invalid input syntax
  // for type uuid` and 500s this page. A malformed id is simply no pin: the
  // log itself still renders, which is the page the staffer came for.
  const record = uuidParam(recordParam);
  // The waiver is the shop's legal instrument; editing it (and the medical
  // jurisdiction it presents) is owner/manager work (H-14, ADR
  // 20260724-role-authorization). Other roles have no use for it, so the
  // surface doesn't exist for them rather than showing a read-only copy — and
  // that now covers the signature log, which ran this identical gate one route
  // over.
  //
  // Refused staff are bounced to Today with an explanatory notice rather than
  // teleported silently (task 82, UX persona 11 "Kai"): Today already renders
  // `shopHome.notice.*` codes.
  const { db, shop } = await requireShopSurface(shopSlug, {
    allow: canPersonManageWaiverTemplates,
    refusal: { notice: "waivers-not-authorized" },
  });
  // Staff read dates in the language their own device asks for, same
  // negotiation as the public pages (docs ADR 20260729-diver-copy-localization).
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const [current, atRisk, highlighted, auditPage, courseForms, resign] = await Promise.all([
    getCurrentWaiverTemplate(db, shop.id),
    // What publishing a new version would cost, in signatures. Read on every
    // render so the choice below can state it *before* the tap — the count in
    // the notice afterwards is the same number, and arrives too late to change
    // a mind (issue #720).
    standingWaiverExposure(db, shop.id),
    record ? getSignedWaiverRecordForShop(db, shop.id, record) : null,
    // A non-numeric or missing `?page=` reads as page 1; the query clamps it
    // into range so a bookmarked page past the end lands on the last real one.
    listWaiverIntegrityAudit(db, shop.id, {
      page: Number.parseInt(page ?? "", 10),
      query,
      view,
    }),
    listCourseForms(db, shop.id),
    courseFormResignImpact(db, shop.id),
  ]);
  const courseFormNotice = courseFormNoticeFor(notice, formParam, t);
  const sampleRelease = isSampleRelease(current?.body);

  const resigning = notice === "waiver-resigning" ? Number(count) : Number.NaN;
  // What a publish that landed says. A refusal never navigates: it answers in
  // the form, with what was typed handed back (`./_components/ReleaseForm`),
  // and its words are composed below.
  const banner =
    notice === "saved"
      ? current
        ? t("waiversStaff.banner.savedNew")
        : t("waiversStaff.banner.savedFirst")
      : notice === "waiver-unchanged"
        ? t("waiversStaff.banner.unchanged")
        : Number.isFinite(resigning) && resigning > 0
          ? t("waiversStaff.banner.resigning", { count: resigning })
          : undefined;
  // Warning, not success, for the same reason `requirements-blocking` is: the
  // save worked and there is nothing to undo, but the shop now owes those
  // divers a link. "Unchanged" is neutral — nothing happened, which is the
  // whole message.
  const bannerTone: NoticeTone =
    notice === "waiver-resigning"
      ? "warning"
      : notice === "waiver-unchanged"
        ? "neutral"
        : "success";

  // The material option states its own cost, so the sentences are composed
  // here — where the counts and the locale are — and handed over as words: a
  // staff Client Component never translates for itself.
  // The operational half. The lifetime number says what publishing costs;
  // this one says which boat it lands on, and it is the one that changes what
  // the shop does next (issue #790).
  const boardingSoon =
    atRisk.boardingSoon > 0
      ? t("waiversStaff.publish.materialBoarding", {
          count: atRisk.boardingSoon,
          days: OPERATIONAL_HORIZON_DAYS,
        })
      : null;
  const publishCopy: PublishReleaseCopy = {
    choiceLegend: t("waiversStaff.publish.choiceLegend"),
    correction: t("waiversStaff.publish.correction"),
    correctionDetail: t("waiversStaff.publish.correctionDetail"),
    correctionQuestions: t("waiversStaff.publish.correctionQuestions"),
    correctionQuestionsDetail: t("waiversStaff.publish.correctionQuestionsDetail"),
    material: t("waiversStaff.publish.material"),
    materialDetail: [
      t("waiversStaff.publish.materialDetail", { count: atRisk.divers }),
      boardingSoon,
    ]
      .filter(Boolean)
      .join(" "),
    materialQuestions: t("waiversStaff.publish.materialQuestions"),
    materialQuestionsDetail: [
      t("waiversStaff.publish.materialQuestionsDetail", { count: atRisk.divers }),
      boardingSoon,
    ]
      .filter(Boolean)
      .join(" "),
    action: t("waiversStaff.publish.action"),
    confirm: t("waiversStaff.publish.confirm", { count: atRisk.divers }),
    pending: t("waiversStaff.pendingLabel"),
  };

  return (
    <StaffPage width="reading">
      <FlashParams params={["notice", "count", "form"]} />
      <ShopPageHeader
        eyebrow={t("settings.main.eyebrow")}
        eyebrowHref={shopPath(shopSlug, "settings")}
        title={t("waiversStaff.title")}
        // The version line is a fact about the release the page is named
        // after, so it rides under the title where a reader meets it before
        // the text — rather than as a second heading inside the card, which is
        // where it sat while that card had a heading of its own repeating the
        // field's.
        meta={
          <>
            {current ? (
              <p className="text-sm text-muted">
                {t("waiversStaff.versionInfo", {
                  version: current.version,
                  date: formatShortDate(current.createdAt, locale, shop.timezone),
                })}
              </p>
            ) : null}
            {/* **Said at rest, not only inside the editor** (third UX review,
                item 30). Sign-up publishes DiveDay's sample release as a new
                shop's version 1, and divers sign it from that hour. The note
                used to render only for a shop with no release, which a
                signed-up shop never is; it now holds for as long as the live
                text is byte-equal to the sample (`isSampleRelease`). */}
            {sampleRelease ? (
              <p className="mt-1 text-sm text-warning-strong">
                {current
                  ? t("waiversStaff.releaseDescription.sampleLive")
                  : t("waiversStaff.releaseDescription.sample")}
              </p>
            ) : null}
          </>
        }
      />

      {/* **The ledger leads; the editor is a door.** A full-height textarea of
          the legal text, a materiality radio pair and a Publish stood at the
          top of a page holding 519 signed records. Editing the release happens
          a handful of times in a shop's life; reading who signed is daily, so
          the release is one control at rest and the log starts a screen
          higher.

          `AutoOpenDetails`, not a bare `<details>`, for the two arrivals that
          have to land *inside* it: the `#release` fragment (a client
          navigation never runs the browser's own reveal, so the target would
          come back collapsed), and any `?notice=` the publish bounced back
          with — the refusal and the confirmation both render on `FormStatus`
          beside the button, which is the right place for them and no place at
          all if the form is shut. Nothing here changes what publishing does:
          `saveWaiverAction` writes the same decision from the same `material`
          field, and `standingWaiverExposure` is still counted before the save
          so the cost is stated before the tap (H-54, issue #720). */}
      <AutoOpenDetails
        id="release"
        openOnHash="release"
        open={Boolean(banner)}
        className="group/release mt-6 scroll-mt-24"
      >
        <summary
          className={`${buttonClass({ variant: "secondary" })} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}
        >
          {t("waiversStaff.editRelease")}
          {/* The disclosure caret rather than the navigate chevron: which way
              it points is what says the release opens here (settled-questions). */}
          <DisclosureCaret className="group-open/release:rotate-90" />
        </summary>
        <SectionCard padding="lg" className="mt-4">
          <ReleaseForm
            action={saveWaiverAction}
            fieldLabel={t("waiversStaff.fieldLabel")}
            placeholder={t("waiversStaff.placeholder")}
            initialBody={current?.body ?? DEFAULT_WAIVER_BODY}
            published={current ? { body: current.body, questions: current.questions } : null}
            pdfDraft={<ReleasePdfDraft shopId={shop.id} fieldId="release-body" t={t} />}
            standardQuestionnaire={<StandardQuestionnaire jurisdiction={shop.jurisdiction} t={t} />}
            questionsCopy={shopQuestionsCopy(t)}
            healthWords={shopQuestionHealthWords()}
            publishCopy={publishCopy}
            standingSignatures={atRisk.divers > 0}
            // Two refusals about the publish, two sentences. `body` says the
            // release is too short; `materiality` says the edit was never
            // called a correction or a material change, which is not about the
            // text at all. They shared one sentence until 2026-08-28, and the
            // staffer who met it was told to lengthen a release they had not
            // shortened. See `./actions.ts`.
            refusalCopy={{
              body: t("waiversStaff.banner.invalid"),
              materiality: t("waiversStaff.banner.materialityRequired"),
              questions: t("waiversStaff.banner.questionsInvalid"),
              questionNumbered: t.raw("waiversStaff.banner.questionInvalid") as string,
            }}
            status={
              banner
                ? {
                    tone: bannerTone,
                    content: (
                      <>
                        {banner}
                        {/* The shop now owes those divers a link, and every one of
                            them is a waiver row on their boat's station on the
                            home. A door, rather than leaving them to hunt for it
                            (issue #790). */}
                        {notice === "waiver-resigning" &&
                        Number.isFinite(resigning) &&
                        resigning > 0 ? (
                          <>
                            {" "}
                            <Link
                              href={`/shop/${shopSlug}`}
                              className="font-medium text-primary hover:underline"
                            >
                              {t("waiversStaff.banner.resigningSendLink")}
                            </Link>
                          </>
                        ) : null}
                      </>
                    ),
                  }
                : null
            }
          />
        </SectionCard>
      </AutoOpenDetails>

      <CourseFormsSection
        forms={courseForms}
        resign={resign}
        notice={courseFormNotice}
        locale={locale}
        timezone={shop.timezone}
        t={t}
      />

      <SignedRecordsSection
        auditPage={auditPage}
        pinned={highlighted}
        query={query}
        view={view}
        record={record}
        shopSlug={shopSlug}
        locale={locale}
        timezone={shop.timezone}
        t={t}
      />
    </StaffPage>
  );
}

const COURSE_FORM_NOTICES = {
  "course-form-saved": { key: "waiversStaff.courseForms.notice.saved", tone: "success" },
  "course-form-unchanged": { key: "waiversStaff.courseForms.notice.unchanged", tone: "neutral" },
  "course-form-invalid": { key: "waiversStaff.courseForms.notice.invalid", tone: "danger" },
  "course-form-deleted": { key: "waiversStaff.courseForms.notice.deleted", tone: "success" },
  "course-form-not-found": { key: "waiversStaff.courseForms.notice.notFound", tone: "warning" },
} as const satisfies Record<string, { key: string; tone: NoticeTone }>;

/**
 * A course-form outcome and the form it belongs beside. `?form=` is a form
 * id, `new`, or `list`; anything else names no form on this page, so the
 * notice has nowhere to sit and is dropped rather than shown out of place.
 */
function courseFormNoticeFor(
  notice: string | undefined,
  form: string | undefined,
  t: ReturnType<typeof staffTranslator>,
): CourseFormNotice | undefined {
  if (!notice || !Object.hasOwn(COURSE_FORM_NOTICES, notice)) return undefined;
  const target = form === "new" || form === "list" ? form : uuidParam(form);
  if (!target) return undefined;
  const { key, tone } = COURSE_FORM_NOTICES[notice as keyof typeof COURSE_FORM_NOTICES];
  return { form: target, tone, text: t(key) };
}
