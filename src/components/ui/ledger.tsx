import Link from "next/link";
import type { ReactNode } from "react";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { SectionCard } from "@/components/ui/card";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";

/**
 * **The open ledger** — the composition ADR 20260827-clearwater-surface-language
 * (decision 2) makes the app's default, in place of the stack of same-weight
 * cards. Rows sit directly on the page background, separated by hairlines,
 * under a group header that owns every fact the rows share: a date, a
 * departure, a state word, a count.
 *
 * It is not a new idea in this repo — the schedule board and the public
 * schedule both arrived at it independently, and Settings arrived at the other
 * good grammar (`InsetGroup` below). This file is those two spellings written
 * down once so the surfaces that speak them next cannot drift apart, and so a
 * later slice recomposing the home, orders or the counter has a vocabulary to
 * compose *in* rather than a card to hand-roll again.
 *
 * Three things this file deliberately owns, because owning them one place is
 * the whole point:
 *
 * - **The group label's spelling.** `groupLabelClass()` below is the only place
 *   in `src/` that *renders* `tracking-[0.14em]`; `ledger.test.tsx` names the
 *   value once to pin it, and its sweep fails the build on a copy in any other
 *   file — source or test, `.ts`, `.tsx` or `.css`. What that sweep catches is
 *   the realistic drift, a paste of this class string; it cannot catch a
 *   *different* spelling of the same idea (`tracking-wide`, `tracking-widest`).
 *   The designed surfaces now route their small-caps group labels through this
 *   helper as well. It is a *function* of the tone rather than a bare constant because
 *   the ink is part of the spelling: appending `text-primary` at a call site
 *   would race `text-muted` in a stylesheet Tailwind orders by token name, the
 *   same trap `buttonClass` carries a warning about. The eyebrow's `0.18em`
 *   (`ShopPageHeader.EYEBROW_CLASS`) is a different thing at a different
 *   volume and stays where it is.
 * - **The one disclosure spelling.** A ledger group that collapses is a native
 *   `<details>` whose `<summary>` carries the group label plus the shared
 *   `DisclosureCaret` — `LedgerGroup`'s `folded` prop, and nothing else. 6c's
 *   Tomorrow row, 6f's imported-history foot and 6h's settled group are all
 *   this; no slice invents a second.
 * - **The kind word.** A row's kind is a word in the row's own type with tone
 *   in the *ink* — never a pill. `Badge` is the only pill in the app
 *   (decision 3), and it marks the exceptional state rather than every row.
 */

/**
 * The inks a group label may be set in. `primary` is for the one group in a
 * run that is *current* — the week board's today column. `success` and
 * `warning` keep exceptional group headings in the same typography while
 * letting the state speak through ink; a group label is quiet by default.
 */
const GROUP_LABEL_INK = {
  muted: "text-muted",
  primary: "text-primary",
  success: "text-success",
  warning: "text-warning-strong",
  /** The one label set in danger ink: the home's "First thing" panel, naming the row that blocks a boat. */
  danger: "text-danger",
} as const;

/** Which ink a group label is set in. `muted` unless the group has a state to carry. */
export type GroupLabelTone = keyof typeof GROUP_LABEL_INK;

/**
 * The small-caps line that owns a group's shared facts. Settings' spelling,
 * now the only spelling.
 *
 * A function rather than a bare string because the ink is part of the
 * spelling: a caller that appended its own `text-primary` would be racing
 * `text-muted` in the emitted stylesheet, which Tailwind orders by token name
 * rather than by where the class was written (AGENTS.md's `buttonClass`
 * warning, the same failure at 31 call sites). Exported for callers that need
 * the spelling without changing their existing semantic element — table headers,
 * definition labels and compact group headings.
 */
export function groupLabelClass(tone: GroupLabelTone = "muted") {
  return `text-xs font-semibold tracking-[0.14em] ${GROUP_LABEL_INK[tone]} uppercase`;
}

/**
 * The quiet, tabular facts a group carries beside its label. One constant
 * because two places render it — `GroupLabel`'s own row, and a folded group's
 * `<summary>`, which lays the same three parts out itself so no flow element
 * has to be nested inside phrasing content (see `LedgerGroup`).
 */
const GROUP_META_CLASS = "shrink-0 text-xs font-medium text-muted tabular-nums";

/** The row grammar used by a collapsed horizon such as Tomorrow. */
const HORIZON_SUMMARY_CLASS =
  "-mx-2 flex min-h-14 cursor-pointer list-none items-center gap-3 border-t border-border px-2 py-1 transition-colors select-none [&::-webkit-details-marker]:hidden hover:bg-surface-sunken";
const HORIZON_LABEL_CLASS = "min-w-0 flex-1 text-base font-semibold tracking-tight";
const HORIZON_META_CLASS = "shrink-0 text-sm font-medium text-muted tabular-nums";

/** Heading levels a group label may be. `p` for chrome that is not page structure (a menu section). */
type GroupLabelElement = "h2" | "h3" | "h4" | "p";

export function GroupLabel({
  children,
  meta,
  as: Label = "p",
  id,
  tone = "muted",
  className = "",
}: {
  /** The label text. */
  children: ReactNode;
  /** Right-aligned quiet facts a group owns for its rows ("3 orders · $412.75"). Tabular. */
  meta?: ReactNode;
  /** The heading level when the group is a section of the page. */
  as?: GroupLabelElement;
  /** For the `aria-labelledby` of the list this labels, and for a fragment target. */
  id?: string;
  /** `primary` for the one group in a run that is current; quiet otherwise. */
  tone?: GroupLabelTone;
  className?: string;
}) {
  // `className` lands on the label element in both shapes, never on the
  // wrapper: a call site's `scroll-mt-24` has to sit on the element the
  // fragment actually targets, and its `px-2` has to indent the words rather
  // than a flex box that may not exist.
  const label = (
    <Label id={id} className={`${groupLabelClass(tone)} ${className}`.trim()}>
      {children}
    </Label>
  );
  if (meta == null) return label;
  return (
    <div className="flex items-baseline justify-between gap-3">
      {label}
      <span className={GROUP_META_CLASS}>{meta}</span>
    </div>
  );
}

/**
 * A ledger group: its label, and its rows. `folded` turns it into the app's
 * one disclosure spelling — a native `<details>`, so keyboard and
 * screen-reader semantics come free and a JS failure still leaves the rows one
 * tap away.
 *
 * Whether a group folds is the caller's rule (the queue folds a horizon once
 * something more pressing has rendered in full); this component only owns what
 * a fold *is*.
 */
export function LedgerGroup({
  label,
  meta,
  as = "p",
  id,
  folded,
  summaryVariant = "group",
  className = "",
  children,
}: {
  label: ReactNode;
  meta?: ReactNode;
  as?: GroupLabelElement;
  id?: string;
  /** Omit for a group that never collapses; `true` renders it closed, `false` open. */
  folded?: boolean;
  /** `row` keeps collapsed horizons in the same grammar as their link rows. */
  summaryVariant?: "group" | "row";
  className?: string;
  children: ReactNode;
}) {
  const SummaryLabel = as;
  if (folded === undefined) {
    return (
      <div className={className || undefined}>
        <GroupLabel as={as} id={id} meta={meta}>
          {label}
        </GroupLabel>
        {children}
      </div>
    );
  }
  return (
    <details open={!folded} className={`group/fold ${className}`.trim()}>
      {/* The default summary keeps the quiet group-label grammar used by
          settings and other folded groups. Horizons opt into the row grammar
          below so their label, count and door match the sibling week row. */}
      {summaryVariant === "row" ? (
        <summary className={HORIZON_SUMMARY_CLASS}>
          {/* The caret stays at the edge of a horizon row, beside its counts,
              so Tomorrow and This week read as the same door. */}
          <SummaryLabel id={id} className={HORIZON_LABEL_CLASS}>
            {label}
          </SummaryLabel>
          {meta != null ? <span className={HORIZON_META_CLASS}>{meta}</span> : null}
          <DisclosureCaret className="text-muted group-open/fold:rotate-90" />
        </summary>
      ) : (
        <summary className="-mx-2 flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-2 rounded-lg px-2 py-1 transition-colors select-none [&::-webkit-details-marker]:hidden hover:bg-surface-sunken">
          {/* Which way this goes, before you press it — decorative; the native
              disclosure semantics carry the state. */}
          <DisclosureCaret className="text-muted group-open/fold:rotate-90" />
          <GroupLabel as={as} id={id} className="min-w-0 flex-1">
            {label}
          </GroupLabel>
          {/* Below `sm` the meta takes its own line under the label rather than
              squeezing it: "Imported payment history" beside "2 imported source
              records" and an Unverified badge left the label 100px to wrap in
              on a 390px phone, three lines deep, with the badge overlapping it. */}
          {meta != null ? (
            <span className={`${GROUP_META_CLASS} max-sm:basis-full max-sm:text-end`}>{meta}</span>
          ) : null}
        </summary>
      )}
      {children}
    </details>
  );
}

export type LedgerRowKindTone = "danger" | "warning" | "neutral";

/**
 * Tone in the ink, never in a fill — a tinted fill here would be a second pill
 * grammar arriving by the back door.
 *
 * `warning` is the `-strong` token and `danger` is not, which is the contrast
 * table in docs/design/forms-and-controls.md read for a component that does
 * **not** know what it is mounted on. Raw `text-warning` clears AA on
 * `bg-surface` (5.02:1) and fails on `bg-surface-sunken` (4.37:1) and on a tint
 * (4.39:1); `text-warning-strong` clears all three (5.56 / 4.83 / 4.86) and
 * every dark-palette pairing. That is not hypothetical here — a door row's own
 * `hover:bg-surface-sunken/60` puts the word on a sunken fill on this very
 * component — and the only override channel a call site has is `className`,
 * which would win or lose by Tailwind's alphabetical emission rather than by
 * intent (the trap AGENTS.md documents for `buttonClass()`). So the component
 * that cannot know its container does not get to be the one that guessed —
 * the same call `FormStatus` and `ShopStat` already made. `text-danger`
 * measures 6.47 / 5.63 / 5.45 and needs no `-strong`; there is no
 * `text-danger-strong` token.
 */
const KIND_TONE_INK = {
  danger: "text-danger",
  warning: "text-warning-strong",
  neutral: "text-muted",
} as const;

/**
 * A row's kind, as a word rather than a chip (ADR
 * 20260827-clearwater-surface-language, decision 3). Exported on its own for
 * the surfaces that name a kind but are not ledger rows *yet* — the Today
 * queue and the close-out, whose recompositions are slices 6c and 6d — so the
 * spelling is single-sourced from the day the pill retires rather than from
 * the day those pages are rebuilt.
 */
export function RowKind({
  word,
  tone,
  count,
  className = "",
}: {
  word: string;
  tone: LedgerRowKindTone;
  /**
   * A tally carried with the word ("Waiver · 3"), for a summary that counts
   * kinds rather than listing rows. It rides *inside* the label because a bare
   * number set beside one is bound to it by a gap alone, and at 390px a wrapped
   * row of them reads as a list of unrelated digits. Only a positive count
   * renders: a kind that turned up cannot also be a "· 0".
   */
  count?: number;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 text-sm font-medium ${KIND_TONE_INK[tone]} ${className}`.trim()}
    >
      {word}
      {count === undefined || !Number.isFinite(count) || count <= 0 ? null : (
        <>
          <span aria-hidden="true" className="font-normal opacity-60">
            ·
          </span>
          <span className="tabular-nums">{count}</span>
        </>
      )}
    </span>
  );
}

/**
 * Whether a row is a door, as one indivisible fact.
 *
 * A stretched overlay link with no children takes its accessible name from
 * nothing at all — an axe `link-name` violation on a control the row's own text
 * sits *behind*, which `e2e/a11y.spec.ts` scans for with no exclusion list, and
 * which principles.md §4 puts outside the set of things that may ever be
 * traded. Two independent optional props let a call site produce that by
 * omission; one union means the type system asks for the destination's name in
 * the same breath as the destination.
 */
type LedgerRowDoor = { href: string; linkLabel: string } | { href?: never; linkLabel?: never };

/**
 * A hairline row on the page background — the ledger's only row shape.
 *
 * The hairline is `border-t` plus a `last:border-b`, so a group closes itself
 * without any row having to know it is last.
 *
 * **A door draws its own chevron.** A row with an `href` ends in the shared
 * `chevron-right` glyph, after whatever `trailing` carries, so the affordance
 * that says "this row opens" is one decision rather than one per surface.
 * Before this it was drawn by hand on nine surfaces and left off on five —
 * the orders ledger, the promo ledger, the reports ledger, the course roster
 * and the departure picker were doors with nothing on them saying so, while
 * the diver roster tucked its chevron inside the row's own content where the
 * phone layout dropped it to a second line. A caller never renders the glyph
 * in `trailing`; the primitive already did.
 *
 * **`stacked` is the phone reading of a row that carries a whole sentence**
 * (the cross-page phone contract is ADR 20260830-responsive-surface-consistency).
 * (ADR 20260827-clearwater-surface-language; the `TodayPhone` artboard draws
 * it). One line holds the kind and the fix, and the sentence takes the full
 * width beneath them — because at 390px a kind word, a sentence and a named
 * fix on one line leave the sentence about 80px to wrap in, which is where the
 * day spine's desk rows first ran six lines deep. Every class it adds is a
 * `max-sm:` one, so from `sm` up an opted-in row is byte-for-byte the row it
 * always was.
 *
 * **A stacked row with no kind leads with its content.** The artboard's first
 * line is *the kind and the fix*; a row that names no kind has nothing to put
 * on the left of that line, and the first reading of this rule gave the
 * dive-site library and the course roster a first line holding only a
 * right-aligned chevron (or "Schedule · Hide") floating above the row's own
 * name — an affordance detached from the thing it opened, on every row, down
 * the whole page. So without a kind the content and the door's chevron take
 * the first line and `trailing` drops beneath them, end-aligned, where the
 * eye reads it as the row's second line rather than its heading. It is opt-in rather than the default because a row whose content
 * is a name and a state (the counter's queue, the gear register) reads better
 * on one line at every width, and changing those would be restyling surfaces
 * this decision has not reached yet.
 */
export function LedgerRow({
  leading,
  kind,
  children,
  trailing,
  href,
  linkLabel,
  size = "md",
  stacked = false,
  as: Tag = "li",
  className = "",
}: {
  /** An 18px drawn glyph. Omitted for plain rows. */
  leading?: ReactNode;
  /** The row's kind, in the row's own type. */
  kind?: { word: string; tone: LedgerRowKindTone };
  /** The row's one sentence, or its primary content. */
  children: ReactNode;
  /** The one fix (a link or ghost button), a fact, or a chevron. */
  trailing?: ReactNode;
  /**
   * `md` is 52px, Reef's floor for a row ("rows never tighter than 52 tall" —
   * the system sheet's spacing rung between 32 and 84); `lg` (56px) for the
   * counter's queue and the horizon rows. It read 48 until 2026-09-02.
   */
  size?: "md" | "lg";
  /** Below `sm`, drop the sentence to its own full-width line. See above. */
  stacked?: boolean;
  /**
   * `article` for a row that is a self-contained record of one person — the
   * counter's queue rows, which carry their own controls and are addressed
   * individually by the e2e suite. A list of those is a `<div>`, not a `<ul>`.
   */
  as?: "li" | "div" | "article";
  className?: string;
} & LedgerRowDoor) {
  return (
    <Tag
      className={`relative flex items-center gap-3 border-t border-border last:border-b ${
        size === "lg" ? "min-h-14" : "min-h-13"
      } ${stacked ? "max-sm:flex-wrap max-sm:py-2" : ""} ${href ? "transition-colors hover:bg-surface-sunken/60 has-[a:focus-visible]:bg-surface-sunken/60" : ""} ${className}`
        .replace(/\s+/g, " ")
        .trim()}
    >
      {leading != null ? <span className="shrink-0">{leading}</span> : null}
      {kind ? (
        <RowKind
          word={kind.word}
          tone={kind.tone}
          className={stacked ? "min-w-23 max-sm:order-1" : "min-w-23"}
        />
      ) : null}
      {/* Every `stacked` class is a `max-sm:` one, deliberately: from `sm` up
          the row must render byte-for-byte as it always has, so opting a
          surface in can only ever change the phone. */}
      <div
        className={
          stacked
            ? kind
              ? "min-w-0 flex-1 max-sm:order-3 max-sm:basis-full"
              : "min-w-0 flex-1 max-sm:order-1"
            : "min-w-0 flex-1"
        }
      >
        {children}
      </div>
      {trailing != null ? (
        <div
          className={
            stacked
              ? kind
                ? "relative z-10 min-w-0 max-w-full shrink-0 max-sm:order-2 max-sm:ms-auto"
                : "relative z-10 min-w-0 max-w-full shrink-0 max-sm:order-3 max-sm:flex max-sm:basis-full max-sm:justify-end"
              : "relative z-10 min-w-0 max-w-full shrink-0"
          }
        >
          {trailing}
        </div>
      ) : null}
      {href ? (
        // The door's glyph, last on the line at every width. It sits below
        // the overlay link (static, so the absolutely positioned link paints
        // over it) — a tap on it is a tap on the row.
        <DiveDayIcon
          name="chevron-right"
          className={`size-4 shrink-0 text-muted ${stacked ? "max-sm:order-2" : ""}`.trim()}
        />
      ) : null}
      {href ? (
        // The stretched link, the same construction the public schedule's
        // agenda rows use: an invisible overlay makes the whole row the tap
        // target, and the label keeps the destination's name for a screen
        // reader. Anything interactive in `trailing` sits above it.
        <Link href={href} aria-label={linkLabel} className="absolute inset-0 z-0" />
      ) : null}
    </Tag>
  );
}

/**
 * **The inset group** — Settings' grammar, kept (ADR decision 2): rows inside
 * one hairline shell under a small-caps group label, for configuration and
 * object lists.
 *
 * The shell comes from `SectionCard` rather than from a second copy of its
 * class string, so the flat-at-rest rule reaches it for free. Its unlabelled
 * twin is `DisclosureRowList` in ./disclosure.tsx, which is this shell holding
 * `<details>` rows.
 */
export function InsetGroup({
  label,
  meta,
  as = "p",
  bodyAs = "div",
  id,
  className = "",
  labelClassName = "",
  children,
}: {
  label?: ReactNode;
  meta?: ReactNode;
  as?: GroupLabelElement;
  /**
   * `"ul"` where the rows are one record each, so the shell announces its own
   * length to a screen reader and each row is a real `<li>`. Configuration
   * rows — settings, a form's fields — stay `"div"`: they are one object seen
   * from several sides, not a list of things.
   */
  bodyAs?: "div" | "ul";
  id?: string;
  className?: string;
  /**
   * Lets a responsive wrapper hide the desktop group label while keeping the
   * same InsetGroup markup and its semantic heading.
   */
  labelClassName?: string;
  children: ReactNode;
}) {
  return (
    <div className={className || undefined}>
      {label != null ? (
        <GroupLabel
          as={as}
          id={id}
          meta={meta}
          className={labelClassName ? `mb-3 ${labelClassName}` : "mb-3"}
        >
          {label}
        </GroupLabel>
      ) : null}
      <SectionCard as={bodyAs} padding="none" className="divide-y divide-border overflow-hidden">
        {children}
      </SectionCard>
    </div>
  );
}
