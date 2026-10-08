import Link from "next/link";
import { EditorSection } from "@/components/editor/EditorSection";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { ChoiceRow, controlClass, FormStatus } from "@/components/ui/form";
import { StatusInView } from "@/components/ui/StatusInView";
import { canPersonManageWaiverTemplates } from "@/db/authz";
import type { AppDb } from "@/db/client";
import {
  type CourseFormSummary,
  listCourseFormRequirements,
  listCourseForms,
} from "@/db/course-forms";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { courseFormAwaitingText } from "@/lib/course-forms";
import type { NoticeTone } from "@/lib/staff-notices";

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
  const [forms, required, canWriteForms] = await Promise.all([
    listCourseForms(db, input.shopId),
    listCourseFormRequirements(db, input.shopId, input.courseId),
    canPersonManageWaiverTemplates(db, input.shopId, input.personId),
  ]);
  return { forms, required, canWriteForms, notice: courseFormsNotice(input.notice, t) };
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
  if (notice === "forms-saved") return { tone: "success", text: t("courses.edit.forms.saved") };
  if (notice === "forms-invalid") return { tone: "danger", text: t("courses.edit.forms.invalid") };
  if (notice === "forms-not-authorized") {
    return { tone: "danger", text: t("courses.edit.forms.notAuthorized") };
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
 * box beside each is that order.
 */
export function CourseFormsRequirement({
  id,
  label,
  forms,
  required,
  notice,
  action,
  waiversPath,
  canWriteForms,
  t,
}: {
  id: string;
  label: string;
  forms: readonly CourseFormSummary[];
  /** The ids this course requires now, in order. */
  required: readonly string[];
  notice: { tone: NoticeTone; text: string } | undefined;
  action: (formData: FormData) => Promise<void>;
  /** The waivers page, where forms are written; each form is an anchor on it. */
  waiversPath: string;
  /** Whether the reader may write forms (owner or manager), so the link goes somewhere. */
  canWriteForms: boolean;
  t: StaffTranslator;
}) {
  const position = new Map(required.map((formId, index) => [formId, index]));
  const ordered = [...forms].sort(
    (a, b) =>
      (position.get(a.id) ?? Number.POSITIVE_INFINITY) -
      (position.get(b.id) ?? Number.POSITIVE_INFINITY),
  );
  return (
    <form action={action} className="mt-8">
      <EditorSection
        id={id}
        label={label}
        as="fieldset"
        description={t("courses.edit.forms.description")}
      >
        {forms.length === 0 ? (
          <p className="text-sm text-muted">{t("courses.edit.forms.none")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {ordered.map((form) => {
              const at = position.get(form.id);
              return (
                <li key={form.id} className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <ChoiceRow
                      type="checkbox"
                      name="formId"
                      value={form.id}
                      defaultChecked={at !== undefined}
                    >
                      {form.title}
                    </ChoiceRow>
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
                  <input
                    type="number"
                    name={`order-${form.id}`}
                    min={1}
                    max={forms.length}
                    defaultValue={at === undefined ? "" : at + 1}
                    aria-label={t("courses.edit.forms.orderLabel", { form: form.title })}
                    className={`${controlClass} w-20 shrink-0`}
                  />
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
        {forms.length === 0 ? null : (
          <div className="flex flex-wrap items-center gap-3">
            <SubmitButton
              pendingLabel={t("courses.edit.saving")}
              className={buttonClass({ variant: "secondary" })}
            >
              {t("courses.edit.forms.save")}
            </SubmitButton>
          </div>
        )}
        {notice ? (
          <>
            <FormStatus tone={notice.tone}>{notice.text}</FormStatus>
            <StatusInView />
          </>
        ) : null}
      </EditorSection>
    </form>
  );
}
