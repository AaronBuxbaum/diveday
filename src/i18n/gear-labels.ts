import { TANK_FILL_O2_PERCENT } from "@/lib/counter-rentals";
import type { RentalItemKind } from "@/lib/dive-prep";
import {
  GEAR_ITEM_STATUSES,
  type GearItemKind,
  type GearItemStatus,
  type GearReservationPhase,
  type GearReturnOutcome,
  type GearServiceKind,
  type GearServiceState,
} from "@/lib/gear";
import { rentalItemLabel } from "./rental-labels";
import type { StaffMessageKey, StaffTranslator } from "./staff-messages";

/**
 * The gear register's word maps (ADR 20260815-minimal-gear-register). The
 * eight kinds a unit shares with the packing list resolve through
 * `rental-labels.ts`'s existing `shared.rentalFit.itemLabels.*` words — one
 * code, one wording, on every screen — and register-only kinds carry words of
 * their own under `gear.itemKinds.*`. The record is total on purpose: a kind
 * added to the enum without a wording decision is a compile error here, never
 * a raw code on a staff screen.
 */
const KIND_SOURCES: Record<GearItemKind, { rental: RentalItemKind } | { key: StaffMessageKey }> = {
  bcd: { rental: "bcd" },
  regulator: { rental: "regulator" },
  wetsuit: { rental: "wetsuit" },
  boots: { rental: "boots" },
  mask: { key: "gear.itemKinds.mask" },
  fins: { key: "gear.itemKinds.fins" },
  weights: { rental: "weights" },
  dive_computer: { rental: "dive_computer" },
  gopro: { rental: "gopro" },
  tank: { key: "gear.itemKinds.tank" },
  drysuit: { key: "gear.itemKinds.drysuit" },
  hood: { key: "gear.itemKinds.hood" },
  gloves: { key: "gear.itemKinds.gloves" },
  torch: { key: "gear.itemKinds.torch" },
  dpv: { key: "gear.itemKinds.dpv" },
  smb: { key: "gear.itemKinds.smb" },
  reel: { key: "gear.itemKinds.reel" },
  camera: { key: "gear.itemKinds.camera" },
  nitrox_analyzer: { key: "gear.itemKinds.nitroxAnalyzer" },
  o2_kit: { key: "gear.itemKinds.o2Kit" },
  aed: { key: "gear.itemKinds.aed" },
  first_aid_kit: { key: "gear.itemKinds.firstAidKit" },
  flares: { key: "gear.itemKinds.flares" },
  other: { key: "gear.itemKinds.other" },
};

/** A tracked unit's kind word — "BCD", "Tank", identical to the prep list's. */
export function gearItemKindLabel(t: StaffTranslator, kind: GearItemKind): string {
  const source = KIND_SOURCES[kind];
  return "rental" in source ? rentalItemLabel(t, source.rental) : t(source.key);
}

const STATUS_KEYS: Record<GearItemStatus, StaffMessageKey> = {
  in_service: "gear.status.inService",
  needs_service: "gear.status.needsService",
};

export function gearStatusLabel(t: StaffTranslator, status: GearItemStatus): string {
  return t(STATUS_KEYS[status]);
}

/**
 * Every gear status, worded — for a caller that has to render all of them and
 * cannot ask one at a time. The palette is the case: `src/db/search.ts` returns
 * the status *code* with each gear hit (domain returns codes), and the words
 * have to be resolved once, server-side, before crossing into the client
 * component (issue #719).
 */
export function gearStatusLabels(t: StaffTranslator): Record<GearItemStatus, string> {
  return Object.fromEntries(
    GEAR_ITEM_STATUSES.map((status) => [status, gearStatusLabel(t, status)]),
  ) as Record<GearItemStatus, string>;
}

const SERVICE_KIND_KEYS: Record<GearServiceKind, StaffMessageKey> = {
  service: "gear.serviceKinds.service",
  hydro_test: "gear.serviceKinds.hydroTest",
  visual_inspection: "gear.serviceKinds.visualInspection",
  o2_clean: "gear.serviceKinds.o2Clean",
  aed_pads: "gear.serviceKinds.aedPads",
  aed_battery: "gear.serviceKinds.aedBattery",
  expiry: "gear.serviceKinds.expiry",
  note: "gear.serviceKinds.note",
};

/** A care clock's word — "Annual service", "Hydro test", "Visual inspection". */
export function gearServiceKindLabel(t: StaffTranslator, kind: GearServiceKind): string {
  return t(SERVICE_KIND_KEYS[kind]);
}

/**
 * A unit's most urgent clock, worded for a register row or detail header.
 * `dueOn` arrives already formatted for the reader's locale — this composes
 * the sentence, never the date.
 */
export function gearServiceStateText(
  t: StaffTranslator,
  state: GearServiceState,
  dueOn: string,
): string | null {
  switch (state.state) {
    case "no_clock":
      return null;
    case "ok":
      return t("gear.serviceState.ok", {
        clockLabel: gearServiceKindLabel(t, state.kind),
        dueOn,
      });
    case "due_soon":
      return t("gear.serviceState.dueSoon", {
        clockLabel: gearServiceKindLabel(t, state.kind),
        dueOn,
      });
    case "overdue":
      return t("gear.serviceState.overdue", {
        clockLabel: gearServiceKindLabel(t, state.kind),
        dueOn,
      });
  }
}

const PHASE_KEYS: Record<GearReservationPhase, StaffMessageKey> = {
  reserved: "gear.phase.reserved",
  out: "gear.phase.out",
  due_back_today: "gear.phase.dueBackToday",
  overdue: "gear.phase.overdue",
  never_picked_up: "gear.phase.neverPickedUp",
  returned: "gear.phase.returned",
};

/** Where a reservation stands — "Reserved", "Out", "Due back today", "Overdue". */
export function gearPhaseLabel(t: StaffTranslator, phase: GearReservationPhase): string {
  return t(PHASE_KEYS[phase]);
}

/**
 * **How a rental set came home**, in the reader's own language (issue #1186,
 * delight report D26).
 *
 * Past tense in all three, because every one of them is a report of something
 * that already happened at a counter — a present-tense "needs service" would
 * read as a state the unit is in, which is the service clocks' claim to make
 * and not this one's.
 */
export function gearReturnOutcomeLabel(t: StaffTranslator, outcome: GearReturnOutcome): string {
  switch (outcome) {
    case "all_good":
      return t("gear.unit.returnOutcomeAllGood");
    case "fit_adjusted":
      return t("gear.unit.returnOutcomeFitAdjusted");
    case "service_concern":
      return t("gear.unit.returnOutcomeServiceConcern");
  }
}

/**
 * A counter tank's recorded gas (issue #2257): "Air" at 21% oxygen, otherwise
 * "EANx 32". The percent is the stored oxygen figure, never rounded here.
 */
export function tankFillLabel(t: StaffTranslator, o2Percent: number): string {
  return o2Percent === 21
    ? t("counterRentals.fill.air")
    : t("counterRentals.fill.eanx", { percent: o2Percent });
}

/**
 * A counter tank's gas menu (#2257): a placeholder nobody can submit, air,
 * then EANx 22 to 40. Shared by the rent-out form and the ticket's correction.
 */
export function tankFillOptions(
  t: StaffTranslator,
  placeholder: string,
): { value: string; label: string }[] {
  const { air, max } = TANK_FILL_O2_PERCENT;
  return [
    { value: "", label: placeholder },
    ...Array.from({ length: max - air + 1 }, (_, index) => ({
      value: String(air + index),
      label: tankFillLabel(t, air + index),
    })),
  ];
}
