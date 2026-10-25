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
  // Exactly this diver's size in its own band, everything
  // else free in a second — the boundary the old flat
  // ranked list could only imply.
  const { exact, rest } = groupUnitsForSize(freeByKind.get(item.kind) ?? [], item.size);
  const selectId = `assign-${bookingId}-${item.kind}`;
  // Preselect only an exact size match: defaulting an XS
  // onto an L diver made a wrong reservation one tap
  // away, and defaulting the same unit into every picker
  // of a kind invited the somebody-got-it-first refusal.
  // Anything else opens on a placeholder the form refuses
  // to submit.
  //
  // A row with a proposal says so in words and holds
  // its picker behind Change (`ProposedUnit`); one
  // without holds it behind Pick and opens on the
  // placeholder, because the exact units it could have
  // preselected are the ones proposed to the divers
  // above it.
  const proposal = proposals.get(proposalKey(bookingId, item.kind));
  const preselect = "";
  // On an air diver's row a nitrox-designated regulator sorts after the air
  // sets (domain review A2/F7); still offered, never refused.
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
  // **Nothing falls between the bands.** The first band
  // is headed by the size it matches, so it can only
  // exist where there is a size to name — and a unit
  // sorted into it without one would otherwise be in
  // neither band and reachable from no picker, which on
  // this page means a staffer cannot assign a unit that
  // is genuinely free. `groupUnitsForSize` does not
  // produce that pair today; this makes it structural
  // rather than something the next reader has to trace.
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
  // One sentence per refusal a pick can come back
  // with, the same for a hand pick and a proposal.
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
          // The tile is the measure: the picker and a proposal's words
          // with its one act both take the tile's width.
          <div className="w-full min-w-0">
            {/* **No "Assign" beside it.** The pick is the act
                (issue #802). Every piece is one line and one text button:
                a proposed piece says its unit and holds the picker behind
                "Change" (A10); a piece with no proposal says it has no unit
                yet and holds the picker behind "Pick", so the tab reads in
                one idiom row by row (visual review polish). The refusal the
                exclusion constraint can still answer with lands on this row,
                and reverts it. */}
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
