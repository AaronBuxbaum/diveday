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
    }
  | {
      /**
       * A visitor entered the live demo — the primary skeptic funnel on the
       * marketing pages. `source` names the page the click came from so the
       * demo-vs-trial story can be read per surface.
       */
      name: "demo_entered";
      source: string;
    }
  | {
      /**
       * A visitor finished the sign-up form and got a shop of their own — the
       * other half of the funnel `demo_entered` opens. Same `source` vocabulary,
       * so demo-vs-trial can be read per marketing surface.
       */
      name: "trial_started";
      source: string;
    };

/**
 * Normalize the funnel `source` a marketing page carries into a form or a query
 * string. It arrives from the visitor's request, so it is clamped to the short
 * slug shape our pages actually emit ("pricing", "switching-eve"); anything else
 * becomes "unknown" rather than letting arbitrary text into the event stream.
 */
export function eventSource(value: unknown): string {
  return typeof value === "string" && /^[a-z0-9-]{1,40}$/.test(value) ? value : "unknown";
}

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
