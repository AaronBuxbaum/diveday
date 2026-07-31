"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { redactCapabilityUrl } from "./observability";

// `next/dynamic` (ssr: false) keeps both SDKs' JS out of the bundle a diver's
// first paint waits on — it's only fetched once `Observability` actually
// renders them, which the idle/timeout gate below pushes past hydration.
const Analytics = dynamic(() => import("@vercel/analytics/next").then((mod) => mod.Analytics), {
  ssr: false,
});
const SpeedInsights = dynamic(
  () => import("@vercel/speed-insights/next").then((mod) => mod.SpeedInsights),
  { ssr: false },
);

/**
 * Single mount point for both telemetry SDKs so the capability-route
 * redaction (CR-001) can't be bypassed by adding a raw <Analytics /> or
 * <SpeedInsights /> elsewhere.
 *
 * Neither SDK mounts until the browser is idle after hydration (task 123 /
 * persona 15, Leo): a diver on a slow hotel-wifi or 3G connection gets the
 * booking form's own scripts and data first, with telemetry arriving a beat
 * later rather than racing it for bandwidth on first load.
 */
export function Observability() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Safari has no requestIdleCallback; a short timeout is still well clear
    // of the critical hydration path it would otherwise share with.
    if (typeof requestIdleCallback === "function") {
      const handle = requestIdleCallback(() => setReady(true));
      return () => cancelIdleCallback(handle);
    }
    const handle = setTimeout(() => setReady(true), 200);
    return () => clearTimeout(handle);
  }, []);

  if (!ready) return null;

  return (
    <>
      <Analytics beforeSend={(event) => ({ ...event, url: redactCapabilityUrl(event.url) })} />
      <SpeedInsights beforeSend={(event) => ({ ...event, url: redactCapabilityUrl(event.url) })} />
    </>
  );
}
