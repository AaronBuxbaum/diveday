import Link from "next/link";
import type { ReactNode } from "react";
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
 * - **The group label's spelling.** `tracking-[0.14em]` appears in exactly one
 *   place in `src/`, and it is `GROUP_LABEL_CLASS` below. `ledger.test.tsx`
 *   fails the build on a second copy. The eyebrow's `0.18em`
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
 * The small-caps line that owns a group's shared facts. Settings' spelling,
 * now the only spelling.
 */
const GROUP_LABEL_CLASS = "text-xs font-semibold tracking-[0.14em] text-muted uppercase";

/** Heading levels a group label may be. `p` for chrome that is not page structure (a menu section). */
type GroupLabelElement = "h2" | "h3" | "h4" | "p";

export function GroupLabel({
  children,
  meta,
  as: Label = "p",
  id,
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
  className?: string;
}) {
  // `className` lands on the label element in both shapes, never on the
  // wrapper: a call site's `scroll-mt-24` has to sit on the element the
  // fragment actually targets, and its `px-2` has to indent the words rather
  // than a flex box that may not exist.
  const label = (
    <Label id={id} className={`${GROUP_LABEL_CLASS} ${className}`.trim()}>
      {children}
    </Label>
  );
  if (meta == null) return label;
  return (
    <div className="flex items-baseline justify-between gap-3">
      {label}
      <span className="shrink-0 text-xs font-medium text-muted tabular-nums">{meta}</span>
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
  className = "",
  children,
}: {
  label: ReactNode;
  meta?: ReactNode;
  as?: GroupLabelElement;
  id?: string;
  /** Omit for a group that never collapses; `true` renders it closed, `false` open. */
  folded?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const heading = (
    <GroupLabel as={as} id={id} meta={meta}>
      {label}
    </GroupLabel>
  );
  if (folded === undefined) {
    return (
      <div className={className || undefined}>
        {heading}
        {children}
      </div>
    );
  }
  return (
    <details open={!folded} className={`group/fold ${className}`.trim()}>
      <summary className="-mx-2 flex cursor-pointer list-none items-baseline gap-2 rounded-lg px-2 py-1 transition-colors select-none [&::-webkit-details-marker]:hidden hover:bg-surface-sunken">
        {/* Which way this goes, before you press it — decorative; the native
            disclosure semantics carry the state. */}
        <DisclosureCaret className="self-center text-muted group-open/fold:rotate-90" />
        <span className="min-w-0 flex-1">{heading}</span>
      </summary>
      {children}
    </details>
  );
}

export type LedgerRowKindTone = "danger" | "warning" | "neutral";

/**
 * Tone in the ink, never in a fill. On `bg-surface` the raw hues clear AA
 * (warning 5.02:1, danger 6.47:1) and a 10% tint does not — the table is in
 * docs/design/forms-and-controls.md — and a tinted fill here would also be a
 * second pill grammar arriving by the back door.
 */
const KIND_TONE_INK = {
  danger: "text-danger",
  warning: "text-warning",
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
 * A hairline row on the page background — the ledger's only row shape.
 *
 * The hairline is `border-t` plus a `last:border-b`, so a group closes itself
 * without any row having to know it is last.
 */
export function LedgerRow({
  leading,
  kind,
  children,
  trailing,
  href,
  linkLabel,
  size = "md",
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
  /** Whole-row link, for a row that *is* a door. The overlay makes the row the target. */
  href?: string;
  /** The accessible name of that whole-row link — the destination, in words. */
  linkLabel?: string;
  /** `lg` (min-h-14) for the counter's queue and the horizon rows. */
  size?: "md" | "lg";
  as?: "li" | "div";
  className?: string;
}) {
  return (
    <Tag
      className={`relative flex items-center gap-3 border-t border-border last:border-b ${
        size === "lg" ? "min-h-14" : "min-h-12"
      } ${href ? "transition-colors hover:bg-surface-sunken/60 has-[a:focus-visible]:bg-surface-sunken/60" : ""} ${className}`
        .replace(/\s+/g, " ")
        .trim()}
    >
      {leading != null ? <span className="shrink-0">{leading}</span> : null}
      {kind ? <RowKind word={kind.word} tone={kind.tone} className="min-w-23" /> : null}
      <div className="min-w-0 flex-1">{children}</div>
      {trailing != null ? <div className="relative z-10 shrink-0">{trailing}</div> : null}
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
  id,
  className = "",
  children,
}: {
  label?: ReactNode;
  meta?: ReactNode;
  as?: GroupLabelElement;
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className || undefined}>
      {label != null ? (
        <GroupLabel as={as} id={id} meta={meta} className="mb-3">
          {label}
        </GroupLabel>
      ) : null}
      <SectionCard as="div" padding="none" className="divide-y divide-border overflow-hidden">
        {children}
      </SectionCard>
    </div>
  );
}
