"use client";

import { type ReactNode, useEffect, useRef } from "react";
import { buttonClass } from "@/components/ui/button";

/**
 * **The one "Filters" button**: the chips live behind it, so the page opens as a
 * map, a search box and one control rather than a wall of them. It closes on a
 * tap outside, on Escape and on choosing a chip, because the map behind it is
 * what the choice is for.
 */
export function FiltersPopover({
  label,
  activeCount,
  children,
}: {
  label: string;
  activeCount: number;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = () => {
      if (ref.current) ref.current.open = false;
    };
    const onPointer = (event: PointerEvent) => {
      if (ref.current?.open && !ref.current.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, []);
  return (
    <details ref={ref} className="relative shrink-0">
      <summary
        className={`${buttonClass({ variant: "secondary" })} list-none gap-2 [&::-webkit-details-marker]:hidden`}
      >
        {label}
        {activeCount > 0 ? (
          <span className="grid size-5 place-items-center rounded-full bg-primary text-xs text-primary-foreground">
            {activeCount}
          </span>
        ) : null}
      </summary>
      {/* A tap on a chip follows its link; the popover then gets out of the way. */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: closes on a followed link only */}
      <div
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("a") && ref.current) ref.current.open = false;
        }}
        onKeyDown={undefined}
        className="absolute end-0 top-full z-30 mt-2 w-[min(24rem,calc(100vw-2rem))] space-y-4 rounded-xl border border-border bg-surface p-4 shadow-lg"
      >
        {children}
      </div>
    </details>
  );
}
