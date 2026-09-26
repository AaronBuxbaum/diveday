import { type ReactNode, useId } from "react";
import { LEAD_TITLE_CLASS } from "@/components/ui/typography";

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
 * The canonical spelling is the one the `<Table>` shell and every loading
 * skeleton share: `rounded-panel border border-border bg-surface shadow-bed`.
 * A card, a stat tile and a table shell are the same object, so they read as
 * one.
 *
 * ## On the warm bed
 *
 * **A resting panel sits on the bed** (ADR 20260901-diveday-reimagined,
 * decision 1, slice 13a): Reef's 28px `--radius-panel` and the one soft warm
 * shadow `--shadow-bed`, `0 2px 10px rgba(88, 66, 30, 0.06)`. This is the one
 * deliberate reversal of Clearwater's "elevation is earned" (ADR
 * 20260827-clearwater-surface-language, decision 1), and it reverses it for
 * the panel alone: menus, sheets, dialogs and toasts keep their own
 * `shadow-lg`/`shadow-2xl` lift because they float, and the header tiles,
 * logos and markers that #1228 flattened stay flat because they are not
 * panels. There is still no `elevated` prop and no `shadow-sm` anywhere near a
 * panel — the bed is a token, so it moves with the palette and never with a
 * call site.
 *
 * The rule reaches the panels this component does not own, too: `card.test.tsx`
 * fails the build on any class string in `src/` that still wears the retired
 * `rounded-2xl` shell, or that pairs the panel radius with `shadow-sm`, so a
 * hand-rolled panel cannot end up at a second radius or a second elevation on
 * a page of consistent ones.
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
 *   neutral chrome. Keep that treatment at the call site — on the card's own
 *   geometry, `TONE_PANEL_CLASS`, so only the colour differs.
 *
 * A card nested directly inside another card at the same radius and fill reads
 * as a rendering bug, not as structure. If that is where you have arrived, the
 * inner thing is one of the three above.
 *
 * ## Headings: what size, and where one goes
 *
 * `title` renders the staff type scale (`text-2xl` — Reef's section rung,
 * drawn 26/600 on the system sheet and set in Geist at the ramp's nearest
 * step — or `text-base` for a card
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
 *   `<h2 className={LEAD_TITLE_CLASS}>` — Reef's section rung — the *same* scale a card's own
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
 * **A tone panel's geometry**: the card's radius, bed and default (`md`)
 * padding, with no colour. A tone-carrying panel (above) spells its own
 * border colour and fill beside it, so it sits on the page as a card does and
 * differs only in the tone that means something.
 *
 * The roster's minimum-seats band and its unmet-demand panel hand-rolled
 * `p-5` with no `sm:` step and no bed, the second at the 12px inset radius:
 * on a phone their words started 4px right of every card above and below
 * them, and the demand panel's corners were visibly tighter (pixel-craft
 * classes 3 and 12).
 */
export const TONE_PANEL_CLASS = "rounded-panel border p-4 shadow-bed sm:p-5";

/**
 * **A note carved into a card** — the first of the "not a section card"
 * objects above: a sentence of advice or context set on the sunken fill
 * inside a panel (a crew gap, a site's rule, a diver's ask, the model's
 * outlook). One box, 12px in and 8px down at 14px, the majority spelling
 * when the departure's panels drew it three ways: 16px in and down beside
 * 12px, and 12px all round at 12px type (pixel-craft class 12).
 *
 * `INSET_NOTE_BOX` is the geometry alone, for a note that carries a tone
 * instead of the sunken grey (a warning tint): the tone changes, the box does
 * not. A note's place in its panel (`mt-3`, `mt-4`) stays at the call site.
 */
export const INSET_NOTE_BOX = "rounded-lg px-3 py-2 text-sm";
export const INSET_NOTE_CLASS = `${INSET_NOTE_BOX} bg-surface-sunken text-muted`;

/**
 * **The corner of a fill laid flush inside a panel**: the panel's radius less
 * the one thing between them, its 1px border — 20 − 1 = 19px, a curve that
 * runs parallel to the panel's own (docs/design/pixel-craft.md, class 6).
 *
 * For a `padding="none"` card whose first or only child paints a fill against
 * the panel's edge — a `<summary>`'s hover band — and where the card does not
 * clip. Apply it to the corners the fill actually touches; a corner that meets
 * the card's own body stays square. The manifest's "On this phone" summary
 * wore the control rung, 12px, flush in the 20px corner, so its hover fill
 * poked out past the panel's curve on every manifest capture the probe took.
 *
 * A clipped card (`DisclosureRowList`'s `overflow-hidden`) does not need it,
 * because the card's own corner cuts the fill; clipping is the wrong fix for a
 * card that holds focusable controls near its edge, whose rings it would cut.
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
 * **The face of a card that is itself a disclosure**: a `<summary>` that is
 * the first thing inside a `padding="none"` card, or inside a `<details>` that
 * wears the panel itself (`SectionCard as="details"`, `DangerDisclosure`).
 *
 * Nine of these were hand-rolled four ways (pixel-craft classes 7 and 12):
 *
 * - **No radius**, so the global ring, which follows the element's corners,
 *   drew a square around a 20px card and stood 8px off it at every corner.
 *   The face takes the panel's inner corner, `PANEL_INNER_RADIUS`, and squares
 *   its bottom once open, when the body is what meets the card's corner. The
 *   open state is spelled against the `<details>` (`[[open]>&]`) rather than
 *   `group-open:`, which would need every call site's group to be unnamed.
 * - **`items-center`**, so a title that wrapped left its caret floating
 *   between its lines, or level with the chips under it (12–21px low on the
 *   manifest at 390). The row starts at the top and the caret sits in a
 *   `SummaryCaret` (`ui/disclosure.tsx`), a box one first line tall. Top
 *   alignment means a single line no longer centres itself in a `min-h-*`
 *   floor, so a call site pads the face to its height: `py-4` round a 24px
 *   line is the 56px `min-h-14` exactly.
 * - **Two gaps** (8 and 12px) put two titles on one manifest 4px apart; one
 *   gap now.
 * - **Two hovers**, a fill on one card and an underline on the next; the fill
 *   takes the same corner, so it cannot poke past the card's curve. A heading
 *   inside may still underline with it.
 *
 * The card does not clip — clipping would cut the ring and the focusable
 * controls in the body — so the ring is the global one, 2px outside the face,
 * concentric with the card. Padding stays at the call site: a manifest row and
 * a settings section are different insets of the same face.
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
  // Reef moved this rung up from `text-lg` to `text-2xl` (#1286); it is
  // `LEAD_TITLE_CLASS` exactly, so it stays a named level rather than a
  // literal that would drift away from the ramp again (#1229).
  h2: LEAD_TITLE_CLASS,
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
  title,
  titleAs = "h2",
  description,
  actions,
  padding = "md",
  id,
  className = "",
  ariaLabel,
  "aria-label": ariaLabelProp,
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
  /** A fragment target (`#backups`, `#invite`). Pair it with `scroll-mt-*` in `className`. */
  id?: string;
  className?: string;
  ariaLabel?: string;
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
  // duplicate-id net in e2e/a11y.spec.ts on the departure-tabs scan.
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
  // which is why the duplicate-id net in e2e/a11y.spec.ts stays the backstop
  // rather than the belt.
  const headingId = title != null ? `card-${generatedId}-${titleSlug(title)}` : undefined;
  const resolvedAriaLabel = ariaLabelProp ?? ariaLabel;
  return (
    <Tag
      id={id}
      // Only when this element is a landmark a name means something on. An `li`
      // in a list of cards is named by its content, and labelling it would make
      // a screen reader announce the heading twice.
      aria-labelledby={headingId != null && Tag !== "li" ? headingId : undefined}
      aria-label={resolvedAriaLabel}
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
