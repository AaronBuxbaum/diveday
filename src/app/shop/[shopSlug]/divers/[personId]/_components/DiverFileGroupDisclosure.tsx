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
 *
 * **No outer margin, and no prop to hang one on.** The record stacks its
 * groups on one `space-y-10` (forms-and-controls.md, "Section rhythm"). A
 * `className` used to let each group bring its own, and five brought `mt-8`,
 * one `mt-10` and the shelf none, which the pixel probe measured as a
 * 32/40/32/32/0/32px stack with two rows sharing a hairline.
 */
export function DiverFileGroupDisclosure({
  id,
  label,
  summary,
  summaryTone = "muted",
  open = false,
  stacked = false,
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
      // …and tell React, so its own idea of `open` cannot disagree with the
      // element's. The `toggle` this mutation fires is asynchronous, and until
      // it lands React still believes the group is shut.
      setIsOpen(true);
      // **The scroll waits for the body to be there.** `open` lands at once,
      // but the group's body arrives on a transition: `::details-content` goes
      // from `content-visibility: hidden` to visible a frame or so later
      // (globals.css, "the disclosure's body arrives"), and a `scrollIntoView`
      // aimed into a subtree the renderer is still skipping moves nothing at
      // all — no scroll, no error, and the control the fix promised sits one
      // line below the fold. Measured, not guessed: a single
      // `requestAnimationFrame` won three runs in five under a full-suite load
      // (`e2e/divers.spec.ts`, "the status ledger's fix lands on the control
      // that clears it"), and the probe showed the target's chain reading
      // `open=true cv=hidden` at the moment of the losing call. So the scroll
      // is deferred, frame by frame, until `checkVisibility()` says the target
      // is rendered — bounded, so a target that is hidden for some other
      // reason cannot hold a frame loop open.
      let framesWaited = 0;
      const scrollOnceRendered = () => {
        const rendered =
          typeof target.checkVisibility === "function" ? target.checkVisibility() : true;
        if (!rendered && framesWaited < 60) {
          framesWaited += 1;
          window.requestAnimationFrame(scrollOnceRendered);
          return;
        }
        target.scrollIntoView({ block: "nearest" });
        const focusTarget =
          target instanceof HTMLElement && target.tabIndex >= 0
            ? target
            : target.querySelector<HTMLElement>(
                "button, a, input, select, textarea, [tabindex]:not([tabindex='-1'])",
              );
        focusTarget?.focus({ preventScroll: true });
      };
      window.requestAnimationFrame(scrollOnceRendered);
    };

    openHashTarget();
    window.addEventListener("hashchange", openHashTarget);
    return () => window.removeEventListener("hashchange", openHashTarget);
  }, []);

  // `flex-wrap` rather than a phone-only column: the caret and the label keep
  // the first line and only the fact drops beneath them, which a `flex-col`
  // would have put the caret on a line of its own to achieve.
  //
  // From `sm` up a stacked fact shares the label's line, and it is the fact
  // that gives way: the label keeps its one-line width (`sm:min-w-max`) and
  // the fact shrinks and wraps beside it. The other way round, a `sm:shrink-0`
  // fact beside a `min-w-0` label, an unverified card's long amber sentence
  // crushed "Certification records" into a 20px box at 640 and ran its words
  // under the fact (the pixel probe's `text-spill`).
  const summaryLayoutClass = stacked ? "max-sm:flex-wrap max-sm:py-2" : "";
  const labelFloorClass = stacked ? "min-w-0 sm:min-w-max" : "min-w-0";
  const toneClass = summaryTone === "warning" ? "font-medium text-warning-strong" : "text-muted";
  const summaryFactClass = stacked
    ? `min-w-0 max-w-full text-sm ${toneClass} tabular-nums max-sm:ms-6 max-sm:basis-full max-sm:whitespace-normal max-sm:break-words sm:text-end`
    : `shrink-0 text-sm ${toneClass} tabular-nums`;

  return (
    <section aria-label={label}>
      <details
        ref={detailsRef}
        // `|| undefined` rather than a bare `false`: React writes an attribute
        // it has been given and removes one it has not, so a literal
        // `open={false}` makes this element React's to drive — and the reveal
        // a fragment navigation performs on a closed ancestor then has React
        // holding the opposite opinion. Undefined leaves the element alone,
        // which is the resting state every reader's own tap lives in.
        open={isOpen || undefined}
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
          <h2 id={id} className={`${labelFloorClass} flex-1 scroll-mt-24 text-base font-medium`}>
            {label}
          </h2>
          <span className={summaryFactClass}>{summary}</span>
        </summary>
        <div id={`${id}-content`}>{children}</div>
      </details>
    </section>
  );
}
