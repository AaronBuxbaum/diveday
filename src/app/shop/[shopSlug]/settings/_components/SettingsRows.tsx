import Link from "next/link";
import type { ReactNode } from "react";
import { AutoOpenDetails } from "@/components/AutoOpenDetails";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { LIST_ROW_SUMMARY_RING } from "@/components/ui/disclosure";
import { type SectionId, settingsSectionFragment } from "../settings-groups";

/**
 * The settings directory's row vocabulary — the same "summary first, form on
 * intent" grammar the trip About panel established, pushed to
 * its conclusion: the whole row is the disclosure control, and at rest the row
 * *states its current value* instead of showing the form that would change it.
 *
 * Two shapes, one anatomy (heading left, answer right, caret):
 *
 * - `SettingsRow` — an editable setting: `<summary>` = heading + current value;
 *   opening reveals the description and the form in place.
 * - `SettingsDoorRow` — a destination: the heading is the link and the whole
 *   row is its tap target (stretched overlay), caret pointing onward.
 *
 * **A door row carries no standing caption** (ADR
 * 20260827-clearwater-surface-language, decision 6): a row is its label and,
 * where it has one, its current value; explanation lives where the row opens
 * — or, for a door, on the page it opens. The shell these rows sit in is
 * `InsetGroup` (src/components/ui/ledger.tsx), which is this same grammar
 * written down once for the rest of the app by the same ADR; the bordered
 * `SettingsRowList` that used to live here was a second spelling of it.
 *
 * The `<summary>` carries no focusable descendants — an interactive element
 * nested in a `<summary>` fails axe's nested-interactive rule (see
 * `TripAboutSection`); detail prose that used to hide behind an `InfoHint`
 * button renders as plain text inside the open state instead, where the
 * reader has already asked for more.
 */

/**
 * Where a row's value sits on a phone. `stack` (the default) puts it on a line
 * of its own under the heading, where a long answer has the full width;
 * `inline` keeps it on the heading's line, as it sits from `sm` up.
 */
type SettingsValuePlacement = "stack" | "inline";

function RowSummary({
  heading,
  value,
  valuePlacement = "stack",
  anchorId,
}: {
  heading: string;
  value?: ReactNode;
  valuePlacement?: SettingsValuePlacement;
  /** Fragment target on the heading itself — *inside* the `<details>`, so a
   * hard navigation's reveal algorithm opens the row on its way to it, and so
   * the rail's scroll-spy has one measurable element per section. */
  anchorId?: string;
}) {
  // A heading nested in a `<summary>` (implicit `button` role) is flattened
  // by some screen readers' heading navigation — a known trade, kept because
  // the whole row must be the disclosure control and the visual hierarchy
  // still needs the h3 level (the door rows' h3s remain navigable).
  //
  // On a phone the value stacks under the heading at full width instead of
  // truncating beside it — the row exists to *state* the answer, and the
  // dock test's device is exactly where an email or address would otherwise
  // be cut to "hello@demo.inva…". From `sm` up it is never cut either: it
  // wraps in its own column, ending at the caret, and the row grows. It used
  // to `truncate` there, and at 640–767px and 1024–1279px, where the pane is
  // narrowest, Contact, Profile and Diving options were ellipsised.
  //
  // **A row with no value is its heading line alone on a phone.** The value's
  // wrapper used to render regardless, holding only the desktop caret, which
  // is `hidden` below `sm`: the wrapper collapsed to 0px and still took the
  // column's `gap-1`, so the pixel probe measured "The counter card" and every
  // other valueless label 2px above its row's centre. Without a value the
  // caret is the summary's own last item instead, and `hidden` takes it out
  // of the phone's column entirely; from `sm` up it sits at the row's end,
  // where the wrapper used to put it.
  //
  // **A badge value stays on the heading's line** (`valuePlacement="inline"`).
  // Stacked, a text value's line carries half-leading under its baseline, so
  // the column still looks centred; a `Badge` paints its whole 28px box, that
  // air is gone, and "Online payments" over "Not connected" sat 2.5px low in
  // its row. A status pill is word-sized, so it takes the heading line's end
  // on a phone — the place it holds from `sm` up, where the heading line then
  // fills the row so the value and its caret end where every other row's do.
  // The pill is kept whole: the heading and it are one wrapping line, so where
  // the two do not fit ("Pagos en línea" and "Todavía no está lista" at 390,
  // "Online payments" and "Not connected" at 360) the pill drops under the
  // heading, where a stacked value sits, instead of both shrinking and the
  // pill's words breaking inside its rounded box. The caret stays at the end.
  const desktopCaret = (
    <DisclosureCaret
      direction="down"
      className="hidden text-muted group-open:rotate-180 sm:block"
    />
  );
  const phoneCaret = (
    <DisclosureCaret direction="down" className="text-muted group-open:rotate-180 sm:hidden" />
  );
  const inline = value != null && valuePlacement === "inline";
  const headingElement = (
    <h3
      id={anchorId}
      className={`scroll-mt-24 text-base font-medium ${inline ? "min-w-0" : "sm:shrink-0"}`}
    >
      {heading}
    </h3>
  );
  return (
    <summary
      className={`flex min-h-14 cursor-pointer list-none flex-col justify-center gap-1 px-4 py-3 transition-brand [&::-webkit-details-marker]:hidden hover:bg-surface-sunken sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-5 ${LIST_ROW_SUMMARY_RING}`}
    >
      {inline ? (
        <span className="flex items-center gap-3 sm:flex-1">
          <span className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-4 gap-y-1">
            {headingElement}
            <span className="shrink-0 whitespace-nowrap text-sm text-muted">{value}</span>
          </span>
          {phoneCaret}
          {desktopCaret}
        </span>
      ) : (
        <span className="flex items-center justify-between gap-4">
          {headingElement}
          {phoneCaret}
        </span>
      )}
      {inline ? null : value != null ? (
        <span className="flex min-w-0 items-center gap-3">
          <span className="text-sm text-muted sm:text-end">{value}</span>
          {desktopCaret}
        </span>
      ) : (
        desktopCaret
      )}
    </summary>
  );
}

export function SettingsRow({
  sectionId,
  activeSection,
  onToggle,
  heading,
  value,
  valuePlacement,
  description,
  detail,
  children,
}: {
  /**
   * Which section of the hub this row is — the id `?saved=<id>` names, the id
   * the rail points at, and (through `settingsSectionFragment`) the `#anchor`
   * it answers to. One prop rather than three, so a row cannot be reopenable
   * by one mechanism and invisible to the others.
   */
  sectionId?: SectionId;
  /** The section `?saved=` named, if any: that row comes back open. */
  activeSection?: SectionId | null;
  /**
   * Told whether the row is now open, for the rare body that should not do its
   * work until somebody asks for it — `CounterQrCard`'s QR encoder is the one
   * caller, and ~50 KB of it. A row whose body is ordinary markup passes
   * nothing and stays a plain native disclosure. (The same prop, for the same
   * reason, as `CompactDisclosureRow`'s.)
   */
  onToggle?: (open: boolean) => void;
  heading: string;
  /** The current answer, stated at rest. Pass a `Badge` only for an exceptional state. */
  value?: ReactNode;
  /** `inline` for a `Badge` value, which sits on the heading's line on a phone too. */
  valuePlacement?: SettingsValuePlacement;
  /** What this setting is for — shown once the row is open. */
  description?: string;
  /** The longer once-interesting explanation, below the description when open. */
  detail?: string;
  children: ReactNode;
}) {
  const fragment = sectionId ? settingsSectionFragment(sectionId) : undefined;
  // **A row opens for one reason: the reader asked, or the save they just made
  // landed here.** "Online payments" used to force itself open whenever the
  // shop had no Stripe account — so the one row on a directory of twenty-seven
  // arrived expanded, showing a warning box its own summary already states as
  // "Not connected". A row that shouts is a row the eye learns to skip past.
  const open = Boolean(sectionId != null && activeSection === sectionId);
  const body = (
    <>
      <RowSummary
        heading={heading}
        value={value}
        valuePlacement={valuePlacement}
        anchorId={fragment}
      />
      <div className="px-4 pb-6 sm:px-5">
        {description ? <p className="text-sm text-muted">{description}</p> : null}
        {/* `mt-1` is the step down from a description; with none above it,
            the detail is the body's first line and starts where one would. */}
        {detail ? (
          <p className={description ? "mt-1 text-sm text-muted" : "text-sm text-muted"}>{detail}</p>
        ) : null}
        {children}
      </div>
    </>
  );
  if (fragment) {
    return (
      <AutoOpenDetails openOnHash={fragment} open={open} className="group scroll-mt-24">
        {body}
      </AutoOpenDetails>
    );
  }
  return (
    <details
      open={open}
      onToggle={onToggle ? (event) => onToggle(event.currentTarget.open) : undefined}
      className="group"
    >
      {body}
    </details>
  );
}

export function SettingsDoorRow({
  href,
  heading,
  external,
}: {
  href: string;
  heading: string;
  /** A `mailto:`/`https:` destination rather than an app route. */
  external?: boolean;
}) {
  // **Focus is ringed on the stretched overlay, the row a pointer has**, drawn
  // inset like a setting's summary (`LIST_ROW_SUMMARY_RING`) and bent into the
  // group's corners at either end, so a keyboard reader sees one ring shape
  // down the whole hub. The link's own ring is off, so focus is drawn once —
  // `RowLink` (src/components/ui/table.tsx) is the same pattern, and both are
  // named in `FOCUS_SHOWN_ELSEWHERE` (src/app/focus-ring.test.ts).
  const linkClass =
    "font-medium after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:focus-ring-inset group-first/door:after:rounded-t-panel group-last/door:after:rounded-b-panel";
  // The outer box is what the group's `divide-y` hangs its rule on, and the
  // row's height lives on the box inside it — the shape a setting has, whose
  // `<details>` takes the rule and whose `<summary>` is 56px. With `min-h-14`
  // on the bordered box, the rule came out of the 56px and every door drew 1px
  // shorter than the settings it sits among.
  return (
    <div className="group/door">
      <div className="relative flex min-h-14 items-center justify-between gap-4 px-4 py-3 transition-brand hover:bg-surface-sunken sm:px-5">
        <h3 className="min-w-0 text-base">
          {external ? (
            <a href={href} className={linkClass}>
              {heading}
            </a>
          ) : (
            <Link href={href} className={linkClass}>
              {heading}
            </Link>
          )}
        </h3>
        <DisclosureCaret direction="right" className="text-muted" />
      </div>
    </div>
  );
}
