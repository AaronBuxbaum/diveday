import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { LedgerGroup, LedgerRow } from "@/components/ui/ledger";
import type { CrewedSessionSummary } from "@/db/today";
import { staffTranslator } from "@/i18n/staff-messages";
import { formatShortDate, formatTime } from "@/lib/format";

/**
 * The instructor's lens over the day spine (20260721-role-aware-landing): the
 * course sessions they teach this week, each with student readiness at a
 * glance. Renders nothing when the person teaches nothing this week — the lens
 * never adds an empty section.
 *
 * It is its own labeled group between the summary sentence and the first
 * station, in the spine's own grammar rather than a stack of sunken cards (ADR
 * 20260827-clearwater-surface-language, decision 2).
 */
export function YourSessions({
  sessions,
  shopSlug,
  timeZone,
  locale,
}: {
  sessions: readonly CrewedSessionSummary[];
  shopSlug: string;
  timeZone: string;
  locale: string;
}) {
  if (sessions.length === 0) return null;
  const t = staffTranslator(locale);
  return (
    <LedgerGroup as="h2" id="your-sessions-heading" label={t("shared.today.yourSessions.heading")}>
      <ul className="mt-3">
        {sessions.map((session) => (
          <LedgerRow
            key={session.tripId}
            href={`/shop/${shopSlug}/trips/${session.tripId}`}
            linkLabel={t("shared.today.yourSessions.openRoster")}
            trailing={
              <DiveDayIcon name="chevron-right" className="size-4 text-muted" aria-hidden="true" />
            }
          >
            <div className="min-w-0 py-2">
              <p className="font-medium">{session.title}</p>
              <p className="mt-0.5 text-sm text-muted tabular-nums">
                {formatShortDate(session.startsAt, locale, timeZone)} ·{" "}
                {formatTime(session.startsAt, locale, timeZone)}
                {session.courseTitle ? ` · ${session.courseTitle}` : ""}
              </p>
              <p className="mt-1 text-sm tabular-nums">
                {t("shared.today.yourSessions.studentsCount", { count: session.booked })}
                {session.booked > 0 ? (
                  <>
                    {" · "}
                    <span className={session.ready > 0 ? "font-medium text-success" : ""}>
                      {t("shared.today.yourSessions.readyCount", { count: session.ready })}
                    </span>
                    {" · "}
                    <span className={session.blocked > 0 ? "font-semibold text-danger" : ""}>
                      {t("shared.today.yourSessions.blockedCount", { count: session.blocked })}
                    </span>
                  </>
                ) : null}
              </p>
            </div>
          </LedgerRow>
        ))}
      </ul>
    </LedgerGroup>
  );
}
