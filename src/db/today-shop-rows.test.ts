import { describe, expect, it } from "vitest";
import type { TodayAction } from "@/lib/today";
import { rowsContext } from "./today-rows-test-fixtures";
import { pushShopRows } from "./today-shop-rows";

const quiet = {
  opsAlerts: null,
  reviewsAwaiting: { count: 0, onlyId: null },
  unanswered: 0,
  openOrders: new Map(),
};

function rows(wave: Record<string, unknown>): TodayAction[] {
  const actions: TodayAction[] = [];
  pushShopRows(actions, rowsContext({ ...quiet, ...wave }));
  return actions;
}

describe("pushShopRows", () => {
  it("adds nothing for a shop with nothing waiting", () => {
    expect(rows({})).toEqual([]);
  });

  it("sends one review straight to its own anchor, and several to the list", () => {
    const [one] = rows({ reviewsAwaiting: { count: 1, onlyId: "r1" } });
    expect(one).toMatchObject({ kind: "reviews_pending", urgency: "later", dueAt: null });
    expect(one?.href).toBe("/shop/blue-mantis/reviews#review-r1");
    const [several] = rows({ reviewsAwaiting: { count: 3, onlyId: null } });
    expect(several?.href).toBe("/shop/blue-mantis/reviews");
  });

  it("raises one inbox row however many divers wrote back", () => {
    const inbox = rows({ unanswered: 4 });
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({
      kind: "unanswered_messages",
      href: "/shop/blue-mantis/inbox",
    });
  });
});
