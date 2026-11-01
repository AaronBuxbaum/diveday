import type { ReactNode } from "react";
import { sectionCardClass } from "@/components/ui/card";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { LIST_ROW_SUMMARY_RING } from "@/components/ui/disclosure";
import { groupLabelClass } from "@/components/ui/group-label";
import { AboutRowDetails } from "./AboutRowDetails";

/**
 * Label, settled value, and control share one grid at every width, keeping
 * rows aligned whether they open or only state a fact.
 *
 * `px-2` offsets `ROWS_CLASS`'s 8px rule overhang so words align with the panel
 * column while an editable summary's fill spans the rules.
 *
 * At `sm`, `items-baseline` aligns the label, first value line, and action;
 * later value lines continue below.
 */
const ROW_GRID =
  "grid w-full gap-1 px-2 py-3 sm:grid-cols-[9rem_minmax(0,1fr)_auto] sm:items-baseline sm:gap-4";

/** The rows' rules extend 8px past the panel column on each side. */
const ROWS_CLASS = "-mx-2 divide-y divide-border border-y border-border";

/**
 * One beat of the departure's definition: the label, the settled value, and —
 * when there is something to change — the control that opens its editor in
 * place. A row with no editor is the same grid without the third column, so a
 * staffer who cannot configure the trip reads the same table.
 */
function AboutRow({ row, editLabel }: { row: TripAboutRow; editLabel: string }) {
  const beat = (
    <>
      <span className={groupLabelClass()}>{row.label}</span>
      <span className="min-w-0 text-sm">{row.value}</span>
    </>
  );
  if (!row.editor) {
    return (
      <div id={row.id} data-trip-detail-row className={`${ROW_GRID} scroll-mt-24`}>
        {beat}
      </div>
    );
  }
  return (
    <AboutRowDetails
      id={row.id}
      label={row.label}
      open={row.editorOpen}
      className="group/row scroll-mt-24"
    >
      {/* The summary fill spans rule to rule; the inset focus ring stays clear
          of the label and caret at the row edges. */}
      <summary className="flex cursor-pointer list-none transition-colors [&::-webkit-details-marker]:hidden hover:bg-surface-sunken focus-visible:focus-ring-inset">
        <span data-trip-detail-row className={ROW_GRID}>
          {beat}
          <span className="inline-flex min-h-11 w-fit items-center gap-1 text-sm font-semibold text-primary sm:justify-self-end print:hidden">
            {editLabel}
            <DisclosureCaret direction="down" className="size-4 group-open/row:rotate-180" />
          </span>
        </span>
      </summary>
      {/* The editor sits on the text column the value above it sits on, and
          the space below it is what keeps the next row's label off the last
          field of this one. */}
      <div className="px-2 pb-5 print:hidden">{row.editor}</div>
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
 * The Details tab lays out the departure definition as rows. Each editable row
 * is its own disclosure: label and value form the summary, with the editor
 * opening below it.
 *
 * The rare and destructive acts live below the card, in `TripMoreDisclosure`,
 * one of the tab's closed rows beside Promote and Activity.
 *
 * Keep focusable descendants out of `<summary>`; nested interactive elements
 * fail accessibility checks, so the edit affordance is a `<span>`.
 */
export function TripAboutSection({
  rows,
  editLabel,
  actions,
}: {
  rows: TripAboutRow[];
  /**
   * The one word on every row's control, "Edit" (visual review 2026-10-24,
   * A13): five spellings ("Edit details", "Edit crew prediction", "Edit
   * requirements", "Edit", "Edit crew") made five rows look like five kinds
   * of act. The row's own label already says what opens.
   */
  editLabel: string;
  /**
   * Quiet doors in one wrapping row, each `flush` so every word — the first,
   * and the first of a wrapped line — sits on the column. The row's `gap-x-8`
   * is the padding they gave up: words 32px apart, fills 16px.
   */
  actions?: ReactNode;
}) {
  return (
    <section
      id="about"
      data-trip-details-paper
      className={sectionCardClass({ padding: "none", className: "scroll-mt-24 overflow-hidden" })}
    >
      <div className="px-4 pb-4 sm:px-5 sm:pb-5">
        {actions ? (
          <div className="flex flex-wrap gap-x-8 gap-y-2 py-3 print:hidden">{actions}</div>
        ) : null}
        <div className={ROWS_CLASS}>
          {rows.map((row) => (
            <AboutRow key={row.id} row={row} editLabel={editLabel} />
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * **The Details tab's foot rows, one bordered group** (visual review
 * 2026-10-24, A13): "Note to everyone", "More for this departure", "Activity"
 * and, when a deal went out, "Last-minute deal" are rows of one
 * `DisclosureRowList`, each with its words in the text's ink and the shared
 * caret at its end. They were three bare labels on hairlines that read as
 * orphaned captions rather than things that open.
 */
export const FOOT_ROW_SUMMARY = `flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium transition-colors [&::-webkit-details-marker]:hidden hover:bg-surface-sunken sm:px-5 ${LIST_ROW_SUMMARY_RING}`;

/** A foot row's body, on its summary's inset. */
export const FOOT_ROW_BODY = "px-4 pb-5 sm:px-5";

/**
 * **More for this departure** — the rare and destructive acts: apply to every
 * date, stop repeating, cancel every upcoming date, the weather blow-out,
 * cancelling this departure. One closed row on the Details tab, the same kind
 * of row as Promote and Activity beside it (owner, 2026-10-06: they are one
 * category, things done *to* the departure rather than facts *about* it). A
 * single column of quiet items with no standing captions: each one's
 * consequence sentence lives in the confirm or the page it opens
 * (docs/design/principles.md §8, "collapse the rare path").
 */
export function TripMoreDisclosure({
  label,
  open = false,
  children,
}: {
  label: string;
  /** One of the acts just ran and its outcome is inside. */
  open?: boolean;
  children: ReactNode;
}) {
  return (
    <details id="about-more" aria-label={label} open={open} className="group/more">
      <summary className={FOOT_ROW_SUMMARY}>
        <span>{label}</span>
        <DisclosureCaret direction="down" className="size-4 group-open/more:rotate-180" />
      </summary>
      {/* One column, one item per line, no captions. */}
      <div className={`flex flex-col items-start ${FOOT_ROW_BODY}`}>{children}</div>
    </details>
  );
}
