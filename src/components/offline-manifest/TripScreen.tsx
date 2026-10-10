import type { ComponentProps, ReactNode } from "react";
import { BoatSafetyNotices } from "@/components/BoatSafetyNotices";
import { EmergencyReferenceCard } from "@/components/EmergencyReferenceCard";
import { OfflineShellVersionBanner } from "@/components/OfflineShellVersionBanner";
import { PullToRefresh } from "@/components/PullToRefresh";
import { SkipLink } from "@/components/SkipLink";
import { buttonClass } from "@/components/ui/button";
import { rollCallCheckpointText } from "@/i18n/manifest-labels";
import { EMPTY_EMERGENCY_REFERENCE } from "@/lib/emergency-reference";
import { rollCallCheckpoints } from "@/lib/manifests";
import { OfflineChecklist } from "./Checklist";
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
  shellVersionCopy,
  discardNotice,
  reconcile,
}: {
  view: OfflineTripView;
  controls: OfflineTripControls;
  tripId: string;
  shellVersionCopy: ComponentProps<typeof OfflineShellVersionBanner>["copy"];
  discardNotice: ReactNode;
  reconcile: () => Promise<void>;
}) {
  const { envelope, manifest, checkpoint } = view;
  const { t, setCheckpoint } = controls;

  return (
    <main
      data-roll-call-surface
      className="boat-mode mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6"
    >
      <PullToRefresh onRefresh={reconcile}>
        <OfflineShellVersionBanner copy={shellVersionCopy} />
        {discardNotice}
        <SkipLink
          href="#offline-roll-call"
          label={t("shared.offlineManifest.single.skipLink")}
          level="page"
        />
        <OfflineTripHeader view={view} controls={controls} />

        {/* **Above the roster, deliberately.** This is the one document a crew has
          with no signal, and the numbers on it are the ones you reach for while
          somebody is bent — not after the boat is back. Everything below is who
          is aboard; this is what to do about it. Rides in the snapshot, so it is
          here in airplane mode (issue #688). */}
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
            shoreContactLabel: t("manifest.emergency.shoreContactLabel"),
            planLabel: t("manifest.emergency.planLabel"),
          }}
        />

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

        {/* `max-sm:[&>*]:grow`, the rule `ShopPageHeader` gives its doors: on
            a phone each wrapped row of checkpoints fills as one band, rather
            than leaving "After dive 2" alone and short on a row of its own. */}
        <nav
          className="mt-6 flex flex-wrap items-center gap-3 pb-1 max-sm:[&>*]:grow"
          aria-label={t("shared.offlineManifest.single.checkpointNavAria")}
        >
          {rollCallCheckpoints(manifest.trip.plannedDives).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setCheckpoint(value)}
              className={buttonClass({
                variant: value === checkpoint ? "primary" : "secondary",
                size: "boat",
                className: "shrink-0",
              })}
            >
              {rollCallCheckpointText(t, value)}
            </button>
          ))}
        </nav>

        <OfflineRollCallSection view={view} controls={controls} />

        <OfflineTripFoot view={view} controls={controls} tripId={tripId} />
      </PullToRefresh>
    </main>
  );
}
