import { describe, expect, it } from "vitest";
import { addPanelCloseHref, addPanelHref, addPanelOpen } from "./add-panel";

describe("add panel URLs", () => {
  it("opens on its own value only", () => {
    expect(addPanelOpen("1")).toBe(true);
    expect(addPanelOpen(undefined)).toBe(false);
    expect(addPanelOpen("rental")).toBe(false);
    expect(addPanelOpen("rental", "rental")).toBe(true);
    expect(addPanelOpen(["1", "1"])).toBe(false);
  });

  it("spells the opening link with only the context it was given", () => {
    expect(addPanelHref("/shop/reef/divers")).toBe("/shop/reef/divers?add=1");
    expect(addPanelHref("/shop/reef/gear", "rental", { personId: "p-1", q: undefined })).toBe(
      "/shop/reef/gear?add=rental&personId=p-1",
    );
  });

  it("closes onto the index as it was read, without the panel's own keys", () => {
    expect(
      addPanelCloseHref(
        "/shop/reef/divers",
        { add: "1", notice: "invalid", q: "ana", confirmName: "Ana", page: "2" },
        ["confirmName"],
      ),
    ).toBe("/shop/reef/divers?q=ana&page=2");
    expect(addPanelCloseHref("/shop/reef/orders", { add: "1" })).toBe("/shop/reef/orders");
  });
});
