import { gearItemKindLabel } from "@/i18n/gear-labels";
import { groupUnitsForSize } from "@/lib/gear";
import { proposalKey } from "@/lib/gear-proposals";
import { assignGearUnit } from "../actions";
import { ProposedUnit } from "./ProposedUnit";
import { kitLineOpenClass, unitLine } from "./prep-lines";
import type { PrepView, WantedItem } from "./prep-view";
import { RentalUnitPicker } from "./RentalUnitPicker";

/** One piece a renting diver still wants: its unit proposed, or the picker for one. */
export function WantedPiece({
  view,
  bookingId,
  wantsNitrox = false,
  item,
}: {
  view: PrepView;
  bookingId: string;
  /** The diver breathes enriched air (`nitroxTanksApproved`): designated regulators say so plainly (issue #2207). */
  wantsNitrox?: boolean;
  item: WantedItem;
}) {
  const { prep, t, tripId } = view;
  const { freeByKind, proposals } = prep;
  const kindLabel = gearItemKindLabel(t, item.kind);
  const pieceLabel = item.size
    ? t("gear.prep.kindWithSize", { kindLabel, size: item.size })
    : kindLabel;
  // Keep exact-size units separate from other free units.
  const { exact, rest } = groupUnitsForSize(freeByKind.get(item.kind) ?? [], item.size);
  const selectId = `assign-${bookingId}-${item.kind}`;
  // Never default a mismatched or shared unit; proposals remain choices, not
  // reservations, and each picker opens without a selected unit.
  const proposal = proposals.get(proposalKey(bookingId, item.kind));
  const preselect = "";
  // Air divers see nitrox-designated regulators last, but may still choose one.
  const designatedLast = (units: typeof exact) =>
    wantsNitrox
      ? units
      : [...units].sort(
          (a, b) => Number(a.nitroxDesignated === true) - Number(b.nitroxDesignated === true),
        );
  const optionsFor = (units: typeof exact) =>
    designatedLast(units).map((option) => ({
      id: option.id,
      label: unitLine(t, option, wantsNitrox),
    }));
  // Keep every free unit reachable, including exact matches when no size is
  // available to label a separate band.
  const named = exact.length > 0 && item.size ? item.size : null;
  const exactBand = named ? exact : [];
  const restBand = named ? rest : [...exact, ...rest];
  const groups = [
    named
      ? {
          key: "exact",
          label: t("gear.prep.groupExactSize", { size: named }),
          options: optionsFor(exactBand),
        }
      : null,
    restBand.length > 0
      ? {
          key: "rest",
          label: t(named ? "gear.prep.groupOtherSizes" : "gear.prep.groupFree"),
          options: optionsFor(restBand),
        }
      : null,
  ].filter((group) => group !== null);
  // Use the same localized refusal messages for manual picks and proposals.
  const pickRefusals = {
    unit_unavailable: t("gear.prep.notice.unitUnavailable"),
    unit_out_of_service: t("gear.prep.notice.unitOutOfService"),
    not_wanted: t("gear.prep.notice.notWanted"),
    already_holds_kind: t("gear.prep.notice.alreadyHoldsKind", {
      kindLabel,
    }),
    identity_held: t("gear.prep.notice.identityHeld"),
    needs_care: t("gear.prep.notice.unitNeedsCare"),
  };
  const picker = (
    <RentalUnitPicker
      id={selectId}
      tripId={tripId}
      bookingId={bookingId}
      defaultValue={preselect}
      assign={assignGearUnit}
      groups={groups}
      copy={{
        pickUnit: t("gear.prep.pickUnit"),
        assigning: t("gear.prep.assigning"),
        refusals: pickRefusals,
        refusalFallback: t("gear.prep.notice.assignFailed"),
        needsCareConfirm: t("gear.prep.notice.unitNeedsCare"),
        assignAnyway: t("gear.prep.assignAnyway"),
      }}
    />
  );
  return (
    <div className={`${kitLineOpenClass} print:hidden`}>
      <dt className="text-muted">
        {groups.length === 0 ? pieceLabel : <label htmlFor={selectId}>{pieceLabel}</label>}
      </dt>
      <dd>
        {groups.length === 0 ? (
          <span className="text-muted">{t("gear.prep.noneFree", { kindLabel })}</span>
        ) : (
          // Keep the picker and proposal within the piece's tile width.
          <div className="w-full min-w-0">
            {/* Proposal and picker stay one row; a refused assignment is
                reported here and leaves the unit unassigned. */}
            <ProposedUnit
              proposed={proposal !== undefined}
              copy={
                proposal
                  ? {
                      line: t("gear.prep.proposal.unit", {
                        unit: unitLine(t, proposal, wantsNitrox),
                      }),
                      reveal: t("gear.prep.proposal.change"),
                    }
                  : { line: t("gear.prep.proposal.none"), reveal: t("gear.prep.proposal.pick") }
              }
            >
              {picker}
            </ProposedUnit>
          </div>
        )}
      </dd>
    </div>
  );
}
