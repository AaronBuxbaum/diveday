import { describe, expect, it } from "vitest";
import {
  CONNECTION_PROVIDERS,
  type ConnectionRows,
  connectionState,
  type IntegrationConnectionRow,
  shopConnections,
} from "./rules";

const t0 = new Date("2026-10-01T12:00:00Z");
const t1 = new Date("2026-10-05T12:00:00Z");
const t2 = new Date("2026-10-09T12:00:00Z");

const none: ConnectionRows = {
  stripe: null,
  whatsapp: null,
  integrations: [],
  backups: null,
  calendarFeeds: [],
};

function integration(overrides: Partial<IntegrationConnectionRow>): IntegrationConnectionRow {
  return {
    provider: "shopify",
    status: "connected",
    lastSyncedAt: null,
    connectedAt: t0,
    deletedAt: null,
    ...overrides,
  };
}

describe("shopConnections", () => {
  it("lists every provider once, in ledger order, and a shop with nothing is all not connected", () => {
    const connections = shopConnections(none);
    expect(connections.map((c) => c.provider)).toEqual([...CONNECTION_PROVIDERS]);
    expect(connections.every((c) => c.state === "notConnected" && c.lastSeenAt === null)).toBe(
      true,
    );
  });
});

describe("connectionState: stripe", () => {
  const live = {
    chargesEnabled: true,
    paymentsRestrictedAt: null,
    disconnectedAt: null,
    connectedAt: t0,
    updatedAt: t1,
  };

  it("is connected while card payments are on", () => {
    expect(connectionState("stripe", { ...none, stripe: live })).toEqual({
      provider: "stripe",
      state: "connected",
      lastSeenAt: t1,
    });
  });

  it("needs attention when Stripe turned card payments off", () => {
    const row = { ...live, chargesEnabled: false, paymentsRestrictedAt: t1 };
    expect(connectionState("stripe", { ...none, stripe: row }).state).toBe("needsAttention");
  });

  it("needs attention while onboarding is unfinished", () => {
    const row = { ...live, chargesEnabled: false };
    expect(connectionState("stripe", { ...none, stripe: row }).state).toBe("needsAttention");
  });

  it("is disconnected after a deauthorize, whatever the flags still say", () => {
    const row = { ...live, disconnectedAt: t2 };
    expect(connectionState("stripe", { ...none, stripe: row })).toEqual({
      provider: "stripe",
      state: "disconnected",
      lastSeenAt: t2,
    });
  });
});

describe("connectionState: whatsapp", () => {
  it("is connected with no last seen: nothing records when Meta last answered (issue #3661)", () => {
    for (const verifiedAt of [t1, null]) {
      const rows = { ...none, whatsapp: { connectedAt: t0, verifiedAt } };
      expect(connectionState("whatsapp", rows)).toEqual({
        provider: "whatsapp",
        state: "connected",
        lastSeenAt: null,
      });
    }
  });
});

describe("connectionState: integrations", () => {
  it("includes Square and reads its own live or disconnected evidence", () => {
    const rows = { ...none, integrations: [integration({ provider: "square" })] };
    expect(shopConnections(rows).find((row) => row.provider === "square")).toEqual({
      provider: "square",
      state: "connected",
      lastSeenAt: t0,
    });
    expect(
      connectionState("square", {
        ...none,
        integrations: [integration({ provider: "square", deletedAt: t2 })],
      }),
    ).toEqual({
      provider: "square",
      state: "disconnected",
      lastSeenAt: t2,
    });
    expect(connectionState("quickbooks", rows).state).toBe("notConnected");
  });
  it("reads each provider from its own row only", () => {
    const rows = { ...none, integrations: [integration({ provider: "quickbooks" })] };
    expect(connectionState("quickbooks", rows).state).toBe("connected");
    expect(connectionState("shopify", rows).state).toBe("notConnected");
    expect(connectionState("zapier", rows).state).toBe("notConnected");
  });

  it("needs attention when the last sync errored", () => {
    const rows = { ...none, integrations: [integration({ status: "error", lastSyncedAt: t1 })] };
    expect(connectionState("shopify", rows)).toEqual({
      provider: "shopify",
      state: "needsAttention",
      lastSeenAt: t1,
    });
  });

  it("is disconnected when only stamped rows remain, seen at the latest disconnect", () => {
    const rows = {
      ...none,
      integrations: [integration({ deletedAt: t1 }), integration({ deletedAt: t2 })],
    };
    expect(connectionState("shopify", rows)).toEqual({
      provider: "shopify",
      state: "disconnected",
      lastSeenAt: t2,
    });
  });

  it("a reconnect beside a disconnected row reads as the live row", () => {
    const rows = {
      ...none,
      integrations: [
        integration({ deletedAt: t1 }),
        integration({ connectedAt: t2, lastSyncedAt: null }),
      ],
    };
    expect(connectionState("shopify", rows)).toEqual({
      provider: "shopify",
      state: "connected",
      lastSeenAt: t2,
    });
  });
});

describe("connectionState: backups", () => {
  it("is connected with no last-seen until a delivery lands", () => {
    const rows = { ...none, backups: { connectedAt: t0, verifiedAt: null } };
    expect(connectionState("backups", rows)).toEqual({
      provider: "backups",
      state: "connected",
      lastSeenAt: null,
    });
  });

  it("is last seen at the delivery that landed", () => {
    const rows = { ...none, backups: { connectedAt: t0, verifiedAt: t2 } };
    expect(connectionState("backups", rows).lastSeenAt).toBe(t2);
  });
});

describe("connectionState: calendar feeds", () => {
  it("is connected while any feed is live, with no last seen: a quiet feed is not a broken one (issue #3661)", () => {
    const rows = {
      ...none,
      calendarFeeds: [
        { lastAccessedAt: t2, revokedAt: t2 },
        { lastAccessedAt: t1, revokedAt: null },
        { lastAccessedAt: null, revokedAt: null },
      ],
    };
    expect(connectionState("calendarFeeds", rows)).toEqual({
      provider: "calendarFeeds",
      state: "connected",
      lastSeenAt: null,
    });
  });

  it("is disconnected when every feed was revoked", () => {
    const rows = {
      ...none,
      calendarFeeds: [
        { lastAccessedAt: t0, revokedAt: t1 },
        { lastAccessedAt: null, revokedAt: t2 },
      ],
    };
    expect(connectionState("calendarFeeds", rows)).toEqual({
      provider: "calendarFeeds",
      state: "disconnected",
      lastSeenAt: t2,
    });
  });
});
