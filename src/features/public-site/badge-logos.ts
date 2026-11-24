import type { BrandBadgeCode } from "@/lib/brand";

/**
 * The official logo shown beside a badge's words (owner decision 2026-11-23,
 * H-20261123-badge-logos-shipped). One entry per code, and the type
 * requires it: a badge cannot exist without a logo (owner, 2026-11-24), so a new
 * code ships with its file. Where each file came from, and when, is
 * `public/badges/SOURCES.md`. If legal review (#4938) does not clear a mark, remove
 * the code, its file and its words together. A mark is never redrawn, recolored or cropped; `tone` is only the ground it sits on,
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

export const BADGE_LOGOS: Record<BrandBadgeCode, BadgeLogo> = {
  // Placeholders found online (owner, 2026-11-24), to be replaced by the official member files.
  // PADI 5 Star and PADI IDC share the plain PADI mark: no tier mark was found.
  padi_5_star: { src: "/badges/padi.svg", width: 180, height: 200, tone: "light" },
  padi_idc: { src: "/badges/padi.svg", width: 180, height: 200, tone: "light" },
  green_fins: { src: "/badges/green_fins.png", width: 256, height: 256, tone: "light" },
  ssi_diamond: { src: "/badges/ssi_diamond.png", width: 322, height: 173, tone: "light" },
  naui_pro: { src: "/badges/naui_pro.png", width: 200, height: 47, tone: "dark" },
  tripadvisor: { src: "/badges/tripadvisor.svg", width: 3354, height: 713, tone: "light" },
  blue_star: { src: "/badges/blue_star.png", width: 300, height: 300, tone: "light" },
  dan_partner: { src: "/badges/dan_partner.svg", width: 230, height: 48, tone: "light" },
};
