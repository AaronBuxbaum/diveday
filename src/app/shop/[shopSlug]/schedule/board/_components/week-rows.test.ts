import { describe, expect, it } from "vitest";
import { weekRows } from "./week-rows";

type Day = { id: string; isPast: boolean; boats: number };
const day = (id: string, isPast: boolean, boats = 0): Day => ({ id, isPast, boats });
const empty = (d: Day) => d.boats === 0;
const shape = (days: Day[]) =>
  weekRows(days, empty).map((row) =>
    row.kind === "day" ? row.day.id : `quiet:${row.days.map((d) => d.id).join(",")}`,
  );

describe("weekRows", () => {
  it("folds Monday to Friday, gone by with no boats, into one row on a Saturday", () => {
    const week = [
      day("mon", true),
      day("tue", true),
      day("wed", true),
      day("thu", true),
      day("fri", true),
      day("sat", false, 2),
      day("sun", false, 2),
    ];
    expect(shape(week)).toEqual(["quiet:mon,tue,wed,thu,fri", "sat", "sun"]);
  });

  it("never folds today or a day still ahead, however empty", () => {
    const week = [day("mon", true), day("tue", true), day("wed", false), day("thu", false)];
    expect(shape(week)).toEqual(["quiet:mon,tue", "wed", "thu"]);
  });

  it("keeps a past day with a boat on it as its own row, splitting the runs around it", () => {
    const week = [
      day("mon", true),
      day("tue", true),
      day("wed", true, 1),
      day("thu", true),
      day("fri", true),
      day("sat", false),
    ];
    expect(shape(week)).toEqual(["quiet:mon,tue", "wed", "quiet:thu,fri", "sat"]);
  });

  it("leaves a lone quiet past day as a day", () => {
    expect(shape([day("mon", true), day("tue", false)])).toEqual(["mon", "tue"]);
    expect(shape([day("mon", false), day("tue", true)])).toEqual(["mon", "tue"]);
  });

  it("folds a whole past week into one row", () => {
    const week = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((id) => day(id, true));
    expect(shape(week)).toEqual(["quiet:mon,tue,wed,thu,fri,sat,sun"]);
  });

  it("changes nothing on a week still ahead", () => {
    const week = ["mon", "tue", "wed"].map((id) => day(id, false));
    expect(shape(week)).toEqual(["mon", "tue", "wed"]);
  });
});
