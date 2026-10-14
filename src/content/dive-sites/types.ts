import type { DiveAreaCode } from "@/content/dive-areas";
import type { GlobalDiveSiteBriefing } from "@/db/schema";

export type DiveSiteTemplate = {
  slug: string;
  version: number;
  /** The `src/content/dive-areas.ts` area this site belongs to, and is counted against. */
  area: DiveAreaCode;
  /**
   * Where the facts came from: at least two independent public pages that
   * agree on the site's position and depth (a marine-park or agency list
   * first, an operator's or dive reference's page as the cross-check). The
   * briefing's words are DiveDay's own; these are what they were checked
   * against, and where to look when a shop says a number is wrong.
   */
  sources: readonly string[];
  briefing: GlobalDiveSiteBriefing;
};
