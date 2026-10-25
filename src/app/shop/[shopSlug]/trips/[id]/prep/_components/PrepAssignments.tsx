import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { sectionCardClass } from "@/components/ui/card";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import { gearItemKindLabel } from "@/i18n/gear-labels";
import { rentalFitLineText } from "@/i18n/rental-labels";
import { formatCalendarDate } from "@/lib/calendar-date";
import { nitroxTanksApproved } from "@/lib/dive-prep";
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
import { assignmentCounts } from "./assignment-counts";
import { FoldBelowLg } from "./FoldBelowLg";
import { GearReturnPane } from "./GearReturnPane";
import { ConfirmProposals } from "./ProposedUnit";
import {
  assignmentRowIsSettled,
  careLine,
  kitGridClass,
  kitLineSettledClass,
  suitMismatchLine,
} from "./prep-lines";
import type { PrepView } from "./prep-view";
import { WantedPiece } from "./WantedPiece";

/** Which tagged unit each renting diver takes, and the set going out and coming home. */
export function PrepAssignments({ view }: { view: PrepView }) {
  const { prep, t, locale, shopSlug, tripId, idPrefix, cancelled, sailed, home } = view;
  const { assignmentRows, loadOut, proposals } = prep;
  /**
   * The unit proposed for each piece still to pick, in roster order (UX audit
   * 2026-10-07, item 9): what the one-tap "Assign all" sends, and what each
   * proposed row offers on its own. None on a cancelled departure, or once the
   * boat has left the dock (fourth review, item 16).
   */
  const proposalPicks =
    cancelled || sailed
      ? []
      : assignmentRows.flatMap(({ diver, wanted }) =>
          wanted.flatMap((item) => {
            const unit = proposals.get(proposalKey(diver.bookingId, item.kind));
            return unit ? [{ bookingId: diver.bookingId, gearItemId: unit.id }] : [];
          }),
        );
  // The summary and the button read one count (A10, B54).
  const counts = assignmentCounts(assignmentRows, proposalPicks);
  return (
    <section
      aria-labelledby={scopedId(idPrefix, "assignments-heading")}
      // On paper the section is only its assigned lines: with nothing
      // assigned yet it would print as a heading over bare names, so
      // it drops out of the packet entirely until a unit is on it.
      className={assignmentRows.some((row) => row.assigned.length > 0) ? undefined : "print:hidden"}
    >
      {/* The heading and its cart on the left, the one-tap "Assign all" on
          the right from `sm` up: stacked, the button was a third line of
          preamble before the first diver. */}
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
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
              {/* One count that matters, "3 divers still need a unit", and
                  the rest a muted tail (visual review 2026-10-24, A10 /
                  B54): "· 13 proposed", the button's own number, so "Assign
                  all 13 proposed units" beside it is the same count. The
                  lead is dropped on a cancellation, where it is an
                  instruction to pick on a day nothing is picked for, and at
                  sea, where nothing more is picked; then the line is what
                  went out. */}
              {counts.missing > 0 && !cancelled && !sailed ? (
                <span className="font-medium text-foreground">
                  {t("gear.prep.cartDiversWaiting", { divers: counts.diversWaiting })}
                </span>
              ) : (
                t("gear.prep.cartLineAssigned", {
                  assigned: counts.assigned,
                  needed: counts.needed,
                })
              )}
              {[
                counts.missing > 0 && !cancelled && !sailed && counts.proposed > 0
                  ? t("gear.prep.cartProposed", { proposed: counts.proposed })
                  : null,
                loadOut.serviceFlagged > 0
                  ? t("gear.prep.cartServiceFlagged", { count: loadOut.serviceFlagged })
                  : null,
              ]
                .filter((line) => line !== null)
                .map((line) => ` · ${line}`)
                .join("")}
            </p>
          ) : null}
        </div>
        {counts.proposed > 0 ? (
          <ConfirmProposals
            className="shrink-0"
            tripId={tripId}
            picks={proposalPicks}
            confirm={confirmProposedGearUnits}
            copy={{
              action: t("gear.prep.proposal.assignAll", { count: counts.proposed }),
              pending: t("gear.prep.assigning"),
              refused: t("gear.prep.proposal.someRefused"),
              failed: t("gear.prep.notice.assignFailed"),
            }}
          />
        ) : null}
      </div>
      {/* **One grammar per diver, not two stacked lists.** A row used
          to be a list of assigned units in one shape followed by a list of
          labelled `<select>`s in another. Every piece is one kit line now,
          a row on a phone and a tile from `sm` up (`kitLineClass`): settled
          ones sunken, open ones edged, so a diver's kit reads at a glance
          as what is done and what is left. The diver's own acts, the ticket
          and the hand-over, sit on the name's line. */}
      <ul
        className={sectionCardClass({
          padding: "none",
          className: "mt-4 divide-y divide-border overflow-hidden print:overflow-visible",
        })}
      >
        {assignmentRows.map(
          ({ diver, assigned, wanted, needsStaffFit, handedOver, counterHeld }) => (
            <li
              key={diver.bookingId}
              className={`px-4 py-3 sm:px-5${assigned.length > 0 ? "" : " print:hidden"}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
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
                <div className="flex items-center gap-x-1">
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
                  {/* **The set goes out in one act too** (issue #1185,
                          D25) — the mirror of the return pane below it. One
                          deliberate hand-over per diver, offered only while
                          there is something still on the wall to hand across:
                          a set already out has nothing to give, and a set with
                          nothing assigned is not a set. */}
                  {assigned.length > 0 && !handedOver && !home ? (
                    <form action={checkOutTripGearSetAction} className="-my-2 print:hidden">
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
                </div>
              </div>
              <FoldBelowLg
                summary={
                  assignmentRowIsSettled(t, {
                    assigned,
                    wanted,
                    needsStaffFit,
                    handedOver,
                    counterHeld,
                  })
                    ? t("gear.prep.allAssigned", { count: assigned.length })
                    : null
                }
              >
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
                    {counterHeldLine(t, locale, counterHeld)}
                  </p>
                ) : null}
                <dl className={kitGridClass}>
                  {assigned.map((assignment) => (
                    <div key={assignment.reservationId} className={kitLineSettledClass}>
                      <AssignedUnitTerm t={t} assignment={assignment} />
                      <dd className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <AssignedUnitWords
                          t={t}
                          assignment={assignment}
                          wetsuitThicknessMm={prep.trip.wetsuitThicknessMm}
                        />
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
                  {/* **The set comes home in one act** (issue #1186, D26).
                          Until the boat is home: after that "Back from the
                          boat" asks per unit (fifth-loop ideas, item 5).
                          Only when something is actually out: a diver whose
                          units are still on the wall has nothing to return, and
                          a pane offering to close a set that never left would
                          be the paperwork this replaces rather than the removal
                          of it. */}
                  {!home && assigned.some((assignment) => assignment.checkedOutAt !== null) ? (
                    <GearReturnPane
                      fields={{ tripId, bookingId: diver.bookingId }}
                      action={returnTripGearSetAction}
                      labels={{
                        allGood: t("gear.prep.returnAllGood"),
                        fitAdjusted: t("gear.prep.returnFitAdjusted"),
                        serviceConcern: t("gear.prep.returnServiceConcern"),
                        cancelConcern: t("gear.prep.returnCancelConcern"),
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
                          wantsNitrox={nitroxTanksApproved(diver)}
                          item={item}
                        />
                      ))}
                </dl>
              </FoldBelowLg>
            </li>
          ),
        )}
      </ul>
    </section>
  );
}

type AssignedUnit = PrepView["prep"]["assignmentRows"][number]["assigned"][number];

/** "BCD · L": the piece an assigned unit fills. */
function AssignedUnitTerm({ t, assignment }: { t: PrepView["t"]; assignment: AssignedUnit }) {
  return (
    <dt className="text-muted">
      {assignment.size
        ? t("gear.prep.kindWithSize", {
            kindLabel: gearItemKindLabel(t, assignment.kind),
            size: assignment.size,
          })
        : gearItemKindLabel(t, assignment.kind)}
    </dt>
  );
}

/** The unit's tag and the two warnings it can carry, the same on screen and paper. */
function AssignedUnitWords({
  t,
  assignment,
  wetsuitThicknessMm,
}: {
  t: PrepView["t"];
  assignment: AssignedUnit;
  wetsuitThicknessMm: PrepView["prep"]["trip"]["wetsuitThicknessMm"];
}) {
  const care = careLine(t, assignment);
  const mismatch = suitMismatchLine(t, assignment, wetsuitThicknessMm);
  return (
    <>
      <span className="font-mono font-medium">{assignment.label}</span>
      {care ? <span className="font-medium text-warning-strong">{care}</span> : null}
      {mismatch ? <span className="font-medium text-warning-strong">{mismatch}</span> : null}
    </>
  );
}

/** "Already has BCD #2 from the counter until Oct 26", one line for every held unit. */
function counterHeldLine(
  t: PrepView["t"],
  locale: string,
  counterHeld: PrepView["prep"]["assignmentRows"][number]["counterHeld"],
) {
  return t("counterRentals.trip.held", {
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
  });
}

/**
 * **The assigned units, as the packet's paper carries them** (B03). The
 * printed packing list has only ever held the assigned lines of this section
 * (each control above is `print:hidden`, and a diver with nothing assigned
 * drops off the sheet), so on the packet that is all there is: the diver, the
 * one warning their row can carry, and each unit with its tag, its warnings
 * and "Out" once it has left the wall. Nothing to tap. With nothing assigned
 * yet the section is absent, as it was on paper.
 */
export function PrepAssignedPaper({ view }: { view: PrepView }) {
  const { prep, t, locale, idPrefix } = view;
  const rows = prep.assignmentRows.filter((row) => row.assigned.length > 0);
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby={scopedId(idPrefix, "assignments-heading")}>
      <h2 id={scopedId(idPrefix, "assignments-heading")} className={SECTION_TITLE_CLASS}>
        {t("gear.prep.heading")}
      </h2>
      <ul
        className={sectionCardClass({ padding: "none", className: "mt-4 divide-y divide-border" })}
      >
        {rows.map(({ diver, assigned, needsStaffFit, counterHeld }) => (
          <li key={diver.bookingId} className="px-4 py-3 sm:px-5">
            <p className="font-medium">{diver.fullName}</p>
            {needsStaffFit ? (
              <p className="mt-1 text-sm font-medium text-warning-strong">
                {rentalFitLineText(t, locale, {
                  state: "needs_staff_fit",
                  note: needsStaffFit.note,
                })}
              </p>
            ) : null}
            {counterHeld.length > 0 ? (
              <p className="mt-1 text-sm text-warning-strong">
                {counterHeldLine(t, locale, counterHeld)}
              </p>
            ) : null}
            <dl className={kitGridClass}>
              {assigned.map((assignment) => (
                <div key={assignment.reservationId} className={kitLineSettledClass}>
                  <AssignedUnitTerm t={t} assignment={assignment} />
                  <dd className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <AssignedUnitWords
                      t={t}
                      assignment={assignment}
                      wetsuitThicknessMm={prep.trip.wetsuitThicknessMm}
                    />
                    {assignment.checkedOutAt ? (
                      <span className="text-muted">{t("gear.prep.outLabel")}</span>
                    ) : null}
                  </dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </section>
  );
}
