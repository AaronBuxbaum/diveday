import type { ReactNode } from "react";
import { AutoOpenDetails } from "@/components/AutoOpenDetails";
import { sectionCardClass } from "@/components/ui/card";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { groupLabelClass } from "@/components/ui/ledger";
import { AboutRowDetails } from "./AboutRowDetails";

/**
 * Label, settled value, and the row's own control, on one grid at every width —
 * the same three columns whether the row opens or only states a fact, so a
 * column of them keeps one left edge.
 */
const ROW_GRID =
  "grid w-full gap-1 py-3 sm:grid-cols-[9rem_minmax(0,1fr)_auto] sm:items-start sm:gap-4";

/**
 * One beat of the departure's definition: the label, the settled value, and —
 * when there is something to change — the control that opens its editor in
 * place. A row with no editor is the same grid without the third column, so a
 * staffer who cannot configure the trip reads the same table.
 */
function AboutRow({ row }: { row: TripAboutRow }) {
  const beat = (
    <>
      <span className={groupLabelClass()}>{row.label}</span>
      <span className="min-w-0 text-sm">{row.value}</span>
    </>
  );
  if (!row.editor) {
    return (
      <div id={row.id} className={`${ROW_GRID} scroll-mt-24`}>
        {beat}
      </div>
    );
  }
  return (
    <AboutRowDetails id={row.id} open={row.editorOpen} className="group/row scroll-mt-24">
      <summary className="flex cursor-pointer list-none transition-colors [&::-webkit-details-marker]:hidden hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary">
        <span className={ROW_GRID}>
          {beat}
          <span className="inline-flex min-h-11 w-fit items-center gap-1 self-start text-sm font-semibold text-primary sm:justify-self-end">
            {row.editLabel}
            <DisclosureCaret direction="down" className="size-4 group-open/row:rotate-180" />
          </span>
        </span>
      </summary>
      {/* The editor sits on the text column the value above it sits on, and
          the space below it is what keeps the next row's label off the last
          field of this one. */}
      <div className="pb-5">{row.editor}</div>
    </AboutRowDetails>
  );
}

export type TripAboutRow = {
  /**
   * The row's fragment target, so the board's "Set a price for …" link and the
   * pulse's crew facts still land on the beat they name.
   */
  id: string;
  label: string;
  value: ReactNode;
  /** The word on this row's own control — "Edit details", "Change the days it runs". */
  editLabel?: string;
  /** The editor this row opens beneath itself. Without one the row is a fact and nothing else. */
  editor?: ReactNode;
  /**
   * Server-decided: this editor has an outcome to show, or its subject has open
   * work. A refusal that hides inside a closed row is a form the staffer cannot
   * see failed — the rule the `Edit …` disclosures inside the old headed
   * sections used to carry.
   */
  editorOpen?: boolean;
};

/**
 * The Trip surface's compact home for everything that used to be Overview.
 *
 * ADR 20260827-the-departure-is-two-working-surfaces, slice 5e, keeps the
 * departure's definition available without making it the first thing a crew
 * member has to work through. At rest this is one compact summary; on intent
 * it opens into five label/value beats. The roster remains below it as the
 * page's main working surface.
 *
 * ## One grammar: the fact rows *are* the surface
 *
 * The panel used to say everything twice. Five rows stated the plan, the
 * conditions, who can book, the boat and crew, and the repeat — and then five
 * headed sections below them stated the same five subjects again, each with its
 * own heading, its own summary prose and its own "Edit …" disclosure, followed
 * by three full-width series buttons and two more destructive ones, every one
 * of them carrying a standing caption. About fifteen controls and eight
 * captions for five facts (design review 2026-09-17).
 *
 * Now a row *is* its own disclosure: the label and the settled value are the
 * summary, the editor opens in place beneath it, and there is no second copy of
 * anything. That is the grammar `SettingsRows` and `DisclosureRowList` already
 * use, arrived at here from the opposite direction.
 *
 * The rare and destructive acts — apply to every date, stop repeating, cancel
 * every upcoming date, the weather blow-out, cancelling this departure — sit in
 * one closed disclosure at the foot (`more`), as a single column of quiet
 * items with no standing captions: each one's consequence sentence lives in the
 * confirm or the page it opens, where somebody is about to act on it
 * (docs/design/principles.md §8, "collapse the rare path").
 *
 * A row's `<summary>` carries no focusable descendants — an interactive element
 * nested in a `<summary>` fails axe's nested-interactive rule, which is why the
 * "Edit …" affordance is a `<span>` and the whole row is the control.
 */
export function TripAboutSection({
  heading,
  detailsLabel,
  closeLabel,
  summary,
  conditionsSummary,
  rows,
  openOnHash = [],
  actions,
  more,
  moreLabel,
  moreOpen = false,
  open = false,
}: {
  heading: string;
  detailsLabel: string;
  closeLabel: string;
  summary: ReactNode;
  conditionsSummary?: ReactNode;
  rows: TripAboutRow[];
  /** Fragments that open the panel itself — every row anchor a deep link uses. */
  openOnHash?: string[];
  actions?: ReactNode;
  /** The rare and destructive acts, as a column of quiet items. */
  more?: ReactNode;
  moreLabel?: string;
  /** One of the acts in `more` just ran and its outcome is inside. */
  moreOpen?: boolean;
  open?: boolean;
}) {
  return (
    <AutoOpenDetails
      id="about"
      openOnHash={["about", ...openOnHash]}
      open={open}
      className={sectionCardClass({
        padding: "none",
        className: "group/about scroll-mt-24 overflow-hidden",
      })}
    >
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2.5 px-4 py-2 text-sm transition-colors [&::-webkit-details-marker]:hidden focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary sm:min-h-16 sm:gap-3 sm:px-5 sm:py-2.5">
        <svg
          aria-hidden="true"
          className="size-4 shrink-0 text-muted sm:size-5"
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
          <span className="block truncate font-semibold leading-snug group-open/about:hidden">
            {summary}
          </span>
          <span className="hidden font-semibold group-open/about:block">{heading}</span>
          {conditionsSummary ? (
            <span className="mt-0.5 hidden truncate text-xs text-muted group-open/about:hidden sm:block sm:group-open/about:hidden">
              {conditionsSummary}
            </span>
          ) : null}
        </span>
        <span className="-mx-2 inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2 font-semibold text-primary transition-colors hover:bg-surface-sunken">
          <span className="group-open/about:hidden">{detailsLabel}</span>
          <span className="hidden group-open/about:inline">{closeLabel}</span>
          <DisclosureCaret direction="right" className="size-4 group-open/about:rotate-90" />
        </span>
      </summary>
      <div className="border-t border-border px-4 pb-4 sm:px-5 sm:pb-5">
        {actions ? <div className="flex flex-wrap gap-2 py-3">{actions}</div> : null}
        <div className="divide-y divide-border border-y border-border">
          {rows.map((row) => (
            <AboutRow key={row.id} row={row} />
          ))}
        </div>
        {more ? (
          <details id="about-more" open={moreOpen} className="group/more mt-4">
            <summary className="-mx-2 flex min-h-11 w-fit cursor-pointer list-none items-center gap-1 rounded-lg px-2 text-sm font-medium text-muted transition-colors [&::-webkit-details-marker]:hidden hover:bg-surface-sunken hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
              {moreLabel}
              <DisclosureCaret direction="down" className="size-4 group-open/more:rotate-180" />
            </summary>
            {/* One column, one item per line, no captions. */}
            <div className="mt-1 flex flex-col items-start">{more}</div>
          </details>
        ) : null}
      </div>
    </AutoOpenDetails>
  );
}
