import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { FlashParams } from "@/components/FlashParams";
import { ImageFileInput } from "@/components/ImageFileInput";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { StoredPhoto } from "@/components/StoredPhoto";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { FieldErrorFocus } from "@/components/ui/FieldErrorFocus";
import {
  controlClass,
  Field,
  FieldActions,
  FieldGrid,
  FormStatus,
  PriceField,
} from "@/components/ui/form";
import { getCourseBySlug, getCourseTemplateUpdate } from "@/db/courses";
import { CERTIFICATION_LEVEL_KEYS } from "@/i18n/readiness-labels";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import type { CourseTemplateField } from "@/lib/course-template-sync";
import { formatFaqs } from "@/lib/courses";
import { toShopCurrency } from "@/lib/money";
import { publicCoursePath } from "@/lib/public-routes";
import { requireShopSurface } from "@/lib/session";
import { noticeFromParam } from "@/lib/staff-notices";
import { MAX_IMAGE_MB, MAX_NEW_GALLERY_IMAGES_PER_SUBMISSION } from "@/lib/storage/limits";
import { ConflictGuardedForm } from "./_components/ConflictGuardedForm";
import { DayByDayEditor } from "./_components/DayByDayEditor";
import { UnsavedChangesGuard } from "./_components/UnsavedChangesGuard";
import { pullCourseTemplateUpdatesAction, saveCourseContentAction } from "./actions";

// `instant = true` asserts that navigating *into* this page paints
// immediately. It is not a claim that the route has a static shell: the staff
// shell layout declares `instant = false` (read its comment for why), so a
// cold, direct visit still blocks on the session and the shop row. What this
// validates is the navigation staff actually make all day — arriving from
// another `/shop` page, where that shell is already mounted and this
// segment's `loading.tsx` is what paints. See ADR 20260804-instant-navigation.
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
  const templateUpdate = await getCourseTemplateUpdate(db, session.user.shopId, course.id);
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

  // Only "saved" now: the editor's own Hide/Show button is gone (the roster's
  // eye toggle is the one place visibility changes), so `?notice=shown|hidden`
  // has nothing left that can send it.
  const messages: Record<string, string> = {
    saved: t("courses.edit.noticeSaved"),
    "template-updated": t("courses.edit.templateUpdates.updated"),
    "template-replaced": t("courses.edit.templateUpdates.replaced"),
  };
  const errors: Record<string, string> = {
    invalid: t("courses.edit.errorInvalid"),
    images: t("courses.edit.errorImages"),
    upload: t("courses.edit.errorUpload"),
    "too-many-photos": t("courses.edit.errorTooManyPhotos", {
      max: MAX_NEW_GALLERY_IMAGES_PER_SUBMISSION,
    }),
    // A half-edited depth marker. Refused at save rather than left to render
    // its own braces to a diver — see saveCourseContentAction.
    "depth-placeholder": t("courses.edit.errorDepthPlaceholder"),
    "template-update-unavailable": t("courses.edit.templateUpdates.unavailable"),
  };
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

  const templateFieldLabels: Record<CourseTemplateField, string> = {
    title: t("courses.edit.templateUpdates.fields.title"),
    agency: t("courses.edit.templateUpdates.fields.agency"),
    description: t("courses.edit.templateUpdates.fields.description"),
    minimumCertificationLevel: t("courses.edit.templateUpdates.fields.minimumCertificationLevel"),
    minimumAge: t("courses.edit.templateUpdates.fields.minimumAge"),
    isIntroCourse: t("courses.edit.templateUpdates.fields.isIntroCourse"),
    summary: t("courses.edit.templateUpdates.fields.summary"),
    overview: t("courses.edit.templateUpdates.fields.overview"),
    durationText: t("courses.edit.templateUpdates.fields.durationText"),
    groupSizeText: t("courses.edit.templateUpdates.fields.groupSizeText"),
    prerequisiteNote: t("courses.edit.templateUpdates.fields.prerequisiteNote"),
    includes: t("courses.edit.templateUpdates.fields.includes"),
    excludes: t("courses.edit.templateUpdates.fields.excludes"),
    scheduleDays: t("courses.edit.templateUpdates.fields.scheduleDays"),
    faqs: t("courses.edit.templateUpdates.fields.faqs"),
  };

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      {/* One-shot, like every other staff notice: without this, `?notice=saved`
          stayed in the URL and replayed "Saved" on every refresh and every
          back-navigation, long after the save. `field` rides along because it
          only ever means "focus this on the render that just failed" — the
          server already computed both, so stripping them changes no output. */}
      <FlashParams params={["notice", "error", "field"]} />
      <Link href={back} className="text-sm font-medium text-primary hover:underline">
        {t("courses.edit.backToCourses")}
      </Link>
      <div className="mt-4">
        <ShopPageHeader
          eyebrow={course.agency.toUpperCase()}
          title={course.title}
          description={t("courses.edit.description")}
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
              <p className="text-sm text-muted">{t("courses.edit.hiddenFromDivers")}</p>
            )
          }
        />
      </div>

      {noticeText ? <ShopNotice>{noticeText}</ShopNotice> : null}
      {templateUpdate ? (
        <section className="mt-6 rounded-2xl border border-primary/30 bg-primary/5 p-4 sm:p-5">
          <h2 className="text-base font-semibold">{t("courses.edit.templateUpdates.title")}</h2>
          <p className="mt-1 text-sm text-muted">
            {templateUpdate.baselineUnavailable
              ? t("courses.edit.templateUpdates.baselineUnavailableDescription")
              : t("courses.edit.templateUpdates.description", {
                  current: templateUpdate.currentVersion,
                  latest: templateUpdate.latestVersion,
                })}
          </p>
          <ul className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
            {templateUpdate.diff.map((change) => (
              <li
                key={change.field}
                className="flex min-h-10 items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-2"
              >
                <span>{templateFieldLabels[change.field]}</span>
                <span className="shrink-0 text-xs font-medium text-muted">
                  {change.shopChanged
                    ? t("courses.edit.templateUpdates.shopEdit")
                    : t("courses.edit.templateUpdates.templateChange")}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-muted">
            {t("courses.edit.templateUpdates.keepEditsDescription")}
          </p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start">
            <form action={preserveTemplateAction} className="flex flex-col gap-1">
              <SubmitButton pendingLabel={t("courses.edit.templateUpdates.applying")}>
                {t("courses.edit.templateUpdates.keepEdits")}
              </SubmitButton>
              <span className="text-xs text-muted">
                {t("courses.edit.templateUpdates.keepEditsHint")}
              </span>
            </form>
            <form action={replaceTemplateAction} className="flex flex-col gap-1">
              <SubmitButton
                pendingLabel={t("courses.edit.templateUpdates.replacing")}
                className={buttonClass({ variant: "secondary" })}
                confirmMessage={t("courses.edit.templateUpdates.replaceConfirm")}
              >
                {t("courses.edit.templateUpdates.replaceCopy")}
              </SubmitButton>
              <span className="text-xs text-muted">
                {t("courses.edit.templateUpdates.replaceCopyHint")}
              </span>
            </form>
          </div>
        </section>
      ) : null}
      {/* Only when a save was refused — the shared component's no-`field`
          fallback (first aria-invalid control) must not fire on a clean load. */}
      {error ? <FieldErrorFocus field={field} /> : null}

      {/* Above the form, not buried in one field's hint: a depth marker may be
          typed into any prose box on this page, and it is the one piece of
          syntax this editor asks a shop to learn. */}
      <p className="mt-6 rounded-xl border border-border bg-surface-sunken px-4 py-3 text-sm text-muted">
        {t.rich("courses.edit.depthMarkersHint", {
          marker: (chunks) => (
            <code className="rounded bg-surface px-1 font-mono text-xs text-foreground">
              {chunks}
            </code>
          ),
        })}
      </p>

      <UnsavedChangesGuard>
        <ConflictGuardedForm
          action={saveAction}
          conflictMessage={t("courses.edit.conflictMessage")}
          reloadLabel={t("courses.edit.conflictReload")}
          className="mt-6 flex flex-col gap-6"
        >
          {/* The row's edit generation, as this render saw it. The save
              compares it and refuses rather than reverting somebody else's
              page (issue #820). `createdAt` when the row has never been saved
              since the column arrived, which is what stops the protection
              switching itself off for a course nobody has edited yet — the
              comparison coalesces the same way. */}
          <input
            type="hidden"
            name="expectedUpdatedAt"
            value={(course.updatedAt ?? course.createdAt).toISOString()}
          />
          {/* These panels are fieldsets, not SectionCards: each legend is the
              accessible name of a control group, and SectionCard deliberately
              has no `fieldset` element. */}
          <fieldset className="rounded-2xl border border-border p-4 sm:p-5">
            <legend className="px-1 text-sm font-semibold">{t("courses.edit.pitchLegend")}</legend>
            <FieldGrid columns={1} className="mt-3 gap-y-5">
              <Field
                label={t("courses.edit.subheadLabel")}
                description={t("courses.edit.subheadDescription")}
              >
                <input
                  id="summary"
                  name="summary"
                  maxLength={200}
                  defaultValue={course.summary ?? ""}
                  className={controlClass}
                />
              </Field>
              <Field
                label={t("courses.edit.overviewLabel")}
                description={t("courses.edit.overviewDescription")}
              >
                <textarea
                  id="overview"
                  name="overview"
                  rows={8}
                  maxLength={6000}
                  defaultValue={course.overview ?? ""}
                  className={controlClass}
                />
              </Field>
            </FieldGrid>
          </fieldset>

          <fieldset className="rounded-2xl border border-border p-4 sm:p-5">
            <legend className="px-1 text-sm font-semibold">
              {t("courses.edit.pricingLegend")}
            </legend>
            <p className="mt-1 text-sm text-muted">{t("courses.edit.pricingDescription")}</p>
            <FieldGrid columns={2} className="mt-4 gap-y-5">
              <PriceField
                id="price"
                name="price"
                label={t("courses.edit.instructionFeeLabel")}
                cents={course.priceCents}
                currency={currency}
                locale={locale}
              />
              <PriceField
                id="eLearningPrice"
                name="eLearningPrice"
                label={t("courses.edit.eLearningFeeLabel")}
                hint={t("courses.edit.eLearningFeeHint")}
                cents={course.eLearningPriceCents}
                currency={currency}
                locale={locale}
              />
              <PriceField
                id="privatePrice"
                name="privatePrice"
                label={t("courses.edit.privatePriceLabel")}
                hint={t("courses.edit.privatePriceHint")}
                cents={course.privatePriceCents}
                currency={currency}
                locale={locale}
              />
            </FieldGrid>
          </fieldset>

          <fieldset className="rounded-2xl border border-border p-4 sm:p-5">
            <legend className="px-1 text-sm font-semibold">{t("courses.edit.photosLegend")}</legend>
            <p className="mt-1 text-sm text-muted">{t("courses.edit.photosDescription")}</p>
            <FieldGrid columns={1} className="mt-4 gap-y-5">
              <Field
                label={t("courses.edit.heroPhotoLabel")}
                hint={t("courses.edit.heroPhotoHint")}
              >
                {course.heroImageUrl ? (
                  <div className="mb-2 flex items-center gap-3">
                    <StoredPhoto
                      src={course.heroImageUrl}
                      alt=""
                      className="h-16 w-24 shrink-0 rounded-lg border border-border"
                      sizes="96px"
                    />
                    <label className="flex min-h-11 items-center gap-2 text-sm">
                      <input type="checkbox" name="removeHero" value="true" className="size-4" />
                      {t("courses.edit.removeCurrentPhoto")}
                    </label>
                  </div>
                ) : null}
                <ImageFileInput
                  name="heroImageFile"
                  copy={{
                    wrongTypeSuffix: t("shared.imageInput.wrongTypeSuffix"),
                    tooBigSuffix: t("shared.imageInput.tooBigSuffix", { maxMb: MAX_IMAGE_MB }),
                  }}
                />
              </Field>
              {course.heroImageUrl ? (
                <Field
                  label={t("courses.edit.photoCaptionLabel")}
                  hint={t("courses.edit.photoCaptionHint")}
                  className="max-w-sm"
                >
                  <input
                    name="heroImageAlt"
                    type="text"
                    maxLength={200}
                    defaultValue={course.heroImageAlt ?? ""}
                    placeholder={t("courses.edit.photoCaptionPlaceholder", { n: 1 })}
                    className={controlClass}
                  />
                </Field>
              ) : null}
              <Field
                label={t("courses.edit.galleryPhotosLabel")}
                hint={t("courses.edit.galleryPhotosHint", {
                  max: MAX_NEW_GALLERY_IMAGES_PER_SUBMISSION,
                })}
              >
                {course.galleryPhotos.length > 0 ? (
                  <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {course.galleryPhotos.map(({ url, alt }, index) => (
                      <div key={url} className="flex flex-col gap-1.5">
                        {/* The whole cell is one label wrapping its own checkbox, so a
                            tap on the photo toggles *that* photo — not the first one. */}
                        <label className="relative block cursor-pointer">
                          <input
                            type="checkbox"
                            name="removeGalleryUrls"
                            value={url}
                            className="peer sr-only"
                          />
                          <StoredPhoto
                            src={url}
                            alt=""
                            className="h-24 w-full rounded-lg border-2 border-border transition peer-checked:border-danger peer-checked:opacity-50"
                            sizes="(min-width: 640px) 25vw, 50vw"
                          />
                          <span
                            aria-hidden="true"
                            className="absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-full border border-border-strong bg-surface/90 text-sm text-transparent shadow-sm transition peer-checked:border-danger peer-checked:bg-danger/15 peer-checked:text-danger"
                          >
                            ✓
                          </span>
                          <span className="mt-1 block text-xs font-medium text-muted transition peer-checked:text-danger">
                            {t("courses.edit.removeLabel")}
                          </span>
                        </label>
                        <input type="hidden" name="galleryAltUrls" value={url} />
                        <Field
                          label={t("courses.edit.photoCaptionLabel")}
                          className="text-xs"
                          htmlFor={`gallery-alt-${index}`}
                        >
                          <input
                            id={`gallery-alt-${index}`}
                            name="galleryAltValues"
                            type="text"
                            maxLength={200}
                            defaultValue={alt}
                            placeholder={t("courses.edit.photoCaptionPlaceholder", {
                              n: index + 2,
                            })}
                            className={`${controlClass} text-xs`}
                          />
                        </Field>
                      </div>
                    ))}
                  </div>
                ) : null}
                <ImageFileInput
                  name="galleryImageFiles"
                  multiple
                  maxFiles={MAX_NEW_GALLERY_IMAGES_PER_SUBMISSION}
                  copy={{
                    tooMany: t("shared.imageInput.tooMany", {
                      count: MAX_NEW_GALLERY_IMAGES_PER_SUBMISSION,
                    }),
                    wrongTypeSuffix: t("shared.imageInput.wrongTypeSuffix"),
                    tooBigSuffix: t("shared.imageInput.tooBigSuffix", { maxMb: MAX_IMAGE_MB }),
                  }}
                />
              </Field>
            </FieldGrid>
          </fieldset>

          <fieldset className="rounded-2xl border border-border p-4 sm:p-5">
            <legend className="px-1 text-sm font-semibold">{t("courses.edit.glanceLegend")}</legend>
            <p className="mt-1 text-sm text-muted">{t("courses.edit.glanceDescription")}</p>
            <FieldGrid columns={2} className="mt-4 gap-y-5">
              <Field label={t("courses.edit.durationLabel")}>
                <input
                  id="durationText"
                  name="durationText"
                  maxLength={120}
                  defaultValue={course.durationText ?? ""}
                  placeholder={t("courses.edit.durationPlaceholder")}
                  className={controlClass}
                />
              </Field>
              <Field label={t("courses.edit.groupSizeLabel")}>
                <input
                  id="groupSizeText"
                  name="groupSizeText"
                  maxLength={120}
                  defaultValue={course.groupSizeText ?? ""}
                  placeholder={t("courses.edit.groupSizePlaceholder")}
                  className={controlClass}
                />
              </Field>
            </FieldGrid>
            {/* Filed with how the course *runs* rather than with who may take
                it: this answers "do we teach this one on enriched air", which
                is the shop's own call about its own gas, not an agency
                admission rule like the two facts in the next box. Unticked, no
                session of this course offers the nitrox box at all — on the
                booking page or on the pre-trip form — however much nitrox the
                shop fills (`nitroxAvailableOn`, src/lib/rentals.ts). */}
            <label className="mt-5 flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="nitroxCompatible"
                value="true"
                defaultChecked={course.nitroxCompatible}
                className="size-4"
              />
              {t("courses.edit.nitroxCompatibleLabel")}
            </label>
            <p className="mt-1 text-sm text-muted">{t("courses.edit.nitroxCompatibleHint")}</p>
          </fieldset>

          <fieldset className="rounded-2xl border border-border p-4 sm:p-5">
            <legend className="px-1 text-sm font-semibold">{t("courses.edit.enrollLegend")}</legend>
            <p className="mt-1 text-sm text-muted">
              {t.rich("courses.edit.enrollDescription", {
                levelAge,
                strong: (chunks: ReactNode) => (
                  <strong className="font-medium text-foreground">{chunks}</strong>
                ),
              })}
            </p>
            {/* No "this is a taster session" tick box. Which courses are
                tasters is not something a shop tells DiveDay — DiveDay ships
                the catalogue and already knows (`isIntroCourse` on the
                published templates, src/db/course-templates.ts): Discover
                Scuba and Try Scuba are, and an Advanced Open Water is not.
                Worse, it was a safety control wearing a checkbox: the flag
                picks the tighter 2:1 in-water ratio (src/lib/course-ratios.ts,
                HD-6), so the box existed only to let someone quietly turn that
                cap off on a course full of people who have never breathed
                underwater. The column stays; the way to set it is to be one of
                those courses. */}
            <FieldGrid columns={1} className="mt-4 gap-y-5">
              <Field label={t("courses.edit.prerequisiteLabel")}>
                <textarea
                  id="prerequisiteNote"
                  name="prerequisiteNote"
                  rows={4}
                  maxLength={400}
                  defaultValue={course.prerequisiteNote ?? ""}
                  placeholder={t("courses.edit.prerequisitePlaceholder")}
                  className={controlClass}
                />
              </Field>
            </FieldGrid>
          </fieldset>

          <fieldset className="rounded-2xl border border-border p-4 sm:p-5">
            <legend className="px-1 text-sm font-semibold">
              {t("courses.edit.feeCoversLegend")}
            </legend>
            <FieldGrid columns={2} className="mt-3 gap-y-5">
              <Field
                label={t("courses.edit.includedLabel")}
                description={t("courses.edit.oneItemPerLine")}
              >
                <textarea
                  id="includes"
                  name="includes"
                  rows={6}
                  maxLength={2000}
                  defaultValue={course.includes.join("\n")}
                  placeholder={t("courses.edit.includedPlaceholder")}
                  className={controlClass}
                />
              </Field>
              <Field
                label={t("courses.edit.notIncludedLabel")}
                description={t("courses.edit.oneItemPerLine")}
              >
                <textarea
                  id="excludes"
                  name="excludes"
                  rows={6}
                  maxLength={2000}
                  defaultValue={course.excludes.join("\n")}
                  placeholder={t("courses.edit.notIncludedPlaceholder")}
                  className={controlClass}
                />
              </Field>
            </FieldGrid>
          </fieldset>

          <fieldset id="scheduleDaysJson" className="rounded-2xl border border-border p-4 sm:p-5">
            <legend className="px-1 text-sm font-semibold">
              {t("courses.edit.dayByDayLegend")}
            </legend>
            <div className="mt-4">
              <DayByDayEditor
                initialDays={course.scheduleDays}
                copy={{
                  dayLabel: t.raw("courses.dayByDay.dayLabel"),
                  removeDay: t("courses.dayByDay.removeDay"),
                  dayTitleLabel: t.raw("courses.dayByDay.dayTitleLabel"),
                  dayTitlePlaceholder: t("courses.dayByDay.dayTitlePlaceholder"),
                  startTimeLabel: t.raw("courses.dayByDay.startTimeLabel"),
                  endTimeLabel: t.raw("courses.dayByDay.endTimeLabel"),
                  timeNoteLabel: t.raw("courses.dayByDay.timeNoteLabel"),
                  timeNoteDescription: t("courses.dayByDay.timeNoteDescription"),
                  timeNoteTitle: t("courses.dayByDay.timeNoteTitle"),
                  timeNotePlaceholder: t("courses.dayByDay.timeNotePlaceholder"),
                  whatHappens: t.raw("courses.dayByDay.whatHappens"),
                  whatHappensHint: t("courses.edit.oneItemPerLine"),
                  itemsPlaceholder: t("courses.dayByDay.itemsPlaceholder"),
                  itemsOverMaxOne: t.raw("courses.dayByDay.itemsOverMaxOne"),
                  itemsOverMaxOther: t.raw("courses.dayByDay.itemsOverMaxOther"),
                  daysMaxOne: t.raw("courses.dayByDay.daysMaxOne"),
                  daysMaxOther: t.raw("courses.dayByDay.daysMaxOther"),
                  addDay: t("courses.dayByDay.addDay"),
                }}
              />
            </div>
          </fieldset>

          <fieldset className="rounded-2xl border border-border p-4 sm:p-5">
            <legend className="px-1 text-sm font-semibold">{t("courses.edit.faqLegend")}</legend>
            <p className="mt-1 text-sm text-muted">{t("courses.edit.faqDescription")}</p>
            <FieldGrid columns={1} className="mt-4">
              <Field label={t("courses.edit.faqLabel")}>
                <textarea
                  id="faqs"
                  name="faqs"
                  rows={10}
                  maxLength={12000}
                  defaultValue={formatFaqs(course.faqs)}
                  placeholder={t("courses.edit.faqPlaceholder")}
                  className={controlClass}
                />
              </Field>
            </FieldGrid>
          </fieldset>

          {/* One control, not two. "Preview" opened the same page the "Live
              at" link in the header already points at, and a second
              button-shaped thing beside Save competes with the only action
              this form has (design principles #8). */}
          {/* The refusal belongs beside the button that earned it, not in a
              banner thirty lines above the first field: this editor runs to
              five fieldsets, so a staffer who pressed Save at the bottom saw
              nothing happen at all. `FieldErrorFocus` above still carries them
              on to the offending box when the server named one. */}
          <FieldActions>
            <SubmitButton pendingLabel={t("courses.edit.saving")} className={buttonClass()}>
              {t("courses.edit.savePage")}
            </SubmitButton>
            <FormStatus tone="danger">{errorText}</FormStatus>
          </FieldActions>
        </ConflictGuardedForm>
      </UnsavedChangesGuard>
    </main>
  );
}
