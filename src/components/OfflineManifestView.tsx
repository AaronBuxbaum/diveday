"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AmbientContrastControl, AmbientGlareDetector } from "@/components/AmbientGlareDetector";
import { ConnectivityStatus } from "@/components/ConnectivityStatus";
import { MilestoneHaptics } from "@/components/MilestoneHaptics";
import { MissingDiversGrid } from "@/components/MissingDiversGrid";
import { OfflineShellVersionBanner } from "@/components/OfflineShellVersionBanner";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SkipLink } from "@/components/SkipLink";
import { SubSurfaceRipple } from "@/components/SubSurfaceRipple";
import { buttonClass } from "@/components/ui/button";
import { controlClass } from "@/components/ui/form";
import { WaterLocker, WaterLockerToggle } from "@/components/WaterLocker";
import { rollCallCheckpointText, rollCallLabelText } from "@/i18n/manifest-labels";
import { matchLocale } from "@/i18n/negotiate";
import { rentalFitLineText } from "@/i18n/rental-labels";
import { DEFAULT_DIVER_LOCALE, type DiverLocale } from "@/i18n/settings";
import { type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import { cachedFormatter, cachedListFormat } from "@/lib/intl-cache";
import {
  isNotBackAboard,
  isRollCallCheckpoint,
  type RollCallCheckpoint,
  rollCallCheckpoints,
  rollCallCompleteness,
  rollCallLabel,
} from "@/lib/manifests";
import {
  appendOfflineRollCall,
  listOfflineManifests,
  loadOfflineManifest,
  OfflineManifestError,
  purgeOfflineManifestsExceptShop,
  syncOfflineManifest,
} from "@/lib/offline-manifest-store";
import {
  isOfflineManifestExpired,
  latestOfflineRollCall,
  type OfflineManifestEnvelope,
  offlineManifestFreshness,
} from "@/lib/offline-manifests";

/**
 * The device's own language. This is the one surface that cannot use
 * `requestLocale` (src/i18n/request.ts): it renders from an encrypted snapshot
 * in IndexedDB with the radio off, so there is no request and no
 * `Accept-Language` header to negotiate from. Both call sites run after the
 * snapshot has loaded from storage, so `navigator` is always defined by then —
 * the guard is for safety, not for a real server render.
 */
function deviceLocale(): string | undefined {
  return typeof navigator === "undefined" ? undefined : navigator.language;
}

const TENANT_LOOKUP_TIMEOUT_MS = 10_000;

/**
 * Server-verified "who is this browser signed in as", the same way
 * `OfflineManifestAutoSave` learns it — never a client-supplied value, never a
 * slug read off a snapshot this device already holds. Null whenever the answer
 * cannot be established (offline, signed out, a request that failed): every
 * caller treats null as "do nothing", because guessing the tenant is the one
 * mistake worth more than the work it would unblock.
 */
async function fetchCurrentShopSlug(): Promise<string | null> {
  if (!navigator.onLine) return null;
  // `navigator.onLine` says a radio is on, not that anything answers. On a
  // marina connection the request can hang indefinitely, and everything
  // downstream of this — the purge, and the reconcile of a captain's queued
  // roll call — would hang with it. Give up and let the next trigger (reconnect,
  // or the next visit) try again. An explicit controller rather than
  // `AbortSignal.timeout`, matching `fetchExportPhotos`: the static helper is
  // absent under jsdom, so using it would have made this function return null
  // in every component test and silently disable the reconcile it guards.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TENANT_LOOKUP_TIMEOUT_MS);
  try {
    const response = await fetch("/api/offline-manifests/upcoming", {
      credentials: "same-origin",
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return ((await response.json()) as { shop: { slug: string } }).shop.slug;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * `staffTranslator` (src/i18n/staff-messages.ts) is documented as
 * server-side-only for every other staff surface — its words normally reach a
 * Client Component as a `copy` prop built by a Server Component parent, never
 * as a function crossing that boundary. This view has no such parent request:
 * it renders fully offline from an IndexedDB snapshot (see `deviceLocale`
 * above), so there is no per-request `Accept-Language` header to negotiate
 * from server-side. `staffTranslator` itself has no server-only dependency —
 * it is a plain function over a JSON bundle — so it is called directly here,
 * entirely within this client module, rather than crossing the RSC boundary
 * (which is the thing that's actually unsafe). `matchLocale` gives it the
 * same fuzzy `es-MX` → `es-ES` matching every other surface gets, instead of
 * the exact-tag-only fallback `staffTranslator` uses on its own.
 */
function offlineManifestTranslator() {
  const requested = deviceLocale();
  const resolved: DiverLocale = requested
    ? (matchLocale([{ tag: requested, quality: 1 }]) ?? DEFAULT_DIVER_LOCALE)
    : DEFAULT_DIVER_LOCALE;
  return { t: staffTranslator(resolved), locale: resolved };
}

export function OfflineManifestView() {
  // Memoized so `reconcile`/`reconcileList` below (and the effect that reruns
  // whenever they change) stay referentially stable across renders — the
  // device's language doesn't change mid-session, so recreating the
  // translator on every render bought nothing except spurious effect reruns.
  const { t, locale } = useMemo(() => offlineManifestTranslator(), []);
  const shellVersionCopy = useMemo(
    () => ({
      staleBanner: t("shared.offlineManifest.shellVersion.staleBanner"),
      updateBanner: t("shared.offlineManifest.shellVersion.updateBanner"),
      refreshButton: t("shared.offlineManifest.shellVersion.refreshButton"),
    }),
    [t],
  );
  const searchParams = useSearchParams();
  const [envelope, setEnvelope] = useState<OfflineManifestEnvelope | null>(null);
  const [list, setList] = useState<OfflineManifestEnvelope[] | null>(null);
  // A failed reload of the live manifest carries its checkpoint through the
  // redirect (see manifest-sw.js) so a captain mid "After dive 1" roll call
  // doesn't land back on "Before departure". This first pass only checks the
  // value's shape — the trip's actual planned-dive count isn't known until
  // the envelope loads below, so an in-range-looking but nonexistent
  // checkpoint (a stale URL, a trip whose dive count later shrank) is caught
  // once that arrives. Without that second check, `checkpoint` would disagree
  // with the manifest actually rendered (the lookup below falls back to the
  // first saved manifest), misrecording roll-call actions and misreporting
  // `isDeparture` against a checkpoint that isn't the one on screen.
  const [checkpoint, setCheckpoint] = useState<RollCallCheckpoint>(() => {
    const requested = searchParams.get("checkpoint");
    return requested && /^(departure|after_dive_\d+)$/.test(requested)
      ? (requested as RollCallCheckpoint)
      : "departure";
  });
  const [message, setMessage] = useState(t("shared.offlineManifest.loadingMessage"));
  // False until this device's storage has actually been read. Two things ride
  // on it, and both are load-bearing on the one surface that exists for having
  // no signal:
  //
  // 1. **It stops the shell asserting what it hasn't checked.** `envelope` and
  //    `list` both start `null`, which means "not looked yet", but every branch
  //    below read that as "nothing there" and rendered "Nothing saved on this
  //    phone yet" — a definitive claim about a safety artifact, made before the
  //    store was opened, directly contradicting the "Opening the manifest saved
  //    on this device…" status line printed underneath it.
  //
  // 2. **It makes the server render URL-agnostic, which is what the cached
  //    offline shell actually is.** `manifest-sw.js` caches one document under
  //    the key `/offline-manifest` and replays it for *every* offline reload,
  //    whatever `?trip=`/`?checkpoint=` the captain was on. That document was
  //    rendered by the server for whichever URL happened to fetch it — normally
  //    the bare path, so its markup is the *list* branch. The reloaded page
  //    therefore used to paint a different page than the one requested, and only
  //    became correct via React's hydration-mismatch recovery (a recoverable
  //    hydration error fired on every single offline reload, measured). Gating
  //    on a state the server can never have true means the server always emits
  //    this one neutral view, the client hydrates against a match, and the real
  //    branch is chosen by an ordinary client render instead of by error
  //    recovery.
  const [storeRead, setStoreRead] = useState(false);
  const [busyBooking, setBusyBooking] = useState<string | null>(null);
  const [noteByBooking, setNoteByBooking] = useState<Record<string, string>>({});
  const tripId = useMemo(() => searchParams.get("trip") ?? "", [searchParams]);
  // Freshness (current/aging/stale) is computed inline at render time from
  // `saved.snapshot.savedAt`/`envelope.snapshot.savedAt`, so nothing re-renders
  // this component as the wall clock crosses the 15-minute or 4-hour
  // threshold on its own — a captain who leaves this page open would
  // otherwise see "Fresh copy" read as current indefinitely. This forces a
  // re-render every minute, well under either threshold's own granularity,
  // purely to re-run that computation against the current time.
  const [, forceFreshnessRecompute] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => forceFreshnessRecompute((tick) => tick + 1), 60_000);
    return () => clearInterval(interval);
  }, []);

  /**
   * The server-verified tenant, cached for this mount. The purge effect below
   * refreshes it on load and on every reconnect; this is the cheap read for the
   * call sites that only need to *check* it (a captain tapping Board should not
   * pay for a request).
   */
  const tenantSlugRef = useRef<string | null>(null);
  /**
   * The in-flight lookup, so the purge effect and the branch effect below share
   * one request instead of racing two on every mount and every reconnect. This
   * endpoint returns the shop's whole 48-hour roster to answer a one-word
   * question, so a duplicate is not free (security review, 2026-08-06).
   */
  const tenantLookupRef = useRef<Promise<string | null> | null>(null);

  const resolveTenant = useCallback(async (): Promise<string | null> => {
    if (tenantSlugRef.current) return tenantSlugRef.current;
    tenantLookupRef.current ??= fetchCurrentShopSlug().finally(() => {
      tenantLookupRef.current = null;
    });
    const slug = await tenantLookupRef.current;
    if (slug) tenantSlugRef.current = slug;
    return slug;
  }, []);

  const reconcile = useCallback(async () => {
    if (!tripId || !navigator.onLine) return;
    // Same rule `reconcileList` applies to the device-wide list, and it belongs
    // here at least as much (security review, 2026-08-06): a foreign shop's
    // record is *deliberately preserved* by the purge while it still holds a
    // pending event, and it is listed and tappable. Submitting that event under
    // whatever shop is currently signed in gets it rejected for a tenant
    // mismatch rather than a real domain refusal — and a rejected event is no
    // longer "pending", so the very next purge pass deletes the record outright.
    // That destroys the only copy of a boarding record. If the tenant cannot be
    // established, reconcile nothing rather than guess.
    const slug = await resolveTenant();
    if (!slug) return;
    const held = await loadOfflineManifest(tripId).catch(() => null);
    if (!held || held.snapshot.shop.slug !== slug) return;
    try {
      const next = await syncOfflineManifest(tripId);
      if (!next) return;
      setEnvelope(next);
      const rejected = next.events.filter((event) => event.syncStatus === "rejected").length;
      const pending = next.events.filter((event) => event.syncStatus === "pending").length;
      setMessage(
        rejected > 0
          ? t("shared.offlineManifest.reconcile.pendingRejectedSingle", { count: rejected })
          : pending > 0
            ? t("shared.offlineManifest.reconcile.pendingWaiting", { count: pending })
            : t("shared.offlineManifest.reconcile.allCaughtUp"),
      );
    } catch {
      setMessage(t("shared.offlineManifest.reconcile.reachError"));
    }
  }, [tripId, t, resolveTenant]);

  // Reconciles every saved trip that still has a pending roll-call event, not
  // just the one a captain happens to open next — otherwise a change recorded
  // offline for a trip the captain never revisits individually would sit
  // pending forever despite "every change is double-checked... once you're
  // back in service" (see the P1 fix in ADR
  // 20260726-shopwide-offline-manifest-priming's review follow-up).
  const reconcileList = useCallback(
    async (saved: OfflineManifestEnvelope[], currentShopSlug: string | null) => {
      if (!navigator.onLine) return;
      const withPending = saved.filter((envelope) =>
        envelope.events.some((event) => event.syncStatus === "pending"),
      );
      if (withPending.length === 0) return;
      // Only ever sync a trip belonging to whichever shop this browser is
      // actually authenticated as right now. This view has no session context
      // of its own (it's designed to work fully offline/unauthenticated), so a
      // preserved foreign-shop pending event — kept alive specifically because
      // it can't be reconciled under the wrong tenant, see
      // purgeOfflineManifestsExceptShop — would otherwise get submitted under
      // whatever shop *is* currently signed in, rejected for a tenant mismatch
      // rather than a genuine domain refusal, and then look "resolved" to the
      // very next purge pass, which would delete it outright. The
      // server-verified current shop is resolved once by the caller (it also
      // drives the cross-tenant purge); if it can't be determined (offline,
      // signed out, request failure), reconcile nothing rather than guess.
      if (!currentShopSlug) return;
      const reconcilable = withPending.filter(
        (envelope) => envelope.snapshot.shop.slug === currentShopSlug,
      );
      if (reconcilable.length === 0) return;
      const results = await Promise.all(
        reconcilable.map((envelope) => {
          const id = envelope.snapshot.manifests[0]?.trip.id;
          return id ? syncOfflineManifest(id).catch(() => null) : Promise.resolve(null);
        }),
      );
      const byId = new Map(
        results
          .filter((envelope): envelope is OfflineManifestEnvelope => envelope !== null)
          .map((envelope) => [envelope.snapshot.manifests[0]?.trip.id ?? "", envelope] as const),
      );
      const merged = saved.map((envelope) => {
        const id = envelope.snapshot.manifests[0]?.trip.id;
        return id && byId.has(id) ? (byId.get(id) as OfflineManifestEnvelope) : envelope;
      });
      setList(merged);
      const rejected = merged.reduce(
        (sum, envelope) =>
          sum + envelope.events.filter((event) => event.syncStatus === "rejected").length,
        0,
      );
      const pending = merged.reduce(
        (sum, envelope) =>
          sum + envelope.events.filter((event) => event.syncStatus === "pending").length,
        0,
      );
      if (rejected > 0) {
        setMessage(t("shared.offlineManifest.reconcile.listPendingRejected", { count: rejected }));
      } else if (pending === 0) {
        setMessage(t("shared.offlineManifest.reconcile.listAllCaughtUp"));
      }
    },
    [t],
  );

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
      listOfflineManifests()
        .then((saved) => {
          if (!cancelled) setList((current) => (current === null ? current : saved));
        })
        .catch(() => {});
    };
    void purge();
    window.addEventListener("online", purge);
    return () => {
      cancelled = true;
      window.removeEventListener("online", purge);
    };
  }, [resolveTenant]);

  useEffect(() => {
    if (!tripId) {
      // No specific trip requested — this is the dive.day-root/shell landing
      // page (see ADR 20260726-shopwide-offline-manifest-priming), so list
      // whatever this device already has rather than asking for a trip id.
      const showList = (saved: OfflineManifestEnvelope[]) => {
        setList(saved);
        setMessage(
          saved.length > 0
            ? t("shared.offlineManifest.reconcile.savedCount", { count: saved.length })
            : t("shared.offlineManifest.reconcile.noneSavedYet"),
        );
      };

      const refreshList = () =>
        listOfflineManifests()
          .then(async (saved) => {
            // Paint from storage alone, before anything touches the network —
            // the whole premise of this surface. The cross-shop purge runs in
            // its own effect above and repaints if it removes anything.
            showList(saved);
            setStoreRead(true);
            void reconcileList(saved, await resolveTenant());
          })
          .catch(() => setMessage(t("shared.offlineManifest.reconcile.listLoadError")))
          // Settled either way: a device whose storage can't be opened at all
          // has still been *looked at*, and the error message it lands on says
          // more than an "opening…" state that never ends.
          .finally(() => setStoreRead(true));
      void refreshList();
      window.addEventListener("online", refreshList);
      return () => window.removeEventListener("online", refreshList);
    }
    loadOfflineManifest(tripId)
      .then((saved) => {
        setEnvelope(saved);
        // The requested checkpoint's shape was checked before the trip's
        // planned-dive count was known; re-validate against it now so a
        // stale or out-of-range checkpoint (from an edited URL, or a trip
        // whose dive count shrank since it was saved) can't leave `checkpoint`
        // pointing at something the manifest lookup below silently falls back
        // away from.
        const plannedDives = saved?.snapshot.manifests[0]?.trip.plannedDives;
        if (plannedDives !== undefined) {
          setCheckpoint((current) =>
            isRollCallCheckpoint(current, plannedDives) ? current : "departure",
          );
        }
        setMessage(
          saved
            ? t("shared.offlineManifest.reconcile.ready")
            : t("shared.offlineManifest.reconcile.noneForTrip"),
        );
        if (saved && navigator.onLine) void reconcile();
      })
      .catch(() => setMessage(t("shared.offlineManifest.reconcile.singleLoadError")))
      .finally(() => setStoreRead(true));
    window.addEventListener("online", reconcile);
    return () => window.removeEventListener("online", reconcile);
  }, [reconcile, reconcileList, resolveTenant, tripId, t]);

  // Before the store has been read — which includes every server render, since
  // the effect above only runs in the browser — say what is actually true and
  // nothing more. See `storeRead` above for why this branch sits ahead of the
  // `tripId` split rather than inside either side of it: it must not depend on
  // the URL, because the cached shell is one document replayed for all of them.
  if (!storeRead) {
    return (
      <main className="boat-mode mx-auto w-full max-w-3xl flex-1 px-6 py-16">
        <ShopPageHeader
          eyebrow={t("shared.offlineManifest.single.eyebrow")}
          title={t("shared.offlineManifest.openingHeading")}
          meta={
            <p className="text-muted" role="status" aria-live="polite">
              {message}
            </p>
          }
        />
      </main>
    );
  }

  if (!tripId) {
    const savedTrips = list ?? [];
    return (
      <main className="boat-mode mx-auto w-full max-w-3xl flex-1 px-6 py-16">
        <OfflineShellVersionBanner copy={shellVersionCopy} />
        <ShopPageHeader
          eyebrow={t("shared.offlineManifest.list.eyebrow")}
          title={
            savedTrips.length > 0
              ? t("shared.offlineManifest.list.headingWithTrips")
              : t("shared.offlineManifest.list.headingEmpty")
          }
          meta={
            <p className="text-muted" role="status" aria-live="polite">
              {message}
            </p>
          }
        />
        {savedTrips.length > 0 ? (
          <ul className="mt-6 divide-y divide-border rounded-xl border border-border bg-surface">
            {savedTrips.map((saved) => {
              const tripManifest = saved.snapshot.manifests[0];
              if (!tripManifest) return null;
              const savedFreshness = offlineManifestFreshness(new Date(saved.snapshot.savedAt));
              // An expired-but-kept-alive record (see loadOfflineManifest) is
              // not a boarding source even though it's still readable — the
              // freshness pill alone would read identically to an ordinary
              // "Stale copy" that's still perfectly usable, so it needs its
              // own distinct label here (the per-trip view already says this
              // plainly once opened).
              const savedExpired = isOfflineManifestExpired(saved.snapshot);
              const dateTime = cachedFormatter("dt", Intl.DateTimeFormat, deviceLocale(), {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: saved.snapshot.shop.timezone,
              });
              return (
                <li key={tripManifest.trip.id}>
                  <a
                    href={`/offline-manifest?trip=${tripManifest.trip.id}`}
                    className="flex min-h-14 flex-col gap-2 p-4 hover:bg-surface-sunken sm:flex-row sm:items-center sm:justify-between sm:p-5"
                  >
                    <div>
                      <p className="text-lg font-semibold">{tripManifest.trip.title}</p>
                      <p className="mt-0.5 text-sm text-muted">
                        {saved.snapshot.shop.name} ·{" "}
                        {dateTime.format(new Date(tripManifest.trip.startsAt))} ·{" "}
                        {t("shared.offlineManifest.list.diverCount", {
                          count: tripManifest.summary.totalDivers,
                        })}
                      </p>
                    </div>
                    {savedExpired ? (
                      <span className="inline-flex min-h-9 items-center self-start rounded-full border border-danger/30 bg-danger/10 px-3 py-1.5 text-sm font-bold text-danger">
                        {t("shared.offlineManifest.list.expiredViewOnly")}
                      </span>
                    ) : (
                      <span
                        className={
                          savedFreshness === "current"
                            ? "inline-flex min-h-9 items-center self-start rounded-full border border-success/30 bg-success/10 px-3 py-1.5 text-sm font-bold text-success"
                            : savedFreshness === "aging"
                              ? "inline-flex min-h-9 items-center self-start rounded-full border border-warning/40 bg-warning/10 px-3 py-1.5 text-sm font-bold text-warning"
                              : "inline-flex min-h-9 items-center self-start rounded-full border border-danger/30 bg-danger/10 px-3 py-1.5 text-sm font-bold text-danger"
                        }
                      >
                        {t(`shared.offlineManifest.freshnessPill.${savedFreshness}`)}
                      </span>
                    )}
                  </a>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="mt-6 rounded-3xl border border-border bg-surface-sunken p-8 text-center sm:p-10">
            <div
              className="mx-auto grid size-12 place-items-center rounded-2xl bg-surface text-2xl"
              aria-hidden="true"
            >
              📋
            </div>
            <p className="mx-auto mt-4 max-w-md text-muted">
              {t("shared.offlineManifest.list.emptyHint")}
            </p>
          </div>
        )}
      </main>
    );
  }

  if (!envelope) {
    return (
      <main className="boat-mode mx-auto w-full max-w-3xl flex-1 px-6 py-16">
        <ShopPageHeader
          eyebrow={t("shared.offlineManifest.single.eyebrow")}
          title={t("shared.offlineManifest.single.emptyHeading")}
          meta={
            <p className="text-muted" role="status">
              {message}
            </p>
          }
        />
        <div className="mt-6 rounded-3xl border border-border bg-surface-sunken p-8 text-center sm:p-10">
          <div
            className="mx-auto grid size-12 place-items-center rounded-2xl bg-surface text-2xl"
            aria-hidden="true"
          >
            ⛵
          </div>
          <p className="mx-auto mt-4 max-w-md text-muted">
            {t("shared.offlineManifest.single.emptyHint")}
          </p>
        </div>
      </main>
    );
  }

  const manifest =
    envelope.snapshot.manifests.find((entry) => entry.checkpoint === checkpoint) ??
    envelope.snapshot.manifests[0];
  if (!manifest) return null;
  // Readiness gates boarding at departure only. After a dive, roll call is a
  // head count — a diver aboard is recorded present whatever the saved paperwork
  // said. The server re-checks the same way, so an offline board still syncs.
  const isDeparture = checkpoint === "departure";
  // Kept readable past its retention window only so an unsynced event isn't
  // silently lost (see loadOfflineManifest) — the H-05 stop rule still treats
  // it as not a boarding source, so no new roll call can be recorded here.
  const expired = isOfflineManifestExpired(envelope.snapshot);
  const freshness = offlineManifestFreshness(new Date(envelope.snapshot.savedAt));
  const pending = envelope.events.filter((event) => event.syncStatus === "pending").length;
  const rejected = envelope.events.filter((event) => event.syncStatus === "rejected").length;
  const localStates = manifest.divers.map((diver) =>
    latestOfflineRollCall(envelope.snapshot, envelope.events, diver.bookingId, checkpoint),
  );
  const boarded = localStates.filter((state) => state?.state === "boarded").length;
  const awaiting = localStates.filter((state) => !state).length;
  // The dock copy splits `not_boarded` exactly the way the live manifest does
  // (`isNotBackAboard`, src/lib/manifests.ts): at departure it means the diver
  // never left, after a dive it means they have not come back. Offline and
  // online disagreeing about whether everyone is out of the water is worse than
  // either being wrong on its own, so both read the same predicate (DOM-H3).
  const notBackAboard = localStates.filter((state) => isNotBackAboard(checkpoint, state)).length;
  // The same definition the live manifest uses — divers *and* crew (DOM-H1,
  // ADRs 20260802-crew-roll-call-attestation and
  // 20260803-per-person-crew-roll-call). Recomputed here rather than read off
  // the snapshot because `awaiting` comes from events on this device, not from
  // what the server knew at save time. The crew half does not: neither the
  // attestation nor a per-person crew result is recordable offline in this
  // slice, so the snapshot is the only crew evidence a dock copy has, and both
  // read fail-closed — absence is "nobody has said", never "accounted for". A
  // checkpoint with every diver counted and the crew uncounted therefore reads
  // *open* here exactly as it does online; never "complete" offline and "not
  // complete" online, which would be worse than the bug this closes.
  const crewAssigned = manifest.crew.length;
  const completeness = rollCallCompleteness({
    checkpoint,
    totalDivers: manifest.summary.totalDivers,
    awaiting,
    notBackAboard,
    crew: manifest.crew,
  });
  const crewCounts = completeness.crewCounts;
  // The dock copy deliberately carries **no person ids**
  // (src/lib/offline-manifests.ts), so its crew list has no `id` to key on the
  // way the live manifest does. `fullName-roles` was the key, and it collides
  // for two crew who share both — exactly what `ManifestCrewMember.id` prevents
  // online (review 20260803, D6). Disambiguating by how many identical entries
  // came before gives each namesake a distinct identity that survives
  // re-rendering, without shipping an id to the device.
  const crewSeen = new Map<string, number>();
  const crewWithKeys = manifest.crew.map((member) => {
    const base = `${member.fullName}\u0000${member.roles.join(",")}`;
    const nth = crewSeen.get(base) ?? 0;
    crewSeen.set(base, nth + 1);
    return { ...member, key: `${base}\u0000${nth}` };
  });
  // Two different facts, and a crew reading warning-yellow on every single dive
  // stops reading it at all (review 20260803, D6):
  //
  // - somebody **is unaccounted for**: a named crew member was recorded not back
  //   aboard. That is an emergency and reads as danger, wherever the divers are.
  // - the crew half **is not recordable here**: neither the attestation nor a
  //   per-person crew result can be written without signal in this slice, so on
  //   an out-of-signal trip every checkpoint is open for a reason nobody aboard
  //   can act on. It stays fail-closed — the checkpoint does *not* read complete
  //   — but it is stated as a limitation of the dock copy, not as an alarm.
  const crewMissing = completeness.crewReason === "crew_not_back_aboard";
  const crewUnrecordableHere = completeness.crewReason !== null && !crewMissing;
  const rollCallComplete = completeness.complete;
  // The actual roster rendered on this device, not the (possibly stale,
  // save-time) `manifest.summary.totalDivers`. Feeds MilestoneHaptics and the
  // roll-call-complete celebration below.
  const totalDivers = manifest.divers.length;
  // Dive-domain-expert review (task 72, invariant 4): "not boarded" carries
  // forward at later checkpoints and never resets to awaiting, so
  // `rollCallComplete` (awaiting === 0) goes true for a checkpoint with
  // carried-forward not-boarded divers on it — that's correct for the
  // heading text above ("Roll call complete" is accurate either way), but an
  // "everyone's aboard" celebration must not fire on that basis. Gate it on
  // the true boarded count instead.
  const allBoarded = totalDivers > 0 && boarded === totalDivers;
  const missingDivers = manifest.divers.filter((_diver, index) => !localStates[index]);
  // Whether anyone on this saved copy carries a team — gates the one line that
  // says the split-team read belongs to the live roll call. Crew count too:
  // a boat where only the divemaster's groups were recorded still needs the
  // limitation stated.
  const anyBuddies =
    manifest.divers.some((diver) => (diver.buddyTeamNames ?? []).length > 0) ||
    manifest.crew.some((member) => (member.buddyTeamNames ?? []).length > 0);

  async function record(bookingId: string, status: "boarded" | "not_boarded", note = "") {
    if (expired) {
      setMessage(t("shared.offlineManifest.single.record.expiredCannotRecord"));
      return;
    }
    setBusyBooking(bookingId);
    try {
      const next = await appendOfflineRollCall(tripId, {
        bookingId,
        checkpoint,
        status,
        note: note.trim() || null,
      });
      setEnvelope(next);
      setMessage(t("shared.offlineManifest.single.record.saved"));
      // Task 73: a typed note must not silently ride along on the next tap
      // for this diver (e.g. tapping "Not boarded" again later re-sends a
      // stale note nobody re-typed).
      setNoteByBooking((current) => {
        if (!(bookingId in current)) return current;
        const next = { ...current };
        delete next[bookingId];
        return next;
      });
      if (navigator.onLine) await reconcile();
    } catch (error) {
      if (error instanceof OfflineManifestError) {
        setMessage(
          error.code === "expired"
            ? t("shared.offlineManifest.single.record.expiredCannotRecord")
            : error.code === "not_allowed"
              ? t("shared.offlineManifest.single.record.notAllowed")
              : t("shared.offlineManifest.single.record.unavailable"),
        );
      } else {
        setMessage(t("shared.offlineManifest.single.record.genericError"));
      }
    } finally {
      setBusyBooking(null);
    }
  }

  const dateTime = cachedFormatter("dt", Intl.DateTimeFormat, deviceLocale(), {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: envelope.snapshot.shop.timezone,
  });

  return (
    <main className="boat-mode mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6">
      <AmbientGlareDetector />
      <OfflineShellVersionBanner copy={shellVersionCopy} />
      <SkipLink href="#offline-roll-call" label={t("shared.offlineManifest.single.skipLink")} />
      <div className="border-b border-border pb-6">
        <ShopPageHeader
          align="start"
          eyebrow={t("shared.offlineManifest.single.eyebrow")}
          title={manifest.trip.title}
          description={t("shared.offlineManifest.single.savedAt", {
            when: dateTime.format(new Date(envelope.snapshot.savedAt)),
          })}
          actions={
            <>
              <div className="print:hidden">
                <AmbientContrastControl
                  copy={{
                    modeLabel: t("shared.boatMode.modeLabel"),
                    labelAuto: t("shared.boatMode.labelAuto"),
                    labelLand: t("shared.boatMode.labelLand"),
                    labelBoat: t("shared.boatMode.labelBoat"),
                  }}
                />
              </div>
              <ConnectivityStatus
                offlineLabel={t("shared.connectivity.offlineWithCopy")}
                copy={{
                  online: t("shared.connectivity.online"),
                  onlineTitle: t("shared.connectivity.onlineTitle"),
                  offlineTitle: t("shared.connectivity.offlineTitle"),
                }}
              />
              <span
                className={
                  freshness === "current"
                    ? "rounded-full border border-success/30 bg-success/10 px-3 py-2 text-sm font-bold text-success"
                    : freshness === "aging"
                      ? "rounded-full border border-warning/40 bg-warning/10 px-3 py-2 text-sm font-bold text-warning"
                      : "rounded-full border border-danger/30 bg-danger/10 px-3 py-2 text-sm font-bold text-danger"
                }
              >
                {t(`shared.offlineManifest.freshnessPill.${freshness}`)}
              </span>
            </>
          }
        />
        {expired ? (
          <p className="mt-4 rounded-lg border border-danger/40 bg-danger/10 p-3 text-base leading-6 font-semibold text-danger">
            {t("shared.offlineManifest.single.expiredBanner")}
          </p>
        ) : (
          <p className="mt-4 rounded-lg border border-warning/40 bg-warning/10 p-3 text-base leading-6">
            {t("shared.offlineManifest.single.freshnessBanner", {
              freshnessNote: t(`shared.offlineManifest.freshnessCopy.${freshness}`),
            })}
          </p>
        )}
        <p className="mt-3 text-sm font-medium" role="status" aria-live="polite">
          {message}
        </p>
        <p className="mt-1 text-sm text-muted">
          {t("shared.offlineManifest.single.pendingRejectedCounts", { pending, rejected })}
        </p>
      </div>

      <nav
        className="mt-6 flex flex-wrap items-center gap-2 overflow-x-auto pb-2"
        aria-label={t("shared.offlineManifest.single.checkpointNavAria")}
      >
        {rollCallCheckpoints(manifest.trip.plannedDives).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setCheckpoint(value)}
            className={buttonClass({
              variant: value === checkpoint ? "primary" : "secondary",
              size: "boat",
              className: "shrink-0",
            })}
          >
            {rollCallCheckpointText(t, value)}
          </button>
        ))}
        <WaterLockerToggle
          copy={{ disableToggleLabel: t("shared.waterLocker.disableToggleLabel") }}
        />
      </nav>

      <section
        className={
          rollCallComplete
            ? "rise-in mt-4 grid grid-cols-3 gap-3 rounded-2xl border border-accent/50 bg-accent/10 p-3"
            : "mt-4 grid grid-cols-3 gap-3"
        }
      >
        {[
          [t("shared.offlineManifest.single.statsDivers"), manifest.summary.totalDivers],
          [t("shared.offlineManifest.single.statsBoarded"), boarded],
          [t("shared.offlineManifest.single.statsAwaiting"), awaiting],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-lg border border-border bg-surface p-3">
            <p className="text-xs font-semibold text-muted uppercase">{label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-semibold">
          {rollCallComplete
            ? t("shared.offlineManifest.single.rollCallCompleteHeading")
            : t("shared.offlineManifest.single.checkpointRollCallHeading", {
                checkpoint: rollCallCheckpointText(t, checkpoint),
              })}
        </h2>
        {rollCallComplete ? (
          <p className="mt-1 text-sm font-semibold text-muted" role="status" aria-live="polite">
            {boarded === manifest.summary.totalDivers
              ? t("shared.offlineManifest.single.allAboard")
              : t("shared.offlineManifest.single.someNotBoarded", {
                  count: manifest.summary.totalDivers - boarded,
                })}
          </p>
        ) : null}
        {/*
         * The crew half of the head count, read-only on the dock (DOM-H1).
         * Divers can be counted with the radio off; crew cannot, in this
         * slice — so this states plainly why the checkpoint is still open
         * rather than letting the device call it done.
         */}
        <div
          className={
            crewMissing
              ? "mt-3 rounded-xl border border-danger bg-danger/10 p-3 ring-1 ring-inset ring-danger/40"
              : completeness.crewAccountedFor
                ? "mt-3 rounded-xl border border-success/40 bg-success/10 p-3"
                : "mt-3 rounded-xl border border-border-strong bg-surface-sunken p-3"
          }
        >
          <p className={`text-sm font-bold${crewMissing ? " text-danger" : ""}`}>
            {t("shared.offlineManifest.single.crewHeading")}
          </p>
          <p className="mt-1 text-sm">
            {crewMissing
              ? t("shared.offlineManifest.single.crewNotBackAboard", {
                  count: crewCounts.crewNotBackAboard,
                })
              : completeness.crewReason === "crew_awaiting"
                ? t("shared.offlineManifest.single.crewAwaiting", {
                    count: crewCounts.crewAwaiting,
                  })
                : completeness.crewReason === "crew_none_assigned"
                  ? t("shared.offlineManifest.single.crewNoneAssigned")
                  : completeness.crewReason === "crew_none_aboard"
                    ? t("shared.offlineManifest.single.crewNoneAboard")
                    : t("shared.offlineManifest.single.crewAllAccountedFor", {
                        assigned: crewAssigned,
                      })}
          </p>
          {/* Says plainly that this half of the count belongs to the live
              manifest, so the state above reads as "not recordable here"
              rather than as one more thing the boat has failed to do. */}
          {crewUnrecordableHere ? (
            <p className="mt-1 text-sm font-semibold text-muted">
              {t("shared.offlineManifest.single.crewReadOnlyHere")}
            </p>
          ) : null}
          {/* Who, not just how many. A crew member's saved result is read-only
              here — recording one needs signal — but naming the person nobody
              has counted is the whole point of the per-person model. */}
          {crewAssigned > 0 ? (
            <ul className="mt-2 flex flex-wrap gap-2">
              {crewWithKeys.map((member) => (
                <li
                  key={member.key}
                  // One colour vocabulary with the live manifest's rows
                  // (`ROLL_CALL_ROW_TONE`), because both are read on the same
                  // deck and often on two devices at once: aboard green, left
                  // ashore amber, nothing said yet slate, did-not-come-back
                  // red and alone in carrying weight. This used to invert two
                  // of them — amber for "still to call" and slate for "ashore"
                  // — so the same crew member read as a warning on the phone
                  // and as settled on the tablet (dive-domain review 20260804).
                  className={
                    isNotBackAboard(checkpoint, member.rollCall)
                      ? "rounded-full bg-danger/15 px-3 py-1 text-sm font-bold text-danger"
                      : member.rollCall?.state === "boarded"
                        ? "rounded-full bg-success/20 px-3 py-1 text-sm"
                        : member.rollCall
                          ? "rounded-full bg-warning/15 px-3 py-1 text-sm"
                          : "rounded-full bg-surface-sunken px-3 py-1 text-sm"
                  }
                >
                  {member.fullName} ·{" "}
                  {rollCallLabelText(t, rollCallLabel(checkpoint, member.rollCall))}
                  {/* The groups this crew member is on, saved as names. Same
                      display-only rule as a diver's — a divemaster leading
                      three groups needs the dock copy to say which bodies
                      they are responsible for. */}
                  {(member.buddyTeamNames ?? []).length > 0 ? (
                    <span className="ms-1 font-normal">
                      ·{" "}
                      {t("shared.buddyTeam.with", {
                        names: cachedListFormat(locale, { type: "conjunction" }).format(
                          member.buddyTeamNames ?? [],
                        ),
                      })}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        {/* Buddy teams are display-only on the dock copy, and the split-team
            read ("someone back, someone not") belongs to the live roll call
            alone — a snapshot cannot know who came back (ADR
            20260804-buddy-teams). Stated the same neutral way as the crew
            limitation above: a limitation of this copy, not an alarm. */}
        {anyBuddies ? (
          <p className="mt-3 text-sm font-semibold text-muted">
            {t("shared.offlineManifest.single.buddyReadOnlyHere")}
          </p>
        ) : null}
        <ul
          id="offline-roll-call"
          tabIndex={-1}
          className="mt-4 divide-y divide-border rounded-xl border border-border bg-surface outline-none"
        >
          {manifest.divers.map((diver, index) => {
            const state = latestOfflineRollCall(
              envelope.snapshot,
              envelope.events,
              diver.bookingId,
              checkpoint,
            );
            const ready = diver.readiness.status === "ready";
            // Recorded here at this checkpoint, either way round — a
            // carried-forward dock result is not undoable and gets the
            // "Mark…" wording, same as the live manifest.
            const recordedNotBoarded = state?.state === "not_boarded" && state.implied !== true;
            const missing = isNotBackAboard(checkpoint, state);
            return (
              <li
                key={diver.bookingId}
                id={`offline-roll-call-${diver.bookingId}`}
                className={
                  missing
                    ? "scroll-mt-24 border-l-4 border-danger bg-danger/10 p-4 ring-1 ring-inset ring-danger/40 sm:p-5"
                    : ready
                      ? state
                        ? "border-l-4 border-success p-4 sm:p-5"
                        : "border-l-4 border-warning bg-warning/10 p-4 ring-1 ring-inset ring-warning/30 sm:p-5"
                      : "scroll-mt-24 border-l-4 border-danger bg-danger/5 p-4 sm:p-5"
                }
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-sunken text-sm font-bold tabular-nums">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <h3 className="text-lg font-semibold">{diver.fullName}</h3>
                      <span
                        className={
                          ready
                            ? "rounded-full bg-success/10 px-3 py-1 text-sm font-semibold text-success"
                            : "rounded-full bg-danger/10 px-3 py-1 text-sm font-semibold text-danger"
                        }
                      >
                        {ready
                          ? t("shared.offlineManifest.single.readyBadge")
                          : t("shared.offlineManifest.single.blockedBadge")}
                      </span>
                      {/* Same resolver the live manifest renders (DOM-H3):
                          one word list, so a diver who has not come back from
                          dive one cannot read "Not boarded" here and "Not back
                          aboard" on the captain's screen. */}
                      <span
                        className={
                          missing
                            ? "rounded-full bg-danger/15 px-3 py-1 text-sm font-bold text-danger"
                            : "rounded-full bg-surface-sunken px-3 py-1 text-sm font-semibold"
                        }
                      >
                        {rollCallLabelText(t, rollCallLabel(checkpoint, state))}
                        {state?.pending
                          ? ` ${t("shared.offlineManifest.single.statePendingSuffix")}`
                          : ""}
                      </span>
                      {/* The saved team, always quiet here: this copy shows
                          who you are with and never judges whether the team is
                          split — that read is live-roll-call only (see the
                          note above the list). */}
                      <OfflineBuddyTeamChip t={t} locale={locale} names={diver.buddyTeamNames} />
                    </div>
                    <div className="mt-3 grid gap-2 text-base sm:grid-cols-2">
                      <p>
                        <span className="font-bold">
                          {t("shared.offlineManifest.single.emergencyContact")}
                        </span>
                        <span className="mt-0.5 block text-muted">
                          {diver.emergencyContactName && diver.emergencyContactPhone
                            ? `${diver.emergencyContactName} · ${diver.emergencyContactPhone}`
                            : t("shared.offlineManifest.single.notOnFile")}
                        </span>
                      </p>
                      <p>
                        <span className="font-bold">
                          {t("shared.offlineManifest.single.rentalFit")}
                        </span>
                        <span className="mt-0.5 block text-muted">
                          {rentalFitLineText(t, locale, diver.rentalFit)}
                          {diver.nitroxRequested
                            ? ` ${t("shared.offlineManifest.single.nitroxRequestedSuffix")}`
                            : ""}
                        </span>
                      </p>
                    </div>
                    {!ready ? (
                      <ul className="mt-2 text-sm text-danger">
                        {diver.readiness.blockers.map((blocker) => (
                          <li key={blocker.code}>• {blocker.text}</li>
                        ))}
                      </ul>
                    ) : null}
                    <details className="mt-3 max-w-xl rounded-xl border border-border/70 bg-surface-sunken/50 p-3">
                      <summary className="flex min-h-11 cursor-pointer items-center text-sm font-bold text-primary">
                        {t("shared.offlineManifest.single.addNoteSummary")}
                      </summary>
                      <div className="mt-2">
                        <label
                          htmlFor={`offline-roll-call-note-${diver.bookingId}`}
                          className="text-sm font-semibold"
                        >
                          {t("shared.offlineManifest.single.optionalNote")}
                        </label>
                        <input
                          id={`offline-roll-call-note-${diver.bookingId}`}
                          maxLength={300}
                          value={noteByBooking[diver.bookingId] ?? ""}
                          onChange={(event) =>
                            setNoteByBooking((current) => ({
                              ...current,
                              [diver.bookingId]: event.target.value,
                            }))
                          }
                          placeholder={t("shared.offlineManifest.single.notePlaceholder")}
                          className={`${controlClass} mt-1`}
                        />
                        <p className="mt-1 text-xs text-muted">
                          {t("shared.offlineManifest.single.noteHint")}
                        </p>
                      </div>
                    </details>
                  </div>
                  <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap">
                    {expired ? (
                      <p className="text-sm font-semibold text-danger">
                        {t("shared.offlineManifest.single.record.expiredRecordOnLive")}
                      </p>
                    ) : (
                      <>
                        {ready || !isDeparture ? (
                          <button
                            type="button"
                            disabled={busyBooking === diver.bookingId}
                            onClick={() =>
                              record(diver.bookingId, "boarded", noteByBooking[diver.bookingId])
                            }
                            aria-busy={busyBooking === diver.bookingId}
                            className="flex min-h-14 w-full touch-manipulation items-center justify-center rounded-lg bg-primary px-5 text-base font-semibold text-primary-foreground transition-[transform,opacity] active:scale-[0.99] disabled:cursor-wait disabled:opacity-70 sm:w-auto"
                          >
                            {busyBooking === diver.bookingId
                              ? t("shared.offlineManifest.single.saving")
                              : state?.state === "boarded"
                                ? t("shared.offlineManifest.single.boardedDone")
                                : t("shared.offlineManifest.single.markBoarded")}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          disabled={busyBooking === diver.bookingId}
                          onClick={() =>
                            record(diver.bookingId, "not_boarded", noteByBooking[diver.bookingId])
                          }
                          aria-busy={busyBooking === diver.bookingId}
                          className={
                            missing
                              ? "flex min-h-14 w-full touch-manipulation items-center justify-center rounded-lg border border-danger bg-danger/15 px-5 text-base font-semibold text-danger transition-[transform,opacity] active:scale-[0.99] disabled:cursor-wait disabled:opacity-70 sm:w-auto"
                              : "flex min-h-14 w-full touch-manipulation items-center justify-center rounded-lg border border-border-strong px-5 text-base font-semibold transition-[transform,opacity] active:scale-[0.99] disabled:cursor-wait disabled:opacity-70 sm:w-auto"
                          }
                        >
                          {/* No done-check after a dive: "Not boarded ✓" beside a
                              diver still in the water is the string this whole
                              change exists to delete (DOM-H3). */}
                          {busyBooking === diver.bookingId
                            ? t("shared.offlineManifest.single.saving")
                            : recordedNotBoarded
                              ? isDeparture
                                ? t("shared.offlineManifest.single.notBoardedDone")
                                : t("shared.offlineManifest.single.notBackAboardActive")
                              : isDeparture
                                ? t("shared.offlineManifest.single.markNotBoarded")
                                : t("shared.offlineManifest.single.markNotBackAboard")}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <MissingDiversGrid
        divers={missingDivers.map((diver) => ({
          bookingId: diver.bookingId,
          fullName: diver.fullName,
          rentsKit: diver.rentalFit.state === "rents",
        }))}
        copy={{
          heading: t("trips.manifest.missingDiversHeading", { count: missingDivers.length }),
          awaitingBoarding: t("trips.manifest.awaitingBoarding"),
          tapHint: t("trips.manifest.missingDiversTapHint"),
          rentsKitLabel: t("trips.manifest.rentsKitLabel"),
          ownKitLabel: t("trips.manifest.ownKitLabel"),
        }}
      />

      <footer className="mt-8 flex flex-wrap items-center gap-4 border-t border-border pt-5">
        <a
          href={`/shop/${envelope.snapshot.shop.slug}/trips/${tripId}/manifest?checkpoint=${checkpoint}`}
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-4 py-2.5 font-semibold text-primary-foreground"
        >
          {t("shared.offlineManifest.single.openLiveManifest")}
        </a>
      </footer>

      {/*
       * Dive-domain-expert review (task 72, invariant 3): none of these three
       * react to an attempted board/not-board tap — only to the envelope's
       * own boarded/awaiting counts, which cannot change while `expired` is
       * true (record() above refuses before ever calling
       * appendOfflineRollCall). So an expired copy — where no board/not-board
       * buttons render at all — never fires a haptic or the ripple for an
       * action the store was about to reject; there's no action for it to be
       * attempted for. MilestoneHaptics and SubSurfaceRipple both skip their
       * very first render besides (see their own components), so mounting
       * with an already-complete roll call never fires either on load.
       *
       * Invariant 5: the ripple and haptics are a same-device UI reaction,
       * not a claim that the server has confirmed anything — pending/rejected
       * counts stay visible in the header above regardless, and sync
       * reconciliation (reconcile(), above) remains the only thing that ever
       * changes `syncStatus`.
       */}
      <WaterLocker
        copy={{
          rainAlt: t("shared.waterLocker.rainAlt"),
          heading: t("shared.waterLocker.heading"),
          body: t("shared.waterLocker.body"),
          holdLine1: t("shared.waterLocker.holdLine1"),
          holdLine2: t("shared.waterLocker.holdLine2"),
          unlockingProgress: t("shared.waterLocker.unlockingProgress"),
          holdToUnlock: t("shared.waterLocker.holdToUnlock"),
        }}
      />
      <MilestoneHaptics total={totalDivers} boarded={boarded} />
      {/*
       * Gated on `allBoarded` (the true boarded count), not `rollCallComplete`
       * (awaiting === 0) — task 72, invariant 4. A checkpoint with a
       * carried-forward not-boarded diver reaches awaiting === 0 without
       * everyone being aboard; the celebration must not read as "everyone's
       * aboard" for that manifest.
       */}
      <SubSurfaceRipple
        complete={allBoarded}
        copy={{
          iconTitle: t("shared.subSurfaceRipple.iconTitle"),
          message: t("shared.subSurfaceRipple.message"),
        }}
      />
    </main>
  );
}

/**
 * The saved team a dock-copy row wears — names only, never a verdict. There is
 * deliberately no tone variant: this copy cannot know who came back, so it must
 * never look like it is telling you (ADR 20260804-buddy-teams).
 */
function OfflineBuddyTeamChip({
  t,
  locale,
  names,
}: {
  t: StaffTranslator;
  locale: string;
  names?: string[];
}) {
  if (!names || names.length === 0) return null;
  return (
    <span className="rounded-full bg-surface-sunken px-3 py-1 text-sm font-medium text-muted">
      {t("shared.buddyTeam.with", {
        names: cachedListFormat(locale, { type: "conjunction" }).format(names),
      })}
    </span>
  );
}
