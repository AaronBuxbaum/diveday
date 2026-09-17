"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";

/**
 * **One door per file group, at every width.**
 *
 * Every group in the diver's file — certification records, waiver, gear and
 * sizes, shelf, notes, dive support, conversation, activity — is a row that
 * states its one useful fact and opens on request. There is no second mode.
 *
 * It had one until this sweep: "legacy" groups hid their summary above `sm`
 * and rendered open as cards under a second, uppercase copy of the row's own
 * label, while the newer groups stayed doors at every width. Two grammars
 * interleaved down one page, so the desktop record read as a stack of open
 * forms with closed rows wedged between them — and the phone, which had only
 * ever had the doors, was the cleaner page. The doors won.
 *
 * A group's summary is its one useful fact, not a second version of the group,
 * and `open` is spent only on work the staffer came for (a notice aimed at the
 * group, an unanswered message, a held medical review, a refused fit). Long
 * facts opt into `stacked` so they take a full-width line beneath the label on
 * a phone.
 *
 * The label is the group's heading and carries the group's fragment id, so the
 * `?notice=` redirects (`#gear`, `#waiver`, `#notes`, …) and the prep panel's
 * `#support` land on it — and `openHashTarget` below opens whichever group
 * holds the target, which is what makes a deep link into a closed door work.
 */
export function DiverFileGroupDisclosure({
  id,
  label,
  summary,
  summaryTone = "muted",
  open = false,
  stacked = false,
  className = "",
  children,
}: {
  id: string;
  label: string;
  summary: string;
  /**
   * `warning` for a summary standing on somebody's *word* rather than on
   * anything the shop has seen — the treatment `certificationSummaryUnchecked`
   * already earns on the wait list and the deal list, and the reason the
   * glossary says a self-declared card "must never be scanned as a plain
   * level". The words carry the fact on their own (principle 6); the ink only
   * has to stop contradicting them.
   *
   * `-strong` because this component cannot know what it is mounted on, and
   * raw `text-warning` fails AA on `bg-surface-sunken` — the same call
   * `ledger.tsx` documents at length.
   */
  summaryTone?: "muted" | "warning";
  open?: boolean;
  /** Put a long summary on its own, label-aligned line below `sm`. */
  stacked?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  /**
   * **The server's `open` is a floor, not a state.**
   *
   * `open` says this group carries work the staffer came for, and a plain
   * `<details open={…}>` would drive the element both ways: a capture form
   * redirects with a `?notice=` that opens the group, the one-tap review beside
   * it then re-renders the record without one, and React takes the attribute
   * back off — shutting the group on somebody who is still working in it
   * (`e2e/certifications.spec.ts`'s capture-then-verify flow). Held here, the
   * server can open the group and never close it, which is the same rule
   * `openHashTarget` below already follows and `AutoOpenDetails` states for the
   * hash: "the hash check can only ever open, never close, so the two compose".
   *
   * `onToggle` keeps the reader's own tap, in either direction: the state is
   * theirs once the page has told them what it had to.
   */
  const [isOpen, setIsOpen] = useState(open);

  useEffect(() => {
    if (open) setIsOpen(true);
  }, [open]);

  useEffect(() => {
    const openHashTarget = () => {
      const rawHash = window.location.hash.slice(1);
      if (!rawHash || !detailsRef.current) return;

      let targetId = rawHash;
      try {
        targetId = decodeURIComponent(rawHash);
      } catch {
        // Keep the raw hash if a malformed escape was supplied.
      }

      const target = document.getElementById(targetId);
      if (!target || !detailsRef.current.contains(target)) return;

      detailsRef.current.open = true;
      window.requestAnimationFrame(() => {
        target.scrollIntoView({ block: "nearest" });
        const focusTarget =
          target instanceof HTMLElement && target.tabIndex >= 0
            ? target
            : target.querySelector<HTMLElement>(
                "button, a, input, select, textarea, [tabindex]:not([tabindex='-1'])",
              );
        focusTarget?.focus({ preventScroll: true });
      });
    };

    openHashTarget();
    window.addEventListener("hashchange", openHashTarget);
    return () => window.removeEventListener("hashchange", openHashTarget);
  }, []);

  // `flex-wrap` rather than a phone-only column: the caret and the label keep
  // the first line and only the fact drops beneath them, which a `flex-col`
  // would have put the caret on a line of its own to achieve.
  const summaryLayoutClass = stacked ? "max-sm:flex-wrap max-sm:py-2" : "";
  const toneClass = summaryTone === "warning" ? "font-medium text-warning-strong" : "text-muted";
  const summaryFactClass = stacked
    ? `min-w-0 max-w-full text-sm ${toneClass} tabular-nums max-sm:ms-6 max-sm:basis-full max-sm:whitespace-normal max-sm:break-words sm:shrink-0 sm:text-end`
    : `shrink-0 text-sm ${toneClass} tabular-nums`;

  return (
    <section aria-label={label} className={className || undefined}>
      <details
        ref={detailsRef}
        open={isOpen}
        onToggle={(event) => setIsOpen(event.currentTarget.open)}
        className="group/diver-file"
        data-testid={`diver-file-group-${id}`}
      >
        {/* `<summary>` takes phrasing content intermixed with heading content,
            which is what lets the row's own label be the group's `<h2>` — one
            heading per group rather than the row label plus a second, uppercase
            copy of it inside. */}
        <summary
          aria-controls={`${id}-content`}
          className={`flex min-h-11 cursor-pointer items-center gap-3 border-y border-border px-1 py-3 group-open/diver-file:border-b-0 ${summaryLayoutClass}`.trim()}
        >
          <DisclosureCaret className="shrink-0 text-muted group-open/diver-file:rotate-90" />
          <h2 id={id} className="min-w-0 flex-1 scroll-mt-24 text-base font-medium">
            {label}
          </h2>
          <span className={summaryFactClass}>{summary}</span>
        </summary>
        <div id={`${id}-content`}>{children}</div>
      </details>
    </section>
  );
}
