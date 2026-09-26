import type { ReactNode } from "react";
import { AutoOpenDetails } from "@/components/AutoOpenDetails";
import { cardSummaryClass, SectionCard } from "@/components/ui/card";
import { DisclosureCaret, type DisclosureCaretDirection } from "@/components/ui/DisclosureCaret";

/**
 * **A summary's caret, on the summary's first line** — pixel-craft classes 1
 * and 2. A leading caret centred on its summary's whole block floats between
 * the lines of a title that wraps, or sits level with the chips under it: on
 * the manifest at 390 the dock checklist's caret hung 12.5px below its first
 * line, "On this phone"'s 21px. The caret goes in a box one first line tall,
 * in a summary whose row starts at the top (`cardSummaryClass`).
 *
 * `line` is what makes the box one first line tall. `h-lh` is the summary's
 * own line, which is right when the title is set in the summary's type; a
 * larger title passes its type class beside `h-lh`, so `1lh` is the title's
 * line; a first line that is a row of 36px chips passes `h-9`.
 */
export function SummaryCaret({
  direction = "right",
  line = "h-lh",
  className = "",
}: {
  direction?: DisclosureCaretDirection;
  line?: string;
  /** The caret's own classes: its size, its colour, its open-state turn. */
  className?: string;
}) {
  return (
    <span className={`flex shrink-0 items-center ${line}`}>
      <DisclosureCaret direction={direction} className={className} />
    </span>
  );
}

/**
 * **A danger zone: the one irreversible or record-ending act on a page,
 * behind a disclosure** — "Delete site" on a dive site, "Erase … personal
 * data" on a deleted diver's record.
 *
 * The two were hand-rolled two ways (pixel-craft class 12): a 20px band with a
 * 16px semibold label and a typed "+", which reads as "add" and stays "+" when
 * open; and a 12px box in a different red, its 14px medium label inset 16px on
 * a 44px row with no affordance at all, because `display: flex` on a
 * `<summary>` drops the browser's marker. One band now: the panel radius, one
 * border, a card face (`cardSummaryClass`) with one label and the shared caret.
 *
 * It opens on its own outcome (`open`): a refusal inside a shut disclosure is
 * invisible, which on these controls reads as the act having happened. The
 * record's reversible "Delete <name>" is deliberately not one of these — it is
 * a quiet ghost button in the record's foot, not a danger zone.
 */
export function DangerDisclosure({
  summary,
  open,
  className = "",
  children,
}: {
  /** The act, in the caller's words: "Delete site". */
  summary: ReactNode;
  open?: boolean;
  /** The band's place on its page — a margin; never a second shape. */
  className?: string;
  children: ReactNode;
}) {
  return (
    <details
      open={open}
      className={`group/danger rounded-panel border border-danger/30 bg-danger/5 ${className}`.trim()}
    >
      {/* `py-3` round a 24px line is the `min-h-12` exactly, so the label
          centres in the row that starts at the top. */}
      <summary
        className={cardSummaryClass({
          tone: "danger",
          className:
            "min-h-12 justify-between px-4 py-3 text-base font-semibold text-danger sm:px-5",
        })}
      >
        <span className="min-w-0">{summary}</span>
        <SummaryCaret direction="down" className="size-4 group-open/danger:rotate-180" />
      </summary>
      <div className="border-t border-danger/20 p-4 text-sm sm:p-5">{children}</div>
    </details>
  );
}

/**
 * A group of collapsables as **one object**: a card-shaped shell of hairline-
 * divided rows, each row a `<details>` that states its question at rest and
 * opens its form in place.
 *
 * This is the staff settings directory's row grammar (`SettingsRows.tsx`) with
 * the parts a diver-facing group does not have — a stated current value, a
 * door row to another route — left off, and it exists because the public
 * schedule had grown the same three-collapsable tail *without* it. Each of the
 * three had built its own card: three top margins (`mt-6`, `mt-6`, `mt-12`),
 * three heading treatments (`text-lg`, a bare `font-semibold` that was not a
 * heading element at all, and a `text-2xl` as loud as the page's own `h1`), and
 * — because `display: flex` on a `<summary>` suppresses the UA's disclosure
 * triangle in Chromium — no affordance on any of them. The result read as
 * three unrelated boxes of empty space that gave a reader no reason to think
 * they opened at all.
 *
 * The list carries the group's chrome, so a row never spells a card or a
 * margin: rows are siblings, the hairline between them is the only separator,
 * and the caret is what says "this opens". The heading above the list belongs
 * to the page, per the group rule in docs/design/forms-and-controls.md ("a
 * *group* of collapsables takes a group heading above, like any other group"),
 * which is also why every row's own heading is an `h3`.
 */
export function DisclosureRowList({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  // `padding="none"` because each row pads itself, and `overflow-hidden` so a
  // row's hover fill is clipped by the corner radius rather than squaring it
  // off — the same two reasons `SettingsRowList` gives.
  return (
    <SectionCard
      as="div"
      padding="none"
      className={`divide-y divide-border overflow-hidden ${className}`.trim()}
    >
      {children}
    </SectionCard>
  );
}

/**
 * **The focus ring of a full-width `<summary>` in a rounded list** —
 * `DisclosureRowList` here, `InsetGroup` for `SettingsRows`.
 *
 * The list is `overflow-hidden` (it rounds the hover fills), and the row is
 * flush with it, so the global ring — 5px outside the summary — was cut on both
 * sides of every row and the top of the first: 462 of the pixel probe's flags
 * on the settings rows alone. The ring is drawn inside instead, and at the
 * list's two ends the summary takes the list's corners, or the clip shaves the
 * ring's square ones. The last row's bottom corners go
 * square again when it opens, since its body is then what meets the corner.
 *
 * The corners are spelled against the `<details>`, not `rounded-[inherit]`:
 * a `<summary>` inherits through the `<details>`' shadow slot, which carries
 * no radius, so `inherit` resolves to 0.
 */
export const LIST_ROW_SUMMARY_RING =
  "focus-visible:focus-ring-inset [details:first-child>&]:rounded-t-panel [details:last-child:not([open])>&]:rounded-b-panel";

const SUMMARY_CLASS = `flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 transition-brand [&::-webkit-details-marker]:hidden hover:bg-surface-sunken sm:px-6 ${LIST_ROW_SUMMARY_RING}`;

/** The row's body inset — the same horizontal padding as the summary above it. */
const BODY_CLASS = "px-5 pb-6 sm:px-6";

export function DisclosureRow({
  id,
  heading,
  children,
}: {
  /**
   * The row's fragment target, on the `<details>` itself so a deep link can
   * scope to the whole row. A hard navigation's native reveal algorithm only
   * opens a target's *ancestors*, so `AutoOpenDetails` is what opens this one
   * — and it covers the client-side transition, where the reveal never runs.
   */
  id: string;
  heading: string;
  children: ReactNode;
}) {
  return (
    <AutoOpenDetails id={id} openOnHash={id} className="group/row scroll-mt-8">
      <summary className={SUMMARY_CLASS}>
        {/* A heading inside a `<summary>` (implicit `button` role) is flattened
            by some screen readers' heading navigation — the same trade
            `SettingsRows` documents, kept because the whole row has to be the
            control and the group still needs its members in the outline. */}
        <h3 className="text-base font-semibold">{heading}</h3>
        <DisclosureCaret direction="down" className="size-4 text-muted group-open/row:rotate-180" />
      </summary>
      <div className={BODY_CLASS}>{children}</div>
    </AutoOpenDetails>
  );
}

/**
 * A compact secondary-detail row (ADR 20260830-responsive-surface-consistency). The settled value stays visible at rest;
 * the editable form opens in place behind one native disclosure control.
 * Labels and values stack below sm so the row remains legible on narrow phones.
 *
 * **Stacked, the value sits under the label, not under the caret**
 * (pixel-craft class 3). A column put it at the summary's edge, 20px left of
 * the words it answers (staffing at 390). Below `sm` the summary is a grid of
 * two columns, the caret and the words; the caret-and-label wrapper is
 * `contents`, so both are the first row, and the value takes the words'
 * column on the second. It starts where the label does whatever the caret's
 * width, with no indent to keep in step with it. From `sm` up the wrapper is
 * the row's leading group and the value its end, as before. The caret sits
 * on the label's first line (`SummaryCaret`); `content-center` still centres
 * a single line in the 44px floor.
 */
export function CompactDisclosureRow({
  id,
  label,
  value,
  open,
  onToggle,
  className = "",
  bodyClassName = "mt-3",
  children,
}: {
  id?: string;
  label: ReactNode;
  value?: ReactNode;
  open?: boolean;
  /**
   * Told whether the row is now open, for the rare body that should not do its
   * work until somebody asks for it — `CounterQrCard`'s QR encoder is the one
   * caller, and ~50 KB of it. A row whose body is ordinary markup passes
   * nothing and stays a plain native disclosure.
   */
  onToggle?: (open: boolean) => void;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <details
      id={id}
      open={open}
      onToggle={onToggle ? (event) => onToggle(event.currentTarget.open) : undefined}
      className={`group/compact-row ${className}`.trim()}
    >
      <summary className="-mx-2 grid min-h-11 cursor-pointer list-none grid-cols-[auto_minmax(0,1fr)] content-center items-start gap-x-2 gap-y-1 rounded-lg px-2 py-2 text-sm select-none transition-brand [&::-webkit-details-marker]:hidden hover:bg-surface-sunken hover:text-primary sm:flex sm:items-center sm:justify-between sm:gap-3">
        <span className="contents sm:flex sm:min-w-0 sm:items-center sm:gap-2">
          <SummaryCaret className="text-muted group-open/compact-row:rotate-90" />
          <span className="min-w-0 font-medium">{label}</span>
        </span>
        {value != null ? (
          <span className="col-start-2 min-w-0 max-w-full whitespace-normal break-words text-muted sm:truncate sm:text-end">
            {value}
          </span>
        ) : null}
      </summary>
      <div className={bodyClassName}>{children}</div>
    </details>
  );
}

/**
 * A row that has been answered — the deal list joined, the link sent. It keeps
 * the group's shape while dropping the disclosure: there is nothing left to
 * open, and a collapsable holding one settled sentence is a control that no
 * longer controls anything.
 */
export function DisclosureRowMessage({
  id,
  heading,
  children,
}: {
  id: string;
  heading: string;
  /** The settled sentence, and whatever the answer leaves the reader — a way
   * to reach the shop, say. A `div` rather than a `p` so a caller may pass an
   * element, which is not legal inside a paragraph. */
  children: ReactNode;
}) {
  return (
    <div id={id} className="rise-in px-5 py-5 sm:px-6">
      <h3 className="text-base font-semibold">{heading}</h3>
      <div className="mt-1 text-sm text-muted">{children}</div>
    </div>
  );
}
