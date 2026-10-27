import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field } from "@/components/ui/form";
import { StatusMarkColumn } from "@/components/ui/StatusMark";
import type { TrainingMarkRosterSeat } from "@/db/training-marks";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatShortDate } from "@/lib/format";

/**
 * **A training mark on a charter seat** (issue #2275, ADR
 * 20261012-course-forms-on-charters-and-counter): staff say this dive counts
 * toward one of the diver's course seats, and the seat is asked that course's
 * forms. Only on a departure that is not a course session.
 *
 * Marked, the row says for which course, warns when the mark no longer fits
 * its course seat or the course's instructor is not on the crew (the seat then
 * keeps the departure's own level, issue #2731), and offers the clear. Not
 * marked, it offers the diver's course seats the writer would accept. A mark
 * cleared while forms were owed stays named, as the manifest names it.
 */
export function TrainingMarkControl({
  bookingId,
  training,
  markAction,
  clearAction,
  locale,
  timezone,
  t,
}: {
  bookingId: string;
  training: TrainingMarkRosterSeat;
  markAction: ((formData: FormData) => void) | undefined;
  clearAction: ((formData: FormData) => void) | undefined;
  locale: string;
  timezone: string;
  t: StaffTranslator;
}) {
  const { mark, options, clearedWithFormsOwed } = training;
  return (
    <div className="mt-3 flex flex-col gap-2" data-training-mark={bookingId}>
      {clearedWithFormsOwed && !mark ? (
        <p className="flex items-baseline gap-2 text-sm text-warning-strong">
          <StatusMarkColumn variant="warning" />
          <span>
            {t("trips.roster.trainingMark.clearedWithFormsOwed", {
              hasName: clearedWithFormsOwed.byName ? "yes" : "no",
              name: clearedWithFormsOwed.byName ?? "",
            })}
          </span>
        </p>
      ) : null}
      {mark ? (
        <>
          {/* A mark that no longer fits says so in the row's own blocker
              line (`training_mark_invalid`); here only its clear. */}
          {mark.valid ? (
            <p className="text-sm">
              {t("trips.roster.trainingMark.marked", { course: mark.courseTitle ?? "" })}
            </p>
          ) : null}
          {mark.valid && !mark.courseInstructorAboard ? (
            <p className="flex items-baseline gap-2 text-sm text-warning-strong">
              <StatusMarkColumn variant="warning" />
              <span>{t("trips.roster.trainingMark.noInstructor")}</span>
            </p>
          ) : null}
          {mark.valid && mark.siteAttributionUnknown ? (
            <p className="flex items-baseline gap-2 text-sm text-warning-strong">
              <StatusMarkColumn variant="warning" />
              <span>{t("trips.roster.trainingMark.siteAttributionUnknown")}</span>
            </p>
          ) : null}
          {clearAction ? (
            <form action={clearAction}>
              <input type="hidden" name="bookingId" value={bookingId} />
              <SubmitButton
                pendingLabel={t("trips.roster.trainingMark.clearing")}
                className={buttonClass({ variant: "link", size: "sm", flush: true })}
              >
                {t("trips.roster.trainingMark.clear")}
              </SubmitButton>
            </form>
          ) : null}
        </>
      ) : markAction && options.length > 0 ? (
        <details className="group/training-mark">
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center text-sm font-medium text-muted hover:text-foreground [&::-webkit-details-marker]:hidden">
            {t("trips.roster.trainingMark.label")}
          </summary>
          <form action={markAction} className="mt-2 flex flex-col gap-3">
            <input type="hidden" name="bookingId" value={bookingId} />
            <Field
              label={t("trips.roster.trainingMark.countsToward")}
              htmlFor={`training-mark-${bookingId}`}
            >
              <select
                id={`training-mark-${bookingId}`}
                name="enrollmentBookingId"
                required
                className={controlClass}
              >
                {options.map((option) => (
                  <option key={option.enrollmentBookingId} value={option.enrollmentBookingId}>
                    {t("trips.roster.trainingMark.option", {
                      course: option.courseTitle,
                      date: formatShortDate(option.sessionStartsAt, locale, timezone),
                    })}
                  </option>
                ))}
              </select>
            </Field>
            <SubmitButton
              pendingLabel={t("trips.roster.trainingMark.marking")}
              className={`${buttonClass({ variant: "secondary", size: "sm" })} self-start`}
            >
              {t("trips.roster.trainingMark.mark")}
            </SubmitButton>
          </form>
        </details>
      ) : null}
    </div>
  );
}
