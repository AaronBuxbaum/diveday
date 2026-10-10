import { describe, expect, it } from "vitest";
import { DIVER_EXPORT_FILES } from "./export-diver-files";
import {
  BOOKING_PAYMENT_EVENTS_CSV,
  BOOKINGS_CSV,
  diverFile,
  ORDER_LINE_ITEMS_CSV,
  ORDERS_CSV,
  RENTAL_FIT_CSV,
  ROLL_CALL_EVENTS_CSV,
  type SharedExportFile,
  shopFile,
  WAIVER_RECORDS_CSV,
  WORK_ORDERS_CSV,
} from "./export-shared-files";
import { SHOP_EXPORT_FILES } from "./export-shop-files";

/**
 * The columns a diver's own bundle must never carry, though the shop's file of
 * the same table does (ADR 20260824-diver-record-export). Each is pinned on
 * both sides: absent from the diver's header, and present in the shop's, so a
 * renamed column cannot pass this by vanishing from both.
 */
function pin<Row>(spec: SharedExportFile<Row>, column: string) {
  return [spec.file, column, shopFile(spec).header, diverFile(spec).header] as const;
}

const WITHHELD = [
  // Another diver's booking id on a shared party.
  pin(BOOKINGS_CSV, "party_lead_booking_id"),
  pin(BOOKINGS_CSV, "person_id"),
  // Free text staff type, which can name a different diver.
  pin(BOOKING_PAYMENT_EVENTS_CSV, "note"),
  pin(ROLL_CALL_EVENTS_CSV, "note"),
  pin(RENTAL_FIT_CSV, "note"),
  // The raw questionnaire: a hold surfaces as a status, never the answers.
  pin(WAIVER_RECORDS_CSV, "medical_answers"),
  // The shop's internal talk about a repair.
  pin(WORK_ORDERS_CSV, "technician_notes"),
  pin(WORK_ORDERS_CSV, "outcome_note"),
  // Staff-typed invoice text.
  pin(ORDERS_CSV, "description"),
  pin(ORDER_LINE_ITEMS_CSV, "description"),
];

describe("a table both bundles write", () => {
  it.each(WITHHELD)("keeps %s's %s out of the diver's file", (_file, column, shop, diver) => {
    expect(shop).toContain(column);
    expect(diver).not.toContain(column);
  });

  it("writes the same file name, and only declared columns, into each bundle", () => {
    const shopNames = new Set(SHOP_EXPORT_FILES.map((file) => file.file));
    for (const file of DIVER_EXPORT_FILES) {
      if (file.file === "profile.csv") continue;
      // Every diver file but the profile is a table the shop bundle exports too.
      expect(shopNames, file.file).toContain(file.file);
    }
  });

  it("answers both bundles from one column list, in one order", () => {
    const shop = shopFile(WORK_ORDERS_CSV).header;
    const diver = diverFile(WORK_ORDERS_CSV).header;
    // The diver's columns appear in the shop file's order: one list, filtered.
    const positions = diver.map((column) => shop.indexOf(column));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });
});
