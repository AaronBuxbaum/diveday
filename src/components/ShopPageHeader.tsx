import Link from "next/link";
import type { ReactNode } from "react";
import { sectionCardClass } from "@/components/ui/card";
import { toneGlyph } from "@/components/ui/tone";

export const EYEBROW_CLASS = "text-xs font-semibold tracking-[0.18em] text-primary uppercase";

/**
 * The eyebrow-as-breadcrumb, for a header that is not `ShopPageHeader`.
 *
 * `TripPageHeader` is the one — the four trip surfaces share their own header,
 * and they were the only staff pages at depth 2–3 with no way back to their
 * parent at all (issue #823). Exported rather than copied so the chevron, the
 * sizing and the `-my-1 py-1` thumb slop stay one decision: a second hand-rolled
 * back link is how three ways up became three (a linked eyebrow, an explicit
 * "← Parent", and the global nav).
 */
export function EyebrowBackLink({
  href,
  children,
  className = "",
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={`${EYEBROW_CLASS} -my-1 inline-flex items-center gap-1 py-1 hover:underline ${className}`.trim()}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-3 shrink-0"
      >
        <path d="m15 18-6-6 6-6" />
      </svg>
      {children}
    </Link>
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
}) {
  const hasBrand = Boolean(brand?.logoUrl || brand?.tagline || brand?.description);
  return (
    <header className="mb-8">
      <div
        className={`flex flex-col gap-5 sm:flex-row sm:justify-between ${
          align === "start" ? "sm:items-start" : "sm:items-end"
        }`}
      >
        <div className="min-w-0">
          {hasBrand ? (
            <div className="mb-5 flex items-start gap-3">
              {brand?.logoUrl ? (
                // biome-ignore lint/performance/noImgElement: dynamic user-uploaded logo
                <img
                  src={brand.logoUrl}
                  alt=""
                  className="size-14 shrink-0 rounded-2xl border border-border bg-surface object-cover shadow-xs"
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
            className={`text-4xl font-semibold tracking-tight text-balance${eyebrow ? " mt-2" : ""}`}
          >
            {title}
          </h1>
          {description ? <p className="mt-2 max-w-2xl text-muted">{description}</p> : null}
          {meta ? <div className="mt-3">{meta}</div> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
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
 *   - `h-4`  — the eyebrow's `text-xs` line box (0.75rem text, 1rem leading)
 *   - `h-10` — the `<h1>`'s `text-4xl` line box (2.25rem text, 2.5rem leading)
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
      <div className={`h-10 ${titleWidth} rounded bg-surface-sunken${eyebrow ? " mt-2" : ""}`} />
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
   * A baseline reading beside this month's own (issue #700) — "vs $6,690
   * last August" or "+12% vs $6,690 last August". A distinct line from
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

  return (
    <div
      // The raised tile takes its chrome from the card, not from a copy of the
      // card's spelling: a stat tile and a section card are the same object
      // (docs/design/forms-and-controls.md), so neither can drift from the
      // other. `inset` is the sunken, chrome-less variant and has none of it.
      className={inset ? "rounded-xl bg-surface-sunken px-4 py-3" : sectionCardClass()}
    >
      <Label
        className={inset ? "text-xs font-medium text-muted" : "text-sm font-medium text-muted"}
      >
        {label}
      </Label>
      <Value
        className={`font-semibold tracking-tight tabular-nums ${
          inset ? "mt-0.5 text-2xl" : "mt-2 text-3xl"
        } ${toneClass}`}
      >
        {value}
        {/* In definition mode the detail and link live inside the <dd> — a
            <dl>'s groups may hold only <dt>/<dd>, and the sentence *is* part
            of the value's definition. */}
        {definition ? statDetail({ detail, comparison, celebrate, linkHref, linkLabel }) : null}
      </Value>
      {definition ? null : statDetail({ detail, comparison, celebrate, linkHref, linkLabel })}
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
  const glyph = toneGlyph(tone);

  return (
    <div
      role={role}
      className={`rounded-xl border px-4 py-3 text-sm font-medium ${toneClass} ${className}`}
    >
      {/* `mr-1` rather than a space baked into the glyph string: the mark is
          one shared declaration (ui/tone.ts) and the gap belongs to whichever
          surface is rendering it. */}
      {glyph ? (
        <span aria-hidden="true" className="mr-1">
          {glyph}
        </span>
      ) : null}
      {children}
    </div>
  );
}
