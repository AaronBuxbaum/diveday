import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EditorRail } from "@/components/editor/EditorRail";
import type { EditorSectionRef } from "@/components/editor/EditorSection";
import { FlashParams } from "@/components/FlashParams";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { FieldErrorFocus } from "@/components/ui/FieldErrorFocus";
import { FormStatus, StickyFormActions } from "@/components/ui/form";
import { canPersonConfigureTrips } from "@/db/authz";
import { getCourseBySlug, getCourseTemplateUpdate } from "@/db/courses";
import { CERTIFICATION_LEVEL_KEYS } from "@/i18n/readiness-labels";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { toShopCurrency } from "@/lib/money";
import { publicCoursePath } from "@/lib/public-routes";
import { requireShopSurface } from "@/lib/session";
import { STAFF_DESTINATION_LABEL_KEYS } from "@/lib/staff-destinations";
import { noticeFromParam, shopPath } from "@/lib/staff-notices";
import { ConflictGuardedForm } from "./_components/ConflictGuardedForm";
import { CourseDetailSections } from "./_components/CourseDetailSections";
import {
  CourseFormsRequirement,
  loadCourseFormsRequirement,
} from "./_components/CourseFormsRequirement";
import { CoursePhotosSection } from "./_components/CoursePhotosSection";
import { CoursePitchPricingSections } from "./_components/CoursePitchPricingSections";
import { CourseScheduleFaqSections } from "./_components/CourseScheduleFaqSections";
import { CourseTemplateUpdatesPanel } from "./_components/CourseTemplateUpdatesPanel";
import { courseEditNotices } from "./_components/edit-notices";
import { LearningMaterialsSection } from "./_components/LearningMaterialsSection";
import { courseTemplateFieldLabels } from "./_components/template-field-labels";
import { UnsavedChangesGuard, UnsavedChangesNote } from "./_components/UnsavedChangesGuard";
import {
  pullCourseTemplateUpdatesAction,
  saveCourseContentAction,
  saveCourseFormRequirementsAction,
  setCourseVisibilityAction,
} from "./actions";

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

  // **The editor's sections, once.** The rail's entries, the anchors it jumps
  // to, and the sentence naming which one holds unsaved work all read this one
  // list, so a section cannot exist without a way back to it (ADR
  // 20260827-the-shops-shelves, decision 2). `scheduleDaysJson` keeps the id it
  // has always had: `saveCourseContentAction` names it in `?field=` when the
  // day-by-day payload is refused, and `FieldErrorFocus` resolves that by id.
  const sections: EditorSectionRef[] = [
    { id: "pitch", label: t("courses.edit.pitchLegend") },
    { id: "pricing", label: t("courses.edit.pricingLegend") },
    { id: "photos", label: t("courses.edit.photosLegend") },
    { id: "glance", label: t("courses.edit.glanceLegend") },
    { id: "enroll", label: t("courses.edit.enrollLegend") },
    { id: "fee-covers", label: t("courses.edit.feeCoversLegend") },
    // `learningMaterialsJson`, like the day-by-day id: the save names it in
    // `?field=` when the materials are refused, and `FieldErrorFocus` finds it.
    { id: "learningMaterialsJson", label: t("courses.edit.materialsLegend") },
    { id: "scheduleDaysJson", label: t("courses.edit.dayByDayLegend") },
    { id: "faq", label: t("courses.edit.faqLegend") },
  ];
  const unsavedTag = t("shared.formDraft.unsavedSection");
  const [pitch, pricing, photos, glance, enroll, feeCovers, materials, dayByDay, faq] =
    sections.map((section) => ({ ...section, unsavedTag }));
  // The forms section is its own `<form>` below the save form, so the rail
  // names it but the unsaved-changes note (which reads the save form) does not.
  const formsSection: EditorSectionRef = { id: "forms", label: t("courses.edit.forms.legend") };
  const railSections = canSetVisibility ? [...sections, formsSection] : sections;

  const templateFieldLabels = courseTemplateFieldLabels(t);

  return (
    // Wider than the form alone needs, because the rail takes the first 220px
    // of it and the fields keep roughly the column they had.
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10 lg:max-w-5xl">
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
      {error ? <FieldErrorFocus field={field} /> : null}

      {/* The rail and the form it names. Below `lg` the rail collapses to a
          jump-row above the sections and this is ordinary block flow, which is
          also what lets the rail stick on a phone (a one-column grid gives its
          nav a row of its own, and a sticky element with no travel never
          moves). ADR 20260827-the-shops-shelves, decision 2. */}
      <div className="mt-6 lg:grid lg:grid-cols-[13.75rem_1fr] lg:gap-x-14">
        <EditorRail navLabel={t("courses.edit.sectionsLabel")} sections={railSections} />

        {/* One grid cell holding the form and the page's rare act beneath it,
            so the rail keeps the first column to itself. */}
        <div className="min-w-0">
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
              {/* Sections, not cards: each keeps its `<fieldset>`/`<legend>` pair —
              the legend is still the accessible name of a control group — and
              loses its border, which is the whole of the change the ADR asks
              for here. Each draws the hairline above itself; `lead` is what
              keeps a rule off the top of the first, where it would be a box
              lid rather than a separator. */}
              {/* The sections' one rhythm, on the wrapper rather than a margin
              per section (docs/design/forms-and-controls.md § "Section
              rhythm"). Each `EditorSection` draws the hairline above itself
              and holds `pt-6` beneath it; with nothing above the rule the
              uppercase label of every section but the first sat flush against
              the previous section's last field, so eight sections read as one
              undifferentiated column. */}
              <div className="flex flex-col gap-10">
                <CoursePitchPricingSections
                  course={course}
                  pitch={pitch}
                  pricing={pricing}
                  currency={currency}
                  locale={locale}
                  t={t}
                />
                <CoursePhotosSection course={course} photos={photos} t={t} />
                <CourseDetailSections
                  course={course}
                  glance={glance}
                  enroll={enroll}
                  feeCovers={feeCovers}
                  levelAge={levelAge}
                  t={t}
                />

                <LearningMaterialsSection
                  section={materials}
                  stored={course.learningMaterials}
                  storageKey={`course-draft:${course.id}`}
                  t={t}
                />
                <CourseScheduleFaqSections course={course} dayByDay={dayByDay} faq={faq} t={t} />
              </div>

              {/* One control, not two. "Preview" opened the same page the "Live
              at" link in the header already points at, and a second
              button-shaped thing beside Save competes with the only action
              this form has (design principles #8). */}
              {/* The refusal belongs beside the button that earned it, not in a
              banner thirty lines above the first field: this editor runs to
              eight sections, so a staffer who pressed Save at the bottom saw
              nothing happen at all. `FieldErrorFocus` above still carries them
              on to the offending box when the server named one. */}
              {/* Sticky, because this form is eight sections and four thousand
              pixels tall and Save used to live only at the far end of it. The
              note beside it names the section holding the unsaved work — the
              rail is what makes that answer actionable. */}
              <StickyFormActions className="mt-8">
                <SubmitButton pendingLabel={t("courses.edit.saving")} className={buttonClass()}>
                  {t("courses.edit.savePage")}
                </SubmitButton>
                <UnsavedChangesNote
                  unsavedLabel={t("courses.edit.unsavedChanges")}
                  restoredLabel={t("courses.edit.draftRestored")}
                  sections={sections.map((section) => ({
                    id: section.id,
                    unsavedSentence: t("courses.edit.unsavedInSection", { section: section.label }),
                  }))}
                  countSentences={sections.map((_, index) =>
                    t("courses.edit.unsavedInSections", { count: index + 1 }),
                  )}
                />
                <FormStatus tone="danger">{errorText}</FormStatus>
              </StickyFormActions>
            </ConflictGuardedForm>
          </UnsavedChangesGuard>

          {formsPanel ? (
            <CourseFormsRequirement
              {...formsPanel}
              {...formsSection}
              action={saveCourseFormRequirementsAction.bind(null, slug)}
              waiversPath={shopPath(shopSlug, "waivers")}
              t={t}
            />
          ) : null}

          {/* Outside the save form, because a form cannot nest inside another —
            and below it, because this is the page's rare act and Save is its
            frequent one. `secondary`, not primary: the editor has exactly one
            obvious next action and this is not it (principles §8). The word on
            screen names what it does to the diver's catalog, since the control
            no longer sits on a row that carried the course's name.

            Drawn only for a reader whose roles allow it: for anybody else the
            button's only outcome is the refusal, and the editor's other work —
            the prose a diver reads — is still theirs. */}
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
      </div>
    </main>
  );
}
