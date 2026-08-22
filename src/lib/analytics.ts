import { track as vercelTrack } from "@vercel/analytics/server";
import { installCapabilityUrlRedaction } from "./analytics-request-context";
import type { DemoRoleId } from "./demo-roles";
import type { FunnelSource } from "./funnel";
import { log } from "./log";
import type { RollCallCheckpoint } from "./manifests";

/**
 * Whether the un-wrappable-context warning has already been written.
 *
 * Once per process, not once per event: the condition is a property of the
 * runtime rather than of any one event, so logging it per call would bury the
 * drain under a line for every tracked action.
 */
let warnedAboutRedaction = false;

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
export type EventSurface = "today" | "blockers" | "roster" | "check_in" | "diver";

/**
 * The typed event vocabulary. Adding an event here — rather than a free-form
 * `track("...")` at a call site — keeps the set of things we measure in one
 * reviewable place and gives every consumer the same prop shapes.
 */
export type AnalyticsEvent =
  | {
      /** Staff cleared a readiness blocker in place (the recovery path). */
      name: "staff_recovery";
      kind: "waiver_sent" | "confirmation_resent" | "waitlist_invited" | "invoice_resent";
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
       * demo-vs-trial story can be read per surface; `role` names which of the
       * landing page's role-picker options they chose (or "owner", the primary
       * CTA's default when no picker option was used).
       */
      name: "demo_entered";
      source: FunnelSource | "unknown";
      role: DemoRoleId;
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
        | "trip_prerequisite"
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
      /**
       * A party member claimed their own seat through a `/claim/[token]` link
       * (docs ADR 20260804-seat-claim-links) — the group-organizer bet's core
       * conversion: paperwork moving off the organizer and onto the diver it
       * belongs to. Never carries the token or any identity.
       */
      name: "seat_claimed";
      source: "diver";
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
        | "has_roster"
        | "capacity_above_boat";
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
    }
  | {
      /**
       * Staff called (or re-ran) a weather blow-out cascade — the one-tap
       * cancellation with per-diver rebooking offers (ADR
       * 20260804-blowout-cascade). The counts say how the send pass landed;
       * `resumed` distinguishes the first call from a pickup of pending rows.
       */
      name: "blowout_called";
      resumed: boolean;
      total: number;
      sent: number;
      failed: number;
      noEmail: number;
    }
  | {
      /** Staff retried a blow-out's failed messages from the cascade surface. */
      name: "blowout_resumed";
      total: number;
      sent: number;
      failed: number;
    }
  | {
      /** Staff opened the complete trip packet from the Overview tab. */
      name: "trip_print_pdf_clicked";
      surface: "trip_overview";
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
    // Before anything reaches Vercel, not once at module load: the runtime
    // installs its request-context global itself, and there is no ordering
    // guarantee that it has done so by the time this module is first imported.
    // The wrap is idempotent and O(1), so paying it per event is cheaper than
    // reasoning about that ordering — and missing the install is the silent
    // failure the whole thing exists to prevent. See
    // `analytics-request-context.ts` for why the page URL cannot be redacted at
    // this call site instead.
    //
    // Inside the try, not above it. Callers are entitled to treat this function
    // as total — `authorize()` in `src/lib/auth.ts` calls it as a bare `void
    // trackEvent(...)` precisely because it swallows its own errors — and when
    // the install threw here instead, that became an unhandled rejection on the
    // sign-in path and an error out of every `after()` callback.
    if (tracker === vercelTrack) {
      const { status } = installCapabilityUrlRedaction();
      // Fail closed. `failed` means a request context is present but could not
      // be wrapped, so the SDK would compose the event's page URL from the raw
      // request — and on `/waivers/[token]` and friends that URL *is* the
      // credential. Losing a count is cheaper than leaking one. `absent` (dev,
      // tests, self-hosted: no context at all) has nothing to leak, so it sends.
      //
      // Say so once, rather than going quiet: dropping every server-side event
      // is exactly as invisible as leaking one used to be, and the reason this
      // shim's first version survived a day in production is that nothing was
      // watching it. A runtime upgrade that defeats both install strategies
      // should show up in the drain, not in a month-end dashboard gap.
      if (status === "failed") {
        if (!warnedAboutRedaction) {
          warnedAboutRedaction = true;
          log("analytics.capability_redaction_uninstallable", "warn");
        }
        return;
      }
    }
    await tracker(name, properties as EventProps);
  } catch {
    // Telemetry is observational, never load-bearing.
  }
}
