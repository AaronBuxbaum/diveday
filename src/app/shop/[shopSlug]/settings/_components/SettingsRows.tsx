import Link from "next/link";
import type { ReactNode } from "react";
import { AutoOpenDetails } from "@/components/AutoOpenDetails";
import { SectionCard } from "@/components/ui/card";

/**
 * The settings directory's row vocabulary — the same "summary first, form on
 * intent" grammar the trip Overview's `EditDisclosure` established, pushed to
 * its conclusion: the whole row is the disclosure control, and at rest the row
 * *states its current value* instead of showing the form that would change it.
 *
 * Three shapes, one anatomy (heading left, answer right, chevron):
 *
 * - `SettingsRowList` — one bordered surface per group, hairlines between rows.
 * - `SettingsRow` — an editable setting: `<summary>` = heading + current value;
 *   opening reveals the description and the form in place.
 * - `SettingsDoorRow` — a destination: the heading is the link and the whole
 *   row is its tap target (stretched overlay), chevron pointing onward.
 *
 * The `<summary>` carries no focusable descendants — an interactive element
 * nested in a `<summary>` fails axe's nested-interactive rule (see
 * `EditDisclosure`); detail prose that used to hide behind an `InfoHint`
 * button renders as plain text inside the open state instead, where the
 * reader has already asked for more.
 */
export function SettingsRowList({ children }: { children: ReactNode }) {
  // The card, as a shell: `padding="none"` because each row pads itself, and
  // `overflow-hidden` so a row's hover fill is clipped by the corner radius
  // rather than squaring it off. Elevation follows containment, the same rule
  // `Table` and `ShopStat` keep — this list *is* the surface, so it is raised.
  return (
    <SectionCard as="div" padding="none" className="divide-y divide-border overflow-hidden">
      {children}
    </SectionCard>
  );
}

function Chevron({
  direction,
  className = "",
}: {
  direction: "down" | "forward";
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      aria-hidden="true"
      className={`${
        direction === "down"
          ? "size-4 shrink-0 text-muted transition-transform duration-200 group-open:rotate-180"
          : "size-4 shrink-0 -rotate-90 text-muted"
      } ${className}`.trim()}
    >
      <path d="m6 8 4 4 4-4" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RowSummary({
  heading,
  value,
  anchorId,
}: {
  heading: string;
  value?: ReactNode;
  /** Fragment target on the heading itself — *inside* the `<details>`, so a
   * hard navigation's reveal algorithm opens the row on its way to it. */
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
        <Chevron direction="down" className="sm:hidden" />
      </span>
      <span className="flex min-w-0 items-center gap-3">
        {value != null ? <span className="text-sm text-muted sm:truncate">{value}</span> : null}
        <Chevron direction="down" className="hidden sm:block" />
      </span>
    </summary>
  );
}

export function SettingsRow({
  heading,
  value,
  description,
  detail,
  open,
  openOnHash,
  anchorId,
  children,
}: {
  heading: string;
  /** The current answer, stated at rest. Pass a `Badge` only for an exceptional state. */
  value?: ReactNode;
  /** What this setting is for — shown once the row is open. */
  description?: string;
  /** The longer once-interesting explanation, below the description when open. */
  detail?: string;
  /** Server-decided initial state — true when this section just saved, so its notice is visible. */
  open?: boolean;
  /** Renders through `AutoOpenDetails` so a deep link to this fragment opens the row. */
  openOnHash?: string;
  /** Fragment target rendered on the row's heading, inside the disclosure. */
  anchorId?: string;
  children: ReactNode;
}) {
  const body = (
    <>
      <RowSummary heading={heading} value={value} anchorId={anchorId} />
      <div className="px-4 pb-6 sm:px-5">
        {description ? <p className="text-sm text-muted">{description}</p> : null}
        {detail ? <p className="mt-1 text-sm text-muted">{detail}</p> : null}
        {children}
      </div>
    </>
  );
  if (openOnHash) {
    return (
      <AutoOpenDetails openOnHash={openOnHash} open={open} className="group scroll-mt-24">
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
  description,
  external,
}: {
  href: string;
  heading: string;
  description: string;
  /** A `mailto:`/`https:` destination rather than an app route. */
  external?: boolean;
}) {
  // The global :focus-visible ring stays on the link itself (a keyboard
  // reader sees the ring around the row's name), while the stretched overlay
  // makes the whole row the pointer target.
  const linkClass = "font-medium after:absolute after:inset-0 after:content-['']";
  return (
    <div className="relative flex min-h-14 items-center justify-between gap-4 px-4 py-3 transition-brand hover:bg-surface-sunken sm:px-5">
      <div className="min-w-0">
        <h3 className="text-base">
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
        <p className="mt-0.5 text-sm text-muted">{description}</p>
      </div>
      <Chevron direction="forward" />
    </div>
  );
}
