import { describe, expect, it } from "vitest";
import type { TodayAction } from "@/lib/today";
import { pushEquipmentRows } from "./today-equipment-rows";
import { rowsContext } from "./today-rows-test-fixtures";

const emptyWave = {
  credentialRows: [],
  overdueGear: [],
  dueBackGear: [],
  gearServiceDueRows: [],
  fitAdjustedReturns: [],
  boatSafety: { departures: [], errands: [] },
  workOrdersNeedingAttention: [],
};

function rows(wave: Record<string, unknown>): TodayAction[] {
  const actions: TodayAction[] = [];
  pushEquipmentRows(actions, rowsContext({ ...emptyWave, ...wave }));
  return actions;
}

describe("pushEquipmentRows", () => {
  it("adds nothing for a shop with no fleet and no credential due", () => {
    expect(rows({})).toEqual([]);
  });

  it("folds one staffer's lapsing credentials into one row, the earliest date leading", () => {
    const person = { id: "p1", fullName: "Rosa Diaz" };
    const actions = rows({
      credentialRows: [
        { person, credential: { name: "First aid", renewsAt: "2026-08-10" } },
        { person, credential: { name: "Insurance", renewsAt: "2026-07-30" } },
        { person, credential: { name: "Captain's licence", renewsAt: "2027-07-30" } },
      ],
    });
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      kind: "staff_credential_due",
      staffPersonId: "p1",
      subject: "Rosa Diaz",
      href: "/shop/blue-mantis/settings/team#credentials",
    });
    expect(actions[0]?.dueAt?.toISOString().slice(0, 10)).toBe("2026-07-30");
  });

  it("marks a credential overdue from its own local day, not UTC's", () => {
    const [row] = rows({
      credentialRows: [
        {
          person: { id: "p2", fullName: "Sam Lee" },
          credential: { name: "First aid", renewsAt: "2026-07-20" },
        },
      ],
    });
    expect(row?.urgency).toBe("now");
  });
});
