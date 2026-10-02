import type { ReactNode } from "react";
import { PAGE_TITLE_CLASS } from "@/components/ui/typography";

/**
 * **The top of the day** — ADR 20261001-logbook, decision 4, which retires the
 * sky band ADR 20260919-one-idea's slice 23a put here.
 *
 * The date is the page's name, the weekday sits above it, and the day is said
 * in one line under it. The sky band, the sun-arc strip and the sunrise line
 * that stood here were cut in the Logbook restart: they were a picture of the
 * day standing above the day's work, and Today now opens on the work.
 *
 * Every word arrives already worded and zoned: a staff component takes words
 * as props (`staffTranslator` is server-side only).
 */
export function DayHeader({
  weekday,
  date,
  summary,
  action,
  children,
}: {
  /** "Thursday" — the day of the week, on its own line above the date. */
  weekday: string;
  /** "August 27" — the date as a name, the page's one heading. */
  date: string;
  /** The day in one line: the boats, and what is still waiting. */
  summary: ReactNode;
  /** The header's one action — the paper day, on a day that has boats. */
  action?: ReactNode;
  /** What the page says under the line: the next departure, offline. */
  children?: ReactNode;
}) {
  return (
    <header className="mb-8">
      <div className="flex items-start gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-muted">{weekday}</p>
          <h1 className={PAGE_TITLE_CLASS}>{date}</h1>
        </div>
        {action ? <div className="ms-auto shrink-0">{action}</div> : null}
      </div>
      {summary ? <p className="mt-1 text-muted">{summary}</p> : null}
      {children}
    </header>
  );
}
