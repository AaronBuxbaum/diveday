"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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
    <nav
      aria-label={copy.ariaLabel}
      className={`flex gap-1 rounded-2xl border border-border bg-surface-sunken p-1 print:hidden ${className}`}
    >
      {tabs.map(({ key, label, href }) => {
        const active = key === current;
        const cls = `inline-flex min-h-11 flex-1 items-center justify-center rounded-xl px-3 text-sm font-semibold whitespace-nowrap transition-colors duration-200 ${
          active
            ? "bg-surface text-primary shadow-sm"
            : "text-muted hover:bg-surface hover:text-foreground"
        }`;
        return active ? (
          <span key={key} aria-current="page" data-tab-active="true" className={cls}>
            {label}
          </span>
        ) : (
          <Link key={key} href={href} className={cls}>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
