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
  /** Proposed units in roster order; they become reservations only on confirmation, which is unavailable after cancellation or sailing. */
  const proposalPicks =
    cancelled || sailed
      ? []
      : assignmentRows.flatMap(({ diver, wanted }) =>
          wanted.flatMap((item) => {
            const unit = proposals.get(proposalKey(diver.bookingId, item.kind));
            return unit ? [{ bookingId: diver.bookingId, gearItemId: unit.id }] : [];
          }),
        );
  // Keep the summary and confirmation button on the same proposal count.
  const counts = assignmentCounts(assignmentRows, proposalPicks);
  return (
    <section
      aria-labelledby={scopedId(idPrefix, "assignments-heading")}
      // The paper projection is empty until there is an assigned unit.
      className={assignmentRows.some((row) => row.assigned.length > 0) ? undefined : "print:hidden"}
    >
      {/* Keep the bulk action beside the heading when there is room. */}
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h2
            id={scopedId(idPrefix, "assignments-heading")}
            tabIndex={-1}
            className={`scroll-mt-28 ${SECTION_TITLE_CLASS}`}
          >
            {t("gear.prep.heading")}
          </h2>
          {/* Show load-out counts and only the applicable exceptions. */}
          {loadOut ? (
            <p className="mt-1 text-sm text-muted print:hidden">
              {/* On cancellation or after sailing, report the load-out without inviting new picks. */}
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
            className="min-w-0 max-w-full"
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
      {/* Each diver's assigned and wanted pieces share kit lines; ticket and hand-over actions stay by the name. */}
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
                {/* A ticket is useful only for an assigned diver; paper already lists their units. */}
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
                  {/* Hand over an assigned set once, while it remains in the shop. */}
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
                {/* Staff-fit cases remain unproposed and explain the required review. */}
                {needsStaffFit ? (
                  <p className="mt-1 text-sm font-medium text-warning-strong">
                    {rentalFitLineText(t, locale, {
                      state: "needs_staff_fit",
                      note: needsStaffFit.note,
                    })}
                  </p>
                ) : null}
                {/* Identify counter-held shop gear so staff do not pack a duplicate. */}
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
                  {/* Before the boat returns, close a handed-over set together; afterward returns are per unit. */}
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
                  {/* Cancellation blocks new reservations, while existing assignments and release/return records remain visible. */}
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

/** Paper projection of assigned units and their warnings/hand-over state; interactive controls are omitted. */
export function PrepAssignedPaper({ view }: { view: PrepView }) {
  const { prep, t, locale, idPrefix } = view;
  const rows = prep.assignmentRows.filter((row) => row.assigned.length > 0);
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby={scopedId(idPrefix, "assignments-heading")}>
      <h2
        id={scopedId(idPrefix, "assignments-heading")}
        tabIndex={-1}
        className={`scroll-mt-28 ${SECTION_TITLE_CLASS}`}
      >
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
