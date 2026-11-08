import Link from "next/link";
import { sectionCardClass } from "@/components/ui/card";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import type { CoursePulse as CoursePulseData } from "@/db/course-pulse";
import { staffTranslator } from "@/i18n/staff-messages";
import { formatDateTimeTz } from "@/lib/format";
import { saveCourseTeachingNoteAction } from "../course-pulse-actions";
import { CourseTeachingNoteForm } from "./CourseTeachingNoteForm";

export function CoursePulse({
  pulse,
  tripId,
  shopSlug,
  locale,
  timeZone,
}: {
  pulse: CoursePulseData | null;
  tripId: string;
  shopSlug: string;
  locale: string;
  timeZone: string;
}) {
  if (!pulse) return null;
  const t = staffTranslator(locale);
  const errors = {
    invalid: t("trips.coursePulse.errors.invalid"),
    too_long: t("trips.coursePulse.errors.too_long"),
    changed: t("trips.coursePulse.errors.changed"),
    forbidden: t("trips.coursePulse.errors.forbidden"),
    disabled: t("trips.coursePulse.errors.disabled"),
    cancelled: t("trips.coursePulse.errors.cancelled"),
    not_found: t("trips.coursePulse.errors.not_found"),
    not_a_course_session: t("trips.coursePulse.errors.not_a_course_session"),
  };
  return (
    <section
      className={sectionCardClass({ className: "my-4" })}
      aria-labelledby="course-preparation"
    >
      <h2 id="course-preparation" className={SECTION_TITLE_CLASS}>
        {t("trips.coursePulse.heading")}
      </h2>
      <p className="mt-1 text-sm text-muted">
        {t("trips.coursePulse.summary", { count: pulse.complete, total: pulse.rows.length })}
      </p>
      {pulse.rows.length ? (
        <ul className="mt-3 space-y-2 text-base">
          {pulse.rows.map((row) => (
            <li
              key={row.bookingId}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1"
            >
              <Link
                href={`#booking-${row.bookingId}`}
                className="inline-flex min-h-11 items-center underline underline-offset-4"
              >
                {row.fullName}
              </Link>
              <span className="text-muted">
                {row.items.length
                  ? row.items.map((item) => t(`trips.coursePulse.items.${item}`)).join(" · ")
                  : t("trips.coursePulse.complete")}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted">{t("trips.coursePulse.empty")}</p>
      )}
      <CourseTeachingNoteForm
        shopSlug={shopSlug}
        tripId={tripId}
        note={pulse.note}
        action={saveCourseTeachingNoteAction.bind(null, tripId)}
        words={{
          label: t("trips.coursePulse.noteLabel"),
          audience: t("trips.coursePulse.audience"),
          save: t("trips.coursePulse.save"),
          remove: t("trips.coursePulse.delete"),
          busy: t("words.busy.saving"),
          saved: t("trips.coursePulse.saved"),
          deleted: t("trips.coursePulse.deleted"),
          undo: t("shared.undoToast.undo"),
          dismiss: t("shared.undoToast.dismiss"),
          errors,
        }}
      />
      {pulse.noteAt && pulse.noteBy ? (
        <p className="mt-2 text-xs text-muted">
          {t("trips.coursePulse.attribution", {
            name: pulse.noteBy,
            zone: timeZone,
            when: formatDateTimeTz(pulse.noteAt, locale, timeZone),
          })}
        </p>
      ) : null}
    </section>
  );
}
