import type { ReactNode } from "react";

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
  return (
    <Tag id={id} className={sectionCardClass({ padding, elevated, className })}>
      {hasHeader ? (
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            {title != null ? <Heading className={TITLE_CLASS[titleAs]}>{title}</Heading> : null}
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
