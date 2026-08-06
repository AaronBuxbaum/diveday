"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { redactCapabilityUrl } from "./observability";
import { WebVitals } from "./web-vitals-client";

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
// CloudWatch RUM is the heaviest of the four and the only one that fetches an
// SDK from the bundle rather than a CDN, so it gets the same treatment: never
// in the first-load graph, and never before the idle gate below.
const CloudWatchRum = dynamic(() => import("./rum-client").then((mod) => mod.CloudWatchRum), {
  ssr: false,
});

/**
 * Single mount point for every telemetry client so the capability-route
 * redaction (CR-001) can't be bypassed by adding a raw <Analytics />,
 * <SpeedInsights />, or RUM client elsewhere.
 *
 * Nothing mounts until the browser is idle after hydration (task 123 /
 * persona 15, Leo): a diver on a slow hotel-wifi or 3G connection gets the
 * booking form's own scripts and data first, with telemetry arriving a beat
 * later rather than racing it for bandwidth on first load.
 *
 * `<WebVitals />` is the exception to the dynamic-import treatment, and
 * deliberately so: it is Next's own `useReportWebVitals` hook over the
 * `web-vitals` code the framework already ships, so there is no third-party
 * bundle to defer — and it has to observe the load it is measuring rather than
 * arriving after it (ADR 20260806-cloudwatch-rum-and-vitals).
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

  return (
    <>
      <WebVitals />
      {ready ? (
        <>
          <Analytics beforeSend={(event) => ({ ...event, url: redactCapabilityUrl(event.url) })} />
          <SpeedInsights
            beforeSend={(event) => ({ ...event, url: redactCapabilityUrl(event.url) })}
          />
          <CloudWatchRum />
        </>
      ) : null}
    </>
  );
}
