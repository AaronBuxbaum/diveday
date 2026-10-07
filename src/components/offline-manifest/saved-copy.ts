import type { OfflineManifestEnvelope } from "@/lib/offline-manifests";

/**
 * The saved copy this view is showing on `?trip=<id>`, and what happened to it.
 *
 * A reducer, and not three `useState`s, for one reason: **"the store says this
 * record is gone" and "whose record was it" are answered in different places
 * and can arrive in either order**, and the wrong answer to the second one is a
 * disclosure. The purge round below learns the first from an async callback,
 * which cannot see React state; the second can only be read from state. Before
 * this, the round bridged that gap by reading a ref mirroring `envelope`,
 * written from an effect — and a mirror written from an effect lags its own
 * commit, so the round's `null` read did not *defer* the repaint, it skipped it:
 *
 * - Between a commit and its passive effects the mirror is stale. The purge's
 *   read landed there often enough to be a measured CI flake.
 * - Worse on a real tablet, where the tenant lookup is a warm request and the
 *   store is a cold IndexedDB open plus an AES-GCM decrypt: an entire purge
 *   round — delete included — can finish before `?trip=<id>`'s opening read has
 *   resolved at all. Nothing has painted, so the mirror is honestly `null`, and
 *   the read already in flight then paints the record the purge just deleted.
 *   Another shop's divers, emergency contacts and readiness blockers, on a
 *   tablet signed in as someone else, with Board buttons that can only throw —
 *   the F5 disclosure the repaint exists to end, restored one microtask later.
 *
 * Both orderings are the same defect, and a reducer removes it rather than
 * narrowing it: whichever half arrives second is applied to the half already
 * held, in one transition, against the state React actually has. The invariant
 * it keeps is the whole point — **once `goneUnderTenant` is set, `envelope` is
 * `null` and stays `null`** — so no read that was in flight when the record was
 * deleted can put it back on screen.
 *
 * That latch is per **mount**, and safely so: this shell is one trip per mount.
 * The list links to `?trip=<id>` with a plain `<a href>`, and `manifest-sw.js`
 * replays a cached *document*, so both are full loads — `tripId` never changes
 * under a live mount. The `checkpoint` state below already banks the same
 * assumption in its `useState` initialiser. A client-side navigation between
 * two trips would need this state reset with it, exactly as it would need that.
 */
export type SavedCopyState = {
  /** The decrypted copy on screen. Cleared the moment the store says it is gone. */
  envelope: OfflineManifestEnvelope | null;
  /**
   * The shop signed in on this device when a purge round positively answered
   * "gone" for this trip. Also the latch that keeps a late read out.
   */
  goneUnderTenant: string | null;
  /**
   * Whose copy vanished: `true` for another shop's, `false` for this shop's own
   * record aging out, `null` for nothing lost — a `?trip=` this device simply
   * never saved reaches the plain empty state, not an accusation.
   */
  removedForOtherShop: boolean | null;
};

export type SavedCopyAction =
  | { type: "loaded"; envelope: OfflineManifestEnvelope | null }
  | { type: "gone"; tenant: string };

export function savedCopyReducer(state: SavedCopyState, action: SavedCopyAction): SavedCopyState {
  switch (action.type) {
    case "loaded":
      if (state.goneUnderTenant === null) return { ...state, envelope: action.envelope };
      // The store already answered "gone" for this trip, and this read was
      // issued before it did. It is the only thing that can say whose copy was
      // lost, so it names the loss — and is never shown.
      return {
        ...state,
        envelope: null,
        removedForOtherShop:
          action.envelope === null
            ? state.removedForOtherShop
            : action.envelope.snapshot.shop.slug !== state.goneUnderTenant,
      };
    case "gone":
      return {
        envelope: null,
        goneUnderTenant: action.tenant,
        removedForOtherShop:
          state.envelope === null
            ? state.removedForOtherShop
            : state.envelope.snapshot.shop.slug !== action.tenant,
      };
  }
}
