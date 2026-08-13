"use client";

import { usePathname } from "next/navigation";
import { SegmentedControl } from "@/components/ui/SegmentedControl";

/**
 * The waiver surface's two tabs (task 155, UX persona assessment Lens 17):
 * Template is the shop's legal instrument; Signatures is the evidence every
 * completed release leaves behind, including any medical follow-up. They used
 * to be one long page — splitting them out gives the signed-record evidence
 * its own reachable surface, one a blocker row can link straight to (see
 * `RosterSection.tsx`'s "View signed record" link).
 *
 * Reads the active tab from the pathname, matching `TripSubNav.tsx`'s pattern,
 * so it can live in the shared layout without re-rendering on every tab switch.
 */
export type WaiversSubNavCopy = {
  ariaLabel: string;
  template: string;
  signatures: string;
};

export function WaiversSubNav({
  shopSlug,
  copy,
  className = "",
}: {
  shopSlug: string;
  copy: WaiversSubNavCopy;
  className?: string;
}) {
  const root = `/shop/${shopSlug}/waivers`;
  const pathname = usePathname();
  const current: "template" | "signatures" =
    pathname === `${root}/signatures` || pathname.startsWith(`${root}/signatures/`)
      ? "signatures"
      : "template";

  const tabs = [
    { key: "template" as const, label: copy.template, href: root },
    { key: "signatures" as const, label: copy.signatures, href: `${root}/signatures` },
  ];

  return (
    <SegmentedControl
      ariaLabel={copy.ariaLabel}
      items={tabs}
      currentKey={current}
      fill
      className={className}
    />
  );
}
