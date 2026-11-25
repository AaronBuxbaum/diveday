import type { ReactNode } from "react";
import { sectionCardClass } from "@/components/ui/card";
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
  "grid w-full gap-1 px-2 py-3 sm:grid-cols-[11rem_minmax(0,1fr)_auto] lg:grid-cols-[13rem_minmax(0,1fr)_auto] sm:items-baseline sm:gap-4";

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
      <div className="min-w-0 text-base">{row.value}</div>
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
    <AboutRowDetails
      id={row.id}
      label={row.label}
      open={row.editorOpen}
      className="group/row scroll-mt-24"
    >
      {/* The summary fill spans rule to rule; the inset focus ring stays clear
          of the label and caret at the row edges. */}
      <summary className="flex cursor-pointer list-none transition-colors [&::-webkit-details-marker]:hidden hover:bg-surface-sunken focus-visible:focus-ring-inset">
        <div className={ROW_GRID}>
          {beat}
          {/* The edit word, as an opened guest's fact says it (`GuestFact`): a
              word, not a disclosure arrow. */}
          <span className="inline-flex min-h-11 w-fit items-center text-base font-semibold text-primary sm:justify-self-end">
            {row.editLabel ?? editLabel}
          </span>
        </div>
      </summary>
      {/* The editor sits on the text column the value above it sits on, and
          the space below it is what keeps the next row's label off the last
          field of this one. */}
      <div className="px-2 pb-5">{row.editor}</div>
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
  /** A narrower correction or future-date action, when this is not a plan edit. */
  editLabel?: string;
  /**
   * Server-decided: this editor has an outcome to show, or its subject has open
   * work. A refusal that hides inside a closed row is a form the staffer cannot
   * see failed — the rule the `Edit …` disclosures inside the old headed
   * sections used to carry.
   */
  editorOpen?: boolean;
};

/**
 * Edit trip lays out the departure definition as rows. Each editable row is
 * its own disclosure: label and value form the summary, with the editor
 * opening below it. The rare and destructive acts sit beside the card.
 *
 * Keep focusable descendants out of `<summary>`; nested interactive elements
 * fail accessibility checks, so the edit affordance is a `<span>`.
 * Design: 20260827-the-departure-is-two-working-surfaces, slice 5e.
 */
export function TripAboutSection({
  id = "about",
  heading,
  rows,
  editLabel,
  actions,
}: {
  id?: string;
  /** The card's own heading ("This trip"), above its rows. */
  heading?: string;
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
      id={id}
      aria-label={heading}
      className={sectionCardClass({ padding: "none", className: "scroll-mt-24 overflow-hidden" })}
    >
      <div className="px-4 pb-4 sm:px-6">
        {heading ? <h3 className="pt-4 font-semibold">{heading}</h3> : null}
        {actions ? <div className="flex flex-wrap gap-x-8 gap-y-2 py-3">{actions}</div> : null}
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
 * **Edit trip's foot rows, one bordered group** (visual review
 * 2026-10-24, A13): "Note to everyone", "More for this departure", "Activity"
 * and, when a deal went out, "Last-minute deal" are rows of one
 * `DisclosureRowList`, each with its words in the text's ink, led by the
 * shared caret (`SummaryCaret`, turning on open) as every disclosure on the
 * Trip page is; a count sits at the row's end (`ms-auto`). They were three
 * bare labels on hairlines that read as orphaned captions rather than things
 * that open.
 */
export const FOOT_ROW_SUMMARY = `flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-3 text-sm font-medium transition-colors [&::-webkit-details-marker]:hidden hover:bg-surface-sunken sm:px-6 ${LIST_ROW_SUMMARY_RING}`;

/** A foot row's body, on its summary's inset. */
export const FOOT_ROW_BODY = "px-4 pb-5 sm:px-6";
