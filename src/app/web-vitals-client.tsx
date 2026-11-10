"use client";

import { useReportWebVitals } from "next/web-vitals";
import { useEffect, useRef } from "react";
import { WEB_VITAL_NAMES, type WebVitalName } from "@/lib/observability/web-vitals";
import { redactCapabilityUrl } from "./observability";

/**
 * Reports Core Web Vitals to `/api/vitals` — the browser half of DiveDay's
 * Speed Insights equivalent (ADR 20260806-cloudwatch-rum-and-vitals).
 *
 * No SDK and no new dependency: `useReportWebVitals` is Next's own hook over
 * the `web-vitals` library it already bundles, so this costs a few hundred
 * bytes rather than a third analytics client on a diver's hotel wifi.
 *
 * **One batch per hide, only changed measurements.** Metrics remain pending until
 * sendBeacon accepts the batch. Resuming a tab can update INP/CLS, and bfcache
 * restores can start new metric IDs; both must remain observable. An unchanged
 * measurement is never replayed by a second hide/pagehide event. Acceptance is
 * browser queueing, not evidence of server delivery.
 *
 * **Attribution is per page load, not per client navigation.** The route is
 * captured when the first metric arrives. LCP, FCP and TTFB genuinely belong to
 * that load; INP and CLS accumulate across any soft navigations that followed
 * and are attributed to the entry route. That is a known, deliberate
 * simplification — the alternative is threading router events through this
 * component for a per-route split the dashboard does not currently show.
 */

const REPORTED = new Set<string>(WEB_VITAL_NAMES);

export function WebVitals() {
  const values = useRef(new Map<WebVitalName, { id: string; value: number }>());
  const accepted = useRef(new Map<WebVitalName, { id: string; value: number }>());
  const route = useRef<string | null>(null);
  const navigationType = useRef<string | undefined>(undefined);

  useReportWebVitals((metric) => {
    if (!REPORTED.has(metric.name)) return;
    // Last value wins: the browser re-reports INP and CLS as a visit degrades,
    // and the final figure is the one that describes the visit.
    const name = metric.name as WebVitalName;
    const previous = accepted.current.get(name);
    if (previous && previous.id === metric.id && previous.value === metric.value) {
      values.current.delete(name);
    } else {
      values.current.set(name, { id: metric.id, value: metric.value });
    }
    navigationType.current = metric.navigationType;
    if (route.current === null) {
      route.current = redactCapabilityUrl(`${window.location.pathname}${window.location.search}`);
    }
  });

  useEffect(() => {
    const send = () => {
      if (values.current.size === 0 || route.current === null) return;
      if (typeof navigator.sendBeacon !== "function") return;
      const pending = new Map(values.current);
      const body = JSON.stringify({
        url: route.current,
        navigationType: navigationType.current,
        metrics: [...pending].map(([name, metric]) => ({ name, value: metric.value })),
      });
      try {
        if (!navigator.sendBeacon("/api/vitals", new Blob([body], { type: "application/json" }))) {
          return;
        }
      } catch {
        // Keep the batch for the next lifecycle event; telemetry never breaks navigation.
        return;
      }
      for (const [name, metric] of pending) {
        accepted.current.set(name, metric);
        values.current.delete(name);
      }
    };

    // `visibilitychange` to hidden is the only event every browser reliably
    // fires before a tab goes away; `pagehide` covers the bfcache path Safari
    // takes instead. Both call the same guarded send, so a browser that fires
    // both still sends once.
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") send();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", send);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", send);
    };
  }, []);

  return null;
}
