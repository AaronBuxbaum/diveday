/** Client-safe projection shared by UI and the feature store; no runtime database import. */

export type PublicReview = {
  id: string;
  rating: number;
  comment: string | null;
  isStandout: boolean;
  /** First name and last initial — the most a public page should say (`reviewerDisplayName`). */
  reviewer: string;
  /**
   * The reviewed departure's title, or null when it was a private charter: a
   * charter's name ("Smith family charter") is the party's, never the public
   * page's. The review itself still shows (#2318).
   */
  tripTitle: string | null;
  divedAt: Date;
  publishedAt: Date;
  /**
   * The shop's public answer under it (batch 4, K2), signed with the shop's
   * name — or null. Plain text; the renderer prints it as a text child.
   */
  reply: { body: string; shopName: string } | null;
};
