import Link from "next/link";
import type { ReactNode } from "react";
import { AutoOpenDetails } from "@/components/AutoOpenDetails";
import { sectionCardClass } from "@/components/ui/card";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";

export type TripAboutRow = {
  label: string;
  value: ReactNode;
  editHref?: string;
};

/**
 * The Trip surface's compact home for everything that used to be Overview.
 *
 * ADR 20260827-the-departure-is-two-working-surfaces, slice 5e, keeps the
 * departure's definition available without making it the first thing a crew
 * member has to work through. At rest this is one two-line summary; on intent
 * it opens into the old, complete editors and the five label/value beats from
 * the design. The roster remains below it as the page's main working surface.
 */
export function TripAboutSection({
  heading,
  detailsLabel,
  closeLabel,
  summary,
  conditionsSummary,
  rows,
  editLabel,
  actions,
  children,
  cancelAction,
  open = false,
}: {
  heading: string;
  detailsLabel: string;
  closeLabel: string;
  summary: ReactNode;
  conditionsSummary?: ReactNode;
  rows: TripAboutRow[];
  editLabel: string;
  actions?: ReactNode;
  children?: ReactNode;
  cancelAction?: ReactNode;
  open?: boolean;
}) {
  return (
    <AutoOpenDetails
      id="about"
      openOnHash={[
        "about",
        ...rows.flatMap((row) => (row.editHref ? [row.editHref.slice(1)] : [])),
      ]}
      open={open}
      className={sectionCardClass({
        padding: "none",
        className: "group/about scroll-mt-24 overflow-hidden",
      })}
    >
      <summary className="flex min-h-16 cursor-pointer list-none items-center gap-3 px-4 py-2.5 text-sm transition-colors [&::-webkit-details-marker]:hidden focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary sm:px-5">
        <svg
          aria-hidden="true"
          className="size-5 shrink-0 text-muted"
          viewBox="0 0 22 22"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="8.2" />
          <path d="m13.8 8.2-1.7 4-4 1.7 1.7-4z" />
        </svg>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold group-open/about:hidden">{summary}</span>
          <span className="hidden font-semibold group-open/about:block">{heading}</span>
          {conditionsSummary ? (
            <span className="mt-0.5 block truncate text-xs text-muted group-open/about:hidden">
              {conditionsSummary}
            </span>
          ) : null}
        </span>
        <span className="inline-flex min-h-11 shrink-0 items-center gap-1 font-semibold text-primary">
          <span className="group-open/about:hidden">{detailsLabel}</span>
          <span className="hidden group-open/about:inline">{closeLabel}</span>
          <DisclosureCaret direction="right" className="size-4 group-open/about:rotate-90" />
        </span>
      </summary>
      <div className="border-t border-border px-4 pb-4 sm:px-5 sm:pb-5">
        {actions ? <div className="flex flex-wrap gap-x-2 gap-y-1 py-3">{actions}</div> : null}
        <div className="divide-y divide-border border-y border-border">
          {rows.map((row) => (
            <div
              key={row.label}
              className="grid gap-1 py-3 sm:grid-cols-[9rem_minmax(0,1fr)_auto] sm:items-start sm:gap-4"
            >
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                {row.label}
              </span>
              <div className="min-w-0 text-sm">{row.value}</div>
              {row.editHref ? (
                <Link
                  href={row.editHref}
                  className="min-h-11 self-start text-start text-sm font-semibold text-primary hover:underline sm:text-end"
                >
                  {editLabel}
                </Link>
              ) : null}
            </div>
          ))}
        </div>
        {children ? <div className="space-y-6 pt-6">{children}</div> : null}
        {cancelAction ? (
          <div className="flex justify-end border-t border-border pt-4">{cancelAction}</div>
        ) : null}
      </div>
    </AutoOpenDetails>
  );
}
