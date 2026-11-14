import { HapticsToggle } from "@/components/HapticsToggle";
import { MilestoneHaptics } from "@/components/MilestoneHaptics";
import { SubSurfaceRipple } from "@/components/SubSurfaceRipple";
import { buttonClass } from "@/components/ui/button";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import type { OfflineTripControls } from "./controls";
import { liveManifestHref, type OfflineTripView } from "./trip-view";

/** Device settings, the live destination and local milestone feedback stay in Deck Details. */
export function OfflineTripFoot({
  view,
  controls,
  tripId,
}: {
  view: OfflineTripView;
  controls: OfflineTripControls;
  tripId: string;
}) {
  const { envelope, checkpoint, totalDivers, boarded, allBoarded } = view;
  const { t } = controls;
  return (
    <>
      {/* Per-device controls are secondary to roll call. Keep them in the
          same disclosure on the offline surface as the live manifest's
          "On this phone" group, rather than mixing one toggle into the
          checkpoint selector. The haptics toggle renders nothing on a phone
          with no vibration motor, and then the group has nothing in it, so
          it hides rather than opening onto an empty box. */}
      <section
        className="mt-8 border-t border-border pt-5 has-[[data-phone-prefs]:empty]:hidden"
        aria-labelledby="offline-phone-heading"
      >
        <details id="offline-phone-settings" className="group/offline-phone">
          <summary className="group/summary flex min-h-14 cursor-pointer list-none items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-surface-sunken/70 focus-visible:focus-ring-inset [&::-webkit-details-marker]:hidden">
            <DisclosureCaret className="group-open/offline-phone:rotate-90" />
            <h2
              id="offline-phone-heading"
              className="text-base font-semibold group-hover/summary:underline"
            >
              {t("manifest.onThisPhone")}
            </h2>
          </summary>
          <div data-phone-prefs className="grid gap-3 pt-4 sm:grid-cols-2">
            {/* Renders nothing on a phone with no vibration motor — which is
                every iPhone (src/components/haptics.ts). */}
            <HapticsToggle
              copy={{ label: t("shared.haptics.toggleLabel") }}
              className="h-full w-full justify-start"
            />
          </div>
        </details>
      </section>

      <footer className="mt-8 flex flex-wrap items-center gap-4 border-t border-border pt-5">
        <a
          href={liveManifestHref(envelope, tripId, checkpoint)}
          className={buttonClass({
            size: "boat",
            className: "w-full sm:w-auto",
          })}
        >
          {t("shared.offlineManifest.single.openLiveManifest")}
        </a>
      </footer>

      {/*
       * Dive-domain-expert review (task 72, invariant 3): none of these three
       * react to an attempted board/not-board tap — only to the envelope's
       * own boarded/awaiting counts, which cannot change while `expired` is
       * true (record() above refuses before ever calling
       * appendOfflineRollCall). So an expired copy — where no board/not-board
       * buttons render at all — never fires a haptic or the ripple for an
       * action the store was about to reject; there's no action for it to be
       * attempted for. MilestoneHaptics and SubSurfaceRipple both skip their
       * very first render besides (see their own components), so mounting
       * with an already-complete roll call never fires either on load.
       *
       * Invariant 5: the ripple and haptics are a same-device UI reaction,
       * not a claim that the server has confirmed anything — pending/rejected
       * counts stay visible in the header above regardless, and sync
       * reconciliation (reconcile(), above) remains the only thing that ever
       * changes `syncStatus`.
       */}
      <MilestoneHaptics total={totalDivers} boarded={boarded} />
      {/*
       * Gated on `allBoarded` (the true boarded count), not `rollCallComplete`
       * (awaiting === 0) — task 72, invariant 4. A checkpoint with a
       * carried-forward not-boarded diver reaches awaiting === 0 without
       * everyone being aboard; the celebration must not read as "everyone's
       * aboard" for that manifest.
       */}
      <SubSurfaceRipple
        complete={allBoarded}
        copy={{
          iconTitle: t("shared.subSurfaceRipple.iconTitle"),
          message: t("shared.subSurfaceRipple.message"),
        }}
      />
    </>
  );
}
