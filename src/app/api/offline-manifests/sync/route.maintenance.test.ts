import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null) }));
vi.mock("@/db/client", async (original) => ({
  ...(await original<typeof import("@/db/client")>()),
  getDb: vi.fn(),
}));

const { auth } = await import("@/lib/auth");
const { getDb } = await import("@/db/client");
const { POST } = await import("./route");

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

it("refuses the entire offline batch during maintenance without reading the database", async () => {
  vi.stubEnv("DIVEDAY_OFFLINE_SYNC_PAUSED", "1");
  const response = await POST(
    new Request("http://localhost/api/offline-manifests/sync", {
      method: "POST",
      body: JSON.stringify({
        events: [{ clientEventId: "roll-call" }],
        checklistEvents: [{ clientEventId: "checklist" }],
        arrivalEvents: [{ clientEventId: "arrival" }],
      }),
    }),
  );
  expect(response.status).toBe(503);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ error: "offline_sync_paused" });
  expect(auth).not.toHaveBeenCalled();
  expect(getDb).not.toHaveBeenCalled();
});

it("keeps the existing authorization check when the pause is unset", async () => {
  vi.stubEnv("DIVEDAY_OFFLINE_SYNC_PAUSED", "");
  const response = await POST(
    new Request("http://localhost/api/offline-manifests/sync", { method: "POST" }),
  );
  expect(response.status).toBe(401);
  expect(auth).toHaveBeenCalledOnce();
  expect(getDb).not.toHaveBeenCalled();
});

it("does not claim to stop a request that entered before the pause", async () => {
  vi.stubEnv("DIVEDAY_OFFLINE_SYNC_PAUSED", "");
  let finishAuth: (value: null) => void = () => {};
  vi.mocked(auth).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishAuth = resolve;
      }),
  );
  const inFlight = POST(
    new Request("http://localhost/api/offline-manifests/sync", { method: "POST" }),
  );
  vi.stubEnv("DIVEDAY_OFFLINE_SYNC_PAUSED", "1");
  finishAuth(null);
  expect((await inFlight).status).toBe(401);
});
