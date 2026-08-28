import Link from "next/link";
import type { ReactNode } from "react";
import { AutoOpenDetails } from "@/components/AutoOpenDetails";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { type SectionId, settingsSectionFragment } from "../settings-groups";

/**
 * The settings directory's row vocabulary — the same "summary first, form on
 * intent" grammar the trip Overview's `EditDisclosure` established, pushed to
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
 * `EditDisclosure`); detail prose that used to hide behind an `InfoHint`
 * button renders as plain text inside the open state instead, where the
 * reader has already asked for more.
 */

function RowSummary({
  heading,
  value,
  anchorId,
}: {
  heading: string;
  value?: ReactNode;
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
  // be cut to "hello@demo.inva…".
  return (
    <summary className="flex min-h-14 cursor-pointer list-none flex-col justify-center gap-1 px-4 py-3 transition-brand [&::-webkit-details-marker]:hidden hover:bg-surface-sunken sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-5">
      <span className="flex items-center justify-between gap-4">
        <h3 id={anchorId} className="scroll-mt-24 text-base font-medium sm:shrink-0">
          {heading}
        </h3>
        <DisclosureCaret direction="down" className="text-muted group-open:rotate-180 sm:hidden" />
      </span>
      <span className="flex min-w-0 items-center gap-3">
        {value != null ? <span className="text-sm text-muted sm:truncate">{value}</span> : null}
        <DisclosureCaret
          direction="down"
          className="hidden text-muted group-open:rotate-180 sm:block"
        />
      </span>
    </summary>
  );
}

export function SettingsRow({
  sectionId,
  activeSection,
  forceOpen,
  heading,
  value,
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
  /** A row that opens itself for a reason of its own (Stripe, unconnected). */
  forceOpen?: boolean;
  heading: string;
  /** The current answer, stated at rest. Pass a `Badge` only for an exceptional state. */
  value?: ReactNode;
  /** What this setting is for — shown once the row is open. */
  description?: string;
  /** The longer once-interesting explanation, below the description when open. */
  detail?: string;
  children: ReactNode;
}) {
  const fragment = sectionId ? settingsSectionFragment(sectionId) : undefined;
  const open = Boolean(forceOpen || (sectionId != null && activeSection === sectionId));
  const body = (
    <>
      <RowSummary heading={heading} value={value} anchorId={fragment} />
      <div className="px-4 pb-6 sm:px-5">
        {description ? <p className="text-sm text-muted">{description}</p> : null}
        {detail ? <p className="mt-1 text-sm text-muted">{detail}</p> : null}
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
    <details open={open} className="group">
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
  // The global :focus-visible ring stays on the link itself (a keyboard
  // reader sees the ring around the row's name), while the stretched overlay
  // makes the whole row the pointer target.
  const linkClass = "font-medium after:absolute after:inset-0 after:content-['']";
  return (
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
  );
}
