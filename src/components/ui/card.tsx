import { type ReactNode, useId } from "react";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";

/**
 * Canonical section-card shell. Callers choose padding and own section spacing.
 * `title` renders a heading inside the region; its id names that region through
 * `aria-labelledby`, and `titleAs` sets the heading level. The full grammar is
 * in docs/design/forms-and-controls.md. ADR 20261001-logbook, decision 5,
 * keeps resting panels on the hairline and shared bed token, with no radius,
 * fill, elevation, or tone props. `card.test.tsx` guards the shell spelling.
 */
const PADDING = {
  /** The card is a shell: a divided row list, a table, a `<details>` whose own parts pad themselves. */
  none: "",
  /** The default, and the `ShopStat`/`Table` spelling. */
  md: "p-4 sm:p-5",
  /** A card a person works *inside* — a form, a set of snippets, a wizard step. */
  lg: "p-5 sm:p-6",
} as const;

export type SectionCardPadding = keyof typeof PADDING;

/**
 * The card's chrome as a class string, for the places that need the shell
 * without the anatomy — most of all a route's `loading.tsx`, whose skeleton
 * must be the same shape as what replaces it or every navigation into the
 * route jumps.
 */
export function sectionCardClass({
  padding = "md",
  className = "",
}: {
  padding?: SectionCardPadding;
  className?: string;
} = {}): string {
  return `rounded-panel border border-border bg-surface shadow-bed ${PADDING[padding]} ${className}`
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Tone-panel geometry; callers supply the semantic border and fill
 * (docs/design/pixel-craft.md, classes 3 and 12).
 */
export const TONE_PANEL_CLASS = "rounded-panel border p-4 shadow-bed sm:p-5";

/** Larger tone-panel inset for `padding="lg"` cards (pixel-craft class 12). */
export const TONE_PANEL_LG_CLASS = "rounded-panel border p-5 shadow-bed sm:p-6";

/**
 * Tone-panel geometry for overlays, which keep their own elevation
 * (ADR 20260901-diveday-reimagined).
 */
export const TONE_PANEL_IN_OVERLAY_CLASS = "rounded-panel border p-4 sm:p-5";

/**
 * Shared sunken-note geometry; placement and tone remain caller-owned
 * (pixel-craft class 12).
 */
export const INSET_NOTE_BOX = "rounded-lg px-3 py-2 text-sm";
export const INSET_NOTE_CLASS = `${INSET_NOTE_BOX} bg-surface-sunken text-muted`;

/**
 * Inner corner radius for a fill flush against the panel border
 * (docs/design/pixel-craft.md, class 6). Apply only where the fill reaches the
 * edge. Do not clip the card: focus rings and controls need room outside it.
 */
export const PANEL_INNER_RADIUS = "rounded-[calc(var(--radius-panel)-1px)]";

/** The hover fill of a card face, by the band it sits on. */
const CARD_SUMMARY_HOVER = {
  neutral: "hover:bg-surface-sunken",
  // A tinted band keeps its tint under the pointer: a grey fill would paint
  // the danger out of the one row that is about danger.
  danger: "hover:bg-danger/5",
} as const;

/**
 * Shared face for a card disclosure. It preserves the panel's inner corner,
 * top-aligns wrapped content, and leaves padding and non-clipping focus room to
 * the caller (docs/design/pixel-craft.md, classes 7 and 12).
 */
export function cardSummaryClass({
  tone = "neutral",
  className = "",
}: {
  tone?: keyof typeof CARD_SUMMARY_HOVER;
  className?: string;
} = {}): string {
  return `flex cursor-pointer list-none items-start gap-3 ${PANEL_INNER_RADIUS} [[open]>&]:rounded-b-none transition-colors select-none [&::-webkit-details-marker]:hidden ${CARD_SUMMARY_HOVER[tone]} ${className}`
    .replace(/\s+/g, " ")
    .trim();
}

/** Closed set on purpose — a caller never hands this component an arbitrary tag. */
type SectionCardElement = "section" | "div" | "article" | "aside" | "ul" | "li" | "details";

/**
 * The heading vocabulary, folded in so no call site types it. Two levels, and
 * only two: `h2` for a section of the page, `h3` for a card inside a group that
 * already has its own `h2` (the export page's Backups half). The step exists so
 * a group and the five cards under it do not shout at the same volume; every
 * other difference the app had grown here — `text-xl`, `text-base`,
 * `font-medium`, bare `font-semibold` — is gone.
 */
const TITLE_CLASS = {
  // The app's one section rung (#1966): every hand-spelled section heading
  // reads the same constant, so the two cannot drift apart again (#1229).
  h2: SECTION_TITLE_CLASS,
  h3: "text-base font-semibold",
} as const;

/**
 * A short, stable discriminator from a card's heading, for the id above.
 *
 * Only a string title yields one — a `ReactNode` heading has no text to read
 * here, and falls back to `title`, which is what every card had before. Bounded
 * because an id is not a place to put a sentence, and sanitised to the charset
 * an id may hold.
 */
function titleSlug(title: ReactNode): string {
  if (typeof title !== "string") return "title";
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "title";
}

export function SectionCard({
  as: Tag = "section",
  open,
  title,
  titleAs = "h2",
  description,
  actions,
  padding = "md",
  id,
  className = "",
  "aria-label": ariaLabel,
  children,
}: {
  /** The element this card *is*. A row in a list is an `li`; a disclosure is `details`. */
  as?: SectionCardElement;
  /** Initial/open state for a native details card. Ignored for other elements. */
  open?: boolean;
  /** The section heading. Rendered at the one size; never spell it at a call site. */
  title?: ReactNode;
  /** `h3` for a card nested under a group that already owns the `h2`. */
  titleAs?: keyof typeof TITLE_CLASS;
  /** One quiet line under the heading, saying what the section is for. */
  description?: ReactNode;
  /** Buttons, a `Badge`, a status — pinned to the heading's right, wrapping below it on a phone. */
  actions?: ReactNode;
  padding?: SectionCardPadding;
  /** A fragment target (`#backups`, `#invite`). Pair it with `scroll-mt-*` in `className`. */
  id?: string;
  className?: string;
  "aria-label"?: string;
  children?: ReactNode;
}) {
  const Heading = titleAs;
  const hasHeader = title != null || description != null || actions != null;
  // A titled card names itself to a screen reader. Hand-rolled panels did this
  // with a hand-written `aria-labelledby` pointing at a hand-written heading id,
  // which is a pair that has to be kept in step — so most of them simply did not
  // have it, and one that did (`PartyClaimPanel`, on `/ready/[token]`) lost it on
  // the way in here and became the only unnamed region on a page whose siblings
  // are all named. Deriving the id removes the bookkeeping: the label follows the
  // title for free, and cannot drift from it.
  //
  // `useId` rather than a slug of the title: the title is a `ReactNode`, and two
  // cards on one page may legitimately share a heading ("Notes", "Details").
  //
  // `useId` in a component with no `"use client"` is deliberate and is fine: it
  // needs no state, only a stable position in the tree, and React allows it in a
  // Server Component. `Field` in `./form.tsx` has done the same since it was
  // written, and six Server Component pages render it. Do not add `"use client"`
  // here to satisfy a doubt about that — it would drag every staff page's panels
  // into the client bundle to buy nothing.
  const generatedId = useId();
  // **Prefixed, so this id can never be a `Field`'s.** Under `cacheComponents`
  // a client navigation renders in two passes and each restarts React's server
  // `useId` counter at 1, so two subtrees can be handed the same `_S_n_`
  // (issue #1022). `scopedFieldId` (./form.tsx) answers that for fields by
  // folding the control's `name` in — and its own note argues that
  // `_S_2_-maxDepthMeters` and `_S_2_-title` therefore cannot collide. They
  // cannot; but this card minted `${useId()}-title` too, and the trip's own
  // Overview has both a `Field name="title"` (DetailsSection) and several of
  // these. Same string, two namespaces, duplicate id — caught by the
  // duplicate-id net in the suite's axe scan (removed 2026-10-24) on the
  // departure-tabs scan.
  //
  // A different *suffix* would only move the coincidence: a control may legally
  // be named anything, so no suffix is provably unreachable. A prefix is.
  // React's ids are `_S_n_`, so a field's id always starts with `_`, and this
  // one never does.
  //
  // The prefix alone is not enough, because the same two passes can hand
  // `_S_1_` to two *cards* — a card in the prerendered shell and a card in the
  // streamed content, which is what the departure's Overview does. So the
  // title is folded in as well, the same move `scopedFieldId` makes with a
  // control's `name`: a stable, content-derived discriminator that both passes
  // compute identically. Its residue is the one that comment names too — two
  // cards sharing *both* a counter value and a heading would still collide,
  // and since the suite's duplicate-id net went with its axe scan on
  // 2026-10-24, nothing automated would notice.
  const headingId = title != null ? `card-${generatedId}-${titleSlug(title)}` : undefined;
  return (
    <Tag
      {...(Tag === "details" ? { open } : {})}
      id={id}
      // Only when this element is a landmark a name means something on. An `li`
      // in a list of cards is named by its content, and labelling it would make
      // a screen reader announce the heading twice.
      aria-labelledby={headingId != null && Tag !== "li" ? headingId : undefined}
      aria-label={ariaLabel}
      className={sectionCardClass({ padding, className })}
    >
      {hasHeader ? (
        // `items-baseline`: the title and whatever sits beside it (a 44px
        // button, a badge, a count) share the line text beside a control
        // shares. Top-aligned, a 32px title line and a 44px button shared no
        // line at all — "My departures" sat 5.5px above its button's centre
        // (pixel-craft class 1). A toned badge hands the row its word's
        // baseline, not its mark's (badge.tsx). Once the actions wrap under
        // the title on a phone they are a line of their own and nothing
        // aligns across.
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            {title != null ? (
              // `text-balance`: a card title that wraps keeps more than one
              // word on its last line ("connected" stood alone on a phone).
              <Heading id={headingId} className={`${TITLE_CLASS[titleAs]} text-balance`}>
                {title}
              </Heading>
            ) : null}
            {description != null ? (
              <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>
            ) : null}
          </div>
          {actions != null ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
          ) : null}
        </div>
      ) : null}
      {/* The gap under the header belongs to the card, so a call site never
          opens its body with a `mt-4` that has to be remembered — and can
          never be typed as `mt-2`, `mt-3` or `mt-5` instead, which is how
          four spacings for one relationship got into the settings routes. */}
      {hasHeader && children != null ? <div className="mt-4">{children}</div> : children}
    </Tag>
  );
}
