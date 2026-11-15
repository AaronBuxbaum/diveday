import type { ButtonSize } from "@/components/ui/button";

export const SIZES = [
  "sm",
  "md",
  "boat",
  "deck",
  "icon",
  "icon-sm",
] as const satisfies readonly ButtonSize[];

/** Labelled sizes whose horizontal padding participates in flush and edge policies. */
export const PADDED_SIZES = ["sm", "md", "boat", "deck"] as const satisfies readonly ButtonSize[];

export const EDGE_PADDING = {
  sm: ["px-2.75"],
  md: ["px-3.75"],
  boat: ["px-5.75"],
  deck: ["px-5.75"],
} as const;
