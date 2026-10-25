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

/**
 * **The key the trip packet composes this page under, as paper** (B03, B55).
 * A symbol for the same reason as {@link PRINTED_MEDICAL_ALERTS}: no URL can
 * set it. Under it the manifest and prep pages render only what a printed
 * sheet carries (the souls-on-board line, the boat check's printed list, the
 * printed rows, the boat's procedure), so the packet's screen view is the
 * paper and holds no control a captain could tap. Only `TripPacket` passes it.
 */
export const PAPER_PACKET: unique symbol = Symbol("paperPacket");

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
  /** Composed as the packet's paper; see {@link PAPER_PACKET}. */
  [PAPER_PACKET]?: true;
};
