"use client";

import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { redactCapabilityUrl } from "./observability";

/**
 * Single mount point for both telemetry SDKs so the capability-route
 * redaction (CR-001) can't be bypassed by adding a raw <Analytics /> or
 * <SpeedInsights /> elsewhere.
 */
export function Observability() {
  return (
    <>
      <Analytics beforeSend={(event) => ({ ...event, url: redactCapabilityUrl(event.url) })} />
      <SpeedInsights beforeSend={(event) => ({ ...event, url: redactCapabilityUrl(event.url) })} />
    </>
  );
}
