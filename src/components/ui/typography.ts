/**
 * **The heading ramp, named once.**
 *
 * ADR 20260827-clearwater-surface-language decision 3 closes the type ramp, and
 * a grep on 2026-09-01 found fourteen heading spellings still typed at the call
 * site. Reading them, they are not fourteen drifting levels of one ramp — they
 * are **two ramps**, one of which the ADR deliberately excludes from itself
 * ("the marketing, legal and error surfaces are also outside every
 * recomposition here"), and which was uniform already: the marketing section
 * heading is byte-identical at twenty-odd call sites. Unnamed, not broken.
 *
 * So both are named here, and `pnpm check:type-ramp` refuses a new spelling in
 * either. A level is chosen by what the heading *is*, never by what it should
 * measure — that is the whole point of taking the numbers out of the call site.
 *
 * ### The app ramp (ADR decision 3)
 *
 * `PAGE_TITLE_CLASS` → `SECTION_TITLE_CLASS`, with `SHELL_TITLE_CLASS` for the
 * pages a diver arrives at from a link. The ADR's other four levels are not
 * heading spellings and are not here: the page summary (`text-base text-muted`),
 * the eyebrow (`EYEBROW_CLASS` in `ShopPageHeader.tsx`), the group label
 * (`groupLabelClass`), the row title (`text-base`) and row meta.
 *
 * ### The reading ramp (marketing, legal, the long public pages)
 *
 * `DISPLAY_TITLE_CLASS` → `BANNER_TITLE_CLASS` → `LEAD_TITLE_CLASS` →
 * `SUB_TITLE_CLASS`. Two of those set their tracking tighter than the app's and
 * balance their wrap, because they are headings that *wrap* at display size; a
 * staff page title is a short label that does not. That is a real difference in
 * the type, not a preserved accident.
 *
 * ### Figures
 *
 * Decision 3 again: "numbers that lead render as **figures** — `text-2xl`–`text-4xl`
 * semibold — not as another line of `text-sm`", and every figure sets
 * `tabular-nums`. Four steps, because a counter's one number and a money value
 * leading its row are not the same object.
 *
 * A leaf module with no imports, deliberately: `ErrorPage` is a Client
 * Component, and pulling a heading string from a module carrying `next/link`
 * and the card shell would drag the whole of it into the browser bundle.
 *
 * `text-balance` is not baked into the app ramp: it belongs to titles that wrap
 * (a trip name), not to the ones that don't, and each shell decides.
 */

/**
 * **The page's own name, Reef's title rung**: 40px bold, tightened, in Geist —
 * the display face was declined, so the display moment is made with the one
 * face's own size and weight (ADR 20260901-diveday-reimagined, decision 1).
 * `leading-[1.1]` gives a 44px line box, which `ShopPageHeaderSkeleton`'s
 * `h-11` matches.
 *
 * Landed in `ShopPageHeader.tsx` with #1286 and moved here on the merge: this
 * module exists so a rung has one name in one place (#1229), and the header
 * that owns the rung is not that place — `ShopfrontHero` reaches for it too.
 * `EYEBROW_CLASS` stays over there on purpose; an eyebrow is not a title.
 */
export const PAGE_TITLE_CLASS =
  "text-[2.5rem] leading-[1.1] font-bold tracking-[-0.02em] text-balance";

/**
 * One step up from the title, for the one page whose title is a greeting rather
 * than a name: the shop home's "Good morning" (the board draws it at 44/700).
 * Same 44px line box as the title, so the two share a skeleton.
 *
 * #1286 called this `DISPLAY_TITLE_CLASS`, which collided with the marketing
 * hero below — two different rungs under one name, which is the drift this
 * module exists to end. Renamed to what its own docblock already called it.
 */
export const GREETING_TITLE_CLASS =
  "text-[2.75rem] leading-none font-bold tracking-[-0.028em] text-balance";

/**
 * **The `<h1>` spelling for every page a person arrives at from a link.**
 *
 * ADR 20260827-the-divers-thread, decision 1: the thread's four bearer pages,
 * the eight doors (`EntryShell`), the terminal outcomes (`EntryDone`), the two
 * 404s and the eleven error boundaries all say the page's name at one size.
 * Before this constant they said it at three — `text-3xl font-semibold` on the
 * token pages, `text-2xl`/`text-3xl` forked by width in `EntryShell`,
 * `text-2xl` on the 404s and the boundaries — so a diver walking their own
 * thread watched the title change weight between the link they tapped and the
 * page it landed on.
 *
 * It also carries the three staff *documents* — the departure log, the printed
 * manifest, the prep ticket — which said the same thing one weight lighter.
 */
export const SHELL_TITLE_CLASS = "text-3xl font-bold tracking-tight";

/**
 * A hero that wraps: the marketing `<h1>`s, stepped up at `sm:` by each page.
 * Distinct from `GREETING_TITLE_CLASS` above, which is the staff home's
 * greeting — #1286 gave both the same name for a few hours.
 */
export const DISPLAY_TITLE_CLASS = "text-4xl font-semibold tracking-[-0.045em] text-balance";

/** The section heading of a long reading page — a marketing `<h2>`, a legal title. */
export const BANNER_TITLE_CLASS = "text-3xl font-semibold tracking-[-0.035em] text-balance";

/** A section lead inside a reading page: a course page's `<h2>`, a modal-scale title. */
export const LEAD_TITLE_CLASS = "text-2xl font-semibold tracking-tight";

/** The step under a lead — a named item in a marketing grid, a legal `<h2>`. */
export const SUB_TITLE_CLASS = "text-xl font-semibold tracking-tight";

/**
 * **The app's section heading**, and the workhorse of the whole ramp — 76 of the
 * call sites swept onto these constants were this one, in two spellings.
 * `SectionCard` renders it for its own `h2`, so a card never types it.
 */
export const SECTION_TITLE_CLASS = "text-lg font-semibold";

/** The one number a surface exists to show — the counter's queue length. */
export const FIGURE_HERO_CLASS = "text-4xl font-semibold tabular-nums";

/** A number a surface leads with: a month's takings, the next boat's countdown. */
export const FIGURE_LARGE_CLASS = "text-3xl font-semibold tracking-tight tabular-nums";

/** The ordinary leading figure — a tank count, a course price, a trip's pulse. */
export const FIGURE_CLASS = "text-2xl font-semibold tabular-nums";

/** A figure that leads its own row rather than its own block: money due, a day's head count. */
export const FIGURE_INLINE_CLASS = "text-lg font-semibold tabular-nums";

/**
 * **The number inside a dial** — the roll call's head count and the day
 * spine's seat count, the two places Reef draws a figure over standing water
 * (#1286). Bold rather than semibold, because the glass and the fill are
 * competing with it, and `leading-none` because it is centred in a circle
 * rather than sitting on a line.
 *
 * Its own rung rather than `FIGURE_CLASS` with a weight bolted on: Tailwind
 * emits `font-bold` and `font-semibold` in source order, not attribute order,
 * so an override at the call site is a coin flip (the same trap `buttonClass`
 * carries a warning about in AGENTS.md).
 */
export const FIGURE_DIAL_CLASS = "text-2xl leading-none font-bold tabular-nums";
