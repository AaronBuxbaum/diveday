import type { ReactNode } from "react";
import { Wordmark } from "@/components/Logo";

/**
 * The one door into DiveDay.
 *
 * Every auth/lifecycle page — sign-in, forgot/reset password, staff invite,
 * email verification, unsubscribe, onboarding — used to hand-roll its own
 * centered card, and two incompatible idioms had grown (`max-w-sm rounded-lg`
 * left-aligned vs `max-w-xl rounded-2xl` centered). This is the shared
 * anatomy they all wear now:
 *
 *  1. **Identity** — the DiveDay wordmark on chrome-less token pages
 *     (`wordmark`), or a small uppercase `eyebrow` (a shop's name, "Founding
 *     shop") where the sender matters more than the platform. Pages that
 *     already render `MarketingNav` above pass neither.
 *  2. **The question** — a centered title, with an optional one-line muted
 *     description under it.
 *  3. **The action** — `children`. Forms sit in a panel that is borderless on
 *     a phone (one centered column needs no box inside the viewport's box)
 *     and becomes a `rounded-2xl` surface from `sm` up. A page whose whole
 *     action is a single button (`panel={false}`) skips the panel entirely —
 *     a border around one control is chrome.
 *  4. **The way out** — `footer`, one quiet centered row of small links below
 *     the panel, never inside it.
 *
 * Terminal outcomes (link expired, email confirmed, unsubscribed) are not
 * this shape — they are `EntryDone` below, the whole-page warm pattern from
 * docs/design/principles.md #4.
 *
 * Words arrive as props; this component reads no translator, so it serves
 * every locale context the pages already resolve.
 */
export function EntryShell({
  wordmark = false,
  eyebrow,
  title,
  description,
  width = "sm",
  panel = true,
  footer,
  children,
}: {
  /** Show the DiveDay mark above the title — for pages with no nav above. */
  wordmark?: boolean;
  /** Small uppercase line above the title (a shop's name, "Founding shop"). */
  eyebrow?: string;
  title: string;
  description?: string;
  /** `sm` for the two-field doors, `lg` for onboarding's two-section form. */
  width?: "sm" | "lg";
  /** `false` when the whole action is one button — no box around a control. */
  panel?: boolean;
  /** Quiet centered links below the panel — the way out, never inside. */
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className={entryMainClass(width)}>
      <header className="text-center">
        {wordmark ? <Wordmark className="mb-8 justify-center" /> : null}
        {eyebrow ? (
          <p className="mb-2 text-xs font-semibold tracking-widest text-primary uppercase">
            {eyebrow}
          </p>
        ) : null}
        <h1
          className={`font-semibold tracking-tight text-balance ${width === "lg" ? "text-3xl" : "text-2xl"}`}
        >
          {title}
        </h1>
        {description ? <p className="mx-auto mt-2 max-w-prose text-muted">{description}</p> : null}
      </header>
      {panel ? (
        <div className={entryPanelClass}>{children}</div>
      ) : (
        <div className="mt-8 flex flex-col items-center gap-4 text-center">{children}</div>
      )}
      {footer ? (
        <footer className="mt-8 flex flex-col items-center gap-2 text-center text-sm text-muted">
          {footer}
        </footer>
      ) : null}
    </main>
  );
}

/**
 * The centered column every door shares. Exported so `EntryShellSkeleton`
 * wears the *same* frame as the shell that replaces it — a skeleton narrower
 * or wider than its page is a sideways layout jump on every navigation into
 * the route (docs/design/principles.md #10), and two width-mismatched
 * loading files were found exactly that way. Shared constants make the
 * drift structurally impossible.
 */
export function entryMainClass(width: "sm" | "lg") {
  return `mx-auto flex w-full ${width === "lg" ? "max-w-xl" : "max-w-md"} flex-1 flex-col justify-center px-6 py-12 sm:py-16`;
}

/** The form panel: borderless on a phone, a bordered surface from `sm` up. */
export const entryPanelClass =
  "mt-8 sm:rounded-2xl sm:border sm:border-border sm:bg-surface sm:p-8";

/**
 * A terminal outcome as the whole page: email confirmed, link expired, emails
 * stopped. The bespoke warm pattern from docs/design/principles.md — a glyph
 * in a soft circle, a heading, subtext, and at most one quiet way onward —
 * with no card border, because nothing else renders and a box would only ask
 * "compared to what?".
 */
export function EntryDone({
  glyph,
  title,
  text,
  action,
}: {
  /** A single emoji/dingbat, decorative — the words carry the meaning. */
  glyph: string;
  title: string;
  text: string;
  /** One quiet way onward (usually a link back to sign-in), or nothing. */
  action?: ReactNode;
}) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-6 py-12 text-center sm:py-16">
      <div
        aria-hidden="true"
        className="grid size-14 place-items-center rounded-full bg-surface-sunken text-3xl"
      >
        {glyph}
      </div>
      <h1 className="mt-6 text-2xl font-semibold tracking-tight text-balance">{title}</h1>
      <p className="mt-3 max-w-prose text-muted">{text}</p>
      {action ? <div className="mt-6 text-sm">{action}</div> : null}
    </main>
  );
}
