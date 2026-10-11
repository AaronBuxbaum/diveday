import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { sectionCardClass } from "@/components/ui/card";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import { gearItemKindLabel } from "@/i18n/gear-labels";
import { rentalFitLineText } from "@/i18n/rental-labels";
import { formatCalendarDate } from "@/lib/calendar-date";
import { scopedId } from "@/lib/element-id";
import { proposalKey } from "@/lib/gear-proposals";
import { cachedListFormat } from "@/lib/intl-cache";
import { shopPath } from "@/lib/staff-notices";
import {
  checkOutTripGearSetAction,
  releaseGearUnitAction,
  returnTripGearSetAction,
} from "../actions";
import { confirmProposedGearUnits } from "../proposal-actions";
import { GearReturnPane } from "./GearReturnPane";
import { ConfirmProposals } from "./ProposedUnit";
import { careLine, kitLineClass } from "./prep-lines";
import type { PrepView } from "./prep-view";
import { WantedPiece } from "./WantedPiece";

/** Which tagged unit each renting diver takes, and the set going out and coming home. */
export function PrepAssignments({ view }: { view: PrepView }) {
  const { prep, t, locale, shopSlug, tripId, idPrefix, cancelled } = view;
  const { assignmentRows, loadOut, proposals } = prep;
  /**
   * The unit proposed for each piece still to pick, in roster order (UX audit
   * 2026-10-07, item 9): what the one-tap "Assign all" sends, and what each
   * proposed row offers on its own. None on a cancelled departure.
   */
  const proposalPicks = cancelled
    ? []
    : assignmentRows.flatMap(({ diver, wanted }) =>
        wanted.flatMap((item) => {
          const unit = proposals.get(proposalKey(diver.bookingId, item.kind));
          return unit ? [{ bookingId: diver.bookingId, gearItemId: unit.id }] : [];
        }),
      );
  return (
    <section
      aria-labelledby={scopedId(idPrefix, "assignments-heading")}
      // On paper the section is only its assigned lines: with nothing
      // assigned yet it would print as a heading over bare names, so
      // it drops out of the packet entirely until a unit is on it.
      className={assignmentRows.some((row) => row.assigned.length > 0) ? undefined : "print:hidden"}
    >
      <h2 id={scopedId(idPrefix, "assignments-heading")} className={SECTION_TITLE_CLASS}>
        {t("gear.prep.heading")}
      </h2>
      {/* The cart, not a caption. What replaced a sentence restating
                  the heading is the count a counter is working against — and
                  its two exceptions, said only when there are any, so a clean
                  load-out reads as one line rather than three reassurances
                  (issue #1185). */}
      {loadOut ? (
        <p className="mt-1 text-sm text-muted print:hidden">
          {[
            t("gear.prep.cartLine", { units: loadOut.units, divers: loadOut.divers }),
            // Dropped on a cancellation: "still to pick" is an
            // instruction to pick, on a day nothing is picked for.
            loadOut.stillToPick > 0 && !cancelled
              ? t("gear.prep.cartStillToPick", { count: loadOut.stillToPick })
              : null,
            loadOut.serviceFlagged > 0
              ? t("gear.prep.cartServiceFlagged", { count: loadOut.serviceFlagged })
              : null,
          ]
            .filter((line) => line !== null)
            .join(" · ")}
        </p>
      ) : null}
      {proposalPicks.length > 0 ? (
        <ConfirmProposals
          tripId={tripId}
          picks={proposalPicks}
          confirm={confirmProposedGearUnits}
          copy={{
            action: t("gear.prep.proposal.assignAll", { count: proposalPicks.length }),
            pending: t("gear.prep.assigning"),
            refused: t("gear.prep.proposal.someRefused"),
            failed: t("gear.prep.notice.assignFailed"),
          }}
        />
      ) : null}
      {/* **One grammar per diver, not two stacked lists.** A row used
                  to be a list of assigned units in one shape (a mono tag, a
                  kind, a release control) followed by a list of labelled
                  `<select>`s in another, so "wetsuit XL" appeared twice in two
                  different layouts depending on whether it had been picked
                  yet. Every piece is one line now — the piece on the left, its
                  unit or its picker on the right — and settling one moves it
                  between bands rather than between designs. */}
      <ul
        className={sectionCardClass({
          padding: "none",
          className: "mt-3 divide-y divide-border overflow-hidden print:overflow-visible",
        })}
      >
        {assignmentRows.map(
          ({ diver, assigned, wanted, needsStaffFit, handedOver, counterHeld }) => (
            <li
              key={diver.bookingId}
              className={`px-4 py-3 sm:px-5${assigned.length > 0 ? "" : " print:hidden"}`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p className="font-medium">{diver.fullName}</p>
                {/* The slip's door, and only once there is something to
                          put on it — a ticket listing nothing is a wrong slip,
                          not a short one. Hidden on paper: the departure packet
                          is already printing this diver's units.

                          `-my-2.5` hands (44 − 24) / 2 back, so the row keeps
                          the name's 24px line: the 44px ghost set a diver with
                          a unit 8–11px lower than the diver above (pixel-craft
                          class 4). `flush` ends the label on the column's edge,
                          as the name starts on it. The box then reaches into
                          the row's padding of a card that clips, so its ring
                          is drawn inside. */}
                {assigned.length > 0 ? (
                  <Link
                    href={shopPath(shopSlug, "trips", tripId, "prep", "ticket", diver.bookingId)}
                    className={buttonClass({
                      variant: "ghost",
                      size: "sm",
                      flush: true,
                      className: "-my-2.5 focus-visible:focus-ring-inset print:hidden",
                    })}
                  >
                    {t("gear.prep.ticketDoor")}
                  </Link>
                ) : null}
              </div>
              {/* Flagged for a staff fit (issue #2208): the row keeps a
                        picker for every piece, proposes none, and says why. */}
              {needsStaffFit ? (
                <p className="mt-1 text-sm font-medium text-warning-strong">
                  {rentalFitLineText(t, locale, {
                    state: "needs_staff_fit",
                    note: needsStaffFit.note,
                  })}
                </p>
              ) : null}
              {/* Already carrying the shop's kit off a counter rental:
                        said, so nobody packs a second set. Counts stay put. */}
              {counterHeld.length > 0 ? (
                <p className="mt-1 text-sm text-warning-strong">
                  {t("counterRentals.trip.held", {
                    units: cachedListFormat(locale, {
                      style: "long",
                      type: "conjunction",
                    }).format(counterHeld.map((held) => held.label)),
                    date: formatCalendarDate(
                      counterHeld
                        .map((held) => held.until)
                        .sort()
                        .at(-1) ?? "",
                      locale,
                    ),
                  })}
                </p>
              ) : null}
              <dl className="mt-1.5 flex flex-col gap-2 text-sm">
                {assigned.map((assignment) => (
                  <div key={assignment.reservationId} className={kitLineClass}>
                    <dt className="text-muted">
                      {assignment.size
                        ? t("gear.prep.kindWithSize", {
                            kindLabel: gearItemKindLabel(t, assignment.kind),
                            size: assignment.size,
                          })
                        : gearItemKindLabel(t, assignment.kind)}
                    </dt>
                    <dd className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-mono font-medium">{assignment.label}</span>
                      {careLine(t, assignment) ? (
                        <span className="font-medium text-warning-strong">
                          {careLine(t, assignment)}
                        </span>
                      ) : null}
                      {assignment.checkedOutAt ? (
                        <span className="text-muted">{t("gear.prep.outLabel")}</span>
                      ) : (
                        <form action={releaseGearUnitAction} className="print:hidden">
                          <input type="hidden" name="tripId" value={tripId} />
                          <input
                            type="hidden"
                            name="reservationId"
                            value={assignment.reservationId}
                          />
                          <SubmitButton
                            pendingLabel={t("gear.unit.where.releasing")}
                            className={buttonClass({ variant: "ghost", size: "sm" })}
                          >
                            {t("gear.unit.where.release")}
                          </SubmitButton>
                        </form>
                      )}
                    </dd>
                  </div>
                ))}
                {/* **The set goes out in one act too** (issue #1185,
                          D25) — the mirror of the return pane below it. One
                          deliberate hand-over per diver, offered only while
                          there is something still on the wall to hand across:
                          a set already out has nothing to give, and a set with
                          nothing assigned is not a set. */}
                {assigned.length > 0 && !handedOver ? (
                  <form action={checkOutTripGearSetAction} className="print:hidden">
                    <input type="hidden" name="tripId" value={tripId} />
                    <input type="hidden" name="bookingId" value={diver.bookingId} />
                    <SubmitButton
                      pendingLabel={t("gear.prep.handingOver")}
                      className={buttonClass({ variant: "secondary", size: "sm" })}
                    >
                      {t("gear.prep.handOver")}
                    </SubmitButton>
                  </form>
                ) : null}
                {/* **The set comes home in one act** (issue #1186, D26).
                          Only when something is actually out: a diver whose
                          units are still on the wall has nothing to return, and
                          a pane offering to close a set that never left would
                          be the paperwork this replaces rather than the removal
                          of it. */}
                {assigned.some((assignment) => assignment.checkedOutAt !== null) ? (
                  <GearReturnPane
                    fields={{ tripId, bookingId: diver.bookingId }}
                    action={returnTripGearSetAction}
                    labels={{
                      allGood: t("gear.prep.returnAllGood"),
                      fitAdjusted: t("gear.prep.returnFitAdjusted"),
                      serviceConcern: t("gear.prep.returnServiceConcern"),
                      noteLabel: t("gear.prep.returnNoteLabel"),
                      notePlaceholder: t("gear.prep.returnNotePlaceholder"),
                    }}
                    bench={{
                      legend: t("gear.prep.returnPullToBench"),
                      units: assigned
                        .filter((assignment) => assignment.checkedOutAt !== null)
                        .map((assignment) => ({
                          id: assignment.gearItemId,
                          label: assignment.label,
                        })),
                    }}
                  />
                ) : null}
                {/* **No new reservations on a departure that is not
                          going.** A reservation holds an exclusion window over
                          the unit, so picking a drysuit for a blown-out boat
                          takes it off the boat that is sailing — and there is
                          nothing to pick *for*. What stays above is the record
                          half: what is already reserved, what is already out,
                          and the two controls that undo them (dive-domain
                          review 20260920). */}
                {cancelled
                  ? null
                  : wanted.map((item) => (
                      <WantedPiece
                        key={item.kind}
                        view={view}
                        bookingId={diver.bookingId}
                        item={item}
                      />
                    ))}
              </dl>
            </li>
          ),
        )}
      </ul>
    </section>
  );
}
