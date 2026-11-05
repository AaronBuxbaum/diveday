import type { ComponentProps, ReactNode } from "react";
import { Wordmark } from "@/components/Logo";
import { EYEBROW_CLASS, SkeletonLineBars, type SkeletonLines } from "@/components/ShopPageHeader";
import { Bone, Pending } from "@/components/ui/pending";
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
 *  3. **The action** — `children`. Forms sit in a panel that is *nothing at
 *     all* on a phone (one centered column needs no box inside the viewport's
 *     box — not a border, not a ground, and not the shadow that used to
 *     survive the breakpoint alone) and becomes a `rounded-2xl` surface from
 *     `sm` up. A page whose whole action is a single button (`panel={false}`)
 *     skips the panel entirely — a border around one control is chrome.
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
function ResolvedEntryShell({
  wordmark = false,
  homeLink = false,
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
  homeLink?: boolean;
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
        {wordmark ? (
          <Wordmark href={homeLink ? "/" : undefined} className="mb-8 justify-center" />
        ) : null}
        {eyebrow ? <p className={`${EYEBROW_CLASS} mb-2`}>{eyebrow}</p> : null}
        {/* One size at both widths. The title used to step down to `text-2xl`
            on the `sm` doors, which made the question a diver was being asked
            smaller on sign-in than on onboarding and smaller again than on the
            thread page they had just come from — three sizes for one sentence
            (ADR 20260827-the-divers-thread, decision 1). `width` still decides
            the column; it no longer decides the type. */}
        <h1 className={`${SHELL_TITLE_CLASS} text-balance`}>{title}</h1>
        {description ? (
          <p className="mx-auto mt-2 max-w-prose text-balance text-muted">{description}</p>
        ) : null}
      </header>
      {panel ? (
        <div className={entryPanelClass}>{children}</div>
      ) : (
        <div className="mt-8 flex flex-col items-center gap-4 text-center">{children}</div>
      )}
      {footer ? (
        <footer
          className={`mt-8 flex flex-col items-center gap-2 text-center text-sm text-muted print:hidden ${FOOTER_LINK_SLOT}`}
        >
          {footer}
        </footer>
      ) : null}
    </main>
  );
}

/**
 * **A link a door hands on is a tap target**, whatever the page typed.
 *
 * Every door's way out — the footer's "Back to sign in", a terminal door's one
 * action — arrived from its page as a bare `font-medium text-primary` link:
 * 96.3 × 17px, under the 44px floor, on forgot-password, the staff invite,
 * reset-password, verify and sign-in (the pixel probe's `small-target`). The
 * slot is the layer that owns them all, so it lays `tapTargetLinkClass`'s floor
 * on its links and no page has to remember.
 *
 * Spelled out rather than built from `tapTargetLinkClass`, because Tailwind
 * only generates a class it can read whole in the source; `EntryShell.test.tsx`
 * holds the two in step.
 *
 * **A floor, never a ceiling.** `:where(&)` takes the slot's class out of the
 * selector's weight, so the rule is `:where(.slot) a` at (0,0,1) and any class
 * on the link itself outranks it. The plain `[&_a]:` spelling is `.slot a` at
 * (0,1,1), which beats a link's own `min-h-12`.
 *
 * **The target grows; the line does not.** `inline-flex` makes the link an
 * atomic inline, and an atomic inline's *margin* box is what sizes its line.
 * So `-my-3` hands back (44 − 20) / 2 above and below — the give-back
 * Copyable's panel trigger uses — and the link takes exactly the 20px line it
 * sits on while the box a finger meets is 44px. Without it every line holding
 * a link grew to 44px: a two-row footer's words stood 24px apart instead of 8,
 * and where a sentence wraps its link onto a second line (the closed
 * onboarding door's "Try the live demo", at 1280 and 390) its two lines sat
 * 32px apart instead of 20. With it the footer keeps the `mt-8 gap-2` it has
 * always had, and a terminal door's link sits 24px under the body.
 *
 * **Which links.** The footer reaches every link in it (`_a`), a sentence's
 * included — its rows are only ever text. A terminal door's action reaches
 * only a link that is the whole action (`>a`): `ExpiredLinkCard` hands it a
 * column holding a `buttonClass()` link or a form, then "Need help? Contact
 * {shop}.", and neither is this slot's to size.
 */
const FOOTER_LINK_SLOT =
  "[:where(&)_a]:inline-flex [:where(&)_a]:min-h-11 [:where(&)_a]:min-w-11 [:where(&)_a]:items-center [:where(&)_a]:justify-center [:where(&)_a]:-my-3";
const ACTION_LINK_SLOT =
  "[:where(&)>a]:inline-flex [:where(&)>a]:min-h-11 [:where(&)>a]:items-center [:where(&)>a]:-my-3";

/**
 * The centered column every door shares. Exported so the pending face
 * wears the *same* frame as the shell that replaces it — a skeleton narrower
 * or wider than its page is a sideways layout jump on every navigation into
 * the route (docs/design/principles.md #10), and two width-mismatched
 * loading files were found exactly that way. Shared constants make the
 * drift structurally impossible.
 */
export function entryMainClass(width: "sm" | "lg") {
  return `mx-auto flex w-full ${width === "lg" ? "max-w-xl" : "max-w-md"} flex-1 flex-col justify-center px-6 py-12 sm:py-16 print:justify-start print:py-4`;
}

/**
 * The form panel: **nothing at all** on a phone, a bordered surface from `sm`
 * up.
 *
 * Every other class here has always been `sm:`-scoped, and `shadow-bed` was
 * not — so below `sm` the panel drew a soft shadow with no border, no ground
 * and no padding under it, and the fields sat inside a faint box that ran edge
 * to edge of the viewport (2026-09-17 design review; it reads as a rendering
 * fault in dark mode, where the bed is `rgba(0, 0, 0, 0.35)`). A shadow is the
 * lift of a surface off the page, so it belongs exactly where the surface does:
 * one centered column inside the viewport's own box needs no box of its own,
 * which is what the anatomy above already said.
 *
 * The pending face wears this same constant, so the door and the skeleton
 * that stands in for it cannot drift apart.
 */
export const entryPanelClass =
  "mt-8 sm:rounded-panel sm:border sm:border-border sm:bg-surface sm:p-8 sm:shadow-bed print:mt-4 print:p-4";

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
  wordmark = false,
  homeLink = false,
  glyph,
  title,
  text,
  action,
}: {
  /**
   * Show the DiveDay mark above the drawn one — for a dead link that resolves
   * no shop, where it is the only answer to "whose page is this?" (UX audit
   * #28). Never alongside a shop's name: that page is the shop's.
   */
  wordmark?: boolean;
  homeLink?: boolean;
  /** Which situation this is — the component owns the drawing. */
  glyph: DoorGlyphId;
  title: string;
  text: string;
  /** One quiet way onward (usually a link back to sign-in), or nothing. */
  action?: ReactNode;
}) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-6 py-12 text-center sm:py-16 print:justify-start print:py-4">
      {wordmark ? (
        <Wordmark href={homeLink ? "/" : undefined} className="mb-8 justify-center" />
      ) : null}
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
      {/* Balanced like the heading above it: left to break greedily, a
          two-line body ended on "do." or "one." alone, and verify's split
          "Sign" from "in" across its two lines. */}
      <p className="mt-3 max-w-prose text-balance text-muted">{text}</p>
      {action ? (
        <div className={`mt-6 text-sm print:hidden ${ACTION_LINK_SLOT}`}>{action}</div>
      ) : null}
    </main>
  );
}

/**
 * Body-shaped skeleton matching `EntryShell` (design principle 1): centered
 * title and description bars, then either the form panel (borderless on a
 * phone, a bordered surface from `sm` up — the *same* exported class
 * constants as the real shell, so nothing can drift or shift when the page
 * streams in) or, for the single-button doors (`panel={false}`), a centered
 * button bar.
 *
 * `fields` is a list of slot names, one per stacked label+control pair, so
 * each page's skeleton carries the same number of rows as its real form.
 *
 * A door's words wrap, and a bar cannot: how many lines the title, the
 * description, a panel's sentence and each footer sentence wrap to is the
 * page's to say, in `<ShopPageHeader pending>`'s spelling (`SkeletonLines`: one
 * count, or one below `sm` and one from it).
 */
function PendingEntryShell({
  wordmark = false,
  eyebrow = false,
  titleLines = 1,
  description = true,
  descriptionLines = 1,
  width = "sm",
  panel = true,
  fields = [],
  body,
  trailingLink = false,
  footnote = true,
}: {
  wordmark?: boolean;
  /** Stands in for the small uppercase line above the title. */
  eyebrow?: boolean;
  /** How many lines the title wraps to. */
  titleLines?: SkeletonLines;
  /** `false` for a door whose shell has no `description` (sign-in, verify, onboarding). */
  description?: boolean;
  /** How many lines the description wraps to. */
  descriptionLines?: SkeletonLines;
  width?: "sm" | "lg";
  panel?: boolean;
  fields?: readonly string[];
  /**
   * A panel that holds a sentence and one button rather than a form — the
   * closed onboarding door — as the number of lines the sentence wraps to.
   */
  body?: SkeletonLines;
  /** A text link after the last field — sign-in's "Forgot password?". */
  trailingLink?: boolean;
  /**
   * The footer's row: `true` for one one-line sentence, or the lines each of
   * its sentences wraps to (`[2, 1]`: a two-line sentence over a one-line one).
   */
  footnote?: boolean | readonly SkeletonLines[];
}) {
  return (
    <main className={entryMainClass(width)}>
      <Pending>
        {/* The shell's `<header>`, bar for line. The wordmark's `mb-8` is the
            wordmark's own, as the shell's is, so an eyebrow under it stands
            32px down and 8px over the title; the title bar carried the 32px,
            which stood a demo door's eyebrow flush under its wordmark
            (K-576). The bars are the shell's own line boxes, read off
            `EntryShell`: the wordmark is a 24px lockup (`h-6`), the eyebrow
            `EYEBROW_CLASS`'s `leading-4` (`h-4`), the `<h1>`
            `SHELL_TITLE_CLASS` at both widths, whose `text-3xl` line box is
            36px (`h-9`), and the description an unsized `<p>` at 24px (`h-6`)
            under the header's own `mt-2`. */}
        <div>
          {wordmark ? <Bone className="mx-auto mb-8 h-6 w-28" /> : null}
          {eyebrow ? <Bone className="mx-auto mb-2 h-4 w-24" /> : null}
          <SkeletonLineBars lines={titleLines} height="h-9" width="mx-auto w-56 max-w-full" />
          {description ? (
            <div className="mt-2">
              <SkeletonLineBars
                lines={descriptionLines}
                height="h-6"
                width="mx-auto w-72 max-w-full"
              />
            </div>
          ) : null}
        </div>
        {/* The form's own rhythm: every door's form is `flex flex-col gap-4`
            around a `buttonClass()` submit, which is `md`, 48px — so the
            button bar is `mt-4 h-12`. It was `mt-6 h-11`, drawn before `md`
            was 48px, and the form moved 4px when it streamed in.

            Sign-in's "Forgot password?" is a 48px link pulled to 32px of flow
            by its `-my-2`, between two of those 16px gaps: an `h-8` row with
            a text bar at its end, where the link's words end.

            A door with no form (`body`) holds a `<p>` and its one button
            `mt-6` under it, so the sentence's line boxes and then `mt-6 h-12`. */}
        {panel ? (
          <div className={entryPanelClass}>
            {fields.map((slot, index) => (
              <div key={slot} className={index === 0 ? "" : "mt-4"}>
                <Bone className="h-4 w-28" />
                <Bone shape="control" className="mt-2 h-12 w-full" />
              </div>
            ))}
            {body !== undefined ? (
              <SkeletonLineBars lines={body} height="h-6" width="w-full max-w-sm" />
            ) : null}
            {trailingLink ? (
              <div className="mt-4 flex h-8 items-center justify-end">
                <Bone className="h-4 w-32" />
              </div>
            ) : null}
            <Bone
              shape="control"
              className={`${body !== undefined ? "mt-6" : "mt-4"} h-12 w-full`}
            />
          </div>
        ) : (
          <Bone shape="control" className="mx-auto mt-8 h-12 w-44" />
        )}
        {/* The footer's row: `EntryShell`'s footer is `mt-8` over `text-sm`
            lines, and its 44px links hand back what they add to the line
            (`FOOTER_LINK_SLOT`), so the row is 20px. The bar stands centred
            in an `h-5` row at the same margin; it was a bare `h-4` bar, 4px
            short of the line it stood in for. A footer of several sentences
            is the shell's `gap-2` column of them, a 20px line box for each
            line each one wraps to. */}
        {footnote === true ? (
          <div className="mt-8 flex h-5 items-center justify-center">
            <Bone className="h-4 w-44" />
          </div>
        ) : footnote ? (
          <div className="mt-8 flex flex-col gap-2">
            {footnote.map((lines, row) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: bars, not records — the row number is the only identity a placeholder row has
              <div key={row}>
                <SkeletonLineBars lines={lines} height="h-5" width="mx-auto w-72 max-w-full" />
              </div>
            ))}
          </div>
        ) : null}
      </Pending>
    </main>
  );
}

/**
 * The door — or, with `pending`, the same door drawn as bars for a route's
 * `loading.tsx`, on the shell's own column and panel classes (#2769). It was a
 * second component, `EntryShellSkeleton`, until the pending face moved in
 * beside the shell it measures itself off.
 */
export function EntryShell(
  props:
    | ({ pending?: false } & ComponentProps<typeof ResolvedEntryShell>)
    | ({ pending: true } & ComponentProps<typeof PendingEntryShell>),
) {
  if (props.pending) {
    const { pending: _pending, ...bars } = props;
    return <PendingEntryShell {...bars} />;
  }
  const { pending: _resolved, ...shell } = props;
  return <ResolvedEntryShell {...shell} />;
}
