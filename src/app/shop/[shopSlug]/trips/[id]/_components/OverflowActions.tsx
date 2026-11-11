// i18n-exempt-file: labels and content arrive translated from the caller.
"use client";

import { type ReactNode, useCallback, useId, useLayoutEffect, useRef, useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { MENU_PANEL } from "@/components/ui/menu";
import { useMenuDismissal } from "@/components/useMenuDismissal";

/** Keep actions visible until their actual widths no longer fit the available row. */
export function OverflowActions({
  primary,
  label,
  children,
}: {
  primary: ReactNode;
  label: string;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLDivElement>(null);
  const rest = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const [overflow, setOverflow] = useState(false);
  const [open, setOpen] = useState(false);
  const naturalWidth = useRef(0);
  const close = useCallback(() => setOpen(false), []);
  useMenuDismissal({ open, close, inside: [root], returnFocus: trigger });

  useLayoutEffect(() => {
    const measure = () => {
      if (!root.current || !first.current || !rest.current) return;
      // Closed overflow content stays mounted, invisible and inert, in its
      // natural single-row layout. Locale, font and zoom changes remeasure it
      // too; a viewport breakpoint cannot know which authorized doors exist.
      if (!open) naturalWidth.current = rest.current.scrollWidth;
      const gap = Number.parseFloat(getComputedStyle(root.current).columnGap) || 0;
      setOverflow(
        first.current.offsetWidth + gap + naturalWidth.current > root.current.clientWidth,
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    if (root.current) observer.observe(root.current);
    if (first.current) observer.observe(first.current);
    if (rest.current) observer.observe(rest.current);
    return () => observer.disconnect();
  }, [open]);

  useLayoutEffect(() => {
    if (!overflow) setOpen(false);
  }, [overflow]);

  useLayoutEffect(() => {
    if (open) rest.current?.querySelector<HTMLElement>("a, button")?.focus({ preventScroll: true });
  }, [open]);

  return (
    <div
      ref={root}
      data-overflow-actions=""
      className="relative flex w-full min-w-0 items-center gap-x-8 gap-y-2"
    >
      <div ref={first} className="shrink-0">
        {primary}
      </div>
      {overflow ? (
        <button
          ref={trigger}
          type="button"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          onClick={() => setOpen((was) => !was)}
          className={buttonClass({ variant: "secondary", size: "sm", className: "gap-2" })}
        >
          {label}
          <DisclosureCaret direction="down" className={open ? "rotate-180" : ""} />
        </button>
      ) : null}
      <div
        ref={rest}
        id={panelId}
        inert={overflow && !open ? true : undefined}
        aria-hidden={overflow && !open ? true : undefined}
        className={
          overflow
            ? open
              ? `absolute start-0 top-full z-20 mt-1 flex w-64 max-w-full flex-col px-2 ${MENU_PANEL} [&_a]:w-full [&_a]:justify-start [&_button]:w-full [&_button]:justify-start`
              : "invisible pointer-events-none absolute flex w-max flex-nowrap items-center gap-x-8"
            : "flex w-max shrink-0 flex-nowrap items-center gap-x-8"
        }
      >
        {children}
      </div>
    </div>
  );
}
