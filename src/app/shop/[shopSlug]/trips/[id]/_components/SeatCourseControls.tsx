import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid, textareaClassFor } from "@/components/ui/form";
import { CERTIFICATION_LEVEL_KEYS, SPECIALTY_KEYS } from "@/i18n/readiness-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { CertificationLevel } from "@/lib/certification-levels";

/**
 * The course session's two acts of teaching (issues #717, #975, #1196, #1205):
 * certify this student, and what they do next. Each renders only when its
 * action is present, which is only on a course session's own roster.
 */
export function SeatCourseControls({
  bookingId,
  personId,
  t,
  certifyDiverAction,
  certifyDefaultLevel,
  saveCourseNextStepAction,
  nextStep,
  setCourseMaterialsDoneAction,
  materialsDoneLine,
  certifyMaterialsNote = null,
}: {
  bookingId: string;
  personId: string;
  t: StaffTranslator;
  certifyDiverAction?: (formData: FormData) => void;
  certifyDefaultLevel: CertificationLevel | null;
  saveCourseNextStepAction?: (formData: FormData) => void;
  nextStep: string;
  setCourseMaterialsDoneAction?: (formData: FormData) => void;
  /** "Materials done · Oct 7" once ticked; null while they are not. */
  materialsDoneLine: string | null;
  /**
   * The neutral line beside Certify when the course has materials nobody has
   * marked done. It informs and never blocks: the agency's own record is the
   * evidence, and the instructor reads it there.
   */
  certifyMaterialsNote?: string | null;
}) {
  return (
    <>
      {/* The learning-materials tick (ADR 20261008-course-learning-materials):
          one tap, and the same tap takes it back. The state is the name
          line's capsule and the date line here, so the button only names
          what it will do. */}
      {setCourseMaterialsDoneAction ? (
        <form
          action={setCourseMaterialsDoneAction}
          className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1"
        >
          <input type="hidden" name="bookingId" value={bookingId} />
          <input type="hidden" name="done" value={materialsDoneLine ? "false" : "true"} />
          {materialsDoneLine ? (
            <span className="text-sm text-muted">{materialsDoneLine}</span>
          ) : null}
          <SubmitButton
            pendingLabel={t("trips.roster.materialsSaving")}
            className={
              materialsDoneLine
                ? buttonClass({ variant: "link", size: "sm", flush: true })
                : buttonClass({ variant: "secondary", size: "sm" })
            }
          >
            {materialsDoneLine
              ? t("trips.roster.materialsMarkNotDone")
              : t("trips.roster.materialsMarkDone")}
          </SubmitButton>
        </form>
      ) : null}

      {/* The one path from "this shop taught and ran this course" to a card
          row (issues #717 and #975) — a per-student tap, collapsed by
          default. Present only on a course session's own roster. */}
      {certifyDiverAction ? (
        <details className="mt-3">
          <summary
            className={buttonClass({
              variant: "secondary",
              size: "sm",
              className: "cursor-pointer list-none",
            })}
          >
            {t("trips.roster.certifyDiver")}
          </summary>
          <FieldGrid
            as="form"
            action={certifyDiverAction}
            columns={1}
            className="mt-2 gap-y-3 sm:w-72"
          >
            <input type="hidden" name="bookingId" value={bookingId} />
            <input type="hidden" name="personId" value={personId} />
            {certifyMaterialsNote ? (
              <p className="text-sm text-muted">{certifyMaterialsNote}</p>
            ) : null}
            <Field
              label={t("trips.roster.certifyLevel")}
              description={t("trips.roster.certifyLevelHint")}
            >
              {/* Opens on the rung the course issues, or on nothing: a
                  course that issues none (a specialty, a refresher the shop
                  wrote itself) must never put a level in front of the
                  instructor to confirm by reflex (dive-domain review). */}
              <select
                name="award"
                required
                className={controlClass}
                defaultValue={certifyDefaultLevel ?? ""}
              >
                <option value="" disabled>
                  {t("trips.roster.certifyChoose")}
                </option>
                <optgroup label={t("trips.roster.certifyLevelGroup")}>
                  {Object.entries(CERTIFICATION_LEVEL_KEYS).map(([value, key]) => (
                    <option key={value} value={value}>
                      {t(key)}
                    </option>
                  ))}
                </optgroup>
                <optgroup label={t("trips.roster.certifySpecialtyGroup")}>
                  {Object.entries(SPECIALTY_KEYS).map(([value, key]) => (
                    <option key={value} value={value}>
                      {t(key)}
                    </option>
                  ))}
                  <option value="nitrox">{t("trips.roster.certifyNitrox")}</option>
                </optgroup>
              </select>
            </Field>
            <SubmitButton
              pendingLabel={t("trips.roster.certifying")}
              className={buttonClass({ variant: "secondary", size: "sm" })}
            >
              {t("trips.roster.certifyConfirm")}
            </SubmitButton>
          </FieldGrid>
        </details>
      ) : null}

      {/* What this student does next, written once and read on their recap
          (issues #1196, #1205). Beside the card above and under the same
          condition: both are things only a course session's instructor has
          to say, and neither is offered on a fun dive. */}
      {saveCourseNextStepAction ? (
        <details className="mt-3">
          <summary
            className={buttonClass({
              variant: "secondary",
              size: "sm",
              className: "cursor-pointer list-none",
            })}
          >
            {t("trips.roster.nextStepSummary")}
          </summary>
          <FieldGrid
            as="form"
            action={saveCourseNextStepAction}
            columns={1}
            className="mt-2 gap-y-3 sm:w-72"
          >
            <input type="hidden" name="bookingId" value={bookingId} />
            <Field
              label={t("trips.roster.nextStepLabel")}
              description={t("trips.roster.nextStepDescription")}
            >
              <textarea
                name="note"
                rows={2}
                maxLength={280}
                defaultValue={nextStep}
                className={textareaClassFor(2)}
              />
            </Field>
            <SubmitButton
              pendingLabel={t("trips.roster.nextStepSaving")}
              className={buttonClass({ variant: "secondary", size: "sm" })}
            >
              {t("trips.roster.nextStepSave")}
            </SubmitButton>
          </FieldGrid>
        </details>
      ) : null}
    </>
  );
}
