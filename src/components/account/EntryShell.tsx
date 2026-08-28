import type { ReactNode } from "react";
import { Wordmark } from "@/components/Logo";
import { EYEBROW_CLASS } from "@/components/ShopPageHeader";
import { SHELL_TITLE_CLASS } from "@/components/ui/typography";

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
 * **This is the one door, and it speaks Clearwater** (ADR
 * 20260827-first-light, decision 1): the panel is flat, the title takes the
 * one shell ramp, footer links are text rather than boxes, and a door renders
 * **one** primary and nothing else button-shaped — sign-in's "Forgot
 * password?" is a link, not a second button. `EntryShell.test.tsx` holds all
 * of that, over the door pages themselves rather than over this file, because
 * a second primary is something a page grows, not something this component
 * can prevent.
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
        {eyebrow ? <p className={`${EYEBROW_CLASS} mb-2`}>{eyebrow}</p> : null}
        {/* One size at both widths. The title used to step down to `text-2xl`
            on the `sm` doors, which made the question a diver was being asked
            smaller on sign-in than on onboarding and smaller again than on the
            thread page they had just come from — three sizes for one sentence
            (ADR 20260827-the-divers-thread, decision 1). `width` still decides
            the column; it no longer decides the type. */}
        <h1 className={`${SHELL_TITLE_CLASS} text-balance`}>{title}</h1>
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
 * **The closed set of marks a terminal door may wear** (ADR
 * 20260827-first-light, decision 2).
 *
 * It was a `string` holding an emoji — a mailbox, an hourglass, a party
 * popper, a crossed-out bell, a calendar — which is the one place in the app
 * where an emoji was the *structure* of a component rather than a word in a
 * sentence, and so the one place it rendered at a different size, weight and
 * hue on every platform the app is opened on. An id instead of a glyph is what
 * makes the mark a decision this file owns: a caller names the situation,
 * never the picture, and no caller can pass markup or type one back in.
 *
 * The ADR names four — `sent` (a reset is in the inbox), `expired` (a dead
 * link), `done` (a confirmed act), `quiet` (nothing more will be sent). The
 * fifth, `cancelled`, is the one its census missed: `/ready/[token]` already
 * drew a distinction the four cannot carry, because a booking cancelled
 * underneath a diver has a link that *works*, and sending them off to ask for
 * a fresh one is the wrong door. Its calendar is the same sentence its emoji
 * said; the amendment is noted for that record rather than resolved by
 * flattening the two states into one clock.
 */
export const DOOR_GLYPH_IDS = ["sent", "expired", "done", "quiet", "cancelled"] as const;

export type DoorGlyphId = (typeof DOOR_GLYPH_IDS)[number];

/**
 * The strokes themselves — path data rather than markup, keyed so the compiler
 * (not a reviewer) is what refuses an id with no drawing. One `<svg>` renders
 * whichever list the id names, in `currentColor` at a single width, so the mark
 * inherits the tone and the theme of whatever renders it and none of these
 * carries a colour of its own.
 *
 * One hand drew all of them: the 24px box, the 1.8 stroke and the round caps
 * are `SettledCheck`'s and `StaffDestinationIcon`'s, so a door's mark and a
 * settled row's mark are recognisably the same pen and no icon library is
 * anywhere near this.
 */
const DOOR_GLYPH_MARKS: Record<DoorGlyphId, readonly string[]> = {
  // An envelope, flap open toward the reader.
  sent: [
    "M5.5 5.5h13a2.5 2.5 0 0 1 2.5 2.5v8a2.5 2.5 0 0 1-2.5 2.5h-13a2.5 2.5 0 0 1-2.5-2.5v-8a2.5 2.5 0 0 1 2.5-2.5Z",
    "M3.9 7.2 12 13l8.1-5.8",
  ],
  // A clock, hands just past the hour.
  expired: ["M12 3.75a8.25 8.25 0 1 1 0 16.5 8.25 8.25 0 1 1 0-16.5Z", "M12 7.25V12l3.25 2"],
  // A check, drawn in one stroke.
  done: ["m5.25 12.5 4.5 4.5 9-9.5"],
  // A bell at rest: no motion lines, because nothing is ringing any more.
  quiet: [
    "M6.75 17h10.5c-1.1-1.35-1.6-2.9-1.6-4.9V11a3.65 3.65 0 0 0-7.3 0v1.1c0 2-.5 3.55-1.6 4.9Z",
    "M10.35 19.4a2 2 0 0 0 3.3 0",
  ],
  // A calendar sheet: the day is off, not the link.
  cancelled: [
    "M6 5.5h12a2.5 2.5 0 0 1 2.5 2.5v10a2.5 2.5 0 0 1-2.5 2.5H6a2.5 2.5 0 0 1-2.5-2.5V8A2.5 2.5 0 0 1 6 5.5Z",
    "M3.5 10h17M8 3.75v3.5M16 3.75v3.5",
  ],
};

/**
 * A terminal outcome as the whole page: email confirmed, link expired, emails
 * stopped. The bespoke warm pattern from docs/design/principles.md — a drawn
 * mark in a soft circle, a heading, subtext, and at most one quiet way onward
 * — with no card border, because nothing else renders and a box would only ask
 * "compared to what?". Flat at rest, like every panel in the Clearwater
 * language (ADR 20260827-clearwater-surface-language, decision 1).
 *
 * The mark is decorative and the circle says so: the heading carries the
 * meaning, in the reader's own language, which is exactly what an emoji could
 * not do.
 */
export function EntryDone({
  glyph,
  title,
  text,
  action,
}: {
  /** Which situation this is — the component owns the drawing. */
  glyph: DoorGlyphId;
  title: string;
  text: string;
  /** One quiet way onward (usually a link back to sign-in), or nothing. */
  action?: ReactNode;
}) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-6 py-12 text-center sm:py-16">
      <div
        aria-hidden="true"
        className="grid size-14 place-items-center rounded-full bg-surface-sunken"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="size-7"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {DOOR_GLYPH_MARKS[glyph].map((mark) => (
            <path key={mark} d={mark} />
          ))}
        </svg>
      </div>
      <h1 className={`mt-6 ${SHELL_TITLE_CLASS} text-balance`}>{title}</h1>
      <p className="mt-3 max-w-prose text-muted">{text}</p>
      {action ? <div className="mt-6 text-sm">{action}</div> : null}
    </main>
  );
}
