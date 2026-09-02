import type { SiteMarkCode } from "@/lib/site-mark";

/**
 * A departure's drawn site mark — Reef's illustration hand, first use (ADR
 * 20260901-diveday-reimagined, decision 1, slice 13f).
 *
 * One hand: a 1.7px line with round caps and joins, lagoon-deep ink on the
 * lagoon wash, one coral detail per drawing and never more. The stroke does
 * not scale with the tile (`vector-effect: non-scaling-stroke`), so the small
 * board tile and the home spine's tile are drawn with the same pen, and
 * neither is ever set below 20px — where a line stops reading and starts
 * looking like a dingbat.
 *
 * Decorative by contract: `aria-hidden`, beside a time and a title that carry
 * the fact. The ADR's illustration rule says where this may never appear — a
 * manifest, a roll call, a cert check, a waiver, a payment, or beside a
 * refusal — and `SiteMark.test.tsx` walks the tree to hold it there.
 */
export const SITE_MARK_SIZES = {
  /** The week board's 150px column: a 44×30 tile. */
  sm: { tile: "h-[30px] w-11 rounded-lg", svg: "h-[22px] w-[33px]" },
  /** The home spine's rail: a 60×42 tile, the canvas's own size. */
  md: { tile: "h-[42px] w-[60px] rounded-xl", svg: "h-8 w-12" },
} as const;

export type SiteMarkSize = keyof typeof SITE_MARK_SIZES;

/** The lowest edge any tile has, in px — the canvas's floor for a drawing. */
export const SITE_MARK_MIN_PX = 20;

const CORAL = { fill: "var(--accent)", stroke: "none" } as const;

function Drawing({ mark }: { mark: SiteMarkCode }) {
  switch (mark) {
    case "reef":
      // Brain coral — the dive site.
      return (
        <>
          <path d="M22 62c0-19 16-33 38-33s38 14 38 33Z" fill="var(--surface)" />
          <path d="M30 58c6-9 13-3 19-11 5-7 12-1 18-8M32 63c8-10 15-3 22-11 6-7 13-1 20-8M48 33c5 5 10 0 15 4" />
          <path d="M16 62h88" />
          <circle cx="104" cy="24" r="3.2" {...CORAL} />
        </>
      );
    case "wreck":
      // The hull on its side, one porthole.
      return (
        <>
          <path d="M20 34h14v14H20z" fill="var(--surface)" />
          <path d="M34 36 96 20v42L34 46Z" fill="currentColor" fillOpacity=".14" />
          <path d="M62 36c6-3 12-3 16 1M62 48c6 3 12 3 16-1" />
          <circle cx="84" cy="40" r="2" fill="currentColor" stroke="none" />
          <circle cx="106" cy="18" r="3.2" {...CORAL} />
        </>
      );
    case "course":
      // Sea fan — courses, learning.
      return (
        <>
          <path d="M60 74c0-14-2-22-5-28" />
          <path d="M55 46c-6-8-14-12-22-18M55 46c1-12 3-18 3-28M55 46c8-6 16-8 26-14" />
          <path d="M40 34c-6-2-10-6-12-10M46 28c0-6 1-10 0-14M58 30c4-4 8-6 13-8M64 38c6-2 11-4 16-8" />
          <path d="M33 28c-4 0-7-2-9-5M52 20c-2-4-2-7-2-10M70 24c2-4 5-6 8-8" />
          <path d="M50 74h20" />
          <circle cx="90" cy="20" r="3.2" {...CORAL} />
        </>
      );
    case "open":
      // Bubble trail — open water, or a site with no name yet.
      return (
        <>
          <circle cx="36" cy="54" r="12" fill="var(--surface)" />
          <circle cx="66" cy="34" r="8" fill="var(--surface)" />
          <circle cx="90" cy="19" r="5" fill="var(--accent)" stroke="var(--accent-deep)" />
          <path d="M18 72c6-6 10-10 14-16" opacity=".45" />
        </>
      );
  }
}

export function SiteMark({
  mark,
  size = "md",
  className = "",
}: {
  mark: SiteMarkCode;
  size?: SiteMarkSize;
  className?: string;
}) {
  const sizes = SITE_MARK_SIZES[size];
  return (
    <span
      aria-hidden="true"
      data-site-mark={mark}
      className={`inline-flex shrink-0 items-center justify-center bg-primary-tint text-primary-hover ${sizes.tile} ${className}`.trim()}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 120 80"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        className={sizes.svg}
      >
        <Drawing mark={mark} />
      </svg>
    </span>
  );
}
