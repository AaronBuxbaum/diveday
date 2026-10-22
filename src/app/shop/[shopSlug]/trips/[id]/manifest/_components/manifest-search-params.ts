/** What the manifest reads off its URL. */
export type ManifestSearchParams = {
  checkpoint?: string;
  buddyError?: string;
  buddies?: string;
  /**
   * **Not part of this route's URL contract.** The paper day
   * (`/shop/[shopSlug]/print`) composes this page once per departure of
   * today, and duplicate element ids there silently point every
   * `aria-labelledby` and `#roll-call-list` jump at the *first* departure's
   * section (`src/lib/element-id.ts`). A page component's props are pinned
   * to Next's `PageProps`, so an extra prop is a build error and this is the
   * one channel a composing surface has.
   *
   * Narrowed by `uuidParam` below rather than trusted: anything that is not
   * a departure id is dropped, so a hand-typed `?idPrefix=` on this route
   * changes nothing.
   */
  idPrefix?: string;
};
