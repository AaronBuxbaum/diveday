"use client";

import { type ReactNode, useEffect, useRef } from "react";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";

/**
 * Diver record file groups use one native disclosure tree at every viewport.
 * Legacy groups become doors on a phone, while `desktopCollapsible` groups
 * retain their door on larger screens too. A group's summary is its one useful
 * fact, not a second version of the group. Long facts can opt into `stacked`
 * so they get a full-width line beneath the group label on a phone.
 */
export function DiverFileGroupDisclosure({
  id,
  label,
  summary,
  open = false,
  desktopCollapsible = false,
  stacked = false,
  className = "",
  children,
}: {
  id: string;
  label: string;
  summary: string;
  open?: boolean;
  /** Keep the native door on larger screens too; legacy file groups stay open there. */
  desktopCollapsible?: boolean;
  /** Put a long summary on its own, label-aligned line below `sm`. */
  stacked?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);

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

  const summaryVisibility = desktopCollapsible ? "" : "sm:hidden";
  const contentVisibility = desktopCollapsible ? "" : "sm:!block";
  const desktopModeClass = desktopCollapsible ? "diver-file-group--desktop-collapsible" : "";
  const summaryLayoutClass = stacked
    ? "max-sm:flex-col max-sm:items-stretch max-sm:gap-1 max-sm:py-2"
    : "";
  const summaryGroupClass = stacked ? "max-sm:w-full" : "";
  const summaryFactClass = stacked
    ? "min-w-0 max-w-full text-sm text-muted tabular-nums max-sm:ms-6 max-sm:whitespace-normal max-sm:break-words sm:shrink-0 sm:text-end"
    : "shrink-0 text-sm text-muted tabular-nums";

  return (
    <section aria-label={label} className={className || undefined}>
      <details
        ref={detailsRef}
        open={open || undefined}
        className={`group/diver-file diver-file-group ${desktopModeClass}`.trim()}
        data-testid={`diver-file-group-${id}`}
      >
        <summary
          aria-controls={`${id}-content`}
          className={`flex min-h-11 cursor-pointer items-center gap-3 border-y border-border px-1 py-3 group-open/diver-file:border-b-0 ${summaryLayoutClass} ${summaryVisibility}`.trim()}
        >
          <span className={`flex min-w-0 items-center gap-3 ${summaryGroupClass} sm:flex-1`.trim()}>
            <DisclosureCaret className="shrink-0 text-muted group-open/diver-file:rotate-90" />
            <span className="min-w-0 flex-1 text-base font-medium">{label}</span>
          </span>
          <span className={summaryFactClass}>{summary}</span>
        </summary>
        <div
          id={`${id}-content`}
          className={`diver-file-group-content ${contentVisibility}`.trim()}
        >
          {children}
        </div>
      </details>
    </section>
  );
}
