import { isValidCalendarDate } from "./calendar-date";
import { GEAR_KIND_ORDER, type GearItemKind, type GearServiceKind } from "./gear";
import {
  MAX_IMPORT_BYTES,
  MAX_IMPORT_CELL_LENGTH,
  MAX_IMPORT_COLUMNS,
  MAX_IMPORT_ROWS,
  parseCsv,
} from "./import";

export type PreparedGearImportRow = {
  rowNumber: number;
  label: string;
  kind: GearItemKind;
  size: string | null;
  serialNumber: string | null;
  brandModel: string | null;
  purchasedOn: string | null;
  serviceKind: GearServiceKind | null;
  servicedOn: string | null;
  nextDueOn: string | null;
  nextDueDives: number | null;
  note: string | null;
  personEmail: string | null;
  personName: string | null;
  assignedFrom: string | null;
  assignedUntil: string | null;
  assignmentStatus: string | null;
  assignmentReference: string | null;
  assignmentNote: string | null;
  issues: string[];
};

export type PreparedGearImport = {
  rows: PreparedGearImportRow[];
  unmappedColumns: string[];
  fatal: GearImportFatal | null;
};

/** Why a whole file was refused; each one has a notice of its own on the Import page. */
export type GearImportFatal =
  | "file_empty"
  | "no_gear_column"
  | "file_too_large"
  | "too_many_columns"
  | "too_many_rows"
  | "cell_too_long";

const aliases = {
  label: ["gear_label", "gear_tag", "tag", "unit", "unit_label", "equipment", "asset"],
  kind: ["gear_kind", "gear_type", "kind", "type", "category"],
  size: ["gear_size", "size"],
  serialNumber: ["serial_number", "serial", "serial_no", "serial_number"],
  brandModel: ["brand_model", "brand", "model", "equipment_model"],
  purchasedOn: ["purchased_on", "purchase_date", "acquired_on"],
  serviceKind: ["service_kind", "service_type", "maintenance_type", "event_type"],
  servicedOn: ["serviced_on", "service_date", "maintenance_date", "performed_on"],
  nextDueOn: ["next_due_on", "due_date", "next_service_date", "expires_on"],
  nextDueDives: ["next_due_dives", "service_due_dives", "dive_interval"],
  note: ["service_note", "service_notes", "note", "notes", "comments"],
  personEmail: ["person_email", "diver_email", "customer_email", "renter_email"],
  personName: ["person_name", "diver_name", "customer_name", "renter_name", "customer"],
  assignedFrom: ["assigned_from", "rental_start", "checkout_date", "from_date", "rented_from"],
  assignedUntil: ["assigned_until", "rental_end", "return_date", "to_date", "rented_until"],
  assignmentStatus: ["assignment_status", "rental_status", "status"],
  assignmentReference: [
    "assignment_reference",
    "rental_reference",
    "booking_reference",
    "order_reference",
  ],
  assignmentNote: ["assignment_note", "rental_note", "rental_notes"],
} as const;

function normalize(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function text(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function kind(value: string | null): GearItemKind {
  const normalized = normalize(value ?? "");
  const aliasesByKind: Partial<Record<GearItemKind, string[]>> = {
    bcd: ["bcd", "buoyancy_compensator"],
    regulator: ["regulator", "regs"],
    wetsuit: ["wetsuit", "exposure_suit"],
    boots: ["boots", "boot"],
    mask: ["mask", "mask_only"],
    // A legacy combined row cannot safely invent a serialized mask companion;
    // keep its tagged/size-bearing unit as fins and let staff add the mask.
    fins: ["fins", "fin", "flippers", "mask_fins", "mask_and_fins"],
    weights: ["weights", "weight"],
    dive_computer: ["dive_computer", "computer"],
    gopro: ["gopro", "go_pro"],
    tank: ["tank", "cylinder"],
    other: ["other", "misc"],
  };
  return (
    GEAR_KIND_ORDER.find((candidate) => aliasesByKind[candidate]?.includes(normalized)) ?? "other"
  );
}

function serviceKind(value: string | null): GearServiceKind {
  const normalized = normalize(value ?? "service");
  if (normalized.includes("hydro")) return "hydro_test";
  if (normalized.includes("visual")) return "visual_inspection";
  if (normalized.includes("o2") || normalized.includes("oxygen")) return "o2_clean";
  if (normalized === "note" || normalized === "condition") return "note";
  return "service";
}

export function prepareGearImport(csv: string): PreparedGearImport {
  // **The same four caps the contacts importer enforces** (issue #1846). The
  // server action's body limit is 16 MB, and every row is a gear write; an
  // unbounded file is an unbounded request against a database every tenant
  // shares. Checked before the grid is walked, so nothing is read from a file
  // that is refused.
  if (new TextEncoder().encode(csv).length > MAX_IMPORT_BYTES)
    return { rows: [], unmappedColumns: [], fatal: "file_too_large" };
  const grid = parseCsv(csv).filter((row) => row.some((cell) => cell.trim() !== ""));
  if (grid.length === 0) return { rows: [], unmappedColumns: [], fatal: "file_empty" };
  if (grid[0].length > MAX_IMPORT_COLUMNS)
    return { rows: [], unmappedColumns: [], fatal: "too_many_columns" };
  if (grid.length - 1 > MAX_IMPORT_ROWS)
    return { rows: [], unmappedColumns: [], fatal: "too_many_rows" };
  if (grid.some((row) => row.some((cell) => cell.length > MAX_IMPORT_CELL_LENGTH)))
    return { rows: [], unmappedColumns: [], fatal: "cell_too_long" };
  const headers = grid[0].map(normalize);
  const indexes = new Map<string, number>();
  const unmappedColumns: string[] = [];
  headers.forEach((header, index) => {
    if (!header) return;
    const field = (Object.entries(aliases) as Array<[string, readonly string[]]>).find(
      ([, names]) => names.includes(header),
    )?.[0];
    if (field && !indexes.has(field)) indexes.set(field, index);
    else if (!field) unmappedColumns.push(grid[0][index] ?? header);
  });
  if (!indexes.has("label")) return { rows: [], unmappedColumns, fatal: "no_gear_column" };

  const value = (cells: string[], field: string) => {
    const index = indexes.get(field);
    return index === undefined ? null : text(cells[index]);
  };
  const rows = grid.slice(1).map((cells, index) => {
    const issues: string[] = [];
    const label = value(cells, "label") ?? "";
    const servicedOn = value(cells, "servicedOn");
    const nextDueOn = value(cells, "nextDueOn");
    const purchasedOn = value(cells, "purchasedOn");
    const personEmail = value(cells, "personEmail");
    const personName = value(cells, "personName");
    const assignedFrom = value(cells, "assignedFrom");
    const assignedUntil = value(cells, "assignedUntil");
    const hasAssignment = Boolean(personEmail || personName || assignedFrom || assignedUntil);
    if (hasAssignment && !(personEmail || personName)) issues.push("assignment_missing_person");
    if (hasAssignment && (!assignedFrom || !assignedUntil)) issues.push("assignment_missing_dates");
    if (assignedFrom && !isValidCalendarDate(assignedFrom)) issues.push("invalid_assignment_start");
    if (assignedUntil && !isValidCalendarDate(assignedUntil)) issues.push("invalid_assignment_end");
    if (assignedFrom && assignedUntil && assignedUntil < assignedFrom)
      issues.push("assignment_end_before_start");
    if (!label) issues.push("missing_label");
    if (purchasedOn && !isValidCalendarDate(purchasedOn)) issues.push("invalid_purchase_date");
    if (servicedOn && !isValidCalendarDate(servicedOn)) issues.push("invalid_service_date");
    if (nextDueOn && !isValidCalendarDate(nextDueOn)) issues.push("invalid_due_date");
    const divesRaw = value(cells, "nextDueDives");
    const nextDueDives = divesRaw ? Number(divesRaw) : null;
    if (divesRaw && (!Number.isInteger(nextDueDives) || (nextDueDives ?? 0) <= 0))
      issues.push("invalid_due_dives");
    if (nextDueDives !== null && !nextDueOn) issues.push("dives_need_date");
    return {
      rowNumber: index + 2,
      label,
      kind: kind(value(cells, "kind")),
      size: value(cells, "size"),
      serialNumber: value(cells, "serialNumber"),
      brandModel: value(cells, "brandModel"),
      purchasedOn,
      serviceKind: servicedOn ? serviceKind(value(cells, "serviceKind")) : null,
      servicedOn,
      nextDueOn,
      nextDueDives,
      note: value(cells, "note"),
      personEmail: personEmail?.toLowerCase() ?? null,
      personName,
      assignedFrom,
      assignedUntil,
      assignmentStatus: value(cells, "assignmentStatus"),
      assignmentReference: value(cells, "assignmentReference"),
      assignmentNote: value(cells, "assignmentNote"),
      issues,
    };
  });
  return { rows, unmappedColumns, fatal: null };
}
