import { describe, expect, it } from "vitest";
import { CONNECTION_PROVIDERS } from "@/lib/connections";
import { fileScopedShopContext } from "@/test/db";
import { readShopConnections } from "./connections";
import { disconnectShopIntegration, saveShopIntegration } from "./integrations";

const ctx = fileScopedShopContext();

function connectZapier(shopId: string) {
  return saveShopIntegration(ctx.db, {
    shopId,
    provider: "zapier",
    credentials: { hookUrl: "https://hooks.zapier.com/hooks/catch/1/abc/" },
    settings: {},
  });
}

describe("readShopConnections", () => {
  it("reads one line per provider, in ledger order", async () => {
    const connections = await readShopConnections(ctx.db, ctx.shop.id);
    expect(connections.map((c) => c.provider)).toEqual([...CONNECTION_PROVIDERS]);
  });

  it("reads a connected integration, then the same provider disconnected", async () => {
    await connectZapier(ctx.shop.id);
    const on = await readShopConnections(ctx.db, ctx.shop.id);
    expect(on.find((c) => c.provider === "zapier")?.state).toBe("connected");

    await disconnectShopIntegration(ctx.db, ctx.shop.id, "zapier");
    const off = await readShopConnections(ctx.db, ctx.shop.id);
    expect(off.find((c) => c.provider === "zapier")?.state).toBe("disconnected");
  });

  it("never reads another shop's rows", async () => {
    await connectZapier(ctx.shop.id);
    const stranger = await readShopConnections(ctx.db, "00000000-0000-4000-8000-000000000000");
    expect(stranger.every((c) => c.state === "notConnected")).toBe(true);
  });
});
