"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  manifestStaleGeneration,
  subscribeManifestInvalidation,
} from "@/components/manifest-stale-generation";
import { subscribeSessionInvalidation } from "@/components/session-invalidation";

const READ_PARAM = "rosterRead";
const CONFIRMATION_MS = 5 * 60 * 1000;

/** Confirms the rendered roster, independently of the age of the offline copy. */
export function ManifestRosterFreshness({
  renderToken,
  renderProof,
  renderId,
  tripId,
  copy,
}: {
  renderToken?: string;
  renderProof?: string;
  renderId: string;
  tripId: string;
  copy: { unconfirmed: string; confirmed: string };
}) {
  const router = useRouter();
  const queryToken = useSearchParams().get(READ_PARAM);
  const [requestToken, setRequestToken] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const requested = useRef<string | null>(null);
  const activeToken = useRef<string | null>(null);
  const confirmedRef = useRef(false);
  const sessionInvalidated = useRef(false);
  const acceptedRender = useRef<{ token: string; id: string } | null>(null);
  const readGeneration = useRef(0);

  const requestRead = useCallback(() => {
    confirmedRef.current = false;
    acceptedRender.current = null;
    setConfirmed(false);
    requested.current = null;
    if (!navigator.onLine || sessionInvalidated.current) {
      activeToken.current = null;
      setRequestToken(null);
      return;
    }
    const token = crypto.randomUUID();
    readGeneration.current = manifestStaleGeneration(tripId);
    activeToken.current = token;
    const url = new URL(window.location.href);
    url.searchParams.set(READ_PARAM, token);
    window.history.replaceState(null, "", url);
    setRequestToken(token);
  }, [tripId]);

  // React Activity tears down effects when a cached page is hidden and runs
  // them again when history returns to it. Each activation gets a new token.
  useLayoutEffect(() => {
    // A later activation may belong to a newly signed-in session. Its roster
    // must pass the live post-render session check before confirmation.
    sessionInvalidated.current = false;
    requestRead();
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
    };
  }, [requestRead, tripId]);

  // Wait until Next's router has observed replaceState before refreshing.
  useEffect(() => {
    if (
      !requestToken ||
      activeToken.current !== requestToken ||
      queryToken !== requestToken ||
      requested.current === requestToken
    )
      return;
    requested.current = requestToken;
    router.refresh();
  }, [queryToken, requestToken, router]);

  useLayoutEffect(() => {
    if (
      !requestToken ||
      activeToken.current !== requestToken ||
      requested.current !== requestToken ||
      renderToken !== requestToken ||
      !renderProof ||
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
    const timeout = setTimeout(() => controller.abort(), 10_000);
    void fetch(`/api/offline-manifests/${tripId}/roster-confirmation`, {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nonce: requestToken, renderId, proof: renderProof }),
      signal: controller.signal,
    })
      .then((response) => {
        if (
          response.status !== 204 ||
          response.redirected ||
          controller.signal.aborted ||
          !navigator.onLine ||
          readGeneration.current !== manifestStaleGeneration(tripId) ||
          activeToken.current !== requestToken ||
          requested.current !== requestToken
        )
          return;
        confirmedRef.current = true;
        setConfirmed(true);
        const url = new URL(window.location.href);
        if (url.searchParams.get(READ_PARAM) === requestToken) {
          url.searchParams.delete(READ_PARAM);
          window.history.replaceState(null, "", url);
        }
      })
      .catch(() => {})
      .finally(() => clearTimeout(timeout));
    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, [renderToken, renderProof, renderId, tripId, requestToken, requestRead]);

  useEffect(() => {
    if (!confirmed) return;
    const expiry = setTimeout(() => {
      confirmedRef.current = false;
      setConfirmed(false);
    }, CONFIRMATION_MS);
    return () => clearTimeout(expiry);
  }, [confirmed]);

  return (
    <p role="status" className="text-sm font-medium text-muted">
      {confirmed ? copy.confirmed : copy.unconfirmed}
    </p>
  );
}
