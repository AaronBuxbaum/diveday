import Link from "next/link";
import type { ReactNode } from "react";
import { FoldedPageTitle } from "@/components/chrome/FoldedPageTitle";
import { tapTargetLinkClass } from "@/components/ui/button";
import { sectionCardClass } from "@/components/ui/card";
import { StatusMark } from "@/components/ui/StatusMark";
import { toneMark } from "@/components/ui/tone";
import { GREETING_TITLE_CLASS, PAGE_TITLE_CLASS } from "@/components/ui/typography";
import { bindTitleDash } from "@/lib/format";

/**
 * The eyebrow — "where you are", one line above the title. Reef's rung: 11px,
 * bold, `+0.16em`, lagoon (ADR 20260901-diveday-reimagined's system sheet).
 * `leading-4` pins the line box to 16px so `ShopPageHeaderSkeleton`'s `h-4`
 * bar stands in for it exactly.
 */
const EYEBROW_SHAPE = "text-[11px] leading-4 font-bold tracking-[0.16em] uppercase";

export const EYEBROW_CLASS = `${EYEBROW_SHAPE} text-primary`;

/**
 * **A 44px tap target that costs the layout the same 16px a `<p>` costs.**
 *
 * `tapTargetLinkClass`'s `min-h-11` is what keeps a linked eyebrow over WCAG
 * 2.5.8's 24px floor, and it is not negotiable — axe measures the element's own
 * box, so moving the hit area onto a pseudo-element would satisfy a person and
 * fail the scan. The box has to be 44px. The *flow* has to be 16, or the header
 * is a different height depending on whether its eyebrow links anywhere, and
 * one skeleton cannot stand in for both.
 *
 * **The negative margin that used to do this never did.** `-my-2` sat on the
 * link itself, and the link is `inline-flex` — an *inline-level* box, whose
 * vertical margins do not move the line box it sits on. Measured on a running
 * dev server (issue #1857): the eyebrow occupied 28px against `EYEBROW_CLASS`'s
 * 16, so `ShopPageHeaderSkeleton`'s `h-4` bar was 12px short of the header it
 * stands in for and **every sub-page with a back-link jumped its title 12px**
 * the instant the page landed — the exact jump `loading.tsx` exists to prevent,
 * on every navigation staff make all day. Widening the margin to 14px a side
 * moved the number to 8 and never to 0, which is what said the mechanism was
 * wrong rather than the arithmetic.
 *
 * So the link is wrapped instead. The wrapper is block-level and exactly the
 * eyebrow's line box; `items-center` centres the 44px link on it and lets it
 * bleed 14px into the padding above and the title's `mt-2` below, where there
 * is nothing to hit. The link's text then lands on the same line as a `<p>`
 * eyebrow's — it used to sit 6px lower — and the header is the same height
 * either way. `ShopPageHeader.test.tsx` pins it.
 */
export const EYEBROW_TAP_WRAPPER = "flex h-4 items-center";

/**
 * The eyebrow-as-breadcrumb, for a header that is not `ShopPageHeader`.
 *
 * `TripPageHeader` is the one — the four trip surfaces share their own header,
 * and they were the only staff pages at depth 2–3 with no way back to their
 * parent at all (issue #823). Exported rather than copied so the chevron, the
 * sizing and the `min-h-11` thumb target stay one decision: a second hand-rolled
 * back link is how three ways up became three (a linked eyebrow, an explicit
 * "← Parent", and the global nav).
 */
export function EyebrowBackLink({
  href,
  children,
  className = "",
  onSky = false,
}: {
  href: string;
  children: ReactNode;
  /**
   * **Layout classes land on the wrapper, not the link.** The wrapper is the
   * element the caller's parent lays out -- `TripPageHeader` places it with
   * `col-start-1 row-start-1`, and the log and ticket pages hide it in print
   * with `print:hidden` so their print-only `<p>` can take the line. On the
   * link those do nothing and the wrapper auto-places, which is a 16px band of
   * nothing on paper and a back-link in the wrong grid cell on screen. Colour
   * is the exception and already has a prop, for the reason below.
   */
  className?: string;
  /**
   * This eyebrow is standing on a `SkyBand`, so it wears the band's ink rather
   * than lagoon. `text-primary` on `--sky-day` measures **1.76:1** in the
   * captured pixels — the trip masthead shipped it that way and the way back
   * was effectively invisible. It is a prop rather than a `className`
   * override because two `text-*` utilities resolve by stylesheet order, not
   * by the order they are written, so an override here silently does nothing
   * (the same trap `buttonClass`'s `flush` exists for).
   */
  onSky?: boolean;
}) {
  return (
    <span className={`${EYEBROW_TAP_WRAPPER} ${className}`.trim()}>
      <Link
        href={href}
        className={`${tapTargetLinkClass} ${EYEBROW_SHAPE} ${
          onSky ? "text-(--sky-ink)" : "text-primary"
        } gap-2 hover:underline`.trim()}
      >
        {/* **The box is the ink** (K-114). Centred in a 24-unit square, the
            stroke (x 9–15, plus half its 2.5 width) began 3.9px into the box,
            so every back-link stood 3–4px right of the title's column. The
            viewBox is cut to the stroke across and kept whole down, so the
            height and centre are the square's; the width follows the cut.
            `gap-2` carries the ink-to-words distance the square's empty right
            side used to share with `gap-1`. `ShopPageHeader.test.tsx`. */}
        <svg
          aria-hidden="true"
          viewBox="7.75 0 8.5 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-3 w-auto shrink-0"
        >
          <path d="m15 18-6-6 6-6" />
        </svg>
        {children}
      </Link>
    </span>
  );
}

export function ShopPageHeader({
  eyebrow,
  eyebrowHref,
  title,
  description,
  meta,
  actions,
  brand,
  display = false,
  titleFace = "app",
  /** "end" bottom-aligns actions with the title block, right for a static
   * button/print row. Use "start" when actions can grow much taller than the
   * title — an expandable form — so opening it doesn't drag the title down. */
  align = "end",
}: {
  eyebrow?: string;
  /**
   * Turns the eyebrow into the page's way back up — a breadcrumb, not a second
   * strip of chrome. The settings sub-pages use it: their eyebrow already read
   * "Settings", so the word that named the parent becomes the door to it, in
   * the page's own column and at the page's own width. What it replaced was a
   * full grouped-pill nav card above every sub-page's `<h1>`, repeating a
   * directory the hub renders better one tap away.
   */
  eyebrowHref?: string;
  title: string;
  description?: string;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  /** Optional shop-owned identity shown above a public booking header. */
  brand?: {
    logoUrl?: string | null;
    tagline?: string | null;
    description?: string | null;
  };
  align?: "start" | "end";
  /** The greeting rung (`GREETING_TITLE_CLASS`) instead of the title rung — the shop home only. */
  display?: boolean;
  /**
   * `brand` sets the title in the shop's own display face — the trip's title
   * and the course's title on the diver-facing pages (Harbor, ADR
   * 20260901-diveday-reimagined, decision 2: "the display face labels headings
   * only"). The staff surfaces that share this header never pass it; with no
   * `BrandStyle` above, the utility resolves to Geist anyway.
   */
  titleFace?: "app" | "brand";
}) {
  const hasBrand = Boolean(brand?.logoUrl || brand?.tagline || brand?.description);
  return (
    <header className="mb-8">
      {/* **From `sm` up, a row with doors is a grid, so the title keeps its
          longest word.** As a flex row beside a `shrink-0` band of doors, the
          title column took whatever the doors left: at 640 the schedule
          board's three doors left "Board" 103.6px of the 106 it needs, and the
          word ran past its column. The title's track is at least its longest
          word and takes the rest (`minmax(min-content, 1fr)`); the doors' is
          `auto`, which keeps them on one row while there is room and folds
          them only once the title has wrapped as far as it can — the order the
          flex row had, without the overrun. With no doors there is no second
          track to leave a gap for, and the row stays the flex row it was. */}
      <div
        className={`flex flex-col gap-5 ${
          actions
            ? "sm:grid sm:grid-cols-[minmax(min-content,1fr)_auto]"
            : "sm:flex-row sm:justify-between"
        } ${align === "start" ? "sm:items-start" : "sm:items-end"}`}
      >
        <div className="min-w-0">
          {hasBrand ? (
            <div className="mb-5 flex items-start gap-3">
              {brand?.logoUrl ? (
                // biome-ignore lint/performance/noImgElement: dynamic user-uploaded logo
                <img
                  src={brand.logoUrl}
                  alt=""
                  className="size-14 shrink-0 rounded-inset border border-border bg-surface object-cover"
                />
              ) : null}
              <div className="min-w-0">
                {brand?.tagline ? (
                  <p className="text-base font-medium text-foreground/90">{brand.tagline}</p>
                ) : null}
                {brand?.description ? (
                  <p className="mt-1 max-w-2xl text-sm text-muted">{brand.description}</p>
                ) : null}
              </div>
            </div>
          ) : null}
          {eyebrow && eyebrowHref ? (
            <EyebrowBackLink href={eyebrowHref}>{eyebrow}</EyebrowBackLink>
          ) : eyebrow ? (
            <p className={EYEBROW_CLASS}>{eyebrow}</p>
          ) : null}
          {/* One size at every width. Below `sm` this used to step down to
              `text-3xl` from a time when the staff header wrapped its tabs
              across two or three rows on a phone and the title was competing
              for the same vertical space. The tabs live in the bottom dock
              now (StaffTabBar) and the header block owns the full content
              width, so the page's own name gets to be the biggest thing on
              screen there too — which is what a phone, read at arm's length
              on a wet dock, most needs it to be.
              `text-balance` because the titles that do wrap here are boat
              names ("Two-Tank Reef — Molasses & French"), and an even two
              lines reads better than a full line plus one orphaned word. */}
          <h1
            // The heading fades as it passes under the bar, so it and the
            // folded label are never the same word twice on one screen (ADR
            // 20260907-nothing-from-nowhere, decision 5). Marked on every
            // shell; the CSS only acts where a bar has a filled title slot,
            // which is the staff shell alone.
            data-chrome-fold-title
            className={`${titleFace === "brand" ? "font-brand-display " : ""}${display ? GREETING_TITLE_CLASS : PAGE_TITLE_CLASS}${eyebrow ? " mt-2" : ""}`}
          >
            {bindTitleDash(title)}
          </h1>
          {/* The same words, delivered into the staff shell's bar so they can
              fold into it as the page scrolls (ADR
              20260907-nothing-from-nowhere, decision 5). Renders nothing at all
              on the storefront, which has no slot to portal into — this header
              serves both shells and only one of them folds. */}
          <FoldedPageTitle title={title} />
          {description ? <p className="mt-2 max-w-2xl text-muted">{description}</p> : null}
          {meta ? <div className="mt-3">{meta}</div> : null}
        </div>
        {/* Below `sm` the header stacks and its actions share the row, each
            growing to an equal share, so two doors read as one tidy band
            rather than two buttons of different widths hugging the left.
            Doors only — a link, a button, a form holding one. The offline
            manifest's actions are two status pills, and growing every child
            stretched each into a half-width bar with its words hugging the
            left and 91px of empty fill beside them (K-65). */}
        {actions ? (
          <div className="flex shrink-0 flex-wrap gap-2 max-sm:[&>:is(a,button,form)]:grow">
            {actions}
          </div>
        ) : null}
      </div>
    </header>
  );
}

/**
 * {@link ShopPageHeader} drawn as bars — what a route's `loading.tsx` stands in
 * with while the real header streams in.
 *
 * It exists because thirty-odd `loading.tsx` files each hand-rolled the same
 * three bars, and every one of them was the wrong size: an `h-9` title bar
 * under a `text-4xl` `<h1>` whose line box is 40px, `mt-3` where the header
 * itself uses `mt-2`, and a description bar of `h-4` (or `h-5`, depending on
 * the file) under a `<p>` that renders 24px. Every staff route therefore
 * shifted a few pixels the instant its page landed — the exact jump a
 * `loading.tsx` exists to prevent, repeated on every navigation staff make all
 * day.
 *
 * The numbers are read off the header above and must move with it:
 *   - `h-4`  — the eyebrow's line box (`EYEBROW_CLASS` pins `leading-4`)
 *   - `h-11` — the `<h1>`'s line box: 40px at `leading-[1.1]`, or the home's
 *     44px at `leading-none` — both 44px, by design, so one bar serves both
 *   - `h-6`  — the description `<p>`'s unsized line box (1rem × 1.5)
 *   - `mt-2` after the eyebrow and before the description, `mt-3` before meta,
 *     and `mb-8` on the wrapper — all straight off `<header className="mb-8">`.
 *
 * Widths stay per-caller: a bar should be about as wide as the words it stands
 * in for, and that is the page's business, not this component's.
 */
export function ShopPageHeaderSkeleton({
  eyebrow = true,
  titleWidth = "w-64",
  description = true,
  descriptionWidth = "w-80",
  meta,
}: {
  /** Pass `false` for a header with no eyebrow — the `<h1>` then loses its `mt-2`, same as the real one. */
  eyebrow?: boolean;
  /** Tailwind width classes for the title bar (e.g. `"w-72 max-w-full"`). */
  titleWidth?: string;
  description?: boolean;
  /** Tailwind width classes for the description bar. */
  descriptionWidth?: string;
  /** Bars for a header that carries `meta` — the trip tabs' seat badge and date line. */
  meta?: React.ReactNode;
}) {
  return (
    <div className="mb-8">
      {eyebrow ? <div className="h-4 w-24 rounded bg-surface-sunken" /> : null}
      <div className={`h-11 ${titleWidth} rounded bg-surface-sunken${eyebrow ? " mt-2" : ""}`} />
      {description ? (
        <div className={`mt-2 h-6 ${descriptionWidth} rounded bg-surface-sunken`} />
      ) : null}
      {meta ? <div className="mt-3">{meta}</div> : null}
    </div>
  );
}

/**
 * The one stat tile: a quiet label, the figure at headline size, and an
 * optional plain-language line under it. This anatomy used to exist twice —
 * here as a label-plus-pill card, and on Reports as a local `Metric` with the
 * big number — two shapes for the same concept, one click apart. The big
 * number won: a stat's value is the content, not a badge on the content, and
 * `tabular-nums` keeps a wall of these inspectable at a glance (design
 * principle 6).
 *
 * `tone` colors the figure itself — emphasis, never the sole carrier of
 * meaning: the label and detail line always say the words.
 *
 * Elevation follows containment, the same rule the Table shell keeps: a stat
 * on the page wears the card (`variant="card"`, the default); a stat already
 * inside a card sits `inset` — a sunken tile, one size down, no border or
 * shadow of its own — so surface never stacks on surface. The anatomy is the
 * vocabulary; only the container adapts.
 *
 * `definition` renders the label/value pair as `<dt>`/`<dd>` for tiles that
 * sit in a `<dl>` — the departure log's summary is a definition-list document
 * an insurer's screen-reader user must be able to navigate as one, and the
 * import confirmation keeps the same shape.
 */
export function ShopStat({
  label,
  value,
  detail,
  comparison,
  tone = "default",
  variant = "card",
  definition = false,
  celebrate = false,
  linkHref,
  linkLabel,
}: {
  label: string;
  value: string | number;
  detail?: string;
  /**
   * A baseline reading beside this month's own (issue #700) — "vs last August"
   * or "up vs last August". A distinct line from
   * `detail` rather than folded into it: `detail` states a fact about this
   * month alone ("8 bookings this month"), and a baseline is a second,
   * separable fact a reader may not want translated as one interpolated
   * sentence.
   */
  comparison?: string;
  tone?: "default" | "primary" | "warning" | "success";
  /** `card` on the page; `inset` (sunken, chrome-less) inside an existing card. */
  variant?: "card" | "inset";
  /** Render label/value as `<dt>`/`<dd>` — the tile must then sit in a `<dl>`. */
  definition?: boolean;
  /** Mark a finished state (e.g. every waiver in) with a success check + words. */
  celebrate?: boolean;
  /** One quiet jump to the surface behind the number (e.g. Reports' revenue → Orders). */
  linkHref?: string;
  linkLabel?: string;
}) {
  // The -strong feedback tokens, not the raw hues — because of `inset`, not
  // because of `card`. On `bg-surface` the raw light-palette hues are fine
  // (5.02:1); it is the sunken inset tile that drops them to 4.36:1, under AA.
  // `-strong` clears both (5.54 / 4.82) and one tile cannot pick per variant
  // without the figure changing hue when it moves inside a card. (An earlier
  // version of this comment cited `bg-surface` as the sub-AA case, which is
  // badge.tsx's *tinted fill* number misquoted; the table in
  // docs/design/forms-and-controls.md is the one to read.)
  const toneClass =
    tone === "primary"
      ? "text-primary"
      : tone === "warning"
        ? "text-warning-strong"
        : tone === "success"
          ? "text-success-strong"
          : "text-foreground";

  const Label = definition ? "dt" : "p";
  const Value = definition ? "dd" : "p";
  const inset = variant === "inset";
  const valueClass = `font-semibold tracking-tight tabular-nums ${
    inset ? "text-2xl" : "text-3xl"
  } ${toneClass}`;

  // **Two rows of the grid the tile stands in: labels, then figures** (K-75).
  // In block flow a label that wrapped ("Divers on the / manifest") pushed its
  // own figure 20px below the figures beside it. Subgridding onto the parent's
  // rows — the mechanism `Field` uses for captions over controls
  // (`ui/form.tsx`) — makes the label row as tall as the row's longest label,
  // so every figure starts on one line. Not `flex-col` with the figure
  // `mt-auto`: that aligns figures only when every tile carries the same lines
  // under them, and the blowout record's first tile has no detail where its
  // neighbours do. The row gap is the space the figure's `mt-2` / `mt-0.5`
  // gave. Outside a grid, `subgrid` falls back to plain rows and the tile
  // reads exactly as it did.
  const rows = `grid row-span-2 grid-rows-subgrid ${inset ? "gap-y-0.5" : "gap-y-2"}`;

  return (
    <div
      // The raised tile takes its chrome from the card, not from a copy of the
      // card's spelling: a stat tile and a section card are the same object
      // (docs/design/forms-and-controls.md), so neither can drift from the
      // other. `inset` is the sunken, chrome-less variant and has none of it.
      className={
        inset
          ? `${rows} rounded-inset bg-surface-sunken px-4 py-3`
          : sectionCardClass({ className: rows })
      }
    >
      <Label
        className={inset ? "text-xs font-medium text-muted" : "text-sm font-medium text-muted"}
      >
        {label}
      </Label>
      {definition ? (
        <Value className={valueClass}>
          {value}
          {/* In definition mode the detail and link live inside the <dd> — a
              <dl>'s groups may hold only <dt>/<dd>, and the sentence *is* part
              of the value's definition. */}
          {statDetail({ detail, comparison, celebrate, linkHref, linkLabel })}
        </Value>
      ) : (
        // The figure and the lines under it are one row: a detail line as a
        // third child would open a third track the neighbours do not have.
        <div>
          <Value className={valueClass}>{value}</Value>
          {statDetail({ detail, comparison, celebrate, linkHref, linkLabel })}
        </div>
      )}
    </div>
  );
}

function statDetail({
  detail,
  comparison,
  celebrate,
  linkHref,
  linkLabel,
}: {
  detail?: string;
  comparison?: string;
  celebrate: boolean;
  linkHref?: string;
  linkLabel?: string;
}) {
  return (
    <>
      {detail ? (
        <span
          className={`mt-2 flex items-center gap-1.5 text-sm font-normal tracking-normal ${
            celebrate ? "text-success-strong" : "text-muted"
          }`}
        >
          {celebrate ? (
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="size-4 shrink-0"
            >
              <path
                fillRule="evenodd"
                d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0l-3.5-3.5a1 1 0 1 1 1.4-1.4l2.8 2.8 6.8-6.8a1 1 0 0 1 1.4 0Z"
                clipRule="evenodd"
              />
            </svg>
          ) : null}
          {detail}
        </span>
      ) : null}
      {/* Its own line, one step quieter than `detail`: a baseline is
          supporting reading, not the fact `detail` already states. */}
      {comparison ? (
        <span className="mt-1 block text-sm tracking-normal text-muted tabular-nums">
          {comparison}
        </span>
      ) : null}
      {linkHref && linkLabel ? (
        <Link
          href={linkHref}
          className="mt-2 inline-block text-sm font-medium tracking-normal text-primary hover:underline"
        >
          {linkLabel}
        </Link>
      ) : null}
    </>
  );
}

export function ShopNotice({
  children,
  tone = "success",
  role = "status",
  className = "",
}: {
  children: React.ReactNode;
  tone?: "success" | "danger" | "warning" | "neutral";
  role?: "status" | "alert";
  className?: string;
}) {
  // `-strong` on the success tint: the raw hue on its own 10% fill is 4.39:1 in
  // the light palette, under AA (docs/design/forms-and-controls.md). `danger`
  // needs no nudge and `warning` already reads as body text on its tint.
  const toneClass =
    tone === "danger"
      ? "border-danger/20 bg-danger-tint text-danger"
      : tone === "warning"
        ? "border-warning/25 bg-warning/10 text-foreground"
        : tone === "neutral"
          ? "border-border bg-surface-sunken text-foreground"
          : "border-success/20 bg-success-tint text-success-strong";
  const mark = toneMark(tone);

  return (
    <div
      role={role}
      // `rise-in`: the app's most-seen success signal used to be the one
      // feedback vehicle with no entrance — a tap acknowledged itself, the
      // page reloaded, and the outcome was simply there. The same arrival the
      // toast and the earned moment make; `prefers-reduced-motion` stills it.
      //
      // **A row aligned on the first baseline** (K-15). The mark used to be a
      // bare svg in front of the words, which preflight makes a block, so it
      // stood alone on a line above them. Not `items-start`: a notice's first
      // line is not always at its top — the trip banner's words sit centred
      // beside a 44px Undo, the duplicate-diver warning opens on a 16px
      // heading — so the mark's column carries one line of the notice's own
      // text (`StatusMark inline`) and the row lines that line's baseline up
      // with the words' first one, wherever it is. `ShopPageHeader.test.tsx`.
      className={`rise-in flex items-baseline gap-2 rounded-inset border px-4 py-3 text-sm font-medium ${toneClass} ${className}`}
    >
      {mark ? (
        <span className="shrink-0">
          <StatusMark variant={mark} inline />
        </span>
      ) : null}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
