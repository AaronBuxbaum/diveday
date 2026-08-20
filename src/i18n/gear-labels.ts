import type { RentalItemKind } from "@/lib/dive-prep";
import type {
  GearItemKind,
  GearItemStatus,
  GearReservationPhase,
  GearServiceKind,
  GearServiceState,
} from "@/lib/gear";
import { rentalItemLabel } from "./rental-labels";
import type { StaffMessageKey, StaffTranslator } from "./staff-messages";

/**
 * The gear register's word maps (ADR 20260815-minimal-gear-register). The
 * eight kinds a unit shares with the packing list resolve through
 * `rental-labels.ts`'s existing `shared.rentalFit.itemLabels.*` words — one
 * code, one wording, on every screen — and only the two register-only kinds
 * (`tank`, `other`) carry words of their own under `gear.itemKinds.*`. The
 * record is total on purpose: a kind added to the enum without a wording
 * decision is a compile error here, never a raw code on a staff screen.
 */
const KIND_SOURCES: Record<GearItemKind, { rental: RentalItemKind } | { key: StaffMessageKey }> = {
  bcd: { rental: "bcd" },
  regulator: { rental: "regulator" },
  wetsuit: { rental: "wetsuit" },
  boots: { rental: "boots" },
  mask_fins: { rental: "mask_fins" },
  weights: { rental: "weights" },
  dive_computer: { rental: "dive_computer" },
  gopro: { rental: "gopro" },
  tank: { key: "gear.itemKinds.tank" },
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
  retired: "gear.status.retired",
};

export function gearStatusLabel(t: StaffTranslator, status: GearItemStatus): string {
  return t(STATUS_KEYS[status]);
}

const SERVICE_KIND_KEYS: Record<GearServiceKind, StaffMessageKey> = {
  service: "gear.serviceKinds.service",
  hydro_test: "gear.serviceKinds.hydroTest",
  visual_inspection: "gear.serviceKinds.visualInspection",
  o2_clean: "gear.serviceKinds.o2Clean",
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
