"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { tapTargetLinkClass } from "@/components/ui/button";
import { publicSchedulePath } from "@/lib/public-routes";

/** Mounted only after the server's live same-shop staff check. Path selects a return door. */
export function PublicStaffPreviewBar({
  shopSlug,
  words,
}: {
  shopSlug: string;
  words: { short: string; long: string; board: string; manage: string };
}) {
  const pathname = usePathname();
  // This layout can stream after the reader has already navigated to a trip.
  // Match the server's board door on hydration, then follow the live route.
  const [clientPathname, setClientPathname] = useState("");
  useEffect(() => setClientPathname(pathname), [pathname]);
  const prefix = `${publicSchedulePath(shopSlug)}/trips/`;
  const tail = clientPathname.startsWith(prefix) ? clientPathname.slice(prefix.length) : "";
  const tripId = tail && !tail.includes("/") ? tail : null;
  return (
    <div role="status" className="border-b border-border bg-surface-sunken">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-x-4 gap-y-1.5 px-4 py-1.5 text-sm sm:flex-wrap sm:px-6">
        <p className="flex min-w-0 items-center text-muted sm:min-h-11">
          <span className="sm:hidden">{words.short}</span>
          <span className="max-sm:hidden">{words.long}</span>
        </p>
        <Link
          href={tripId ? `/shop/${shopSlug}/trips/${tripId}` : `/shop/${shopSlug}/schedule/board`}
          className={`${tapTargetLinkClass} font-medium text-primary hover:underline`}
        >
          {tripId ? words.manage : words.board}
        </Link>
      </div>
    </div>
  );
}
