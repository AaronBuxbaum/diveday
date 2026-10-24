import type { PrintedMedicalAlerts } from "@/db/medical-alerts";

/**
 * **The key "Print with medical alerts" hands the words to this page under**
 * (issue #2990). A symbol, so no URL can set it: Next builds `searchParams`
 * from the query string, whose keys are strings, and a hand-typed
 * `?printedMedicalAlerts=` is just another string key this page never reads.
 * Only the print route (`trips/[id]/print/medical-alerts`), which checked the
 * printer and recorded one trail line per diver first, composes the page with
 * it, through `TripPacket`.
 */
export const PRINTED_MEDICAL_ALERTS: unique symbol = Symbol("printedMedicalAlerts");

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
  /** The words for a packet printed with them; see {@link PRINTED_MEDICAL_ALERTS}. */
  [PRINTED_MEDICAL_ALERTS]?: PrintedMedicalAlerts;
};
