import { type ReactNode, useId } from "react";

/**
 * The card — the bordered panel a staff page is mostly made of, and the last
 * piece of this folder's vocabulary to get a component.
 *
 * Until now every page retyped it. That spelling appeared **209 times across
 * 153 files**, at four radii (`rounded-2xl`, `rounded-lg`, `rounded-xl`,
 * `rounded-3xl`) and six paddings, with `shadow-sm` on only 26 of them — so
 * identically-shaped cards sat at two different elevations on one page, and
 * two sibling settings routes one tap apart rendered the same panel at two
 * different corner radii.
 *
 * The canonical spelling is the one `ShopStat` and the `<Table>` shell already
 * share: `rounded-2xl border border-border bg-surface shadow-sm`. A card, a
 * stat tile and a table shell are the same object, so they read as one.
 *
 * There is deliberately **no `radius` prop**. A prop that lets every call site
 * keep the radius it happens to have today would preserve the drift behind an
 * abstraction and call it a design system. A card that looks wrong is fixed
 * here, not at the call site — the same rule `buttonClass()` and
 * `SegmentedControl` keep.
 *
 * Section rhythm belongs to the page, not the card: `SectionCard` carries no
 * outer margin at all. A page stacks its sections in `space-y-10` rather than
 * hanging a `mt-*` off each one (nine different values were in use), and a
 * list of *like* cards — two calendar feeds, a roster of people — keeps its own
 * tighter gap, because that is a list rather than a run of sections.
 *
 * ## What is *not* a section card
 *
 * Three migrations asked for a prop to widen this component, and the answer
 * each time was that the thing in front of them is a different object. Written
 * down so the fourth does not ask again:
 *
 * - **A sunken inset** (`bg-surface-sunken`, a roll-call row, a flagged
 *   fallback, a form's nested note). It is *carved into* a card rather than
 *   raised on the page. `ShopStat`'s `inset` variant is the precedent.
 * - **A panel on a `bg-surface` band** — the marketing pages set `bg-background`
 *   on their cards precisely because the band behind them is already
 *   `bg-surface`. This component hard-codes `bg-surface` and will not gain a
 *   fill prop: two fills is how a card starts meaning "any rectangle".
 * - **An overlay** — a dropdown, a modal, a toast, a bottom sheet. They carry
 *   `shadow-lg`/`shadow-2xl` because they float above the page rather than
 *   sitting in it.
 * - **A tone-carrying operational panel** — a warning, success confirmation,
 *   paid receipt or earned moment. Its border and fill communicate meaning,
 *   and `SectionCard` deliberately has no tone prop that could flatten it into
 *   neutral chrome. Keep that treatment at the call site.
 *
 * A card nested directly inside another card at the same radius and fill reads
 * as a rendering bug, not as structure. If that is where you have arrived, the
 * inner thing is one of the three above.
 *
 * ## Headings: what size, and where one goes
 *
 * `title` renders the staff type scale (`text-lg`, or `text-base` for a card
 * inside a group that already owns the `h2`). The **marketing pages keep their
 * own scale at the call site** and pass no `title` — their headings sit under a
 * 36px display type where `text-base` would turn a page's one checkable proof
 * into fine print. A design system that flattens a deliberately different
 * surface is not being consistent, it is being indiscriminate.
 *
 * *Placement* is the other half, and the marketing exemption does not reach it:
 * a heading goes **inside the card it names, above the group it governs**. One
 * question decides which — would the heading still be telling the truth if the
 * card under it disappeared, multiplied, or swapped for an `EmptyState`?
 *
 * - **No**: the heading and the card live and die together, so it is the card's
 *   `title` and this component renders the `h2` and derives its
 *   `aria-labelledby`. A bare heading floated above a single card splits one
 *   object into two — the named region and the visible border disagree, so a
 *   screen reader lands on an unnamed panel while the heading sits ownerless in
 *   the gutter.
 * - **Yes**: the body is plural — sibling cards, a grid of object cards, a
 *   `padding="none"` shell of divided rows, anything that swaps to an
 *   `EmptyState`. The heading stands above as a bare
 *   `<h2 className="text-lg font-semibold">`, the *same* scale a card's own
 *   `h2` gets, because a section speaks at one volume whether its heading sits
 *   inside one card or above five. Each card under it steps down with
 *   `titleAs="h3"`, or carries the object's own name.
 *
 * Two corollaries. A `<details>` never takes a bare heading above it: the
 * `<summary>` *is* the heading and the control, and a closed disclosure under a
 * floated heading is a heading over apparently nothing that a reader will press
 * and open nothing. And a band — a search or filter form wearing this chrome —
 * takes no heading at all; its field labels are its words.
 *
 * The full grammar, including the "one card or a group?" line and the anatomies
 * that hand-spell their heading (a tone panel, an eyebrow, a `<form>` card,
 * which this component's element set excludes): the "Where a heading goes"
 * section of docs/design/forms-and-controls.md.
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
  elevated = true,
  className = "",
}: {
  padding?: SectionCardPadding;
  elevated?: boolean;
  className?: string;
} = {}): string {
  return `rounded-2xl border border-border bg-surface ${elevated ? "shadow-sm" : ""} ${
    PADDING[padding]
  } ${className}`
    .replace(/\s+/g, " ")
    .trim();
}

/** Closed set on purpose — a caller never hands this component an arbitrary tag. */
type SectionCardElement = "section" | "div" | "article" | "aside" | "li" | "details";

/**
 * The heading vocabulary, folded in so no call site types it. Two levels, and
 * only two: `h2` for a section of the page, `h3` for a card inside a group that
 * already has its own `h2` (the export page's Backups half). The step exists so
 * a group and the five cards under it do not shout at the same volume; every
 * other difference the app had grown here — `text-xl`, `text-base`,
 * `font-medium`, bare `font-semibold` — is gone.
 */
const TITLE_CLASS = {
  h2: "text-lg font-semibold",
  h3: "text-base font-semibold",
} as const;

export function SectionCard({
  as: Tag = "section",
  title,
  titleAs = "h2",
  description,
  actions,
  padding = "md",
  elevated = true,
  id,
  className = "",
  children,
}: {
  /** The element this card *is*. A row in a list is an `li`; a disclosure is `details`. */
  as?: SectionCardElement;
  /** The section heading. Rendered at the one size; never spell it at a call site. */
  title?: ReactNode;
  /** `h3` for a card nested under a group that already owns the `h2`. */
  titleAs?: keyof typeof TITLE_CLASS;
  /** One quiet line under the heading, saying what the section is for. */
  description?: ReactNode;
  /** Buttons, a `Badge`, a status — pinned to the heading's right, wrapping below it on a phone. */
  actions?: ReactNode;
  padding?: SectionCardPadding;
  /**
   * Elevation follows containment, the rule `Table` and `ShopStat` already
   * keep: a card on the page is raised; a card that has to sit *inside*
   * another one drops its shadow so surface never stacks on surface.
   */
  elevated?: boolean;
  /** A fragment target (`#backups`, `#invite`). Pair it with `scroll-mt-*` in `className`. */
  id?: string;
  className?: string;
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
  const headingId = title != null ? `${generatedId}-title` : undefined;
  return (
    <Tag
      id={id}
      // Only when this element is a landmark a name means something on. An `li`
      // in a list of cards is named by its content, and labelling it would make
      // a screen reader announce the heading twice.
      aria-labelledby={headingId != null && Tag !== "li" ? headingId : undefined}
      className={sectionCardClass({ padding, elevated, className })}
    >
      {hasHeader ? (
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            {title != null ? (
              <Heading id={headingId} className={TITLE_CLASS[titleAs]}>
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
