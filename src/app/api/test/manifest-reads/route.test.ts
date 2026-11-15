import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearManifestReadCount, recordManifestRead } from "@/features/e2e-test-routes";
import { POST } from "./route";

const tripId = "11111111-1111-4111-8111-111111111111";
function request(action: string, authorization = "Bearer secret") {
  return new Request("http://localhost/api/test/manifest-reads", {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify({ tripId, action }),
  });
}
beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("DIVEDAY_E2E", "1");
  vi.stubEnv("DIVEDAY_E2E_SECRET", "secret");
  clearManifestReadCount(tripId);
});
afterEach(() => {
  clearManifestReadCount(tripId);
  vi.unstubAllEnvs();
});
it("observes armed read attempts and clears them", async () => {
  recordManifestRead(tripId);
  expect(await (await POST(request("read"))).json()).toEqual({ count: null });
  expect((await POST(request("reset"))).status).toBe(200);
  recordManifestRead(tripId);
  expect(await (await POST(request("read"))).json()).toEqual({ count: 1 });
  expect(await (await POST(request("clear"))).json()).toEqual({ count: null });
});
it("refuses an unauthorized or real-database request without changing the counter", async () => {
  await POST(request("reset"));
  recordManifestRead(tripId);
  expect((await POST(request("reset", "Bearer wrong"))).status).toBe(404);
  vi.stubEnv("DATABASE_URL", "postgres://production");
  expect((await POST(request("reset"))).status).toBe(404);
  vi.stubEnv("DATABASE_URL", "");
  expect(await (await POST(request("read"))).json()).toEqual({ count: 1 });
});
