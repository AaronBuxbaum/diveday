"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { redactCapabilityUrl } from "./observability";

/**
 * Amazon CloudWatch RUM — the session, geography, and device half of DiveDay's
 * real-user monitoring (ADR 20260806-cloudwatch-rum-and-vitals).
 *
 * The vitals beacon beside this one produces the *numbers* (p75 LCP/INP/CLS as
 * CloudWatch metrics, with alarms). RUM produces the *context* those numbers
 * sit in — which pages, which countries, which browsers, and how a session
 * moved between them — none of which a metric can answer.
 *
 * Three deliberate narrowings, each of which trades a RUM feature for a
 * property this app already promises:
 *
 * 1. **`telemetries: ["performance"]` only.** RUM's `errors` telemetry would
 *    duplicate Sentry, which has better stack traces and release attribution;
 *    its `http` telemetry records request URLs, and this app's fetches include
 *    bearer-capability paths. Neither is worth what it would carry.
 * 2. **`disableAutoPageView: true`.** RUM's own page-view recorder reads
 *    `location.pathname` verbatim, which on `/waivers/<token>` is a replayable
 *    credential leaving for a third system. Page views are recorded here
 *    instead, through the same `redactCapabilityUrl` Analytics, Speed Insights
 *    and Sentry all use (docs/engineering/capability-telemetry-runbook.md).
 * 3. **`allowCookies: false`.** RUM's cookies exist to stitch a session across
 *    page loads. Without them a session is one page load, which is less useful
 *    and asks nothing of a diver's consent — the right side of that trade for
 *    a product whose visitors are mid-booking.
 */

type RumConfig = {
  applicationId: string;
  identityPoolId: string;
  guestRoleArn: string;
  region: string;
  sessionSampleRate: number;
};

/**
 * All five values are `NEXT_PUBLIC_` because the browser is the only thing that
 * uses them, and none is a secret: the identity pool grants exactly
 * `rum:PutRumEvents` on one app monitor and nothing else (infra-stack.ts §13).
 * Unset — every local run, the e2e fleet, a fork — returns null and no SDK is
 * ever fetched.
 */
function rumConfig(): RumConfig | null {
  const applicationId = process.env.NEXT_PUBLIC_RUM_APP_MONITOR_ID;
  const identityPoolId = process.env.NEXT_PUBLIC_RUM_IDENTITY_POOL_ID;
  const guestRoleArn = process.env.NEXT_PUBLIC_RUM_GUEST_ROLE_ARN;
  const region = process.env.NEXT_PUBLIC_RUM_REGION;
  if (!applicationId || !identityPoolId || !guestRoleArn || !region) return null;
  const rate = Number(process.env.NEXT_PUBLIC_RUM_SAMPLE_RATE ?? "1");
  return {
    applicationId,
    identityPoolId,
    guestRoleArn,
    region,
    // A misconfigured rate must never mean "record everything at full price";
    // anything unparseable or out of range falls back to the documented default.
    sessionSampleRate: Number.isFinite(rate) && rate >= 0 && rate <= 1 ? rate : 1,
  };
}

type PageViewRecorder = { recordPageView: (pageId: string) => void };

export function CloudWatchRum() {
  // `usePathname` rather than `useSearchParams`: the latter opts a route out of
  // static prerendering unless it sits under its own Suspense boundary, and
  // this component is mounted in the root layout — it would cost every route in
  // the app its static shell (ADR 20260804-instant-navigation). The query
  // string is read off `window.location` inside the effect instead, which is
  // client-only by construction and needs no hook.
  const pathname = usePathname();
  const client = useRef<PageViewRecorder | null>(null);

  useEffect(() => {
    const config = rumConfig();
    if (!config) return;
    let cancelled = false;

    void (async () => {
      try {
        const { AwsRum } = await import("aws-rum-web");
        if (cancelled) return;
        client.current = new AwsRum(config.applicationId, "1.0.0", config.region, {
          identityPoolId: config.identityPoolId,
          guestRoleArn: config.guestRoleArn,
          sessionSampleRate: config.sessionSampleRate,
          telemetries: ["performance"],
          allowCookies: false,
          enableXRay: false,
          disableAutoPageView: true,
        });
        // The effect below already ran, against a client that did not exist
        // yet, so the entry page view is recorded here or not at all.
        client.current.recordPageView(
          redactCapabilityUrl(`${window.location.pathname}${window.location.search}`),
        );
      } catch {
        // A blocked SDK fetch, a refused Cognito exchange, an ad blocker: none
        // of it is the page's problem. Telemetry never breaks a booking.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Recorded on every navigation, soft or hard, and always through the
  // redaction — this is the only place a URL reaches RUM.
  useEffect(() => {
    const pageId = redactCapabilityUrl(`${pathname}${window.location.search}`);
    try {
      client.current?.recordPageView(pageId);
    } catch {
      // Same reasoning as above.
    }
  }, [pathname]);

  return null;
}
