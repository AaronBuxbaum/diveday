import Link from "next/link";

const EYEBROW_CLASS = "text-xs font-semibold tracking-[0.18em] text-primary uppercase";

export function ShopPageHeader({
  eyebrow,
  eyebrowHref,
  title,
  description,
  meta,
  actions,
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
  align?: "start" | "end";
}) {
  return (
    <header className="mb-8">
      <div
        className={`flex flex-col gap-5 sm:flex-row sm:justify-between ${
          align === "start" ? "sm:items-start" : "sm:items-end"
        }`}
      >
        <div className="min-w-0">
          {eyebrow && eyebrowHref ? (
            // Sized exactly like the plain eyebrow it replaces, so a page that
            // gains a way back does not gain a line of height. `py-1 -my-1`
            // buys a little slop for a thumb without moving anything around it.
            <Link
              href={eyebrowHref}
              className={`${EYEBROW_CLASS} -my-1 inline-flex items-center gap-1 py-1 hover:underline`}
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
              {eyebrow}
            </Link>
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
 */
export function ShopStat({
  label,
  value,
  detail,
  tone = "default",
  celebrate = false,
  linkHref,
  linkLabel,
}: {
  label: string;
  value: string | number;
  detail?: string;
  tone?: "default" | "primary" | "warning" | "success";
  /** Mark a finished state (e.g. every waiver in) with a success check + words. */
  celebrate?: boolean;
  /** One quiet jump to the surface behind the number (e.g. Reports' revenue → Orders). */
  linkHref?: string;
  linkLabel?: string;
}) {
  // The -strong feedback tokens, not the raw hues: success/warning text on
  // bg-surface measured just under AA (see ui/badge.tsx).
  const toneClass =
    tone === "primary"
      ? "text-primary"
      : tone === "warning"
        ? "text-warning-strong"
        : tone === "success"
          ? "text-success-strong"
          : "text-foreground";

  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm sm:p-5">
      <p className="text-sm font-medium text-muted">{label}</p>
      <p className={`mt-2 text-3xl font-semibold tracking-tight tabular-nums ${toneClass}`}>
        {value}
      </p>
      {detail ? (
        <p
          className={`mt-2 flex items-center gap-1.5 text-sm ${
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
        </p>
      ) : null}
      {linkHref && linkLabel ? (
        <Link
          href={linkHref}
          className="mt-2 inline-block text-sm font-medium text-primary hover:underline"
        >
          {linkLabel}
        </Link>
      ) : null}
    </div>
  );
}

// Decorative, `aria-hidden` tone mark — the same reasoning, and the same
// emoji, as `Badge`'s (see ui/badge.tsx): status here is hue plus reading the
// words, which a colorblind scan can miss before it gets to the words at all,
// and a text dingbat at this size reads as a font falling back rather than as
// a status.
const NOTICE_GLYPH: Record<"success" | "danger" | "warning" | "neutral", string | null> = {
  success: "✅ ",
  danger: "❌ ",
  warning: "⚠️ ",
  neutral: null,
};

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
  const toneClass =
    tone === "danger"
      ? "border-danger/20 bg-danger/10 text-danger"
      : tone === "warning"
        ? "border-warning/25 bg-warning/10 text-foreground"
        : tone === "neutral"
          ? "border-border bg-surface-sunken text-foreground"
          : "border-success/20 bg-success/10 text-success";
  const glyph = NOTICE_GLYPH[tone];

  return (
    <div
      role={role}
      className={`rounded-xl border px-4 py-3 text-sm font-medium ${toneClass} ${className}`}
    >
      {glyph ? <span aria-hidden="true">{glyph}</span> : null}
      {children}
    </div>
  );
}
