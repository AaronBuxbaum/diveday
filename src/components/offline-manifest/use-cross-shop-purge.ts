import { type Dispatch, type MutableRefObject, type SetStateAction, useEffect } from "react";
import {
  listOfflineManifests,
  loadOfflineManifest,
  purgeOfflineManifestsExceptShop,
} from "@/lib/offline-manifest-store";
import type { OfflineManifestEnvelope } from "@/lib/offline-manifests";
import type { SavedCopyAction } from "./saved-copy";

/**
 * SEC-D3 (review 20260802). The cross-shop purge used to run only from
 * `OfflineManifestAutoSave`, which mounts in the *staff shop layout*. A
 * captain who lives on this shell — bookmarks it, opens it at the dock, never
 * navigates into `/shop/**` on that device — therefore never ran one, so a
 * shared or reassigned boat tablet kept the previous shop's roster
 * decryptable indefinitely.
 *
 * Deliberately its **own** effect rather than a step inside the list branch
 * below: the URL a captain actually bookmarks is the one the list links to,
 * `?trip=<id>`, and the one `manifest-sw.js` replays after a failed reload —
 * so a purge that ran only on the list branch would miss exactly the person
 * SEC-D3 is about (security review, 2026-08-06). Runs on both branches, and
 * again on every reconnect.
 *
 * It never blocks a render. The purge needs a server round trip to learn
 * which tenant this browser is signed in as, and on a marina connection that
 * can take as long as `fetchCurrentShopSlug`'s timeout allows — a captain
 * opening the roll call must never wait on it, which is the entire premise of
 * this surface. What SEC-D3 shortens is how *long* a foreign roster stays
 * decryptable, not the moment it stops being on screen.
 */
export function useCrossShopPurge({
  tripId,
  tenantSlugRef,
  resolveTenant,
  dispatchSaved,
  setList,
  refreshDiscarded,
}: {
  tripId: string;
  tenantSlugRef: MutableRefObject<string | null>;
  resolveTenant: () => Promise<string | null>;
  dispatchSaved: Dispatch<SavedCopyAction>;
  setList: Dispatch<SetStateAction<OfflineManifestEnvelope[] | null>>;
  refreshDiscarded: () => void;
}) {
  useEffect(() => {
    let cancelled = false;
    const purge = async () => {
      // Re-verified each round rather than read from the cache: a reconnect is
      // exactly when the signed-in shop may have changed, which is the event
      // this whole mechanism exists for.
      tenantSlugRef.current = null;
      const slug = await resolveTenant();
      if (cancelled || !slug) return;
      try {
        await purgeOfflineManifestsExceptShop(slug);
      } catch {
        // Best-effort, unlike the auto-save path, which fails its whole round
        // when the purge throws. There the alternative is writing a second
        // shop's rosters in beside the first; here the alternative is blanking
        // the list a captain is standing on the dock reading. Residency is
        // shortened when this succeeds and unchanged when it does not.
        return;
      }
      if (cancelled) return;
      // Re-read so a record the purge removed stops being displayed in this
      // round rather than at the next visit.
      //
      // **Both branches repaint, and the trip branch says why** (security
      // review, 2026-08-06, F5). This used to re-read only the list — the
      // `current === null ? current : saved` guard below is what confined it to
      // that branch — so on `?trip=<id>` the component kept rendering the
      // in-memory envelope of a record that no longer existed, and every Board
      // / Not-boarded button then raised `OfflineManifestError("unavailable")`:
      // a roster that looks fine at the dock, with dead buttons and a refusal
      // that explains nothing.
      //
      // The asymmetry was deliberate once — blanking the screen a captain is
      // actively reading is its own harm, which is why only the list, where a
      // vanished row costs a link rather than the working surface, repainted.
      // It does not survive what the record actually is. The cross-shop purge
      // can only delete a record belonging to a *different* shop than the
      // session this tablet now holds, so what stays on screen is another
      // shop's diver names, emergency contacts and readiness/medical blockers,
      // rendered with no session behind them — the exact exposure the purge
      // exists to end. And nothing on it can be acted on any more: a roster
      // that cannot record is worse than no roster, because it reads as a head
      // count being kept. Keeping it up would trade an ongoing disclosure for a
      // convenience the buttons can no longer deliver.
      //
      // So it repaints — but never to a bare "nothing saved on this phone",
      // which is the one thing the captain already knows is wrong. The empty
      // state names the cause: a different shop is signed in on this tablet.
      // Two things it will not do: blank on a *failed* read (only a store that
      // positively answers "gone" repaints), and blank a record that survived
      // the purge because it still holds unsynced evidence.
      //
      // All this round reports is what it found: gone, under this tenant. It
      // deliberately does not decide whether anything was *lost*, or what to
      // say about it — that needs the record this view is showing, and an
      // async callback cannot see React state. It used to bridge that with a
      // ref mirroring `envelope`, which lags its own commit and made the
      // repaint droppable in two different orderings; `savedCopyReducer` now
      // joins the two halves in whichever order they arrive. Read its doc
      // before changing this line.
      if (tripId) {
        const held = await loadOfflineManifest(tripId).catch(() => undefined);
        if (!cancelled && held === null) dispatchSaved({ type: "gone", tenant: slug });
      } else {
        await listOfflineManifests()
          .then((saved) => {
            if (!cancelled) setList((current) => (current === null ? current : saved));
          })
          // A failed refresh keeps the list we already rendered — stale beats
          // blank on a dock tablet; the next purge round retries anyway.
          .catch(() => {});
      }
      // A purge round is also when the store is most likely to have hit the
      // retention ceiling and thrown unsynced roll call away, so ask what was
      // lost right after it rather than only at mount.
      if (!cancelled) refreshDiscarded();
    };
    void purge();
    window.addEventListener("online", purge);
    return () => {
      cancelled = true;
      window.removeEventListener("online", purge);
    };
    // No `t` any more: this round reports a fact and picks no words, so a
    // translator identity can no longer cancel a repaint mid-flight by
    // re-running the effect underneath it.
  }, [refreshDiscarded, resolveTenant, tripId, tenantSlugRef, dispatchSaved, setList]);
}
