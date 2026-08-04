"use client";

import { useCallback, useEffect, useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { applicationServerKey, pushSupport } from "@/lib/web-push-key";

/** Every word this renders, resolved server-side — see AGENTS.md on copy. */
export interface PushOptInCopy {
  heading: string;
  body: string;
  enable: string;
  enabling: string;
  disable: string;
  on: string;
  unsupported: string;
  homeScreenHint: string;
  denied: string;
  error: string;
}

export interface PushSubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * The manifest's opt-in for Web Push — the third refresh trigger, and the only
 * one that reaches a phone whose page is frozen (ADR 20260804-manifest-web-push).
 *
 * Permission is requested **only** behind this button. A permission prompt on
 * page load is the reliable way to get denied permanently, and a captain who
 * denies once cannot be asked again from the page.
 */
export function PushOptIn({
  publicKey,
  copy,
  subscribeAction,
  unsubscribeAction,
  isSubscribedAction,
  isSubscribedAnyAction,
}: {
  /** VAPID public key. Null when the server has no keys configured — the control hides. */
  publicKey: string | null;
  copy: PushOptInCopy;
  subscribeAction: (input: PushSubscriptionInput) => Promise<{ ok: boolean }>;
  unsubscribeAction: (endpoint: string) => Promise<{ ok: boolean; hasOtherTrips: boolean }>;
  /** Whether *this trip* has a row for this device — see the effect below. */
  isSubscribedAction: (endpoint: string) => Promise<boolean>;
  /** Whether *any* trip in this shop still has a row for this device. */
  isSubscribedAnyAction: (endpoint: string) => Promise<boolean>;
}) {
  const [support, setSupport] = useState<
    "checking" | "supported" | "needs-home-screen" | "unsupported"
  >("checking");
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<"denied" | "error" | null>(null);

  useEffect(() => {
    // Read support and current state on the client only: `pushSupport` reads
    // navigator/window, and the server render has neither.
    const state = pushSupport(window);
    setSupport(state);
    if (state !== "supported") return;
    void navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then(async (existing) => {
        // The browser subscription alone is *not* the answer. It is one per
        // registration — origin-wide — while a subscription row is per trip. A
        // captain running two departures has one browser subscription and needs
        // a row for each boat, so "is this device on for *this* trip" is a
        // question only the server can answer.
        if (!existing) return false;
        return isSubscribedAction(existing.endpoint);
      })
      .then((on) => setSubscribed(on))
      .catch(() => setSubscribed(false));
  }, [isSubscribedAction]);

  const enable = useCallback(async () => {
    if (!publicKey) return;
    setBusy(true);
    setProblem(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setProblem("denied");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      // Reuse the existing browser subscription when there is one. It is
      // origin-wide, so a captain opting a second departure in needs another
      // *row*, not another subscription — and re-subscribing would rotate the
      // endpoint out from under the first trip's row.
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          // Required by Chrome and Edge, which reject the subscription outright
          // without it — so every push shows a notification, and the server side
          // coalesces to keep that from being noise.
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey(publicKey),
        }));
      const json = subscription.toJSON();
      const result = await subscribeAction({
        endpoint: subscription.endpoint,
        p256dh: json.keys?.p256dh ?? "",
        auth: json.keys?.auth ?? "",
      });
      if (!result.ok) {
        // Don't leave the browser holding a subscription the server has no row
        // for — but only tear it down if no other trip is relying on it.
        const others = await isSubscribedAnyAction(subscription.endpoint).catch(() => false);
        if (!others) await subscription.unsubscribe().catch(() => undefined);
        setProblem("error");
        return;
      }
      setSubscribed(true);
    } catch {
      setProblem("error");
    } finally {
      setBusy(false);
    }
  }, [publicKey, subscribeAction, isSubscribedAnyAction]);

  const disable = useCallback(async () => {
    setBusy(true);
    setProblem(null);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        const { hasOtherTrips } = await unsubscribeAction(subscription.endpoint);
        // Only drop the browser subscription once no other departure needs it.
        if (!hasOtherTrips) await subscription.unsubscribe();
      }
      setSubscribed(false);
    } catch {
      setProblem("error");
    } finally {
      setBusy(false);
    }
  }, [unsubscribeAction]);

  // No keys configured server-side, or still deciding: render nothing rather
  // than a control that cannot work.
  if (!publicKey || support === "checking") return null;

  return (
    <div className="mt-4 border-border border-t pt-4">
      <h3 className="font-semibold text-sm">{copy.heading}</h3>
      <p className="mt-1 max-w-2xl text-muted text-sm leading-6">{copy.body}</p>
      {support === "supported" ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => void (subscribed ? disable() : enable())}
            className={buttonClass({ variant: "secondary" })}
          >
            {busy ? copy.enabling : subscribed ? copy.disable : copy.enable}
          </button>
          {subscribed ? <span className="text-muted text-sm">{copy.on}</span> : null}
        </div>
      ) : (
        <p className="mt-3 text-muted text-sm">
          {support === "needs-home-screen" ? copy.homeScreenHint : copy.unsupported}
        </p>
      )}
      {/* Stays mounted so a problem is announced when it arrives, matching the
          manager's own live region above. */}
      <p className={problem ? "mt-2 font-medium text-sm" : ""} aria-live="polite">
        {problem === "denied" ? copy.denied : problem === "error" ? copy.error : ""}
      </p>
    </div>
  );
}
