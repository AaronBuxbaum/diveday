import { AutoOpenDetails } from "@/components/AutoOpenDetails";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { controlClass, Field, FieldGrid, FormStatus, textareaClassFor } from "@/components/ui/form";
import { InlineConfirm } from "@/components/ui/InlineConfirm";
import { GroupLabel } from "@/components/ui/ledger";
import { StatusInView } from "@/components/ui/StatusInView";
import type { CourseFormImpact, CourseFormSummary } from "@/db/course-forms";
import type { StaffTranslator } from "@/i18n/staff-messages";
import {
  COURSE_FORM_BODY_MAX,
  COURSE_FORM_BODY_MIN,
  COURSE_FORM_TITLE_MAX,
  courseFormAwaitingText,
} from "@/lib/course-forms";
import { formatShortDate } from "@/lib/format";
import type { NoticeTone } from "@/lib/staff-notices";
import { deleteCourseFormAction, saveCourseFormAction } from "../actions";

/** A course-form outcome, and which form on the page it belongs beside. */
export type CourseFormNotice = { form: string; tone: NoticeTone; text: string };

/**
 * **Course forms, on the release's own page** (ADR 20261008-course-forms).
 *
 * The forms a course asks each student to sign on top of the release — an
 * agency's course release, a safe-diving-practices statement — are the same
 * kind of thing as the release: the shop's own legal words, pasted in,
 * versioned on every edit, and owner or manager work. So they are written
 * here, beside the release, and *chosen* on each course's page.
 *
 * Each form is a door that opens in place, like the release above it; a save
 * or a refusal lands back on that form's own anchor with its outcome beside
 * the button that earned it.
 */
export function CourseFormsSection({
  forms,
  resign,
  notice,
  locale,
  timezone,
  t,
}: {
  forms: readonly CourseFormSummary[];
  /** Who a new version of each form asks to sign again, said before the Save. */
  resign: ReadonlyMap<string, CourseFormImpact>;
  notice: CourseFormNotice | undefined;
  locale: string;
  timezone: string;
  t: StaffTranslator;
}) {
  const statusFor = (form: string) =>
    notice?.form === form ? (
      <>
        <FormStatus tone={notice.tone}>{notice.text}</FormStatus>
        <StatusInView />
      </>
    ) : null;

  return (
    <section
      className="mt-10 scroll-mt-24"
      id="course-forms"
      aria-labelledby="course-forms-heading"
    >
      <GroupLabel as="h2" id="course-forms-heading">
        {t("waiversStaff.courseForms.heading")}
      </GroupLabel>
      <p className="mt-2 text-sm text-muted">{t("waiversStaff.courseForms.intro")}</p>
      {statusFor("list")}
      <ul className="mt-4 flex flex-col gap-3">
        {forms.map((form) => (
          <li key={form.id}>
            <AutoOpenDetails
              id={`course-form-${form.id}`}
              openOnHash={`course-form-${form.id}`}
              open={notice?.form === form.id}
              className="group/form scroll-mt-24"
            >
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
                <DisclosureCaret className="group-open/form:rotate-90" />
                <span className="font-medium">{form.title}</span>
                {courseFormAwaitingText(form.body) ? (
                  <Badge tone="warning" size="sm">
                    {t("waiversStaff.courseForms.needsText")}
                  </Badge>
                ) : null}
                <span className="text-sm text-muted">
                  {t("waiversStaff.courseForms.versionLine", {
                    version: form.version,
                    date: formatShortDate(form.updatedAt, locale, timezone),
                  })}
                </span>
              </summary>
              <SectionCard padding="lg" className="mt-2">
                <form action={saveCourseFormAction} className="flex flex-col gap-5">
                  <input type="hidden" name="formId" value={form.id} />
                  <CourseFormFields
                    idPrefix={form.id}
                    title={form.title}
                    body={form.body}
                    bodyDescription={t(
                      courseFormAwaitingText(form.body)
                        ? "waiversStaff.courseForms.needsTextDescription"
                        : "waiversStaff.courseForms.editDescription",
                    )}
                    t={t}
                  />
                  <ResignImpact impact={resign.get(form.id)} t={t} />
                  <div className="flex flex-wrap items-center gap-3">
                    <SubmitButton
                      pendingLabel={t("waiversStaff.courseForms.saving")}
                      className={buttonClass()}
                    >
                      {t("waiversStaff.courseForms.save")}
                    </SubmitButton>
                    <InlineConfirm
                      triggerLabel={t("waiversStaff.courseForms.delete")}
                      confirmLabel={t("waiversStaff.courseForms.deleteConfirm")}
                      pendingLabel={t("waiversStaff.courseForms.deleting")}
                      triggerClassName={buttonClass({ variant: "danger-ghost", size: "sm" })}
                      formAction={deleteCourseFormAction}
                      autoResetMs={6000}
                    />
                  </div>
                  {statusFor(form.id)}
                </form>
              </SectionCard>
            </AutoOpenDetails>
          </li>
        ))}
      </ul>

      <AutoOpenDetails
        id="course-form-new"
        openOnHash="course-form-new"
        open={notice?.form === "new"}
        className="group/new mt-4 scroll-mt-24"
      >
        <summary
          className={`${buttonClass({ variant: "secondary" })} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}
        >
          {t("waiversStaff.courseForms.newForm")}
          <DisclosureCaret className="group-open/new:rotate-90" />
        </summary>
        <SectionCard padding="lg" className="mt-4">
          <form action={saveCourseFormAction} className="flex flex-col gap-5">
            <CourseFormFields idPrefix="new" title="" body="" t={t} />
            <div>
              <SubmitButton
                pendingLabel={t("waiversStaff.courseForms.saving")}
                className={buttonClass()}
              >
                {t("waiversStaff.courseForms.create")}
              </SubmitButton>
            </div>
            {statusFor("new")}
          </form>
        </SectionCard>
      </AutoOpenDetails>
    </section>
  );
}

/**
 * What saving new words costs, before the tap: the students on sessions not
 * yet started who signed this version and will be asked again. Nothing when
 * nobody would be.
 */
function ResignImpact({ impact, t }: { impact: CourseFormImpact | undefined; t: StaffTranslator }) {
  if (!impact || impact.students === 0) return null;
  return (
    <p className="text-sm text-warning-strong" data-course-form-resign-impact>
      {t("waiversStaff.courseForms.resignImpact", {
        students: impact.students,
        sessions: impact.sessions,
      })}
    </p>
  );
}

function CourseFormFields({
  idPrefix,
  title,
  body,
  bodyDescription,
  t,
}: {
  idPrefix: string;
  title: string;
  body: string;
  bodyDescription?: string;
  t: StaffTranslator;
}) {
  return (
    <FieldGrid columns={1} className="gap-y-5">
      <Field
        label={t("waiversStaff.courseForms.titleLabel")}
        htmlFor={`course-form-title-${idPrefix}`}
      >
        <input
          id={`course-form-title-${idPrefix}`}
          name="title"
          required
          minLength={2}
          maxLength={COURSE_FORM_TITLE_MAX}
          defaultValue={title}
          className={controlClass}
        />
      </Field>
      <Field
        label={t("waiversStaff.courseForms.bodyLabel")}
        description={[bodyDescription, t("waiversStaff.courseForms.placeholdersHint")]
          .filter(Boolean)
          .join(" ")}
        htmlFor={`course-form-body-${idPrefix}`}
      >
        <textarea
          id={`course-form-body-${idPrefix}`}
          name="body"
          required
          minLength={COURSE_FORM_BODY_MIN}
          maxLength={COURSE_FORM_BODY_MAX}
          rows={8}
          defaultValue={body}
          placeholder={t("waiversStaff.courseForms.bodyPlaceholder")}
          className={textareaClassFor(8)}
        />
      </Field>
    </FieldGrid>
  );
}
