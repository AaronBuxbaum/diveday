"use client";

import { usePathname } from "next/navigation";

/**
 * The sub-nav's Suspense fallback, shaped per route so nothing jumps when the
 * real nav streams in: the hub renders a single quiet anchor row, the six
 * sub-pages render the grouped pill card (see `SettingsSubNav`). A client
 * component because the shared `layout.tsx` renders it for every settings
 * route and only the pathname says which shape is coming.
 */
export function SettingsSubNavFallback() {
  const pathname = usePathname();
  const onHub = /\/settings\/?$/.test(pathname);
  if (onHub) {
    return (
      <div aria-hidden="true" className="mx-auto w-full max-w-3xl px-4 pt-8 sm:px-6 sm:pt-10">
        <div className="flex animate-pulse flex-wrap gap-1">
          <div className="h-11 w-24 rounded-lg bg-surface-sunken" />
          <div className="h-11 w-20 rounded-lg bg-surface-sunken" />
          <div className="h-11 w-36 rounded-lg bg-surface-sunken" />
        </div>
      </div>
    );
  }
  return (
    <div aria-hidden="true" className="mx-auto w-full max-w-5xl px-4 pt-8 sm:px-6 sm:pt-10">
      <div className="flex animate-pulse flex-col gap-3 rounded-2xl border border-border bg-surface-sunken p-3">
        <div className="h-11 w-24 rounded-xl bg-surface" />
        <div className="flex flex-wrap gap-2">
          <div className="h-11 w-20 rounded-xl bg-surface" />
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="h-11 w-28 rounded-xl bg-surface" />
          <div className="h-11 w-32 rounded-xl bg-surface" />
          <div className="h-11 w-24 rounded-xl bg-surface" />
          <div className="h-11 w-24 rounded-xl bg-surface" />
          <div className="h-11 w-20 rounded-xl bg-surface" />
        </div>
      </div>
    </div>
  );
}
