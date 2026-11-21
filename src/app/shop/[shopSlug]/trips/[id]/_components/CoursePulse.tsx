import Link from "next/link";
import { sectionCardClass } from "@/components/ui/card";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import type { CoursePulse as CoursePulseData } from "@/features/training/course-pulse";
import { staffTranslator } from "@/i18n/staff-messages";
import { formatDateTimeTz } from "@/lib/format";
import { claimCourseFollowupAction, saveCourseTeachingNoteAction } from "../course-pulse-actions";
import { CourseFollowupForm } from "./CourseFollowupForm";
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
          {pulse.rows.map((row) => {
            const followup = pulse.followupByBooking.get(row.bookingId);
            return (
              <li
                key={row.bookingId}
                className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-1 ${row.items.length ? "" : "text-muted"}`}
              >
                <Link
                  href={`#booking-${row.bookingId}`}
                  className="inline-flex min-h-11 items-center underline underline-offset-4"
                >
                  {row.fullName}
                </Link>
                <div className="flex min-w-0 max-w-full flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="min-w-0 max-w-full break-words text-muted">
                    {row.items.length
                      ? row.items.map((item) => t(`trips.coursePulse.items.${item}`)).join(" · ")
                      : t("trips.coursePulse.complete")}
                  </span>
                  {row.items.length && followup ? (
                    <>
                      <span className="text-sm text-muted">
                        {followup.ownerId
                          ? t("trips.coursePulse.followup.owner", {
                              name: followup.ownerName ?? t("trips.coursePulse.items.staff"),
                            })
                          : t("trips.coursePulse.followup.unassigned")}
                        {followup.ownerId
                          ? ` · ${t("trips.coursePulse.followup.inProgress")}`
                          : null}
                      </span>
                      {!followup.ownerId || followup.canRelease ? (
                        <CourseFollowupForm
                          action={claimCourseFollowupAction.bind(null, tripId, row.bookingId)}
                          revision={followup.revision}
                          intent={followup.ownerId ? "release" : "claim"}
                          words={{
                            label: t(
                              followup.ownerId
                                ? "trips.coursePulse.followup.release"
                                : "trips.coursePulse.followup.take",
                            ),
                            busy: t("words.busy.saving"),
                            ariaLabel: t(
                              followup.ownerId
                                ? "trips.coursePulse.followup.releaseFor"
                                : "trips.coursePulse.followup.takeFor",
                              { name: row.fullName },
                            ),
                            changed: t("trips.coursePulse.followup.changed"),
                            unavailable: t("trips.coursePulse.followup.unavailable"),
                          }}
                        />
                      ) : null}
                    </>
                  ) : null}
                </div>
              </li>
            );
          })}
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
          optional: t("trips.details.optionalHint"),
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
