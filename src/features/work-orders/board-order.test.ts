import { describe, expect, it } from "vitest";
import { shops, workOrders } from "../../db/schema/index";
import { fileScopedShopContext } from "../../test/db";
import { createDiver } from "../divers/store";
import { workOrderBoard } from "./store";

const ctx = fileScopedShopContext();
const TODAY = "2026-10-08";

describe("collected work order board", () => {
  it("shows the latest pickups before applying the collected limit", async () => {
    const { db } = ctx;
    const [shop, rival] = await db
      .insert(shops)
      .values([
        { name: "Work Order Divers", slug: "work-order-pickups", timezone: "America/New_York" },
        { name: "Rival Reef", slug: "rival-pickups", timezone: "America/New_York" },
      ])
      .returning();
    const maya = await createDiver(db, {
      shopId: shop.id,
      fullName: "Maya Pressure",
      email: "maya@example.com",
    });
    const rivalDiver = await createDiver(db, {
      shopId: rival.id,
      fullName: "Rival Diver",
      email: "rival@example.com",
    });
    if (!maya || !rivalDiver) throw new Error("diver insert failed");
    const base = new Date("2026-10-01T00:00:00Z").getTime();
    const minute = 60_000;
    const tickets = await db
      .insert(workOrders)
      .values(
        Array.from({ length: 21 }, (_, index) => ({
          shopId: shop.id,
          personId: maya.id,
          number: index + 1,
          status: "picked_up" as const,
          reportedProblem: "Service",
          receivedAt: new Date(base + index * minute),
          // The oldest intake is tied for the newest pickup.
          pickedUpAt: new Date(base + (21 - Math.max(index, 1)) * minute),
        })),
      )
      .returning();
    const [deleted, foreign, olderOpen, newerOpen] = await db
      .insert(workOrders)
      .values([
        {
          shopId: shop.id,
          personId: maya.id,
          number: 22,
          status: "picked_up" as const,
          reportedProblem: "Deleted",
          pickedUpAt: new Date(base + 30 * minute),
          deletedAt: new Date(base),
        },
        {
          shopId: rival.id,
          personId: rivalDiver.id,
          number: 1,
          status: "picked_up" as const,
          reportedProblem: "Foreign",
          pickedUpAt: new Date(base + 31 * minute),
        },
        {
          shopId: shop.id,
          personId: maya.id,
          number: 23,
          reportedProblem: "Older open",
          receivedAt: new Date(base + 23 * minute),
        },
        {
          shopId: shop.id,
          personId: maya.id,
          number: 24,
          reportedProblem: "Newer open",
          receivedAt: new Date(base + 24 * minute),
        },
      ])
      .returning();
    const tied = [tickets[0].id, tickets[1].id].sort();
    const expected = [...tied, ...tickets.slice(2).map((ticket) => ticket.id)];

    const board = await workOrderBoard(db, shop.id, { todayLocal: TODAY });
    expect(board.openCount).toBe(2);
    expect(
      board.groups.find((group) => group.status === "received")?.rows.map((row) => row.id),
    ).toEqual([newerOpen.id, olderOpen.id]);
    const collected = board.groups.find((group) => group.status === "picked_up")?.rows ?? [];
    expect(collected.map((row) => row.id)).toEqual(expected.slice(0, 20));
    expect(collected.map((row) => row.id)).not.toContain(deleted.id);
    expect(collected.map((row) => row.id)).not.toContain(foreign.id);

    const limited = await workOrderBoard(db, shop.id, { todayLocal: TODAY, collectedLimit: 2 });
    expect(limited.openCount).toBe(2);
    expect(
      limited.groups.find((group) => group.status === "picked_up")?.rows.map((row) => row.id),
    ).toEqual(tied);
  });
});
