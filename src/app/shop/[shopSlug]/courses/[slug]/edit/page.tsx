import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { AssistFillButton } from "@/components/assists/AssistFillButton";
import type { EditorSectionRef } from "@/components/editor/EditorSection";
import { FlashParams } from "@/components/FlashParams";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { DisclosureRowList } from "@/components/ui/disclosure";
import { FieldErrorFocus } from "@/components/ui/FieldErrorFocus";
import { FormStatus, StickyFormActions } from "@/components/ui/form";
import { assistsAvailable } from "@/db/assists";
import { canPersonConfigureTrips } from "@/db/authz";
import { courseIdsEverOnBoard, getCourseBySlug, getCourseTemplateUpdate } from "@/db/courses";
import { CERTIFICATION_LEVEL_KEYS } from "@/i18n/readiness-labels";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { translationBoxId } from "@/lib/assists/shop-translate";
import { toShopCurrency } from "@/lib/money";
import { publicCoursePath } from "@/lib/public-routes";
import { requireShopSurface } from "@/lib/session";
import { STAFF_DESTINATION_LABEL_KEYS } from "@/lib/staff-destinations";
import { noticeFromParam, shopPath } from "@/lib/staff-notices";
import { loadTranslationBox } from "../../../_components/ShopTextTranslation";
import { draftCourseSummaryAction } from "../../../content-assist-actions";
import { SpanishBox } from "../../../dive-sites/_components/SiteAssists";
import { ConflictGuardedForm } from "./_components/ConflictGuardedForm";
import {
  CourseEnrollSection,
  CourseFeeCoversSection,
  CourseGlanceSection,
} from "./_components/CourseDetailSections";
import {
  CourseFormsRequirement,
  loadCourseFormsRequirement,
} from "./_components/CourseFormsRequirement";
import { CoursePhotosSection } from "./_components/CoursePhotosSection";
import { CoursePitchPricingSections } from "./_components/CoursePitchPricingSections";
import { CourseSavedPrintDetails } from "./_components/CourseSavedPrintDetails";
import { CourseDayByDaySection, CourseFaqSection } from "./_components/CourseScheduleFaqSections";
import { CourseTemplateUpdatesPanel } from "./_components/CourseTemplateUpdatesPanel";
import { courseEditNotices, refusedSectionId } from "./_components/edit-notices";
import { LearningMaterialsSection } from "./_components/LearningMaterialsSection";
import { courseTemplateFieldLabels } from "./_components/template-field-labels";
import { UnsavedChangesGuard, UnsavedChangesNote } from "./_components/UnsavedChangesGuard";
import {
  pullCourseTemplateUpdatesAction,
  saveCourseContentAction,
  setCourseVisibilityAction,
} from "./actions";
import {
  COURSE_EDITOR_CLOSED_SECTIONS,
  COURSE_EDITOR_OPEN_SECTIONS,
} from "./course-editor-sections";

// `instant = true` asserts that navigating *into* this page paints
// immediately — this segment's `loading.tsx`, with no request read above it.
// Since the staff shell became synchronous (issue 1446) that holds for a cold,
// direct visit too: the shell's session, shop row and nav stream in beside the
// page from `ShopChrome` rather than above it, so the route gets a static
// shell and its own reads are the only ones the reader waits on. See ADR
// 20260804-instant-navigation.
export const instant = true;

export const metadata: Metadata = { title: "Edit course page — DiveDay" };

export default async function EditCoursePage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string; slug: string }>;
  searchParams: Promise<{ notice?: string; error?: string; field?: string }>;
}) {
  const { shopSlug, slug } = await params;
  const { notice, error, field } = await searchParams;
  const { session, db, shop } = await requireShopSurface(shopSlug);
  const course = await getCourseBySlug(db, shop.id, slug);
  if (!course) notFound();
  const back = `/shop/${shopSlug}/courses`;
  const locale = await requestLocale(shop.defaultLocale);
  const currency = toShopCurrency(shop.currency);
  const t = staffTranslator(locale);

  const saveAction = saveCourseContentAction.bind(null, shopSlug, slug);

  // The catalog toggle's course, bound rather than posted (`setCourseVisibilityAction`).
  const visibilityAction = setCourseVisibilityAction.bind(null, slug, course.id);
  // The same question the action asks, asked once for the reader: a control
  // whose only outcome is a refusal is a control that should not be drawn.
  const canSetVisibility = await canPersonConfigureTrips(db, shop.id, session.user.personId);
  const templateUpdate = await getCourseTemplateUpdate(db, session.user.shopId, course.id);
  const canAssist = await assistsAvailable(db, shop.id);
  const summaryTranslation = await loadTranslationBox(
    db,
    shop,
    { kind: "course", id: course.id, field: "summary" },
    course.summary,
  );
  // The forms a course asks for are chosen by the same people who set its
  // visibility, so the same answer draws the section (ADR 20261008-course-forms).
  const formsPanel = canSetVisibility
    ? await loadCourseFormsRequirement(
        db,
        { shopId: shop.id, courseId: course.id, personId: session.user.personId, notice },
        t,
      )
    : null;
  const preserveTemplateAction = pullCourseTemplateUpdatesAction.bind(
    null,
    shopSlug,
    slug,
    "preserve-shop-edits",
  );
  const replaceTemplateAction = pullCourseTemplateUpdatesAction.bind(
    null,
    shopSlug,
    slug,
    "replace-template-copy",
  );

  const { messages, errors } = courseEditNotices(t);
  // `Object.hasOwn`, not `messages[notice]` / `errors[error]`: both params are
  // attacker-supplied, and a bare lookup walks the prototype —
  // `?notice=constructor` resolved to a *function*, which React then tried to
  // render as a child (src/lib/staff-notices.ts).
  const noticeText = noticeFromParam(notice, messages);
  const errorText = noticeFromParam(error, errors);

  const levelAge =
    (course.minimumCertificationLevel
      ? t("courses.edit.orHigher", {
          level: t(CERTIFICATION_LEVEL_KEYS[course.minimumCertificationLevel]),
        })
      : t("courses.edit.openToUncertified")) +
    (course.minimumAge ? t("courses.edit.ageSuffix", { age: course.minimumAge }) : "");

  // The ordered IDs and their label keys are shared with the loading skeleton.
  const sections: EditorSectionRef[] = [
    ...COURSE_EDITOR_OPEN_SECTIONS,
    ...COURSE_EDITOR_CLOSED_SECTIONS,
  ].map(({ id, labelKey }) => ({ id, label: t(labelKey) }));
  const unsavedTag = t("shared.formDraft.unsavedSection");
  // A closed section a refusal names opens, so the box to fix is in view.
  const refusedSection = refusedSectionId(error, field);
  const closedRef = (section: EditorSectionRef) => ({
    ...section,
    unsavedTag,
    closed: true,
    printEditorLabel: t("shared.formDraft.editorValues"),
    open: refusedSection === section.id,
  });
  const [pitch, pricing, glance, dayByDay] = sections
    .slice(0, COURSE_EDITOR_OPEN_SECTIONS.length)
    .map((section) => ({ ...section, unsavedTag }));
  const [photos, enroll, feeCovers, materials, faq] = sections
    .slice(COURSE_EDITOR_OPEN_SECTIONS.length)
    .map(closedRef);
  const formsSection = {
    id: "forms",
    label: t("courses.edit.forms.legend"),
    closed: true,
    open: Boolean(notice?.startsWith("forms-")),
  };
  // The unsaved sentence names the forms section too, when it is drawn.
  const noteSections: readonly EditorSectionRef[] = formsPanel
    ? [...sections, { id: formsSection.id, label: formsSection.label }]
    : sections;

  // "Schedule a session" on a course the shop runs (third UX review, item 35):
  // one that has been on the board, ahead or behind, or one the shop wrote
  // itself. It moved here from the roster's every row (visual review
  // 2026-10-24, A39); a template's other courses are scheduled from the
  // board's own Add, which lists every course.
  const offersSchedule =
    canSetVisibility &&
    (course.sourceTemplateSlug === null ||
      (await courseIdsEverOnBoard(db, shop.id, [course.id])).has(course.id));

  const templateFieldLabels = courseTemplateFieldLabels(t);

  return (
    // The form's own measure: the jump rail that widened this page from `lg`
    // up is gone (visual review 2026-10-24, A11).
    <StaffPage width="reading">
      {/* One-shot, like every other staff notice: without this, `?notice=saved`
          stayed in the URL and replayed "Saved" on every refresh and every
          back-navigation, long after the save. `field` rides along because it
          only ever means "focus this on the render that just failed" — the
          server already computed both, so stripping them changes no output. */}
      <FlashParams params={["notice", "error", "field"]} />
      <div>
        <ShopPageHeader
          eyebrow={t(STAFF_DESTINATION_LABEL_KEYS.courses)}
          eyebrowHref={back}
          title={course.title}
          actions={
            offersSchedule ? (
              // The board's add panel, with this course preselected (`?course=`
              // shapes the title too): the one trip-creation path, never a
              // second one (ADR 20260806-one-trip-create-form).
              <Link
                href={`/shop/${shopSlug}/schedule/board?course=${course.id}`}
                className={buttonClass({ variant: "secondary" })}
              >
                {t("courses.edit.scheduleSession")}
              </Link>
            ) : undefined
          }
          meta={
            course.isActive ? (
              <p className="text-sm text-muted">
                {t("courses.edit.liveAt")}{" "}
                <Link
                  href={publicCoursePath(shopSlug, slug)}
                  className="font-medium text-primary hover:underline"
                >
                  {publicCoursePath(shopSlug, slug)}
                </Link>
              </p>
            ) : (
              /* The hidden course's public URL now answers 404 to anyone the
                 edge cannot verify as this shop's staff, which is the whole
                 point of hiding it (issue #1735) — so this is the only door
                 left to it, and it has to be here. The link mints its
                 capability on the tap rather than carrying one in this HTML;
                 the route handler says why. */
              <p className="text-sm text-muted">
                {t("courses.edit.hiddenFromDivers")}{" "}
                <Link
                  href={shopPath(shopSlug, "courses", slug, "preview")}
                  className="font-medium text-primary hover:underline"
                >
                  {t("courses.edit.previewHidden")}
                </Link>
              </p>
            )
          }
        />
      </div>

      {noticeText ? <ShopNotice>{noticeText}</ShopNotice> : null}
      {templateUpdate ? (
        <CourseTemplateUpdatesPanel
          update={templateUpdate}
          labels={templateFieldLabels}
          preserveAction={preserveTemplateAction}
          replaceAction={replaceTemplateAction}
          t={t}
        />
      ) : null}
      {/* Only when a save was refused — the shared component's no-`field`
          fallback (first aria-invalid control) must not fire on a clean load. */}
      {error ? (
        <FieldErrorFocus
          field={
            error.startsWith("spanish-") ? translationBoxId("course", course.id, "summary") : field
          }
        />
      ) : null}

      <div className="mt-6">
        <UnsavedChangesGuard storageKey={`course-draft:${course.id}`}>
          <ConflictGuardedForm
            action={saveAction}
            conflictMessage={t("courses.edit.conflictMessage")}
            reloadLabel={t("courses.edit.conflictReload")}
            className="min-w-0"
          >
            {/* The row's edit generation, as this render saw it. The save
                compares it and refuses rather than reverting somebody else's
                page (issue #820). `createdAt` when the row has never been saved
                since the column arrived, which is what stops the protection
                switching itself off for a course nobody has edited yet — the
                comparison coalesces the same way. */}
            <input type="hidden" name="expectedVersion" value={String(course.rowVersion)} />
            {/* The open sections on hairlines, then every other section
                closed behind its name in one list (visual review 2026-10-24,
                A11). One rhythm on the wrapper rather than a margin per
                section (docs/design/forms-and-controls.md § "Section rhythm").
                The summary's Spanish and the forms a student signs are part of
                this form, saved by its one Save. */}
            <div className="flex flex-col gap-6">
              <CoursePitchPricingSections
                course={course}
                pitch={pitch}
                pricing={pricing}
                currency={currency}
                locale={locale}
                t={t}
                summaryTranslation={
                  summaryTranslation ? (
                    <div id="course-spanish" className="scroll-mt-24">
                      <SpanishBox
                        shopSlug={shopSlug}
                        box={summaryTranslation}
                        canAssist={canAssist}
                        t={t}
                        label={t("courses.edit.summarySpanishLabel")}
                        maxLength={200}
                      />
                    </div>
                  ) : undefined
                }
                summaryAssist={
                  canAssist ? (
                    <AssistFillButton
                      draft={draftCourseSummaryAction.bind(null, shopSlug, course.id)}
                      label={t("deskAssists.draft")}
                      pendingLabel={t("deskAssists.drafting")}
                      emptyLabel={t("deskAssists.nothing")}
                    />
                  ) : undefined
                }
              />
              <CourseGlanceSection course={course} glance={glance} t={t} />
              <CourseDayByDaySection course={course} dayByDay={dayByDay} t={t} />

              <DisclosureRowList className="print:[&>details:not([open])]:hidden">
                <CoursePhotosSection course={course} photos={photos} t={t} />
                <CourseEnrollSection course={course} enroll={enroll} levelAge={levelAge} t={t} />
                <CourseFeeCoversSection course={course} feeCovers={feeCovers} t={t} />
                <LearningMaterialsSection
                  section={materials}
                  stored={course.learningMaterials}
                  storageKey={`course-draft:${course.id}`}
                  t={t}
                />
                <CourseFaqSection course={course} faq={faq} t={t} />
                {formsPanel ? (
                  <CourseFormsRequirement
                    {...formsPanel}
                    {...formsSection}
                    waiversPath={shopPath(shopSlug, "waivers")}
                    t={t}
                  />
                ) : null}
              </DisclosureRowList>
              <CourseSavedPrintDetails
                course={course}
                t={t}
                display={{ locale, depthUnit: shop.depthUnit, levelAge }}
                formsPanel={formsPanel}
              />
            </div>

            {/* One control, not two: "Preview" opened the same page the "Live
                at" link in the header already points at. The refusal belongs
                beside the button that earned it, and the note beside it names
                the section holding the unsaved work. Sticky, because Save used
                to live only at the far end of a four-thousand-pixel form. */}
            <StickyFormActions className="mt-8">
              <SubmitButton pendingLabel={t("courses.edit.saving")} className={buttonClass()}>
                {t("courses.edit.save")}
              </SubmitButton>
              <UnsavedChangesNote
                unsavedLabel={t("courses.edit.unsavedChanges")}
                restoredLabel={t("courses.edit.draftRestored")}
                sections={noteSections.map((section) => ({
                  id: section.id,
                  unsavedSentence: t("courses.edit.unsavedInSection", { section: section.label }),
                }))}
                countSentences={noteSections.map((_, index) =>
                  t("courses.edit.unsavedInSections", { count: index + 1 }),
                )}
              />
              <FormStatus tone="danger">{errorText}</FormStatus>
            </StickyFormActions>
          </ConflictGuardedForm>
        </UnsavedChangesGuard>

        {/* Outside the save form, because a form cannot nest inside another —
            and below it, because this is the page's rare act and Save is its
            frequent one. `secondary`, not primary: the editor has exactly one
            obvious next action and this is not it (principles §8). The word on
            screen names what it does to the diver's catalog.

            Drawn only for a reader whose roles allow it: for anybody else the
            button's only outcome is the refusal. */}
        {canSetVisibility ? (
          <form action={visibilityAction} className="mt-8 border-t border-border pt-6">
            <SubmitButton
              pendingLabel="…"
              className={buttonClass({ variant: "secondary", size: "sm" })}
            >
              {course.isActive
                ? t("courses.edit.hideFromCatalog")
                : t("courses.edit.showInCatalog")}
            </SubmitButton>
          </form>
        ) : null}
      </div>
    </StaffPage>
  );
}
