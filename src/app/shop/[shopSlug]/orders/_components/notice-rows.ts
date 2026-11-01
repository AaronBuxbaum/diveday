import { tapTargetLinkClass } from "@/components/ui/button";

/** Keeps the 44px link target on the text baseline (K-389). */
export const OPEN_TRIP_LINE = "inline-flex h-5 items-center";
export const OPEN_TRIP_LINK = `${tapTargetLinkClass} font-medium text-primary underline underline-offset-2`;

/** A 24px row gap separates adjacent 44px targets (K-389). */
export const NOTICE_ROWS = "mt-3 space-y-6 text-sm";

/**
 * A notice row's separator, bound by a no-break space to the word before it,
 * so a wrapped line ends after a dot and never opens on one (K-569).
 */
export const FACT_SEPARATOR = "\u00A0· ";
