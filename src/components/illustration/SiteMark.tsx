import type { ReefDrawingCode } from "@/lib/site-mark";

/**
 * A departure's drawn site mark — Reef's illustration hand, first use (ADR
 * 20260901-diveday-reimagined, decision 1, slice 13f) — and the tile every
 * other creature in the hand is drawn on.
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
 * refusal — and `illustration.test.ts` walks the tree to hold it there.
 *
 * **The coral detail is budgeted, not automatic.** The system sheet allows a
 * surface "one drawn creature's single warm detail", and a spine of three
 * boats or a week board of twenty is not one creature: the caller says which
 * mark carries it (`coral`), and the rest are drawn in the line alone. The
 * home gives it to the next boat out; the board gives it to none.
 */
export const SITE_MARK_SIZES = {
  /** The week board's 150px column: a 44×30 tile. */
  sm: { tile: "h-[30px] w-11 rounded-lg", svg: "h-[22px] w-[33px]" },
  /** The home spine's rail: an 84×60 tile at the inset rung, the board's own size. */
  md: { tile: "h-[60px] w-[84px] rounded-inset", svg: "h-[42px] w-[60px]" },
  /** The recap postcard's face: a 120×84 tile (slice 13i). */
  lg: { tile: "h-[84px] w-[120px] rounded-inset", svg: "h-[60px] w-[84px]" },
} as const;

/**
 * What the tile sits on, and the ink and the fill that go with it. The lagoon
 * wash is the tile's own ground everywhere a mark sits on the page; on a
 * surface that *is* the wash — the postcard's band — the tile takes the shell
 * instead, so the drawing keeps an edge; and `deep` swaps wash and ink for a
 * boat that leaves after dark (`siteMarkGroundFor`). A prop rather than a
 * `className` override, because two `bg-*` utilities on one element resolve
 * by Tailwind's emit order, not by the caller's intent (the `buttonClass`
 * lesson in AGENTS.md). `--site-mark-fill` is what a drawing's closed shapes
 * (a shell, a bubble) are filled with — the ground's own colour, so a fill
 * reads as a shape cut from the tile rather than a white blob at night.
 */
export const SITE_MARK_GROUNDS = {
  tint: "bg-primary-tint text-primary-hover [--site-mark-fill:var(--surface)]",
  surface: "bg-surface text-primary-hover [--site-mark-fill:var(--surface)]",
  deep: "bg-primary-hover text-primary-tint [--site-mark-fill:var(--primary-hover)]",
} as const;

export type SiteMarkGround = keyof typeof SITE_MARK_GROUNDS;

export type SiteMarkSize = keyof typeof SITE_MARK_SIZES;

/** The lowest edge any tile has, in px — the canvas's floor for a drawing. */
export const SITE_MARK_MIN_PX = 20;

const CORAL = { fill: "var(--accent)", stroke: "none" } as const;
const FILL = "var(--site-mark-fill)";

/** The one warm detail, or nothing — never a second colour in its place. */
function CoralDetail({ cx, cy, coral }: { cx: number; cy: number; coral: boolean }) {
  return coral ? <circle cx={cx} cy={cy} r="3.2" {...CORAL} /> : null;
}

function Drawing({ mark, coral }: { mark: ReefDrawingCode; coral: boolean }) {
  switch (mark) {
    case "reef":
      // Parrotfish — the reef trip.
      return (
        <>
          <path
            d="M30 42c10-16 30-22 50-16 8 2 14 6 18 12-4 6-10 10-18 12-20 6-40 0-50-8Z"
            fill={FILL}
          />
          <path d="M30 42 16 30v24Z" fill={FILL} />
          <path d="M56 38c6-6 14-6 20 0M52 50c4 4 10 4 14 0" />
          <path d="M64 34c2 3 2 7 0 10M72 33c2 3 2 8 0 11" opacity=".55" />
          <path d="M98 38c3 2 3 6 0 8" />
          <circle cx="82" cy="37" r="2" fill="currentColor" stroke="none" />
          <circle cx="106" cy="26" r="2" opacity=".5" />
          <CoralDetail cx={44} cy={44} coral={coral} />
        </>
      );
    case "site":
      // Brain coral — the dive site.
      return (
        <>
          <path d="M22 62c0-19 16-33 38-33s38 14 38 33Z" fill={FILL} />
          <path d="M30 58c6-9 13-3 19-11 5-7 12-1 18-8M32 63c8-10 15-3 22-11 6-7 13-1 20-8M48 33c5 5 10 0 15 4" />
          <path d="M16 62h88" />
          <CoralDetail cx={104} cy={24} coral={coral} />
        </>
      );
    case "wreck":
      // The hull on its side, one porthole — the set's one addition, for the
      // wrecks Key Largo dives every week (see `site-mark.ts`).
      return (
        <>
          <path d="M20 34h14v14H20z" fill={FILL} />
          <path d="M34 36 96 20v42L34 46Z" fill="currentColor" fillOpacity=".14" />
          <path d="M62 36c6-3 12-3 16 1M62 48c6 3 12 3 16-1" />
          <circle cx="84" cy="40" r="2" fill="currentColor" stroke="none" />
          <CoralDetail cx={106} cy={18} coral={coral} />
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
          <CoralDetail cx={90} cy={20} coral={coral} />
        </>
      );
    case "turtle":
      // Green turtle — the all-clear.
      return (
        <>
          <path d="M32 52c0-14 13-24 30-24s30 10 30 24Z" fill={FILL} />
          <path d="M48 52c2-10 8-16 14-16s12 6 14 16M39 52c1-6 5-11 9-13M85 52c-1-6-5-11-9-13" />
          <path d="M92 50c6-1 10-4 11-8 0-3-3-5-7-5-4 0-7 3-8 6" />
          <circle cx="97" cy="43" r="1.3" fill="currentColor" stroke="none" />
          <path d="M42 54c-8 2-14 7-17 13M82 54c8 2 14 7 17 13M30 51c-4 1-6 4-6 8" />
          <path d="M22 66h80" />
          <CoralDetail cx={108} cy={22} coral={coral} />
        </>
      );
    case "open":
      // Bubble trail — open water, or a site with no name yet. Its coral is
      // the smallest bubble, so without the budget it is drawn in the line.
      return (
        <>
          <circle cx="36" cy="54" r="12" fill={FILL} />
          <circle cx="66" cy="34" r="8" fill={FILL} />
          {coral ? (
            <circle cx="90" cy="19" r="5" fill="var(--accent)" stroke="var(--accent-deep)" />
          ) : (
            <circle cx="90" cy="19" r="5" fill={FILL} />
          )}
          <path d="M18 72c6-6 10-10 14-16" opacity=".45" />
        </>
      );
  }
}

export function SiteMark({
  mark,
  size = "md",
  ground = "tint",
  coral = true,
  className = "",
}: {
  mark: ReefDrawingCode;
  size?: SiteMarkSize;
  ground?: SiteMarkGround;
  /** Whether this drawing carries the surface's one warm detail. */
  coral?: boolean;
  className?: string;
}) {
  const sizes = SITE_MARK_SIZES[size];
  return (
    <span
      aria-hidden="true"
      data-site-mark={mark}
      className={`inline-flex shrink-0 items-center justify-center ${SITE_MARK_GROUNDS[ground]} ${sizes.tile} ${className}`.trim()}
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
        <Drawing mark={mark} coral={coral} />
      </svg>
    </span>
  );
}
