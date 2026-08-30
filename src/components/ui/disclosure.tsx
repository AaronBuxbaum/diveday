import type { ReactNode } from "react";
import { AutoOpenDetails } from "@/components/AutoOpenDetails";
import { SectionCard } from "@/components/ui/card";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";

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

const SUMMARY_CLASS =
  "flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 transition-brand [&::-webkit-details-marker]:hidden hover:bg-surface-sunken sm:px-6";

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
 * A compact secondary-detail row. The settled value stays visible at rest;
 * the editable form opens in place behind one native disclosure control.
 * Labels and values stack below sm so the row remains legible on narrow phones.
 */
export function CompactDisclosureRow({
  id,
  label,
  value,
  open,
  className = "",
  bodyClassName = "mt-3",
  children,
}: {
  id?: string;
  label: ReactNode;
  value?: ReactNode;
  open?: boolean;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <details id={id} open={open} className={`group/compact-row ${className}`.trim()}>
      <summary className="flex min-h-11 cursor-pointer list-none flex-col items-start justify-center gap-1 py-2 text-sm select-none transition-brand [&::-webkit-details-marker]:hidden hover:text-primary sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <DisclosureCaret className="shrink-0 text-muted group-open/compact-row:rotate-90" />
          <span className="font-medium">{label}</span>
        </span>
        {value != null ? <span className="min-w-0 max-w-full truncate text-muted sm:text-end">{value}</span> : null}
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
