import { HapticsToggle } from "@/components/HapticsToggle";
import { MilestoneHaptics } from "@/components/MilestoneHaptics";
import { MissingDiversGrid } from "@/components/MissingDiversGrid";
import { SubSurfaceRipple } from "@/components/SubSurfaceRipple";
import { buttonClass } from "@/components/ui/button";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import type { OfflineTripControls } from "./controls";
import { offlineRollCallRowId } from "./shared";
import type { OfflineTripView } from "./trip-view";

/** Below the roll call: the faces still to call, this phone's settings, the live page, and the milestone. */
export function OfflineTripFoot({
  view,
  controls,
  tripId,
}: {
  view: OfflineTripView;
  controls: OfflineTripControls;
  tripId: string;
}) {
  const { envelope, checkpoint, isDeparture, missingDivers, totalDivers, boarded, allBoarded } =
    view;
  const { t } = controls;
  return (
    <>
      {/* Same words as the live page, chosen by the same checkpoint rule: at
          the dock these are people still to board, after a dive they are
          people nobody has counted back aboard yet. The dock copy must never
          be louder than the live manifest about a benign state.

          **The grid stays here, and only here** (decision 20260812, closing
          FU-20260810-offline-manifest-checklist-grammar). The live manifest
          dropped its face grid, and then the name chips that replaced it,
          because the roll-call rows directly below already name everyone
          (Aaron, 2026-10-05).

          The grid is also a scanning surface rather than a jump list, and this
          is the copy read underway, at the rail, looking up from the water for
          a face rather than down at a name. Its rents-kit line carries
          information no chip does. Keeping it is a considered divergence
          from the live page, not a leftover: the *rows* above now read
          identically on both surfaces, which is what a captain working the two
          minutes apart actually needs.

          The blocked accent is **not** part of that divergence — it follows
          the live chip's checkpoint rule below. The one thing that does stay
          ungated is the diver row's own readiness badge, for the reason
          written above it: that badge is the snapshot's two-state record, not
          an exception accent on a checkpoint-scoped prompt. */}
      <MissingDiversGrid
        divers={missingDivers.map((diver) => ({
          bookingId: diver.bookingId,
          fullName: diver.fullName,
          // Where the tap lands, from the same function that wrote the id
          // onto the row above (#1675). Every face here is a diver from the
          // roster rendered above, so the target is on the page by
          // construction, not by hope.
          rowId: offlineRollCallRowId(diver.bookingId),
          rentsKit: diver.rentalFit.state === "rents",
          // A readiness fact, and only at the dock — the same gate the live
          // chip this grid stands in for applies (`blocked: diver.blocked &&
          // isDeparture`, SummaryPanel). Every face here is somebody nobody
          // has called yet, so after a dive every one of them is somebody who
          // went in the water: the saved paperwork word is stale by
          // definition there, and its red competed with the one red on the
          // page that means a diver has not come back. The live row states
          // the same rule in the same words (`blockedAtDock`, DiverRollCall),
          // and this page's own head-count note says it of itself
          // (`isDeparture`, above) — the grid was the one place that said it
          // and then rendered the word anyway.
          blocked: isDeparture && diver.readiness.status === "blocked",
        }))}
        tone={isDeparture ? "neutral" : "urgent"}
        copy={{
          heading: isDeparture
            ? t("manifest.stillToBoardHeading", { count: missingDivers.length })
            : t("manifest.notCountedBackHeading", { count: missingDivers.length }),
          statusLabel: isDeparture
            ? t("manifest.missingDiversPillDock")
            : t("manifest.missingDiversPillAfterDive"),
          tapHint: t("manifest.missingDiversTapHint"),
          rentsKitLabel: t("manifest.rentsKitLabel"),
          ownKitLabel: t("manifest.ownKitLabel"),
          // The offline exception, all the way down: the diver's own row
          // reads "Blocked when saved", so the face in this grid has to say
          // the same thing. The bare readiness word here made the glossary's
          // "every readiness word on this page carries the qualifier"
          // sentence false, and put an unqualified badge one scroll from a
          // qualified one on a page whose whole point is that it may be
          // stale (#1360).
          blockedLabel: t("shared.offlineManifest.single.blockedBadge"),
        }}
      />

      {/* Per-device controls are secondary to roll call. Keep them in the
          same disclosure on the offline surface as the live manifest's
          "On this phone" group, rather than mixing one toggle into the
          checkpoint selector. The haptics toggle renders nothing on a phone
          with no vibration motor, and then the group has nothing in it, so
          it hides rather than opening onto an empty box. */}
      <section
        className="mt-8 border-t border-border pt-5 print:hidden has-[[data-phone-prefs]:empty]:hidden"
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
          href={`/shop/${envelope.snapshot.shop.slug}/trips/${tripId}/manifest?checkpoint=${checkpoint}`}
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
