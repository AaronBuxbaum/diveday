import type { ReactNode } from "react";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import type { TripPrep } from "@/db/trips";
import type { StaffMessageKey, StaffTranslator } from "@/i18n/staff-messages";
import type { PrepGrouping } from "@/lib/dive-prep";
import { shopOffersNitrox } from "@/lib/rentals";
import { type NoticeTone, noticeFromParam } from "@/lib/staff-notices";
import { PrepAssignments } from "./PrepAssignments";
import { PrepFitGaps } from "./PrepFitGaps";
import { PrepKitList } from "./PrepKitList";
import { PrepPickups } from "./PrepPickups";
import { PrepTanks } from "./PrepTanks";
import type { PrepView } from "./prep-view";

/** `?notice=` codes the Gear tab's forms redirect back with. Read through
 * `noticeFromParam`, never a bare index — the param is attacker-supplied. */
const GEAR_NOTICES: Record<string, { tone: NoticeTone; key: StaffMessageKey }> = {
  "gear-released": { tone: "success", key: "gear.prep.notice.released" },
  "gear-already-checked-out": { tone: "warning", key: "gear.prep.notice.alreadyCheckedOut" },
  "gear-not-found": { tone: "danger", key: "gear.notice.notFound" },
  "gear-already-returned": { tone: "warning", key: "gear.notice.alreadyReturned" },
  "gear-returned-set": { tone: "success", key: "gear.notice.returnedSet" },
  "gear-returned-set-pulled": { tone: "success", key: "gear.notice.returnedSetPulled" },
  "gear-handed-over": { tone: "success", key: "gear.prep.notice.handedOver" },
  "gear-nothing-to-hand-over": { tone: "warning", key: "gear.notice.nothingToHandOver" },
  "gear-concern-needs-words": { tone: "warning", key: "gear.notice.concernNeedsWords" },
  "gear-nothing-out": { tone: "warning", key: "gear.notice.nothingOut" },
};

/**
 * **The morning packing list, minus the page it used to be.**
 *
 * Every fact here is read once by `getTripPrep` and drawn once, so the two
 * places that show it — the departure page, where the list is part of the hour
 * a crew is working, and `/prep`, which the paper day still composes as a
 * component — cannot tell the boat different things about the same piece of
 * kit. The header, the notice flash and the reads stay with each caller,
 * because a printed sheet and a screen want different ones.
 */
export function PrepBody({
  prep,
  t,
  locale,
  shopSlug,
  tripId,
  rentalItems,
  notice,
  grouping,
  groupPath,
  cancelled = false,
  emptyState = null,
  idPrefix,
  className,
}: {
  prep: TripPrep;
  t: StaffTranslator;
  locale: string;
  shopSlug: string;
  tripId: string;
  /**
   * `shops.rental_items` — what this shop offers at all, which is one of the
   * three things that decide whether the nitrox split renders.
   */
  rentalItems: string[];
  /** The raw `?notice=`, read through `noticeFromParam` and never indexed. */
  notice: string | undefined;
  grouping: PrepGrouping;
  /**
   * What the two groupings link to — this list's own page, at a different
   * `?group=`. Passed rather than built because the list now renders on two of
   * them, and a switch that jumps the reader to the other page would be a
   * navigation wearing a toggle's clothes.
   */
  groupPath: string;
  /**
   * **A blown-out departure packs nothing.**
   *
   * A cancellation cancels the *trip* and leaves every booking active (the
   * glossary's *Blow-out*), so every count below still computes — and every
   * one of them is an instruction about a check-in that is not happening. The
   * tank tiles are the dangerous half: on a three-boat Saturday with one
   * blown out, a staffer working down the day reads "Total 18 · Air 18" long
   * after the Cancelled badge has scrolled off the top of a twelve-row roster.
   * Nothing is lost by standing them down — they are derived per departure
   * from each diver's own record and recompute, identically, on whatever
   * departure those divers rebook onto (dive-domain review 20260920).
   *
   * **What survives is the half a cancellation creates work in**: units
   * already reserved for today's window and sets already handed across a
   * counter that are now walking back out of the shop. Those are records, not
   * predictions, and releasing or taking them back is the morning's real job.
   *
   * The rule lives here rather than at the two call sites so `/prep` and the
   * paper day cannot say something different from the departure page — a pull
   * sheet printed for a blown-out boat is the same error on paper, where it
   * cannot be corrected.
   */
  cancelled?: boolean;
  /**
   * What stands here when there is nobody to pack for. `/prep` is a page about
   * this list alone, so it says so and points at the roster; on the departure
   * page the roster is the section directly above, already saying the boat is
   * empty and offering the way to fill it, so nothing stands here at all.
   */
  emptyState?: ReactNode;
  /** See `src/lib/element-id.ts`: set on the paper day, absent on a route. */
  idPrefix?: string;
  /**
   * **The gap between the list's sections, which is the page's to set** —
   * `space-y-10` from both callers. The list is a run of a page's sections, and
   * section rhythm belongs to the page (`card.tsx`), so no section here hangs a
   * margin of its own: each used to carry `mt-8`, 32px where the page's
   * sections sit 40px apart (pixel-craft class 4).
   */
  className: string;
}) {
  const { checklist, gearFleetTotal, assignmentRows } = prep;
  const view: PrepView = { prep, t, locale, shopSlug, tripId, idPrefix, cancelled };
  // A shop that has never offered nitrox can never have live nitrox data here
  // (setBookingNitrox fails closed), so this is purely cosmetic for that
  // common case — but a shop that *disabled* nitrox after a diver requested
  // it (with or without a verified card) must not have this trip's already-
  // real tank split or blocker silently disappear out from under the crew.
  const showNitrox =
    shopOffersNitrox(rentalItems) ||
    checklist.tanks.nitrox > 0 ||
    checklist.nitroxBlockers.length > 0;

  const gearBanner = noticeFromParam(notice, GEAR_NOTICES);

  return (
    <>
      {/* A snorkel-only boat still loads vests and surface kit, so only a
          boat with nobody in the water is empty. */}
      {checklist.diverCount === 0 && checklist.crewCount === 0 && checklist.snorkelVests === 0 ? (
        emptyState
      ) : (
        <div className={className}>
          {cancelled ? (
            // Said, not merely absent: a staffer who knows the list lives here
            // must not read the gap as a bug, and an empty packing list that
            // says nothing reads as "nothing to pull", which is the one thing
            // it must never say by accident.
            <p className="text-muted">{t("tripPrep.cancelledNothingToPack")}</p>
          ) : (
            <>
              <PrepTanks view={view} showNitrox={showNitrox} />
              <PrepFitGaps view={view} />
            </>
          )}

          {/* **Kept on a cancellation**, unlike everything above it: on a
              blow-out morning this run is the list of hotels somebody has to
              phone before a diver is standing in a lobby at 06:00. */}
          <PrepPickups view={view} />

          {cancelled ? null : <PrepKitList view={view} grouping={grouping} groupPath={groupPath} />}

          {/* Which tagged unit each renting diver takes — the one part of this
              page that reserves anything, present only for a shop that keeps
              its fleet on the register. The assigned lines print with the
              packing list; the controls do not. The notice banner sits above
              the section's own gate: a refusal like gear-not-found is exactly
              the case where the row (or the whole fleet) can be gone, and the
              staffer still gets told what happened. */}
          {/* Its own space above it, the stack's gap. Rendered flush, it
              read as the last row of the packing table it happens to follow
              rather than as an answer to the tap that produced it. Below it,
              the banner's own `mb-6` outranks the stack's zero-specificity
              margin, so it sits 24px over the assignments it answers for —
              the space every notice keeps over what follows it. */}
          {gearBanner ? (
            <StaffNoticeBanner tone={gearBanner.tone}>{t(gearBanner.key)}</StaffNoticeBanner>
          ) : null}
          {gearFleetTotal > 0 && assignmentRows.length > 0 ? <PrepAssignments view={view} /> : null}
        </div>
      )}
    </>
  );
}
