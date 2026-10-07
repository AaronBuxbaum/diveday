import { describe, expect, it } from "vitest";
import type { OfflineManifestEnvelope } from "@/lib/offline-manifests";
import { type SavedCopyState, savedCopyReducer } from "./saved-copy";

const EMPTY: SavedCopyState = { envelope: null, goneUnderTenant: null, removedForOtherShop: null };

function copyOf(shopSlug: string): OfflineManifestEnvelope {
  return {
    snapshot: { shop: { slug: shopSlug } },
    events: [],
    checklistEvents: [],
  } as unknown as OfflineManifestEnvelope;
}

/**
 * The saved copy's two answers — "here is the record" and "the store says it
 * is gone" — arrive in either order, and the wrong reading of the second is
 * another shop's divers on screen. Every ordering is pinned here.
 */
describe("savedCopyReducer", () => {
  it("shows a loaded copy while nothing has been purged", () => {
    const copy = copyOf("blue-mantis");
    const state = savedCopyReducer(EMPTY, { type: "loaded", envelope: copy });
    expect(state.envelope).toBe(copy);
    expect(state.removedForOtherShop).toBeNull();
  });

  it("clears the copy on screen when the store says it is gone, naming whose it was", () => {
    const shown = savedCopyReducer(EMPTY, { type: "loaded", envelope: copyOf("other-shop") });
    const gone = savedCopyReducer(shown, { type: "gone", tenant: "blue-mantis" });
    expect(gone).toEqual({
      envelope: null,
      goneUnderTenant: "blue-mantis",
      removedForOtherShop: true,
    });
  });

  it("calls this shop's own aged-out copy its own, not another shop's", () => {
    const shown = savedCopyReducer(EMPTY, { type: "loaded", envelope: copyOf("blue-mantis") });
    const gone = savedCopyReducer(shown, { type: "gone", tenant: "blue-mantis" });
    expect(gone.removedForOtherShop).toBe(false);
  });

  it("never paints a read that lands after the purge, but lets it say whose copy was lost", () => {
    const gone = savedCopyReducer(EMPTY, { type: "gone", tenant: "blue-mantis" });
    expect(gone.removedForOtherShop).toBeNull();

    const late = savedCopyReducer(gone, { type: "loaded", envelope: copyOf("other-shop") });
    expect(late.envelope).toBeNull();
    expect(late.removedForOtherShop).toBe(true);
    expect(late.goneUnderTenant).toBe("blue-mantis");

    // And the latch holds for every read after it.
    const later = savedCopyReducer(late, { type: "loaded", envelope: copyOf("blue-mantis") });
    expect(later.envelope).toBeNull();
  });

  it("leaves a trip this device never saved at the plain empty state", () => {
    const gone = savedCopyReducer(EMPTY, { type: "gone", tenant: "blue-mantis" });
    const nothing = savedCopyReducer(gone, { type: "loaded", envelope: null });
    expect(nothing.envelope).toBeNull();
    expect(nothing.removedForOtherShop).toBeNull();
  });
});
