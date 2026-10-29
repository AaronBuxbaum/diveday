import type { ComponentProps, ReactNode } from "react";
import { BoatSafetyNotices } from "@/components/BoatSafetyNotices";
import { EmergencyReferenceCard } from "@/components/EmergencyReferenceCard";
import { OfflineShellVersionBanner } from "@/components/OfflineShellVersionBanner";
import { OFFLINE_NOTICE_CLASS } from "@/components/offline-notice";
import { PullToRefresh } from "@/components/PullToRefresh";
import { RollCallTouchCue } from "@/components/RollCallTouchCue";
import { SkipLink } from "@/components/SkipLink";
import { buttonClass } from "@/components/ui/button";
import { EMPTY_EMERGENCY_REFERENCE } from "@/lib/emergency-reference";
import { OfflineChecklist, OfflineSnags } from "./Checklist";
import { OfflineCheckpointNav } from "./CheckpointNav";
import { OfflineCounter } from "./Counter";
import type { OfflineTripControls } from "./controls";
import { OfflineRollCallSection } from "./RollCallSection";
import { OfflineTripFoot } from "./TripFoot";
import { OfflineTripHeader } from "./TripHeader";
import type { OfflineTripView } from "./trip-view";

/** One saved trip on this device, as the crew works it with no signal. */
export function OfflineTripScreen({
  view,
  controls,
  tripId,
  foreignPendingChanges,
  shellVersionCopy,
  discardNotice,
  reconcile,
}: {
  view: OfflineTripView;
  controls: OfflineTripControls;
  tripId: string;
  foreignPendingChanges: boolean;
  shellVersionCopy: ComponentProps<typeof OfflineShellVersionBanner>["copy"];
  discardNotice: ReactNode;
  reconcile: () => Promise<void>;
}) {
  const { envelope } = view;
  const { t } = controls;

  return (
    // **A paper page with a column on it** (visual review 2026-10-24, B51):
    // Boat mode's paper fills the window and the copy reads in one centred
    // `max-w-3xl` column, rather than a column floating on the body's grey.
    <main data-roll-call-surface className="boat-mode w-full flex-1 bg-background">
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
        <PullToRefresh onRefresh={reconcile}>
          <OfflineShellVersionBanner copy={shellVersionCopy} />
          {discardNotice}
          {foreignPendingChanges ? (
            <p
              className={`${OFFLINE_NOTICE_CLASS} border-warning/40 bg-warning/10 text-pretty`}
              role="status"
              aria-live="polite"
            >
              {t("shared.offlineManifest.reconcile.foreignPending")}
            </p>
          ) : null}
          <SkipLink
            href="#offline-roll-call"
            label={t("shared.offlineManifest.single.skipLink")}
            level="page"
          />
          <OfflineTripHeader view={view} controls={controls} />
          {!view.envelope.snapshot.juniorAdvisoriesChecked ? (
            <p className="mt-3 text-base text-warning-strong">
              {t("shared.offlineManifest.juniorChecksUnavailable")}
            </p>
          ) : null}
          <a
            href="#offline-roll-call-context"
            className={buttonClass({
              variant: "link",
              flush: true,
              className: "mt-2 print:hidden",
            })}
          >
            {t("shared.offlineManifest.single.rollCallJump")}
          </a>

          {/* **Above the roster, deliberately.** This is the one document a crew has
          with no signal, and the numbers on it are the ones you reach for while
          somebody is bent — not after the boat is back. Everything below is who
          is aboard; this is what to do about it. Rides in the snapshot, so it is
          here in airplane mode (issue #688). */}
          <section id="offline-emergency-reference" tabIndex={-1} className="scroll-mt-24">
            <EmergencyReferenceCard
              className="mt-6"
              // A snapshot saved before this field existed still decrypts, so it
              // arrives without one. Falls back to the empty reference, which renders
              // the "nothing recorded yet" prompt — the same thing a shop that has
              // filled nothing in sees, and the only outcome that does not throw on
              // the one surface a crew has offshore.
              reference={envelope.snapshot.shop.emergencyReference ?? EMPTY_EMERGENCY_REFERENCE}
              copy={{
                heading: t("manifest.emergency.heading"),
                empty: t("manifest.emergency.empty"),
                vesselLabel: t("manifest.emergency.vesselLabel"),
                callSignLabel: t("manifest.emergency.callSignLabel"),
                mmsiLabel: t("manifest.emergency.mmsiLabel"),
                workingChannelLabel: t("manifest.emergency.workingChannelLabel"),
                distressChannel: t("manifest.emergency.distressChannel"),
                shoreContactLabel: t("manifest.emergency.shoreContactLabel"),
                planLabel: t("manifest.emergency.planLabel"),
              }}
            />
          </section>

          {/* Opt-in by presence, the same rule the gear register follows: a shop
          with no checklist items renders nothing here, not an empty card.
          Above the checkpoint switcher because the check happens once,
          before the boat leaves — not once per checkpoint. */}
          {/* The hull's papers and safety kit as the live Boat tab said them at
          the save, above the boat check for the same reason the live page
          puts them there. Words, not codes: nothing here can word them. */}
          {envelope.snapshot.boatSafety ? (
            <BoatSafetyNotices className="mt-6" {...envelope.snapshot.boatSafety} />
          ) : null}
          {/* What the last crew said about this hull, above the check it was
          written against, as the live page carries it. */}
          <OfflineSnags view={view} />
          <OfflineChecklist view={view} controls={controls} />

          {/* **The desk, with no signal** (ADR
          20260907-the-counter-survives-offline). Above the checkpoint switcher
          for the same reason the checklist is: arriving happens once, before
          the boat leaves, not once per dive. It is deliberately a separate
          list from the roll call below rather than a second control on those
          rows — arrived and aboard are two different questions asked in two
          different places, and a row that answered both would be the first
          step toward a queue answering the second. */}
          <OfflineCounter view={view} controls={controls} />

          <section id="offline-roll-call-context" tabIndex={-1} className="scroll-mt-24">
            <OfflineCheckpointNav view={view} controls={controls} />

            <OfflineRollCallSection view={view} controls={controls} />
          </section>

          <OfflineTripFoot view={view} controls={controls} tripId={tripId} />
        </PullToRefresh>
      </div>
      {/* The words for a press the touch guard refused (issue #2328). */}
      <RollCallTouchCue message={t("manifest.touchRefused")} />
    </main>
  );
}
