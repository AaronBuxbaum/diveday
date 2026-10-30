"use client";

import { useOnline } from "@/components/use-online";
import { ARRIVAL_MAP_PROBES } from "@/lib/maps";
import { useMapReachable } from "./use-map-reachable";

/**
 * **The meeting point's map, only once it can load** (third UX review item
 * 27, fourth review item 4). An embedded map is a live third-party frame: at
 * a marina with one bar, behind a captive portal or on a carrier that blocks
 * the host, it drew a 16:9 block of gray above the address. So it is never in
 * the server's HTML (the HTML the phone keeps), it appears only once the map
 * host has answered the same probe the dive-site map uses
 * (`useMapReachable`), and it steps aside when the connection drops. The
 * address and "Open in maps" beneath it carry the card on their own.
 */
export function ArrivalMap({ title, src }: { title: string; src: string }) {
  const reachable = useMapReachable(true, ARRIVAL_MAP_PROBES);
  const online = useOnline();
  if (!reachable || !online) return null;
  return (
    /* Inset to the card's own rhythm rather than bled to its edge, so it
       stands in exactly where the shop's photo would.

       **`no-referrer`, not `strict-origin-when-cross-origin`.** An element's
       own `referrerpolicy` overrides the document's, and the one caller is
       `/ready/[token]`, which `TOKEN_ROUTE_PREFIXES`
       (`src/lib/security-headers.ts`) serves under `Referrer-Policy:
       no-referrer` precisely because a bearer-token route has "no legitimate
       cross-origin use" for a referrer at all, not even the origin-only form.
       A map embed needs no referrer, so it asks for none
       (docs/engineering/capability-telemetry-runbook.md). */
    <iframe
      title={title}
      src={src}
      loading="lazy"
      referrerPolicy="no-referrer"
      className="mb-5 block aspect-[16/9] w-full rounded-inset border-0 bg-surface-sunken print:hidden"
    />
  );
}
