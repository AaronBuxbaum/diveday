"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  isManifestRereadRunning,
  manifestRosterIsCommitted,
  manifestStaleGeneration,
  satisfyPendingManifestReread,
  subscribeManifestInvalidation,
  subscribeManifestReread,
  subscribeManifestRosterCommit,
} from "@/components/manifest-stale-generation";
import {
  sessionInvalidationGeneration,
  subscribeSessionInvalidation,
} from "@/components/session-invalidation";
import { nowMs } from "@/lib/clock";
import { manifestHistoryCookieName, readManifestHistoryCookie } from "./manifest-history-cookie";

const CONFIRMATION_MS = 5 * 60 * 1000;
const READ_DEADLINE_MS = 10_000;
type ReadStarted = { wall: number; monotonic: number };
function withinDeadline(start: ReadStarted | null, limit: number): boolean {
  if (!start) return false;
  const wall = nowMs() - start.wall;
  const monotonic = performance.now() - start.monotonic;
  return wall >= 0 && wall < limit && monotonic >= 0 && monotonic < limit;
}

/** Confirms the rendered roster, independently of the age of the offline copy. */
export function ManifestRosterFreshness({
  renderToken,
  renderProof,
  renderId,
  tripId,
  checkpoint = "departure",
  historyScope,
  readCompletedAt,
  readCompletedLabel,
  requireCommit = false,
  copy,
}: {
  renderToken?: string;
  renderProof?: string;
  renderId: string;
  tripId: string;
  checkpoint?: string;
  historyScope: string;
  readCompletedAt: number;
  readCompletedLabel: string;
  requireCommit?: boolean;
  copy: { unconfirmed: string; confirmed: string };
}) {
  const router = useRouter();
  const [requestToken, setRequestToken] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [confirmedHistory, setConfirmedHistory] = useState<{
    scope: string;
    generation: number;
    label: string;
  } | null>(null);
  const requested = useRef<string | null>(null);
  const activeToken = useRef<string | null>(null);
  const confirmedRef = useRef(false);
  const sessionInvalidated = useRef(false);
  const acceptedRender = useRef<{ token: string; id: string } | null>(null);
  const readGeneration = useRef(0);
  const readStarted = useRef<ReadStarted | null>(null);
  const readCheckpoint = useRef(checkpoint);

  const requestRead = useCallback(() => {
    confirmedRef.current = false;
    acceptedRender.current = null;
    setConfirmed(false);
    requested.current = null;
    if (!navigator.onLine || sessionInvalidated.current) {
      activeToken.current = null;
      setRequestToken(null);
      return false;
    }
    if (!historyScope) {
      activeToken.current = null;
      setRequestToken(null);
      router.refresh();
      return true;
    }
    const token = crypto.randomUUID();
    readStarted.current = { wall: nowMs(), monotonic: performance.now() };
    readCheckpoint.current = checkpoint;
    readGeneration.current = manifestStaleGeneration(tripId);
    activeToken.current = token;
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    try {
      // The nonce is a non-authorizing challenge and contains no user data.
      // biome-ignore lint/suspicious/noDocumentCookie: the Cookie Store API is not available on all supported devices.
      document.cookie = `${manifestHistoryCookieName(tripId)}=${token}; Path=/; Max-Age=60; SameSite=Lax${secure}`;
      if (readManifestHistoryCookie(document.cookie, tripId) !== token)
        throw new Error("cookie unavailable");
    } catch {
      activeToken.current = null;
      setRequestToken(null);
      router.refresh();
      return true;
    }
    requested.current = token;
    setRequestToken(token);
    router.refresh();
    return true;
  }, [tripId, checkpoint, historyScope, router]);

  // React Activity tears down effects when a cached page is hidden and runs
  // them again when history returns to it. Each activation gets a new token.
  useLayoutEffect(() => {
    // A later activation may belong to a newly signed-in session. Its roster
    // must pass the live post-render session check before confirmation.
    sessionInvalidated.current = false;
    const unsubscribeReread = subscribeManifestReread(tripId, requestRead);
    if (!isManifestRereadRunning(tripId, requestRead)) requestRead();
    window.addEventListener("online", requestRead);
    const offline = () => {
      confirmedRef.current = false;
      activeToken.current = null;
      requested.current = null;
      setRequestToken(null);
      setConfirmed(false);
    };
    window.addEventListener("offline", offline);
    const unsubscribe = subscribeSessionInvalidation(() => {
      sessionInvalidated.current = true;
      setConfirmedHistory(null);
      offline();
    });
    const unsubscribeStale = subscribeManifestInvalidation(tripId, () => {
      offline();
      acceptedRender.current = null;
    });
    return () => {
      window.removeEventListener("online", requestRead);
      window.removeEventListener("offline", offline);
      unsubscribe();
      unsubscribeStale();
      unsubscribeReread();
    };
  }, [requestRead, tripId]);

  useLayoutEffect(() => {
    if (
      !requestToken ||
      activeToken.current !== requestToken ||
      requested.current !== requestToken ||
      renderToken !== requestToken ||
      !renderProof ||
      !historyScope ||
      !Number.isSafeInteger(readCompletedAt) ||
      readCompletedAt <= 0 ||
      readCompletedAt > 8_640_000_000_000_000 ||
      !readCompletedLabel ||
      readCheckpoint.current !== checkpoint ||
      !withinDeadline(readStarted.current, READ_DEADLINE_MS) ||
      readGeneration.current !== manifestStaleGeneration(tripId) ||
      !navigator.onLine
    ) {
      const wasConfirmed = confirmedRef.current;
      confirmedRef.current = false;
      setConfirmed(false);
      if (wasConfirmed && navigator.onLine) requestRead();
      return;
    }
    const previous = acceptedRender.current;
    if (previous?.token === requestToken && previous.id !== renderId) {
      requestRead();
      return;
    }
    acceptedRender.current = { token: requestToken, id: renderId };
    confirmedRef.current = false;
    setConfirmed(false);
    // A matching render may have started under a session that was revoked or
    // replaced while it was in flight. Check the live session *after* the
    // roster commits before calling it checked. Abort on replacement/unmount.
    const controller = new AbortController();
    const sessionGeneration = sessionInvalidationGeneration();
    let unsubscribeCommit = () => {};
    const timeout = setTimeout(() => controller.abort(), 10_000);
    void fetch(`/api/offline-manifests/${tripId}/roster-confirmation`, {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        nonce: requestToken,
        renderId,
        proof: renderProof,
        checkpoint,
        readCompletedAt,
      }),
      signal: controller.signal,
    })
      .then((response) => {
        if (
          response.status !== 204 ||
          response.redirected ||
          controller.signal.aborted ||
          !withinDeadline(readStarted.current, READ_DEADLINE_MS) ||
          sessionGeneration !== sessionInvalidationGeneration() ||
          !navigator.onLine ||
          readGeneration.current !== manifestStaleGeneration(tripId) ||
          activeToken.current !== requestToken ||
          requested.current !== requestToken
        )
          return;
        const finish = () => {
          if (
            controller.signal.aborted ||
            sessionGeneration !== sessionInvalidationGeneration() ||
            !navigator.onLine ||
            !withinDeadline(readStarted.current, READ_DEADLINE_MS) ||
            readGeneration.current !== manifestStaleGeneration(tripId) ||
            activeToken.current !== requestToken ||
            requested.current !== requestToken
          )
            return;
          if (
            requireCommit &&
            !manifestRosterIsCommitted(
              tripId,
              readGeneration.current,
              renderId,
              requestToken,
              checkpoint,
            )
          )
            return;
          clearTimeout(timeout);
          unsubscribeCommit();
          satisfyPendingManifestReread(tripId, readGeneration.current);
          confirmedRef.current = true;
          setConfirmedHistory({
            scope: historyScope,
            generation: sessionGeneration,
            label: readCompletedLabel,
          });
          setConfirmed(true);
        };
        if (requireCommit) unsubscribeCommit = subscribeManifestRosterCommit(tripId, finish);
        finish();
      })
      .catch(() => {});
    return () => {
      controller.abort();
      unsubscribeCommit();
      clearTimeout(timeout);
    };
  }, [
    renderToken,
    renderProof,
    renderId,
    tripId,
    checkpoint,
    historyScope,
    readCompletedAt,
    readCompletedLabel,
    requireCommit,
    requestToken,
    requestRead,
  ]);

  useEffect(() => {
    if (!confirmed) return;
    const withdrawIfExpired = () => {
      if (withinDeadline(readStarted.current, CONFIRMATION_MS)) return;
      confirmedRef.current = false;
      setConfirmed(false);
    };
    const age = readStarted.current
      ? Math.max(0, nowMs() - readStarted.current.wall)
      : CONFIRMATION_MS;
    const expiry = setTimeout(withdrawIfExpired, Math.max(0, CONFIRMATION_MS - age));
    window.addEventListener("focus", withdrawIfExpired);
    document.addEventListener("visibilitychange", withdrawIfExpired);
    return () => {
      clearTimeout(expiry);
      window.removeEventListener("focus", withdrawIfExpired);
      document.removeEventListener("visibilitychange", withdrawIfExpired);
    };
  }, [confirmed]);

  const historicalLabel =
    confirmedHistory?.scope === historyScope &&
    confirmedHistory.generation === sessionInvalidationGeneration()
      ? confirmedHistory.label
      : "";
  return (
    <p role="status" className="text-sm font-medium text-muted">
      <span>{confirmed && historicalLabel ? copy.confirmed : copy.unconfirmed}</span>
      {historicalLabel ? (
        <>
          {" "}
          · <span>{historicalLabel}</span>
        </>
      ) : null}
    </p>
  );
}
