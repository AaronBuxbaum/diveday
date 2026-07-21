import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import type { CrewedSessionSummary } from "@/db/today";
import { formatShortDate, formatTime } from "@/lib/format";

/**
 * The instructor's lens over Today (20260721-role-aware-landing): the course
 * sessions they teach this week, each with student readiness at a glance.
 * Renders nothing when the person teaches nothing this week — the lens never
 * adds an empty section.
 */
export function YourSessions({
  sessions,
  shopSlug,
  timeZone,
}: {
  sessions: readonly CrewedSessionSummary[];
  shopSlug: string;
  timeZone: string;
}) {
  if (sessions.length === 0) return null;
  return (
    <section aria-labelledby="your-sessions-heading" className="mb-10">
      <h2 id="your-sessions-heading" className="text-lg font-semibold">
        Your sessions
      </h2>
      <p className="mt-1 text-sm text-muted">
        The classes you teach this week, with where each student stands.
      </p>
      <ul className="mt-4 flex flex-col gap-3">
        {sessions.map((session) => (
          <li
            key={session.tripId}
            className="flex flex-col gap-4 rounded-2xl border border-border bg-surface-sunken p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-5"
          >
            <div className="min-w-0">
              <p className="font-semibold">{session.title}</p>
              {session.courseTitle ? (
                <p className="text-sm font-medium text-primary">{session.courseTitle}</p>
              ) : null}
              <p className="mt-1 text-sm text-muted">
                {formatShortDate(session.startsAt, "en-US", timeZone)} ·{" "}
                {formatTime(session.startsAt, "en-US", timeZone)}
              </p>
              <p className="mt-2 text-sm tabular-nums">
                {session.booked} {session.booked === 1 ? "student" : "students"}
                {session.booked > 0 ? (
                  <>
                    {" · "}
                    <span className={session.ready > 0 ? "font-medium text-success" : ""}>
                      {session.ready} ready
                    </span>
                    {" · "}
                    <span className={session.blocked > 0 ? "font-semibold text-danger" : ""}>
                      {session.blocked} blocked
                    </span>
                  </>
                ) : null}
              </p>
            </div>
            <div className="shrink-0">
              <Link
                href={`/shop/${shopSlug}/trips/${session.tripId}`}
                className={buttonClass({ variant: "secondary" })}
              >
                Open roster
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
