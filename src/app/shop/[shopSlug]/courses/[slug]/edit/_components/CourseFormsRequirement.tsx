import Link from "next/link";
import { ChoiceRow, controlClass, FormStatus } from "@/components/ui/form";
import { StatusInView } from "@/components/ui/StatusInView";
import { canPersonManageWaiverTemplates } from "@/db/authz";
import type { AppDb } from "@/db/client";
import {
  COURSE_FORM_MAX_AGE_MAX,
  COURSE_FORM_MAX_AGE_MIN,
  type CourseFormImpact,
  type CourseFormSummary,
  courseUpcomingEnrollment,
  listCourseFormAgeBounds,
  listCourseFormRequirements,
  listCourseForms,
} from "@/db/course-forms";
import { ownerOrManagerWords, sayWords } from "@/i18n/shared-sentences";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { courseFormAwaitingText } from "@/lib/course-forms";
import type { NoticeTone } from "@/lib/staff-notices";
import { CourseSection } from "./CourseSection";

/**
 * What the Forms section needs, read for one course and one reader: every
 * form the shop has written, the ones this course asks for in order, whether
 * the reader may write forms, and the section's own outcome from `?notice=`.
 */
export async function loadCourseFormsRequirement(
  db: AppDb,
  input: { shopId: string; courseId: string; personId: string; notice: string | undefined },
  t: StaffTranslator,
) {
  const [forms, required, ageBounds, canWriteForms, addImpact] = await Promise.all([
    listCourseForms(db, input.shopId),
    listCourseFormRequirements(db, input.shopId, input.courseId),
    listCourseFormAgeBounds(db, input.shopId, input.courseId),
    canPersonManageWaiverTemplates(db, input.shopId, input.personId),
    courseUpcomingEnrollment(db, input.shopId, input.courseId),
  ]);
  return {
    forms,
    required,
    ageBounds,
    canWriteForms,
    addImpact,
    notice: courseFormsNotice(input.notice, t),
  };
}

/**
 * The Forms section's own outcome, shown beside its button rather than in the
 * page's banner (a staffer who pressed it is looking at it). Codes the other
 * forms on the page send are not in this map, so they fall through to the banner.
 */
function courseFormsNotice(
  notice: string | undefined,
  t: StaffTranslator,
): { tone: NoticeTone; text: string } | undefined {
  if (notice === "forms-invalid") return { tone: "danger", text: t("courses.edit.forms.invalid") };
  if (notice === "forms-invalid-age") {
    return { tone: "danger", text: t("courses.edit.forms.invalidAge") };
  }
  if (notice === "forms-medical-age") {
    return { tone: "danger", text: t("courses.edit.forms.medicalAge") };
  }
  if (notice === "forms-not-authorized") {
    return { tone: "danger", text: t("courses.edit.forms.notAuthorized") };
  }
  if (notice === "forms-remove-not-authorized") {
    return {
      tone: "danger",
      text: `${t("courses.edit.forms.removeNotSaved")} ${sayWords(t, ownerOrManagerWords("courseForm"))}`,
    };
  }
  return undefined;
}

/**
 * **Which course forms this course asks each student to sign** (ADR
 * 20261008-course-forms).
 *
 * Its own `<form>` below the page's save form, because a form cannot nest in
 * another and because this is not page prose: it changes who is Blocked on
 * every session of the course the moment it saves, so it does not wait on the
 * page's Save or ride its conflict guard. The forms themselves are written on
 * the release's page, so this only chooses, and links there to write one.
 *
 * Ticked forms are listed first in the order students meet them; the number
 * box beside each is that order. A reader who may not take a form off (not an
 * owner or manager) sees the course's forms ticked and fixed, still posted,
 * so their save can add and reorder but never drop one. Beside the button,
 * who a form added now would ask to sign, before the tap.
 *
 * Under each form, an optional age: the form is then asked only of students
 * that age or younger on the session's first day (issue #2265), as PADI asks
 * its youth acknowledgment of 10- and 11-year-olds. Blank asks everyone.
 */
export function CourseFormsRequirement({
  id,
  label,
  closed,
  open,
  forms,
  required,
  ageBounds,
  notice,
  waiversPath,
  canWriteForms,
  addImpact,
  t,
}: {
  id: string;
  label: string;
  /** Closed behind its name on the editor (visual review 2026-10-24, A11). */
  closed?: boolean;
  /** Opened by a forms notice, so the answer is not behind a shut disclosure. */
  open?: boolean;
  forms: readonly CourseFormSummary[];
  /** The ids this course requires now, in order. */
  required: readonly string[];
  /** The age bound on each required form that has one (issue #2265). */
  ageBounds?: ReadonlyMap<string, number>;
  notice: { tone: NoticeTone; text: string } | undefined;
  /** The waivers page, where forms are written; each form is an anchor on it. */
  waiversPath: string;
  /** Whether the reader may write forms (owner or manager), so the link goes somewhere. */
  canWriteForms: boolean;
  /** Every live seat on a session of this course that has not started. */
  addImpact: CourseFormImpact;
  t: StaffTranslator;
}) {
  const position = new Map(required.map((formId, index) => [formId, index]));
  const ordered = [...forms].sort(
    (a, b) =>
      (position.get(a.id) ?? Number.POSITIVE_INFINITY) -
      (position.get(b.id) ?? Number.POSITIVE_INFINITY),
  );
  return (
    <CourseSection
      unsavedTag={t("shared.formDraft.unsavedSection")}
      id={id}
      label={label}
      closed={closed}
      open={open}
      as="fieldset"
      description={t("courses.edit.forms.description")}
    >
      {/* Part of the editor's one form now, saved by its one Save (visual
            review 2026-10-24, A11). The marker says this reader was shown the
            list, so a save without it never reads as "ask for no forms". */}
      <input type="hidden" name="formsSection" value="1" />
      {forms.length === 0 ? (
        <p className="text-sm text-muted">{t("courses.edit.forms.none")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {ordered.map((form) => {
            const at = position.get(form.id);
            return (
              <li key={form.id} className="flex flex-col gap-2">
                <div className="min-w-0 flex-1">
                  {at !== undefined && !canWriteForms ? (
                    <>
                      <input type="hidden" name="formId" value={form.id} />
                      <ChoiceRow
                        type="checkbox"
                        checked
                        disabled
                        readOnly
                        className="min-w-0 [overflow-wrap:anywhere]"
                      >
                        {form.title}
                      </ChoiceRow>
                    </>
                  ) : (
                    <ChoiceRow
                      className="min-w-0 [overflow-wrap:anywhere]"
                      type="checkbox"
                      name="formId"
                      value={form.id}
                      defaultChecked={at !== undefined}
                    >
                      {form.title}
                    </ChoiceRow>
                  )}
                  {/* A form made from the course's template starts with no
                        text, and asks nobody anything until it has some. */}
                  {courseFormAwaitingText(form.body) ? (
                    <p className="text-sm text-warning-strong" data-course-form-awaiting-text>
                      {canWriteForms ? (
                        <Link
                          href={`${waiversPath}#course-form-${form.id}`}
                          className="font-medium hover:underline"
                        >
                          {t("courses.edit.forms.pasteWording")}
                        </Link>
                      ) : (
                        t("courses.edit.forms.pasteWording")
                      )}
                      {". "}
                      {t("courses.edit.forms.awaitingText")}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-start gap-4 ps-7">
                  <label className="flex flex-col gap-1 text-sm text-muted">
                    {t("courses.edit.forms.displayOrder")}
                    <span className="w-20">
                      <input
                        type="number"
                        name={`order-${form.id}`}
                        min={1}
                        max={forms.length}
                        defaultValue={at === undefined ? "" : at + 1}
                        aria-label={t("courses.edit.forms.orderLabel", { form: form.title })}
                        className={controlClass}
                      />
                    </span>
                  </label>
                  {/* A medical statement is every student's: no age (G3). */}
                  {form.medicalScreening ? null : (
                    <label className="flex flex-col gap-1 text-sm text-muted">
                      {t("courses.edit.forms.maxAgeLabel")}
                      <span className="w-20">
                        <input
                          type="number"
                          name={`maxAge-${form.id}`}
                          min={COURSE_FORM_MAX_AGE_MIN}
                          max={COURSE_FORM_MAX_AGE_MAX}
                          defaultValue={ageBounds?.get(form.id) ?? ""}
                          aria-label={t("courses.edit.forms.maxAgeAria", { form: form.title })}
                          className={controlClass}
                        />
                      </span>
                    </label>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {canWriteForms ? (
        <p className="text-sm">
          <Link
            href={`${waiversPath}#course-form-new`}
            className="font-medium text-primary hover:underline"
          >
            {t("courses.edit.forms.writeLink")}
          </Link>
        </p>
      ) : null}
      {!canWriteForms && required.length > 0 ? (
        <p className="text-sm text-muted">{sayWords(t, ownerOrManagerWords("courseForm"))}</p>
      ) : null}
      {forms.length > required.length && addImpact.students > 0 ? (
        <p className="text-sm text-muted" data-course-form-add-impact>
          {t("courses.edit.forms.addImpact", {
            students: addImpact.students,
            sessions: addImpact.sessions,
          })}
        </p>
      ) : null}
      {notice ? (
        <>
          <FormStatus tone={notice.tone}>{notice.text}</FormStatus>
          <StatusInView />
        </>
      ) : null}
    </CourseSection>
  );
}
