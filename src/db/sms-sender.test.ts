import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { shopForSmsSender } from "./sms-sender";

const ctx = fileScopedShopContext();

describe("shopForSmsSender (#2320)", () => {
  it("names no shop for DiveDay's shared sender, whatever number was texted", async () => {
    expect(await shopForSmsSender(ctx.db, "+18335550100")).toBeNull();
    expect(await shopForSmsSender(ctx.db, null)).toBeNull();
  });
});
