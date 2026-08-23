/**
 * Canonical classes for buttons and button-shaped links.
 *
 * Every variant is `inline-flex items-center justify-center`. That is not
 * decoration: our touch targets set a `min-h-*` floor, and a plain block or
 * inline box leaves the label sitting at the top of that taller box instead of
 * centered in it. Use this instead of hand-written class strings so centering is
 * structural rather than remembered. See docs/design/forms-and-controls.md.
 */

/**
 * Type scale lives on the sizes, not here. Two competing font-size utilities in
 * one class list resolve by stylesheet order, not by the order you wrote them,
 * so a `text-base` passed through `className` cannot reliably beat a `text-sm`
 * baked in here. Keeping exactly one of each means nothing has to fight.
 */
/**
 * **Label colour lives on the variants, for the same reason, and a `text-<color>`
 * passed through `className` is silently inert.**
 *
 * This one had actually happened: thirty-one call sites passed a
 * `text-foreground` through `className` to the `secondary` variant, plainly
 * meaning "a bordered surface button whose label is body text, not link blue",
 * and every one of them rendered primary anyway. Two `text-<color>` utilities
 * are two declarations of one property, so the winner is whichever Tailwind
 * emitted last — and **Tailwind v4 emits colour utilities in alphabetical order
 * by token name**, independent of the order the tokens are declared in
 * `@theme`. Verified by compiling `src/app/globals.css` through this repo's own
 * `@tailwindcss/postcss` and reading the byte offsets of the emitted rules:
 * `.text-danger` < `.text-foreground` < `.text-info` < `.text-muted` <
 * `.text-primary` < `.text-success`. So `text-primary` beats both
 * `text-foreground` and `text-muted`, and reordering `@theme` would not change
 * it — the only fix is not to have two.
 *
 * The resolution: `secondary` now *is* `text-foreground` (see the variant), and
 * `button.test.ts` fails the build if any `text-<color>` reappears in a
 * `className` handed to `buttonClass`. If a button needs a label colour no
 * variant offers, add a variant — the same answer `flush` gave for padding.
 * Never Tailwind's `!` suffix: that papers over one instance of a rule this file
 * solves structurally, and leaves the next override just as silently inert.
 */
/**
 * `cursor-pointer` is on the base, not on call sites. Tailwind v4's Preflight
 * dropped the v3 rule that gave `button` a pointer cursor, so every
 * `<button>` in the app has been rendering the default arrow — invisible in a
 * screenshot, and exactly the "is this even clickable?" hesitation an icon-only
 * control can least afford (found on the course roster's eye toggle). Links
 * already get it from the browser; putting it here is what makes buttons and
 * button-shaped links behave alike. `disabled:cursor-not-allowed` still wins on
 * a disabled button — its variant selector carries the higher specificity.
 */
const base =
  "inline-flex min-h-11 cursor-pointer items-center justify-center gap-1 rounded-lg transition-[color,background-color,border-color,transform] ease-out-soft active:scale-[0.98]";

/**
 * What a disabled state *means*, which is two different things this app renders
 * identically until asked not to.
 *
 * The default is "you cannot do this" — a form that is not ready, an action
 * this staffer lacks the role for. `busy` is "this is happening": the control
 * disabled itself for the moment its own submit is in flight, which is every
 * `SubmitButton` and every roll-call target. A wait cursor says that; a
 * not-allowed cursor says the opposite, and on the boat surfaces it read as
 * "the tap was refused" at precisely the moment it had been accepted.
 *
 * They are two spellings of one property rather than a `className` addition
 * because two utilities for one property resolve by stylesheet order, not by
 * the order you wrote them — the same reason `flush` exists (see below).
 */
const DISABLED = {
  default: "disabled:cursor-not-allowed disabled:opacity-60",
  busy: "disabled:cursor-wait disabled:opacity-70",
} as const;

const variants = {
  primary: "bg-primary text-primary-foreground shadow-sm hover:bg-primary-hover",
  /**
   * The demoted-but-real action: a bordered surface box whose label is **body
   * text**, not link blue.
   *
   * It carried `text-primary` until thirty-one call sites had each written
   * `className: "text-foreground"` to cancel it — inertly, see the note above.
   * By this file's own rule ("if you find yourself cancelling a variant's own
   * styles, the variant is wrong"), thirty-one cancellations is the variant
   * being wrong, not thirty-one mistakes. It is also what
   * docs/design/forms-and-controls.md already asks of `secondary`: a settings
   * hub's nine Saves demote to it "without the shout", and a teal label is part
   * of the shout. `link` remains the primary-toned text affordance, so the two
   * variants no longer say the same thing in colour. Contrast improves either
   * way (light 5.36 -> 15.02, dark 9.05 -> 14.48 on `bg-surface`).
   */
  secondary: "border border-border bg-surface text-foreground hover:bg-surface-sunken",
  ghost: "text-muted hover:bg-surface-sunken hover:text-foreground",
  danger: "border border-danger/40 text-danger hover:bg-danger/10",
  /**
   * A destructive choice sitting among quiet siblings — a disclosed action
   * list's "Remove" next to ghost-weight items. The bordered `danger` shouts
   * inside a small menu; this keeps the warning hue without the box.
   */
  "danger-ghost": "text-danger hover:bg-danger/10",
  "danger-solid": "bg-danger text-primary-foreground hover:bg-danger/90",
  /** Reads as inline text, but still claims a full touch target. */
  link: "text-primary hover:underline",
  /**
   * Shape and touch target only — no colour of its own.
   *
   * For a control whose fill *is* the state of the row it sits in, so a
   * variant's own hue would have to be overridden away at every call site:
   * the roll-call targets, which are bordered danger when someone did not come
   * back, sunken when the result is settled, and boxless while the routine
   * choice is still on offer. Every other variant answers "what kind of button
   * is this"; these rows answer it per person, per checkpoint.
   *
   * This is the gap that produced four hand-copied class strings — the live
   * roll call, the offline manifest, the check-in queue, and a fourth — each
   * re-deriving the dock target because the wrapper had no way to say "the
   * shape, and I will bring the colour."
   */
  bare: "",
} as const;

/**
 * Each size names its horizontal padding separately from the rest of its
 * classes, because `flush` below has to remove exactly that and nothing else.
 *
 * It is a field rather than something parsed back out of one class string on
 * the way past: a regex for "the `px-*` token" gets a variant-prefixed padding
 * wrong in the worst available way. `/\bpx-[^\s]+/` matches the `px-6` *inside*
 * `sm:px-6` — the `:` is a word boundary — and strips it, leaving a bare `sm:`
 * in the class attribute, which is not a class at all. Keeping the padding in
 * its own field means a size may hold `px-4 sm:px-6` tomorrow and `flush` still
 * drops the whole thing, at every breakpoint, with nothing to parse.
 *
 * So: `x` holds every horizontal-padding utility the size wants, responsive
 * variants included, and `rest` holds no `px-*` at all. `button.test.ts` pins
 * both halves of that.
 */
const sizes = {
  sm: { x: "px-3", rest: "py-2 text-sm font-medium" },
  md: { x: "px-4", rest: "py-2.5 text-sm font-medium" },
  lg: { x: "px-5", rest: "py-2.5 text-sm font-medium" },
  /** Marketing calls to action: reads at 16px and carries more weight. */
  cta: { x: "px-5", rest: "py-3 text-base font-semibold" },
  /**
   * Dock target: a 56px, 16px-label action for wet-hands boat surfaces.
   *
   * `touch-manipulation` is part of the size rather than something call sites
   * remember: it drops the browser's ~300ms double-tap-to-zoom wait, and the
   * surfaces that reach for this size are the ones where a tap that seems not
   * to have registered gets tapped again — which on a roll call is how one
   * person gets marked aboard twice.
   */
  boat: { x: "px-6", rest: "min-h-14 touch-manipulation py-3.5 text-base font-semibold" },
  /**
   * A square target holding one glyph and no label — a row's "remove", a
   * month stepper's arrow.
   *
   * It exists because `buttonClass` could not express it, and four surfaces
   * each answered that by hand: two spelled the box `min-h-11 min-w-11` and
   * two `size-11`, two rounded it `lg` and two `full`, and the glyph inside
   * came out `text-sm font-semibold`, `text-sm font-bold`, and `text-lg
   * leading-none`. A wrapper gap is why a control drifts four ways, so the
   * gap is what gets closed.
   *
   * The width is `w-11` against the base's `min-h-11` rather than `size-11`:
   * a fixed height would clip a glyph whose line box is taller than 44px,
   * where a floor grows with it.
   */
  icon: { x: "px-0", rest: "w-11 text-base" },
} as const;

/**
 * **A text link that is also a tap target**, for the one case a button is not:
 * the link that opens the record a row or a card is about.
 *
 * Not a button variant — it stays a link, keeps its own ink, and carries no
 * chrome. What it borrows from the button vocabulary is the *floor*, because
 * that is the thing this file already owns: `min-h-11` is the same 44px
 * `sizes.icon` exists to guarantee, and for the same reason
 * (`docs/design/principles.md` §2, one hand in glare with wet fingers).
 *
 * Three staff tables and the check-in queue were shipping this as an 18px word
 * — 34 of them on the gear register, tapped standing at the wall (issue #786).
 * `inline-flex items-center` is what lets the floor apply to an inline link at
 * all: `min-height` does nothing to a non-replaced inline box.
 */
export const tapTargetLinkClass = "inline-flex min-h-11 items-center";

export type ButtonVariant = keyof typeof variants;
export type ButtonSize = keyof typeof sizes;

/**
 * The horizontal padding, dropped. For a `link`-variant button that has to sit
 * flush with the prose it belongs to — a "See the full list →" under a
 * checklist, a guide link under the claim it cites — where the size's `px-*`
 * reads as an unexplained indent.
 *
 * It is an option rather than something a caller passes through `className`
 * because passing it there **does not work**, for the same reason the type
 * scale lives on the sizes: two utilities for one property resolve by
 * stylesheet order, not by the order you wrote them, and Tailwind emits `px-0`
 * before `px-4`, so the size always wins. Three links on `/pricing` rendered 12
 * measured pixels inside the text above them while asking for `px-0`.
 *
 * Vertical padding and `min-h-11` stay: the touch target is why the padding is
 * there at all, and only the horizontal half is what misaligns the text.
 */
const FLUSH = "px-0";

export function buttonClass({
  variant = "primary",
  size = "md",
  flush = false,
  busy = false,
  className = "",
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Drop the size's horizontal padding so the label sits flush with adjacent text. */
  flush?: boolean;
  /**
   * This control's disabled state means "in flight", not "unavailable" — every
   * `SubmitButton`, which disables itself for the duration of its own submit.
   * Renders a wait cursor instead of a not-allowed one. See `DISABLED`.
   */
  busy?: boolean;
  className?: string;
} = {}) {
  const { x, rest } = sizes[size];
  return `${base} ${DISABLED[busy ? "busy" : "default"]} ${variants[variant]} ${rest} ${
    flush ? FLUSH : x
  } ${className}`.trim();
}
