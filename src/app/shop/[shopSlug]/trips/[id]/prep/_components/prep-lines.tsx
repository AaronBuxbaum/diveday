import { Fragment } from "react";
import { StatusMark } from "@/components/ui/StatusMark";
import type { TripPrep } from "@/db/trips";
import { gearStatusLabel } from "@/i18n/gear-labels";
import { diveRecencyText } from "@/i18n/readiness-labels";
import { rentalItemLabel } from "@/i18n/rental-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { type PrepPiece, UNSIZED_ITEM_KINDS } from "@/lib/dive-prep";
import { diveRecencyIsNotable } from "@/lib/dive-recency";
import type { GearItemStatus } from "@/lib/gear";

/**
 * **How the packing list says a piece, a unit and a diver's kit** — the words
 * every section of `PrepBody` shares, so the phone cards, both tables and the
 * assignments cannot tell the boat different things about the same piece.
 */

type DiverLine = TripPrep["checklist"]["diverLines"][number];

/**
 * A unit in words, the way the picker's option and a proposed row both say
 * it: label, size, and whatever about its care is worth saying at the
 * moment of the pick. A lapsed clock, an unanswered service concern and a
 * clock coming due are each said, never hidden: the dock decides (H-06).
 * A proposal is never overdue or flagged, so on a proposed row this says
 * at most "service due soon".
 */
export const careNotes = (
  t: StaffTranslator,
  unit: { serviceState: { state: string }; serviceConcern?: boolean },
) => [
  unit.serviceState.state === "overdue" ? t("gear.prep.optionServiceOverdue") : null,
  unit.serviceConcern ? t("gear.prep.optionServiceConcern") : null,
  unit.serviceState.state === "due_soon" ? t("gear.prep.optionServiceDueSoon") : null,
];
export const unitLine = (
  t: StaffTranslator,
  unit: {
    label: string;
    size: string | null;
    serviceState: { state: string };
    serviceConcern?: boolean;
    nitroxDesignated?: boolean | null;
    thicknessMm?: number | null;
  },
  /**
   * The row is an approved nitrox diver's (`nitroxTanksApproved`). A regulator
   * the shop keeps for enriched air says so on every row (issue #2207): plainly
   * here, and as a caution on an air diver's row, so a designated set cannot go
   * out on air unnoticed (domain review A2/F7). It informs, never refuses.
   */
  forNitroxDiver = false,
) =>
  [
    unit.size ? `${unit.label} · ${unit.size}` : unit.label,
    // A wetsuit's thickness, so a staffer picking by hand sees the 3 mm from
    // the 7 mm without reading it off a tag (issue #2206).
    unit.thicknessMm ? t("gear.prep.optionThickness", { mm: unit.thicknessMm }) : null,
    unit.nitroxDesignated === true
      ? t(
          forNitroxDiver
            ? "gear.prep.optionNitroxDesignated"
            : "gear.prep.optionNitroxDesignatedOnAir",
        )
      : null,
    ...careNotes(t, unit),
  ]
    .filter(Boolean)
    .join(" · ");
/**
 * What an assigned unit's line says about its care: the same notes the
 * picker said when it was chosen, so a lapsed clock or an open concern does
 * not go quiet the moment the unit is assigned (second dive-domain review).
 * A unit a technician pulled off the wall after it was assigned says so
 * first, in the register's own status word, with the technician's note.
 */
export const careLine = (
  t: StaffTranslator,
  unit: {
    status: GearItemStatus;
    serviceNote: string | null;
    serviceState: { state: string };
    serviceConcern?: boolean;
  },
) =>
  [
    unit.status === "needs_service" ? gearStatusLabel(t, unit.status) : null,
    unit.status === "needs_service" ? unit.serviceNote?.trim() || null : null,
    ...careNotes(t, unit),
  ]
    .filter(Boolean)
    .join(" · ");

/**
 * An assigned wetsuit that is not the day's thickness (domain review F3): a
 * hand pick, or a suit assigned before the day's thickness was set or changed.
 * Says the day's figure; null on a match, on no day's thickness, or another kind.
 */
export function suitMismatchLine(
  t: StaffTranslator,
  unit: { kind: string; thicknessMm: number | null },
  dayThicknessMm: number | null,
): string | null {
  if (unit.kind !== "wetsuit" || dayThicknessMm === null) return null;
  return unit.thicknessMm === dayThicknessMm
    ? null
    : t("gear.prep.notDaysThickness", { mm: dayThicknessMm });
}

/**
 * Whether a diver's assignment row has nothing left to do (issue #2435), so a
 * phone may fold it to "All N assigned": every piece they wanted is on a unit,
 * the set has been handed over, and nothing on the row asks for a person —
 * no staff-fit flag, no counter rental to say, no unit with a care line.
 * Anything short of that stays open, and so does a row holding nothing.
 */
export function assignmentRowIsSettled(
  t: StaffTranslator,
  row: {
    assigned: Parameters<typeof careLine>[1][];
    wanted: readonly unknown[];
    needsStaffFit: unknown;
    handedOver: boolean;
    counterHeld: readonly unknown[];
  },
): boolean {
  return (
    row.assigned.length > 0 &&
    row.wanted.length === 0 &&
    row.needsStaffFit === null &&
    row.counterHeld.length === 0 &&
    row.handedOver &&
    row.assigned.every((unit) => careLine(t, unit) === "")
  );
}

/**
 * The size a staffer pulls, or the honest reason there isn't one — null when
 * the piece has no size to carry at all. Shared by the phone cards, both
 * tables, and both groupings, so none of them can drift into telling the
 * boat different things about the same piece.
 */
export const pieceDetail = (t: StaffTranslator, piece: PrepPiece) => {
  // The count is real; the size deliberately isn't.
  if (piece.fitAtCheckIn) {
    return <span className="font-medium text-warning">{t("tripPrep.fitAtCheckIn")}</span>;
  }
  // A drysuit diver's stated weighting is a wetsuit answer, so there is no
  // number to pack to and the lead is settled in the water (dive-prep.ts).
  if (piece.drysuitWeightCheck) {
    return <span className="font-medium text-warning">{t("tripPrep.drysuitWeightCheck")}</span>;
  }
  // Fin size is recorded independently. For a drysuit diver it describes the
  // bare foot; confirm a boot-clearing pair at check-in (dive-prep.ts).
  if (piece.drysuitFinFit) {
    return (
      <span className="font-medium text-warning">
        {piece.size
          ? t("tripPrep.drysuitFinsWithSize", { size: piece.size })
          : t("tripPrep.drysuitFins")}
      </span>
    );
  }
  // A drysuit diver's gloves: wet gloves or dry gloves on rings are two
  // different things off the rack, so the line asks (H-102).
  if (piece.drysuitGloves) {
    return (
      <span className="font-medium text-warning">
        {piece.size
          ? t("tripPrep.drysuitGlovesWithSize", { size: piece.size })
          : t("tripPrep.drysuitGloves")}
      </span>
    );
  }
  if (piece.size) return piece.size;
  // An item that should have had a size and doesn't says so, on the piece
  // itself and in the warning ink, since the packer cannot pull it yet (UX
  // review 2026-10-10, item 26: this mark replaced a sentence above the list
  // saying the list was short). One with no size to record has nothing to
  // say, because those are different problems.
  return UNSIZED_ITEM_KINDS.includes(piece.kind) ? null : (
    <span className="font-medium text-warning-strong" data-size-missing="">
      {t("tripPrep.sizeMissing")}
    </span>
  );
};
/**
 * The one thing a size cannot say: the shop's own catalog no longer offers
 * this piece, and the diver's fit still asks for it.
 *
 * The piece is deliberately still on the list. A stored `rents_*` flag
 * survives the shop dropping that item (issue #1755), so dropping the line
 * here would be the same silence one layer down — the packer would see
 * nothing while the fit behind it still records a suit. The size stays too,
 * because it is what the conversation with the diver is about. Nothing
 * else changes: the weight check and the fin sizing follow `divesDry`, what
 * the diver wears, not the catalog (`src/lib/dive-prep.ts`).
 */
export const pieceSize = (t: StaffTranslator, piece: PrepPiece) => {
  const detail = pieceDetail(t, piece);
  if (!piece.notOffered) return detail;
  const dropped = noLongerRented(t);
  return detail ? (
    <>
      {detail} · {dropped}
    </>
  ) : (
    dropped
  );
};
/** "No longer rented": the catalog dropped a piece the diver's fit still asks for. */
export const noLongerRented = (t: StaffTranslator) => (
  <span className="font-medium text-warning">{t("tripPrep.noLongerRented")}</span>
);

/**
 * A rental line's divers, breakable between two names and inside one only
 * when it cannot fit whole. Joined as one string, a line could end inside a
 * name: "Sam / Whitfield" in the table and the phone card alike (pixel-craft
 * class 8). Each name is its own `inline-block`, which moves to the next line
 * whole and wraps inside itself only when it is wider than the column; never
 * `whitespace-nowrap`, which in a clipping `Td` cut such a name off without a
 * mark. The comma rides inside the name before it, so the one break between
 * two names is the bare space.
 */
export const diverNames = (names: readonly string[]) =>
  names.map((name, place) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: two divers can share a name, and the list is drawn once, never reordered
    <Fragment key={`${place}:${name}`}>
      {place > 0 ? " " : null}
      <span className="inline-block">
        {name}
        {place < names.length - 1 ? "," : null}
      </span>
    </Fragment>
  ));
/** The same answer in a Size column, where an unsized piece still owes a cell. */
export const sizeCell = (t: StaffTranslator, piece: PrepPiece) => {
  return pieceSize(t, piece) ?? <span className="text-muted">—</span>;
};

/**
 * One kit line. On a phone it is a row: the piece on the left, what it
 * resolves to (a tagged unit or the picker for one) on the right (UX review
 * 2026-10-10, item 13: stacked on a phone, a five-piece diver was ten lines
 * and a page of them ran to 7,000px). From `sm` up it is a tile in the diver's
 * grid, the piece over its unit: a 1,152px desk drew every piece as a 50px
 * row down the left third with the rest of the card empty (Aaron, 2026-10-23:
 * "really ugly"), and three tiles a row put a diver's kit on two lines.
 */
export const kitLineClass =
  "grid grid-cols-[5rem_minmax(0,1fr)] items-center gap-x-2 gap-y-1 sm:flex sm:min-w-0 sm:flex-col sm:items-stretch sm:justify-between sm:gap-1.5 sm:rounded-inset sm:border sm:p-3";

/** A piece with its unit on it: settled, so it sits back in a sunken tile. */
export const kitLineSettledClass = `${kitLineClass} sm:border-transparent sm:bg-surface-sunken`;

/** A piece still to pick: the tile with an edge, where the work is. */
export const kitLineOpenClass = `${kitLineClass} sm:border-border sm:bg-surface`;

/** The grid a diver's kit lines sit in: rows on a phone, tiles from `sm`. */
export const kitGridClass =
  "mt-2 flex flex-col gap-1 text-base sm:grid sm:grid-cols-2 sm:gap-2 lg:grid-cols-3";

/**
 * **A packing line on a phone: one row, three facts** (UX review 2026-10-10,
 * item 13) — the piece and its size in a fixed column, who it is for in the
 * middle where a long list may wrap, and the count at the end. The first
 * column is fixed so every name list starts at one x down the card.
 */
export const KIT_PHONE_ROW_CLASS =
  "grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1 px-4 py-3 text-base [&>p:nth-child(2)]:col-span-2 [&>p:nth-child(2)]:row-start-2 [&>p:last-child]:col-start-2 [&>p:last-child]:row-start-1";

/**
 * Years dry, beside the name, on exactly the terms the roster states it
 * (`RosterSection.tsx`) — only the two notable bands, warning tone, words
 * from `diveRecencyText`. This is the reader the answer is most use to: a
 * divemaster packing a diver's kit is deciding what to bring and who to pair
 * them with, and "last dived over five years ago" changes both.
 *
 * Informs, never gates (ADR 20260821-currency-is-what-catches-people) —
 * nothing here filters, sorts, or refuses. `diveRecencyText` returns null for
 * a diver who was never asked, so silence renders nothing rather than a "not
 * said" line on every seat booked before the question existed.
 *
 * `items-start`: the `md` mark is 20px, the `text-sm` line, so it sits on the
 * note's first line; centred, it stood 9px low beside a note that wrapped.
 * `gap-2`, as the roster draws the same fact.
 */
export const diveRecencyLine = (t: StaffTranslator, band: DiverLine["lastDivedBand"]) => {
  if (!diveRecencyIsNotable(band)) return null;
  return (
    <span className="mt-0.5 flex items-start gap-2 text-sm font-normal text-warning-strong">
      <StatusMark variant="warning" size="md" />
      {diveRecencyText(t, band)}
    </span>
  );
};

/**
 * A diver's kit as one cell: each piece with the size to pull it in, or the
 * one word that says why there is nothing to pull. Own kit and never-asked
 * are kept apart here for the same reason they are kept apart everywhere
 * else — one is an answer, the other is an open question.
 */
export const kitCell = (t: StaffTranslator, line: DiverLine) => {
  if (line.items.length === 0) {
    return (
      <span className="text-muted">
        {line.state === "own_kit"
          ? t("shared.rentalFit.ownKit")
          : line.state === "identity_held"
            ? t("tripPrep.heldSeatSizesWait")
            : t("shared.rentalFit.notRecorded")}
      </span>
    );
  }
  // "Fit at check-in" once per diver, after their pieces, not beside each
  // one (visual review 2026-10-24, B54). A flagged piece keeps what else it
  // has to say: the catalog no longer offering it.
  const fitInPerson = line.items.some((piece) => piece.fitAtCheckIn);
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1">
      {line.items.map((piece) => {
        const detail = piece.fitAtCheckIn
          ? piece.notOffered
            ? noLongerRented(t)
            : null
          : pieceSize(t, piece);
        return (
          // The piece and its detail as two boxes, so a detail that wraps
          // ("Drysuit: weight check in the water") hangs under itself, not
          // back under the piece's name, which never wraps.
          <li key={piece.kind} className="flex gap-1">
            <span className="shrink-0 font-medium">{rentalItemLabel(t, piece.kind)}</span>
            {detail ? <span>{detail}</span> : null}
          </li>
        );
      })}
      {fitInPerson ? (
        <li className="font-medium text-warning">{t("tripPrep.fitAtCheckIn")}</li>
      ) : null}
    </ul>
  );
};
