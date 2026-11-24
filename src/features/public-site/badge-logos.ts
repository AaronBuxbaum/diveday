import type { BrandBadgeCode } from "@/lib/brand";

/**
 * The official logo shown beside a badge's words (owner decision 2026-11-23,
 * H-20261123-badge-logos-shipped). One entry per code that has an official
 * file; a code with no entry keeps the text-and-shield badge. Where each file
 * came from, and when, is `public/badges/SOURCES.md`.
 *
 * **Falling back is a one-line change**: delete the code's line here and the
 * badge reads as text again, with no other edit (legal review is #4938). A mark
 * is never redrawn, recolored or cropped; `tone` is only the ground it sits on,
 * because the file is what the organization published (NAUI's is white type on
 * transparent and needs a dark ground, the others need a light one).
 */
export type BadgeLogo = {
  /** Under `public/`. */
  readonly src: string;
  readonly width: number;
  readonly height: number;
  /** The ground the published file was drawn for. */
  readonly tone: "light" | "dark";
};

export const BADGE_LOGOS: Partial<Record<BrandBadgeCode, BadgeLogo>> = {
  ssi_diamond: { src: "/badges/ssi_diamond.png", width: 322, height: 173, tone: "light" },
  naui_pro: { src: "/badges/naui_pro.png", width: 200, height: 47, tone: "dark" },
  tripadvisor: { src: "/badges/tripadvisor.svg", width: 3354, height: 713, tone: "light" },
  blue_star: { src: "/badges/blue_star.png", width: 300, height: 300, tone: "light" },
  dan_partner: { src: "/badges/dan_partner.svg", width: 230, height: 48, tone: "light" },
};
