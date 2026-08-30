import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { LedgerGroup, LedgerRow } from "@/components/ui/ledger";
import { canonicalAgency } from "@/lib/courses";

/**
 * **The course roster as one ledger, grouped by agency** — ADR
 * 20260827-the-shops-shelves, decision 1 (the library pattern) in the
 * open-ledger grammar of ADR 20260827-clearwater-surface-language.
 *
 * What this replaced was a bordered card wrapping a divided list, above a
 * segmented tab strip that showed **one agency at a time**. The tab was a
 * filter answering a question the list could have answered itself, and it cost
 * the reader the rest of their catalog to ask it: a shop teaching PADI and SSI
 * could not see both ladders in one scroll, and the SSI tab's page 2 was a
 * different query from the PADI tab's page 2. Agency is a shared fact, and a
 * shared fact belongs to the group header — said once, above the run it
 * describes, with the whole roster in one Pager beneath it.
 *
 * Two rules this file holds, both pinned in `CourseRoster.test.tsx`:
 *
 * - **The rows arrive sorted and are never re-sorted here.** Progression order
 *   — a taster, then the entry certification, then everything it opens — is
 *   `progressionOrder` in `src/db/courses.ts`, and it is agency-major from
 *   there so a group cannot interleave across a page boundary. This component
 *   walks the run and starts a new group whenever the canonical agency
 *   changes; an alphabetical or otherwise re-ordered render here would silently
 *   undo the one ordering the roster exists to show.
 * - **The group key is canonical, the heading is the shop's own noun.**
 *   `courses.agency` is imported free text, so `" PADI "` and `"padi"` are one
 *   group; the heading is that key upper-cased rather than translated, because
 *   an agency code is a proper noun and not copy.
 *
 * Hidden is the roster's one exceptional state, so it is the roster's one
 * Badge (decision 3 — a badge marks the exception, never the expected). The
 * row is the door to the course's editor; the two list-level acts, Schedule
 * and Hide/Show, ride above the stretched link in the trailing slot.
 */

/** One course, already worded by the page — this file formats nothing. */
export type CourseRosterRow = {
  id: string;
  /** Raw `courses.agency`; canonicalised here into the group key. */
  agency: string;
  title: string;
  /** The editor. The row is the door to it. */
  href: string;
  /** What the tap does, for the whole-row link's accessible name. */
  linkLabel: string;
  /**
   * The row's quiet facts, in one line: who it is open to, how long it runs,
   * what it costs. Pre-formatted for the reader's locale — a price is a
   * figure, so the page renders it tabular.
   */
  meta: ReactNode;
  /** Set for a course the shop has taken off its public catalog. */
  hiddenLabel?: string;
  /** Schedule, and Hide/Show — the caller's forms, per its permissions. */
  actions?: ReactNode;
};

/** One agency's run of the roster, in the order the rows arrived. */
export type CourseRosterGroup = {
  /** `lower(trim(agency))` — the same key the query sorted by. */
  agency: string;
  courses: CourseRosterRow[];
};

/**
 * Consecutive runs of one agency, never a re-sort. The rows come back
 * agency-major from `pagedCourses`, so a change of key *is* the group
 * boundary — and if the query ever stopped sorting that way, this would draw
 * the same agency twice rather than quietly gathering rows out of the
 * progression order they were read in.
 */
export function groupCoursesByAgency(rows: readonly CourseRosterRow[]): CourseRosterGroup[] {
  const groups: CourseRosterGroup[] = [];
  for (const row of rows) {
    const agency = canonicalAgency(row.agency);
    const open = groups.at(-1);
    if (open && open.agency === agency) open.courses.push(row);
    else groups.push({ agency, courses: [row] });
  }
  return groups;
}

export function CourseRoster({
  rows,
  className = "",
}: {
  rows: readonly CourseRosterRow[];
  className?: string;
}) {
  return (
    <div className={`space-y-8 ${className}`.trim()}>
      {groupCoursesByAgency(rows).map((group) => {
        const labelId = `agency-${group.agency}`;
        return (
          <LedgerGroup
            key={group.agency}
            as="h2"
            id={labelId}
            // An agency code is shop data — a proper noun — so it is
            // upper-cased, never translated.
            label={group.agency.toUpperCase()}
          >
            <ul aria-labelledby={labelId} className="mt-2">
              {group.courses.map((course) => (
                <LedgerRow
                  key={course.id}
                  href={course.href}
                  linkLabel={course.linkLabel}
                  trailing={course.actions}
                  stacked
                  className="py-3"
                >
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className={`font-medium ${course.hiddenLabel ? "text-muted" : ""}`}>
                        {course.title}
                      </span>
                      {course.hiddenLabel ? (
                        <Badge tone="neutral" size="sm">
                          {course.hiddenLabel}
                        </Badge>
                      ) : null}
                    </p>
                    <p className="mt-0.5 text-sm text-muted">{course.meta}</p>
                  </div>
                </LedgerRow>
              ))}
            </ul>
          </LedgerGroup>
        );
      })}
    </div>
  );
}
