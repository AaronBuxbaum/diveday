import { Fragment } from "react";
import { tapTargetLinkClass } from "@/components/ui/button";
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
  },
) =>
  [unit.size ? `${unit.label} · ${unit.size}` : unit.label, ...careNotes(t, unit)]
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
  // A drysuit diver's fins. The stated size is a shoe size — one question,
  // "Fin & boot size" — and a drysuit boot is two to three fin sizes bigger
  // than the foot in it, so the size is where the packer starts and never
  // what they pull (dive-prep.ts).
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
  // An item that should have had a size and doesn't says so; one with no
  // size to record has nothing to say, because those are different problems.
  return UNSIZED_ITEM_KINDS.includes(piece.kind) ? null : (
    <span className="text-muted">{t("tripPrep.notRecorded")}</span>
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
  const dropped = <span className="font-medium text-warning">{t("tripPrep.noLongerRented")}</span>;
  return detail ? (
    <>
      {detail} · {dropped}
    </>
  ) : (
    dropped
  );
};
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
 * One kit line: the piece on the left, what it resolves to — a tagged unit
 * or the picker for one — on the right. Stacked on a phone, two columns from
 * `sm` up, so a diver's pieces line up down the row rather than each finding
 * its own indent.
 */
export const kitLineClass =
  "grid gap-x-3 gap-y-1 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-baseline";

/**
 * **A diver's name that stands on a line of its own, as the way into their
 * record**: the 44px floor (`tapTargetLinkClass`, principles §2), with the
 * (44 − 20) / 2 it adds handed back above and below, so the target grows and
 * the 20px line the name sits on does not — the give-back `EntryShell`'s
 * footer links make. The never-asked run was 17px words
 * (pixel-craft class 7). A name inside a sentence (the bullet lines) stays
 * that sentence's link.
 *
 * The 12px is padding as well as the margin that hands it back, so the
 * margin box is always exactly the name's own lines. As a bare `min-h-11`
 * the give-back held for one line only: a name that wrapped outgrew the
 * floor, the margin still handed back 24px, and its second line hung 10px
 * below the line box, onto whatever came next.
 */
export const nameLinkClass = `${tapTargetLinkClass} py-3 -my-3 font-medium hover:text-primary hover:underline`;

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
export const kitCell = (t: StaffTranslator, line: DiverLine) =>
  line.items.length > 0 ? (
    <ul className="flex flex-wrap gap-x-4 gap-y-1">
      {line.items.map((piece) => {
        const detail = pieceSize(t, piece);
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
    </ul>
  ) : (
    <span className="text-muted">
      {line.state === "own_kit"
        ? t("shared.rentalFit.ownKit")
        : line.state === "identity_held"
          ? t("tripPrep.heldSeatSizesWait")
          : t("shared.rentalFit.notRecorded")}
    </span>
  );
