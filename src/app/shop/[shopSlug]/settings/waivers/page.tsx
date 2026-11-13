import type { Metadata } from "next";
import Link from "next/link";
import { FlashParams } from "@/components/FlashParams";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import type { NoticeTone } from "@/components/ui/tone";
import { requireShopSurface } from "@/features/session";
import { canPersonManageWaiverTemplates, getWaiversPage } from "@/features/waivers-page";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { formatShortDate } from "@/lib/format";
import { OPERATIONAL_HORIZON_DAYS } from "@/lib/operational-window";
import { shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
import { DEFAULT_WAIVER_BODY, isSampleRelease } from "@/lib/waivers";
import { settingsPaneClass } from "../_components/settings-pane";
import { BlankReleaseLink } from "./_components/BlankReleaseLink";
import { type CourseFormNotice, CourseFormsSection } from "./_components/CourseFormsSection";
import type { PublishReleaseCopy } from "./_components/PublishRelease";
import { ReleaseForm } from "./_components/ReleaseForm";
import { ReleasePdfDraft } from "./_components/ReleasePdfDraft";
import {
  StandardQuestionnaire,
  shopQuestionHealthWords,
  shopQuestionsCopy,
} from "./_components/ShopQuestionsPanel";
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
  title: "Waivers and forms — DiveDay",
};

/**
 * **Waivers and forms: the setup, in Settings** (ADR 20260827-people-not-lists,
 * decision 4, split on Aaron's 2026-11-13 call: one-time or
 * occasional setup happens in Settings; whatever is logged or read happens in
 * the app itself). The release a shop publishes, its own questions, and the
 * forms a course asks for. The signatures standing against the release are read
 * in Divers (`divers/waivers/page.tsx`), and this page links there.
 *
 * - **`PublishRelease`**: materiality is a recorded choice, and then one
 *   Publish. H-20260822-may-shop-explicitly-declare's semantics hold:
 *   `saveWaiverAction` writes the decision from the `material` field,
 *   `standingWaiverExposure` is counted before the save, and a material publish
 *   puts every standing signature back in the queue.
 *
 * Security-sensitive: the gate is `canPersonManageWaiverTemplates`, and every
 * query is scoped to the shop `requireShopSurface` resolved from the *session*,
 * never the `shopSlug` route param.
 */
export default async function WaiversPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ notice?: string; count?: string; form?: string }>;
}) {
  const { shopSlug } = await params;
  const { notice, count, form: formParam } = await searchParams;
  // The waiver is the shop's legal instrument; editing it (and the medical
  // jurisdiction it presents) is owner/manager work (H-20260724-staff-role-reach, ADR
  // 20260724-role-authorization). Other roles have no use for it, so the
  // surface doesn't exist for them rather than showing a read-only copy.
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
  // What publishing a new version would cost is read on every render so the
  // choice can state it *before* the tap (issue #720).
  const { current, atRisk, courseForms, resign } = await getWaiversPage(db, shop.id);
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
    <main className={settingsPaneClass()}>
      <FlashParams params={["notice", "count", "form"]} />
      <ShopPageHeader
        eyebrow={t("settings.main.eyebrow")}
        title={t("settings.main.waivers.heading")}
        // The version line is a fact about the release, so it rides under the
        // title where a reader meets it before the text.
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
                shop's version 1, and divers sign it from that hour; the note
                holds for as long as the live text is byte-equal to the
                sample (`isSampleRelease`). */}
            {sampleRelease ? (
              <p className="mt-1 text-sm text-warning-strong">
                {current
                  ? t("waiversStaff.releaseDescription.sampleLive")
                  : t("waiversStaff.releaseDescription.sample")}
              </p>
            ) : null}
          </>
        }
        actions={
          <Link
            href={shopPath(shopSlug, "divers", "waivers")}
            className={buttonClass({ variant: "secondary" })}
          >
            {t("waiversStaff.signedRecordsLink")}
          </Link>
        }
      />

      {/* **Setup lives here; the signed records live with the divers**
          (Aaron, 2026-11-13): writing the release and the course forms
          happens a handful of times in a shop's life, so it is a Settings
          page, and who has signed is read in Divers. `saveWaiverAction`
          writes the same decision from the same `material` field, and
          `standingWaiverExposure` is still counted before the save so the
          cost is stated before the tap (H-20260822-may-shop-explicitly-declare,
          issue #720). */}
      <SectionCard padding="lg" className="device-text-settings-editor" id="release">
        {current ? <BlankReleaseLink shopSlug={shopSlug} t={t} /> : null}
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

      <CourseFormsSection
        forms={courseForms}
        resign={resign}
        notice={courseFormNotice}
        locale={locale}
        timezone={shop.timezone}
        t={t}
      />
    </main>
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
