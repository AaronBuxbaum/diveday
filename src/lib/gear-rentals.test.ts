import { describe, expect, it } from "vitest";
import { type GearRentalUnitInput, groupGearRentals, rentalPhaseLapsed } from "./gear-rentals";

const TODAY = "2026-10-08";

function unit(overrides: Partial<GearRentalUnitInput> & { reservationId: string }) {
  return {
    reservedFrom: TODAY,
    reservedUntil: TODAY,
    checkedOutAt: null,
    holderPersonId: "p-ana",
    holderName: "Ana Diaz",
    bookingId: "b-1",
    ...overrides,
  } satisfies GearRentalUnitInput;
}

describe("groupGearRentals", () => {
  it("folds a booking's units into one rental under its holder", () => {
    const holders = groupGearRentals(
      [
        unit({ reservationId: "r1", reservedFrom: "2026-10-10", reservedUntil: "2026-10-11" }),
        unit({ reservationId: "r2", reservedFrom: "2026-10-10", reservedUntil: "2026-10-12" }),
      ],
      TODAY,
    );
    expect(holders).toHaveLength(1);
    const [holder] = holders;
    expect(holder?.name).toBe("Ana Diaz");
    expect(holder?.rentals).toHaveLength(1);
    const [rental] = holder?.rentals ?? [];
    expect(rental).toMatchObject({
      key: "b-1",
      bookingId: "b-1",
      from: "2026-10-10",
      until: "2026-10-12",
      phase: "reserved",
    });
    expect(rental?.units.map((row) => row.reservationId)).toEqual(["r1", "r2"]);
  });

  it("keeps a counter rental apart from the same person's trip rental", () => {
    const holders = groupGearRentals(
      [
        unit({ reservationId: "trip", reservedUntil: "2026-10-09" }),
        unit({ reservationId: "counter", bookingId: null, reservedUntil: "2026-10-12" }),
      ],
      TODAY,
    );
    expect(holders).toHaveLength(1);
    expect(holders[0]?.rentals.map((rental) => rental.key)).toEqual(["b-1", "counter:p-ana"]);
    expect(holders[0]?.rentals[1]?.bookingId).toBeNull();
  });

  it("names each unit's phase in the register's own words, and the rental's most urgent", () => {
    const [holder] = groupGearRentals(
      [
        unit({
          reservationId: "out",
          reservedFrom: "2026-10-01",
          reservedUntil: "2026-10-09",
          checkedOutAt: new Date("2026-10-01T12:00:00Z"),
        }),
        unit({
          reservationId: "late",
          reservedFrom: "2026-10-01",
          reservedUntil: "2026-10-07",
          checkedOutAt: new Date("2026-10-01T12:00:00Z"),
        }),
      ],
      TODAY,
    );
    const [rental] = holder?.rentals ?? [];
    expect(rental?.phase).toBe("overdue");
    expect(rental?.units.map((row) => [row.reservationId, row.phase])).toEqual([
      ["late", "overdue"],
      ["out", "out"],
    ]);
  });

  it("splits a lapsed window on whether the unit ever left: overdue vs never picked up", () => {
    const [holder] = groupGearRentals(
      [unit({ reservationId: "wall", reservedFrom: "2026-10-01", reservedUntil: "2026-10-02" })],
      TODAY,
    );
    expect(holder?.rentals[0]?.phase).toBe("never_picked_up");
    expect(rentalPhaseLapsed("never_picked_up")).toBe(true);
    expect(rentalPhaseLapsed("overdue")).toBe(true);
    expect(rentalPhaseLapsed("due_back_today")).toBe(false);
  });

  it("sorts holders by due-back date, so the overdue lead and the future trail", () => {
    const holders = groupGearRentals(
      [
        unit({
          reservationId: "future",
          holderPersonId: "p-zed",
          holderName: "Zed Ames",
          bookingId: "b-zed",
          reservedFrom: "2026-11-01",
          reservedUntil: "2026-11-02",
        }),
        unit({
          reservationId: "today",
          holderPersonId: "p-bo",
          holderName: "Bo Lin",
          bookingId: "b-bo",
          checkedOutAt: new Date("2026-10-08T12:00:00Z"),
        }),
        unit({
          reservationId: "late",
          holderPersonId: "p-cy",
          holderName: "Cy Vane",
          bookingId: "b-cy",
          reservedFrom: "2026-10-01",
          reservedUntil: "2026-10-05",
          checkedOutAt: new Date("2026-10-01T12:00:00Z"),
        }),
      ],
      TODAY,
    );
    expect(holders.map((holder) => [holder.name, holder.rentals[0]?.phase])).toEqual([
      ["Cy Vane", "overdue"],
      ["Bo Lin", "due_back_today"],
      ["Zed Ames", "reserved"],
    ]);
  });

  it("on one due-back date, puts the unit out with a diver ahead of the one never collected", () => {
    const holders = groupGearRentals(
      [
        unit({
          reservationId: "wall",
          holderPersonId: "p-a",
          holderName: "Aa",
          bookingId: "b-a",
          reservedFrom: "2026-10-01",
          reservedUntil: "2026-10-05",
        }),
        unit({
          reservationId: "gone",
          holderPersonId: "p-b",
          holderName: "Bb",
          bookingId: "b-b",
          reservedFrom: "2026-10-01",
          reservedUntil: "2026-10-05",
          checkedOutAt: new Date("2026-10-01T12:00:00Z"),
        }),
      ],
      TODAY,
    );
    expect(holders.map((holder) => holder.name)).toEqual(["Bb", "Aa"]);
  });

  it("returns nothing for nothing", () => {
    expect(groupGearRentals([], TODAY)).toEqual([]);
  });
});
