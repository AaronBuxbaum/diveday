import { afterEach, describe, expect, it, vi } from "vitest";
import { armClaudeFixtures } from "../assists/e2e-fixtures";
import { e2eTestRouteAuthorized, requireDemoTenant, testRouteRefused } from "./rules";

function req(authorization?: string): Request {
  const headers = new Headers();
  if (authorization !== undefined) headers.set("authorization", authorization);
  return new Request("http://localhost/api/test/reset", { method: "POST", headers });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("e2eTestRouteAuthorized", () => {
  it("refuses when a real database is configured, even with a correct secret and DIVEDAY_E2E set", () => {
    vi.stubEnv("DATABASE_URL", "postgres://example");
    vi.stubEnv("DIVEDAY_E2E", "1");
    vi.stubEnv("DIVEDAY_E2E_SECRET", "s3cr3t");
    expect(e2eTestRouteAuthorized(req("Bearer s3cr3t"))).toBe(false);
  });

  it("refuses in a production runtime without DIVEDAY_E2E, even with a correct secret", () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DIVEDAY_E2E", "");
    vi.stubEnv("DIVEDAY_E2E_SECRET", "s3cr3t");
    expect(e2eTestRouteAuthorized(req("Bearer s3cr3t"))).toBe(false);
  });

  it("refuses a production+DIVEDAY_E2E=1 deployment (the misconfiguration this hardens) when no secret is configured", () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DIVEDAY_E2E", "1");
    vi.stubEnv("DIVEDAY_E2E_SECRET", "");
    expect(e2eTestRouteAuthorized(req("Bearer anything"))).toBe(false);
  });

  it("refuses that same deployment even with DIVEDAY_E2E=1 if the caller doesn't know the configured secret", () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DIVEDAY_E2E", "1");
    vi.stubEnv("DIVEDAY_E2E_SECRET", "real-secret");
    expect(e2eTestRouteAuthorized(req("Bearer guessed-wrong"))).toBe(false);
    expect(e2eTestRouteAuthorized(req())).toBe(false);
  });

  it("authorizes a non-production runtime with the correct secret", () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("DIVEDAY_E2E_SECRET", "s3cr3t");
    expect(e2eTestRouteAuthorized(req("Bearer s3cr3t"))).toBe(true);
  });

  it("authorizes a production+DIVEDAY_E2E=1 deployment when the correct secret is presented", () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DIVEDAY_E2E", "1");
    vi.stubEnv("DIVEDAY_E2E_SECRET", "real-secret");
    expect(e2eTestRouteAuthorized(req("Bearer real-secret"))).toBe(true);
  });

  it("refuses when DIVEDAY_E2E_SECRET is unset, even in a harmless-looking dev runtime", () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("DIVEDAY_E2E_SECRET", "");
    expect(e2eTestRouteAuthorized(req("Bearer anything"))).toBe(false);
    expect(e2eTestRouteAuthorized(req())).toBe(false);
  });
});

describe("requireDemoTenant (issue #2751)", () => {
  function harness() {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("DIVEDAY_E2E_SECRET", "s3cr3t");
  }

  async function expectRefusal(response: Response) {
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_available" });
  }

  it("hands back a demo shop to an authorized request", async () => {
    harness();
    const shop = { id: "shop-1", isDemo: true };
    expect(await requireDemoTenant(req("Bearer s3cr3t"), async () => shop)).toEqual({
      ok: true,
      shop,
    });
  });

  it("refuses a real shop, a missing one, and a non-boolean isDemo with the one shape", async () => {
    harness();
    for (const found of [
      { id: "real", isDemo: false },
      null,
      undefined,
      { id: "odd", isDemo: "true" as unknown as boolean },
      { id: "odd", isDemo: 1 as unknown as boolean },
    ]) {
      const tenant = await requireDemoTenant(req("Bearer s3cr3t"), async () => found);
      expect(tenant.ok).toBe(false);
      if (!tenant.ok) await expectRefusal(tenant.response);
    }
  });

  it("never runs the lookup for a request the harness gate refuses", async () => {
    vi.stubEnv("DIVEDAY_E2E_SECRET", "s3cr3t");
    const findShop = vi.fn(async () => ({ id: "shop-1", isDemo: true }));
    for (const request of [req(), req("Bearer wrong"), req("Bearer s3cr3"), req("bearer s3cr3t")]) {
      vi.stubEnv("DATABASE_URL", "");
      const tenant = await requireDemoTenant(request, findShop);
      expect(tenant.ok).toBe(false);
      if (!tenant.ok) await expectRefusal(tenant.response);
    }
    vi.stubEnv("DATABASE_URL", "postgres://example");
    const tenant = await requireDemoTenant(req("Bearer s3cr3t"), findShop);
    expect(tenant.ok).toBe(false);
    expect(findShop).not.toHaveBeenCalled();
  });

  it("refuses a demo shop when the gate closes, however the shop reads", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("DIVEDAY_E2E_SECRET", "");
    const tenant = await requireDemoTenant(req("Bearer "), async () => ({
      id: "shop-1",
      isDemo: true,
    }));
    expect(tenant.ok).toBe(false);
  });

  it("lets through only the shop this server armed for Claude fixtures, never another real one", async () => {
    harness();
    armClaudeFixtures("armed-shop", true);
    try {
      const armed = { id: "armed-shop", isDemo: false };
      expect(await requireDemoTenant(req("Bearer s3cr3t"), async () => armed)).toEqual({
        ok: true,
        shop: armed,
      });
      const other = await requireDemoTenant(req("Bearer s3cr3t"), async () => ({
        id: "real-shop",
        isDemo: false,
      }));
      expect(other.ok).toBe(false);
      vi.stubEnv("DIVEDAY_E2E_SECRET", "");
      expect((await requireDemoTenant(req("Bearer s3cr3t"), async () => armed)).ok).toBe(false);
    } finally {
      armClaudeFixtures("armed-shop", false);
    }
    harness();
    expect(
      (
        await requireDemoTenant(req("Bearer s3cr3t"), async () => ({
          id: "armed-shop",
          isDemo: false,
        }))
      ).ok,
    ).toBe(false);
  });

  it("is the same refusal the harness gate answers with", async () => {
    await expectRefusal(testRouteRefused());
  });
});
