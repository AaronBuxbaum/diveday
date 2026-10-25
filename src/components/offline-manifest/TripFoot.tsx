import { HapticsToggle } from "@/components/HapticsToggle";
import { MilestoneHaptics } from "@/components/MilestoneHaptics";
import { SubSurfaceRipple } from "@/components/SubSurfaceRipple";
import { buttonClass } from "@/components/ui/button";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import type { OfflineTripControls } from "./controls";
import { offlineRollCallRowId } from "./shared";
import { liveManifestHref, type OfflineTripView } from "./trip-view";

/**
 * Who is still to call at this checkpoint, as one jump: how many, and the row
 * of the first of them in roster order. `null` when nobody is, so the page
 * says nothing rather than "0". Every diver here is one the roll call above
 * renders, so the row id is on the page by construction (#1675).
 */
export function stillToCallLine(
  missingDivers: readonly { bookingId: string }[],
): { count: number; href: string } | null {
  const first = missingDivers[0];
  if (!first) return null;
  return { count: missingDivers.length, href: `#${offlineRollCallRowId(first.bookingId)}` };
}

function StillToCallLine({
  line,
  label,
}: {
  line: { count: number; href: string } | null;
  label: (count: number) => string;
}) {
  if (!line) return null;
  return (
    <p className="mt-4 print:hidden">
      <a
        href={line.href}
        className="inline-flex min-h-11 items-center text-base font-semibold text-primary underline underline-offset-2"
      >
        {label(line.count)}
      </a>
    </p>
  );
}

/** Below the roll call: who is still to call, this phone's settings, the live page, and the milestone. */
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
      {/* **One line, not a second list of people** (visual review
          2026-10-24, B02): the roll-call rows above already name everyone,
          so the face grid that repeated them is gone, as the live
          manifest's went before it. The line counts who nobody has called
          yet, in the live page's words for the checkpoint, and jumps to the
          first of them. Nothing when nobody is left. */}
      <StillToCallLine
        line={stillToCallLine(missingDivers)}
        label={(count) =>
          isDeparture
            ? t("manifest.stillToBoardHeading", { count })
            : t("manifest.notCountedBackHeading", { count })
        }
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
