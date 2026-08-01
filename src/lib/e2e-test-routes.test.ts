import { afterEach, describe, expect, it, vi } from "vitest";
import { e2eTestRouteAuthorized } from "./e2e-test-routes";

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
