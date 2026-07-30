import { track as vercelTrack } from "@vercel/analytics/server";
import type { FunnelSource } from "./funnel";
import type { RollCallCheckpoint } from "./manifests";

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
      source: FunnelSource | "unknown";
    }
  | {
      /**
       * A visitor finished the sign-up form and got a shop of their own — the
       * other half of the funnel `demo_entered` opens. Same `source` vocabulary,
       * so demo-vs-trial can be read per marketing surface.
       */
      name: "trial_started";
      source: FunnelSource | "unknown";
    }
  | {
      /** A diver or staff member completed a booking — the core conversion moment. */
      name: "booking_completed";
      source: "diver" | "staff";
      partySize: number;
    }
  | {
      /**
       * A booking attempt was refused — full trip, a cert/nitrox prerequisite,
       * or a data mismatch. `reason` is the confusion signal: a prerequisite
       * or age reason recurring on one course means the requirement isn't
       * clear at the point of booking, not that divers keep failing to meet it.
       */
      name: "booking_blocked";
      source: "diver" | "staff";
      reason:
        | "trip_unavailable"
        | "course_unstaffed"
        | "person_not_found"
        | "course_prerequisite"
        | "course_min_age"
        | "trip_full"
        | "course_ratio_full"
        | "already_booked";
    }
  | {
      /** A diver joined a full trip's wait list instead of booking outright. */
      name: "waitlist_joined";
      source: "diver" | "staff";
    }
  | {
      /** A booking was cancelled, by the diver themself or by a staff member. */
      name: "booking_cancelled";
      source: "diver" | "staff";
    }
  | {
      /** A diver finished and signed their waiver. */
      name: "waiver_signed";
    }
  | {
      /**
       * Staff tried to board a diver at roll call whose readiness gate (cert,
       * waiver, payment) hadn't cleared. A checkpoint where this recurs is
       * where readiness work is being left too late, not a boarding bug.
       */
      name: "roll_call_blocked";
      checkpoint: RollCallCheckpoint;
    }
  | {
      /** One of the schedule builder's four departure mutations, and how it landed. */
      name: "schedule_builder_action";
      action: "add" | "move" | "copy" | "remove";
      outcome:
        | "ok"
        | "invalid"
        | "end_before_start"
        | "not_found"
        | "not_scheduled"
        | "already_sailed"
        | "has_roster";
    }
  | {
      /** A refund was issued after a cancellation, automatically or by a staff member. */
      name: "refund_issued";
      auto: boolean;
      status: "refunded" | "forfeit" | "failed" | "manual";
    }
  | {
      /** A staff sign-in attempt and how it resolved — the friction signal for the sign-in form. */
      name: "sign_in_attempted";
      outcome: "success" | "invalid_credentials" | "rate_limited";
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
  // Browser tests exercise our full Next/database stack but must not wait on a
  // third-party collector. Swallowing the error is not enough: callers `await`
  // this before doing their own work (`enterDemoAction` tracks `demo_entered`
  // before minting the shop), and under restricted outbound egress the request
  // hangs until it fails rather than failing fast — so a provider that is
  // merely unreachable still charges its full stall to a user-facing flow.
  // Best-effort has to mean latency too, not just errors. Passing an explicit
  // tracker still exercises the seam in unit tests (mirrors marine-forecast.ts).
  if (process.env.DIVEDAY_DISABLE_EXTERNAL_HTTP === "1" && tracker === vercelTrack) return;

  const { name, ...properties } = event;
  try {
    await tracker(name, properties as EventProps);
  } catch {
    // Telemetry is observational, never load-bearing.
  }
}
