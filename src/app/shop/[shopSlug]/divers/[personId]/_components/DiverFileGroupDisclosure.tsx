"use client";

import { type ReactNode, useEffect, useRef } from "react";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";

/**
 * Diver record file groups use one native disclosure tree at every viewport.
 * Legacy groups become doors on a phone, while `desktopCollapsible` groups
 * retain their door on larger screens too. A group's summary is its one useful
 * fact, not a second version of the group.
 */
export function DiverFileGroupDisclosure({
  id,
  label,
  summary,
  open = false,
  desktopCollapsible = false,
  className = "",
  children,
}: {
  id: string;
  label: string;
  summary: string;
  open?: boolean;
  /** Keep the native door on larger screens too; legacy file groups stay open there. */
  desktopCollapsible?: boolean;
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
          className={`flex min-h-11 cursor-pointer items-center gap-3 border-y border-border px-1 py-3 ${summaryVisibility}`.trim()}
        >
          <DisclosureCaret className="shrink-0 text-muted group-open/diver-file:rotate-90" />
          <span className="min-w-0 flex-1 text-base font-medium">{label}</span>
          <span className="shrink-0 text-sm text-muted tabular-nums">{summary}</span>
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
