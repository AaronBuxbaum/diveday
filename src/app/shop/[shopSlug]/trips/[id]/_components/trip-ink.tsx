import type { ReactNode } from "react";
import { buttonClass } from "@/components/ui/button";
import { sectionCardClass } from "@/components/ui/card";

/**
 * **One way to draw each thing on the Trip page** (owner, 2026-11-25: "make
 * sure everything is beautiful and clean and consistent"). Every phase and
 * Edit trip draw their facts, quiet doors, names lines, cards and inks from
 * here, so a thing looks the same wherever the clock shows it. No hooks and no
 * server reads: the client fix list draws from it too.
 */

/** A quiet door at the end of its row or card: "Add a guest", "Print", "Edit". */
export const QUIET_ACTION = buttonClass({ variant: "link", size: "sm", flush: true });

/**
 * The same door inside a line of words (Filling's facts line): the quiet
 * action's ink and weight without its box, so it keeps the line's baseline.
 */
export const QUIET_LINK_INLINE = "font-medium text-primary hover:underline focus-visible:underline";

/**
 * A row's remedy (Send waiver, Check in, Call Tom, Add contact), the same
 * weight in every phase. Only a phase heading's one main action is primary.
 */
export const REMEDY_ACTION = buttonClass({ variant: "secondary", size: "sm" });

/** A card's heading: row-sized, inside its card. */
export const CARD_HEADING = "font-semibold";

/** The inset of everything inside a Trip page card, rows and heading alike. */
export const CARD_INSET = "px-4 sm:px-6";

/**
 * **One disclosure line**: a `<summary>` that is words, led by `SummaryCaret`
 * (`size-4`, turning 90° on its group's open), never the native marker or a
 * caret at the far edge. A card's own face uses `cardSummaryClass` with the
 * same caret.
 */
export const INLINE_SUMMARY =
  "flex min-h-11 w-fit cursor-pointer list-none items-center gap-2 rounded-lg select-none [&::-webkit-details-marker]:hidden focus-visible:focus-ring-inset";

/** The ink of each meaning: what stops a guest boarding, an advisory, a plain fact. */
export type Tone = "danger" | "warning" | "muted";
export const TONE_INK: Readonly<Record<Tone, string>> = {
  danger: "text-danger",
  warning: "text-warning-strong",
  muted: "text-muted",
};

/** The fact row's columns: the label, the value, the quiet action. */
export const FACT_GRID =
  "grid grid-cols-[6.5rem_minmax(0,1fr)_auto] items-baseline gap-x-4 text-sm sm:grid-cols-[10rem_minmax(0,1fr)_auto]";
/** One fact row: the columns and the row's height. */
export const FACT_ROW = `${FACT_GRID} min-h-11 py-2.5`;
/** What opens under a fact row sits on the value's column. */
export const FACT_BODY = "pb-4 sm:ps-[11rem]";

export type Fact = {
  key: string;
  label: string;
  value: ReactNode;
  /** A second, muted line under the value. */
  detail?: ReactNode;
  /** The row's quiet action, at its end. */
  action?: ReactNode;
  id?: string;
};

/** A fact's three cells, for a row drawn inside something else (a summary). */
export function FactCells({ label, value, detail, action }: Omit<Fact, "key" | "id">) {
  return (
    <>
      <span className="text-muted">{label}</span>
      <span className="min-w-0 [overflow-wrap:anywhere]">
        {value}
        {detail ? <span className="block text-muted">{detail}</span> : null}
      </span>
      <span>{action}</span>
    </>
  );
}

/**
 * **One fact list**: a muted label in a fixed left column, the value beside
 * it, an optional quiet action at the row's end, a hairline between rows.
 * `inset` pads each row to a padding-less card's edge.
 */
export function FactList({
  facts,
  inset = false,
  className = "",
}: {
  facts: readonly Fact[];
  inset?: boolean;
  className?: string;
}) {
  return (
    <div className={`divide-y divide-border ${className}`}>
      {facts.map(({ key, id, ...fact }) => (
        <div
          key={key}
          id={id}
          data-fact={key}
          className={`${FACT_ROW} scroll-mt-24 ${inset ? CARD_INSET : ""}`}
        >
          <FactCells {...fact} />
        </div>
      ))}
    </div>
  );
}

/**
 * **One Trip page card**: the shell every phase draws its sections in, the
 * heading inside it, its rows on the same inset. `aside` sits at the heading
 * row's end (a quiet action, a count). Children own their own vertical room;
 * `body` pads them as one block.
 */
export function TripCard({
  id,
  heading,
  headingId,
  headingClass = "",
  aside,
  label,
  body = false,
  className = "",
  data,
  children,
}: {
  id?: string;
  heading?: ReactNode;
  headingId?: string;
  /** The heading's tone, when it carries one. */
  headingClass?: string;
  aside?: ReactNode;
  /** The region's name when it has no heading. */
  label?: string;
  /** Pad the children as one block on the card's inset. */
  body?: boolean;
  className?: string;
  /** `data-*` hooks the specs read. */
  data?: Record<`data-${string}`, string>;
  children?: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={heading && headingId ? headingId : undefined}
      aria-label={heading ? undefined : label}
      className={sectionCardClass({ padding: "none", className: `scroll-mt-24 ${className}` })}
      {...data}
    >
      {heading ? (
        <div
          className={`flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 pt-4 ${CARD_INSET} ${body ? "" : "pb-1"}`}
        >
          <h2 id={headingId} className={`${CARD_HEADING} ${headingClass}`}>
            {heading}
          </h2>
          {aside ? <span className="flex flex-wrap items-baseline gap-x-4">{aside}</span> : null}
        </div>
      ) : null}
      {body ? <div className={`space-y-3 py-4 ${CARD_INSET}`}>{children}</div> : children}
    </section>
  );
}

/**
 * **One names line**: a bold label, the names in muted ink, an optional quiet
 * action at the end ("Booked · Ana, Joe and Sam … Add a guest", "Here · …",
 * "Crew and plan are set · …"). `lead` is a mark before the words; `onToggle`
 * makes the words a button that unfolds what the line stands for.
 */
export function NamesLine({
  label,
  names,
  lead,
  action,
  toggle,
  data,
}: {
  label: ReactNode;
  names?: ReactNode;
  lead?: ReactNode;
  action?: ReactNode;
  /** The words open a list: the button's state and what it does. */
  toggle?: { expanded: boolean; onToggle: () => void; data?: Record<`data-${string}`, string> };
  data?: Record<`data-${string}`, string>;
}) {
  const words = (
    <>
      {lead}
      <span className="min-w-0 [overflow-wrap:anywhere]">
        <span className="font-semibold">{label}</span>
        {names ? <span className="text-muted"> · {names}</span> : null}
      </span>
    </>
  );
  return (
    <div className={`flex min-h-11 items-center gap-3 py-3 ${CARD_INSET}`} {...data}>
      {toggle ? (
        <button
          type="button"
          aria-expanded={toggle.expanded}
          onClick={toggle.onToggle}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-3 text-start focus-visible:focus-ring-inset"
          {...toggle.data}
        >
          {words}
        </button>
      ) : (
        <p className="flex min-w-0 flex-1 items-center gap-3">{words}</p>
      )}
      {action ? <span className="shrink-0">{action}</span> : null}
    </div>
  );
}
