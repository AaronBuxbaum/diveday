import { track as vercelTrack } from "@vercel/analytics/server";

/**
 * Custom event instrumentation, one seam. Page-level analytics already ships via
 * the Vercel `<Analytics />` component; this adds the discrete product events the
 * page view can't see — where staff hit a blocker, how often they recover it, and
 * where a diver abandons a flow. Like the notification and storage seams, the
 * provider lives behind one entry point so a flow never breaks on a telemetry
 * hiccup and the event vocabulary stays typed and searchable
 * (docs/architecture/decisions/20260723-event-instrumentation.md).
 */

/** Where a staff action happened, so recovery can be sliced by surface. */
export type EventSurface = "today" | "blockers" | "roster";

/**
 * The typed event vocabulary. Adding an event here — rather than a free-form
 * `track("...")` at a call site — keeps the set of things we measure in one
 * reviewable place and gives every consumer the same prop shapes.
 */
export type AnalyticsEvent =
  | {
      /** Staff cleared a readiness blocker in place (the recovery path). */
      name: "staff_recovery";
      kind: "waiver_sent" | "confirmation_resent" | "waitlist_invited";
      surface: EventSurface;
    }
  | {
      /** How much a diver was blocking a boat when staff opened Today. */
      name: "blockers_surfaced";
      count: number;
      urgent: number;
    }
  | {
      /** A checkout the diver never completed — the pay-at-booking abandonment signal. */
      name: "checkout_abandoned";
      isDeposit: boolean;
    };

type EventProps = Record<string, string | number | boolean | null>;
export type Tracker = (name: string, properties?: EventProps) => Promise<void> | void;

/**
 * Emit one typed event. Best-effort by construction: a provider error (or no
 * provider at all, as in dev and tests) is swallowed so instrumentation can
 * never take down the flow it observes. The tracker is injectable for tests.
 */
export async function trackEvent(
  event: AnalyticsEvent,
  tracker: Tracker = vercelTrack,
): Promise<void> {
  const { name, ...properties } = event;
  try {
    await tracker(name, properties as EventProps);
  } catch {
    // Telemetry is observational, never load-bearing.
  }
}
