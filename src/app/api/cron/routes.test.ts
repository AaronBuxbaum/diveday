import { readdirSync, readFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **Every `/api/cron/*` route, by behaviour rather than by source text**
 * (issue #2780).
 *
 * `src/lib/cron-auth.test.ts` reads each route's source for a gate call, which
 * a contrived file can satisfy (a call in a dead branch, work in a wrapper's
 * arguments). This file imports every route the directory holds and asks it:
 *
 * - **Refused, it does nothing.** No secret, no header, a wrong token: the
 *   answer is the gate's 503 or 401, and the database, Sentry, `fetch` and any
 *   socket were never touched, neither while the module loaded nor while it answered.
 * - **Admitted, its monitor schedule is the one Vercel runs.** The first Sentry
 *   check-in names the crontab vercel.json deploys for that path, so a monitor
 *   cannot drift from its cron and page for a tick that was never due (or stay
 *   quiet for one that was missed). The database is made to fail, so no pass
 *   does any work here.
 */

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
// The routes report only where a DSN is configured; the suite runs without one.
vi.mock("@/lib/sentry-dsn", () => ({ SENTRY_DSN: "https://key@sentry.invalid/1" }));
vi.mock("@sentry/nextjs", () => ({
  captureCheckIn: vi.fn(() => "check-in-id"),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

const { getDb } = await import("@/db/client");
const Sentry = await import("@sentry/nextjs");

const SECRET = "every-cron-route-secret";
const ROOT = path.join(process.cwd(), "src/app/api/cron");
const ROUTES = readdirSync(ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

type VercelCron = { path: string; schedule: string };
const DEPLOYED = new Map(
  (
    JSON.parse(readFileSync(path.join(process.cwd(), "vercel.json"), "utf8")) as {
      crons: VercelCron[];
    }
  ).crons.map((cron) => [cron.path, cron.schedule]),
);

type RouteModule = { GET: (request: Request) => Promise<Response>; maxDuration?: number };

const fetchSpy = vi.fn(async () => {
  throw new Error("a cron route reached the network in a test");
});

/**
 * Every Node client that is not `fetch` (the AWS and Stripe SDKs, SMTP, a
 * Postgres driver) opens a socket through `net.Socket#connect`, TLS included.
 */
const connectSpy = vi.spyOn(net.Socket.prototype, "connect").mockImplementation(() => {
  throw new Error("a cron route opened a socket in a test");
});

function cronRequest(name: string, authorization?: string): Request {
  const headers: Record<string, string> = {};
  if (authorization !== undefined) headers.authorization = authorization;
  return new Request(`http://localhost/api/cron/${name}`, { headers });
}

function expectUntouched(name: string) {
  expect(getDb, name).not.toHaveBeenCalled();
  expect(Sentry.captureCheckIn, name).not.toHaveBeenCalled();
  expect(Sentry.captureException, name).not.toHaveBeenCalled();
  expect(Sentry.captureMessage, name).not.toHaveBeenCalled();
  expect(fetchSpy, name).not.toHaveBeenCalled();
  expect(connectSpy, name).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchSpy);
  vi.stubEnv("CRON_SECRET", SECRET);
  vi.mocked(getDb).mockReset().mockRejectedValue(new Error("no database in this test"));
  vi.mocked(Sentry.captureCheckIn).mockClear();
  vi.mocked(Sentry.captureException).mockClear();
  vi.mocked(Sentry.captureMessage).mockClear();
  fetchSpy.mockClear();
  connectSpy.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("every cron route", () => {
  it("is deployed: each route directory has a vercel.json entry and each entry a route", () => {
    expect(ROUTES.length).toBeGreaterThan(10);
    expect(ROUTES.map((name) => `/api/cron/${name}`)).toEqual([...DEPLOYED.keys()].sort());
  });

  describe.each(ROUTES)("/api/cron/%s", (name) => {
    async function load(): Promise<RouteModule> {
      const loaded = (await import(`./${name}/route.ts`)) as RouteModule;
      // Loading the module is not a pass either.
      expectUntouched(name);
      return loaded;
    }

    it("answers 503 with no secret configured, whatever is presented, and touches nothing", async () => {
      const { GET } = await load();
      vi.stubEnv("CRON_SECRET", "");
      for (const presented of [undefined, "Bearer ", `Bearer ${SECRET}`]) {
        const response = await GET(cronRequest(name, presented));
        expect(response.status, name).toBe(503);
        expect(await response.json()).toEqual({ error: "not_configured" });
      }
      expectUntouched(name);
    });

    it("answers a bodiless 401 to a missing, wrong or schemeless token and touches nothing", async () => {
      const { GET } = await load();
      for (const presented of [
        undefined,
        "Bearer wrong",
        `Bearer ${"x".repeat(SECRET.length)}`,
        SECRET,
      ]) {
        const response = await GET(cronRequest(name, presented));
        expect(response.status, name).toBe(401);
        expect(await response.text()).toBe("");
      }
      expectUntouched(name);
    });

    it("refuses a by-hand rerun (`?scan=`) the same way, touching nothing", async () => {
      const { GET } = await load();
      const rerun = (authorization?: string) => {
        const headers: Record<string, string> = {};
        if (authorization !== undefined) headers.authorization = authorization;
        return new Request(`http://localhost/api/cron/${name}?scan=recaps`, { headers });
      };
      expect((await GET(rerun())).status, name).toBe(401);
      expect((await GET(rerun("Bearer wrong"))).status, name).toBe(401);
      vi.stubEnv("CRON_SECRET", "");
      expect((await GET(rerun(`Bearer ${SECRET}`))).status, name).toBe(503);
      expectUntouched(name);
    });

    it("opens its Sentry monitor on the schedule vercel.json deploys, in UTC", async () => {
      const { GET, maxDuration } = await load();
      // The platform backup checks in only once its uploader is configured.
      vi.stubEnv("PLATFORM_BACKUP_AWS_ACCESS_KEY_ID", "AKIA-TEST");
      vi.stubEnv("PLATFORM_BACKUP_AWS_SECRET_ACCESS_KEY", "secret");
      vi.stubEnv("PLATFORM_BACKUP_BUCKET", "diveday-backups");
      vi.stubEnv("PLATFORM_BACKUP_AWS_REGION", "us-east-1");
      await GET(cronRequest(name, `Bearer ${SECRET}`));

      const opened = vi
        .mocked(Sentry.captureCheckIn)
        .mock.calls.find(([checkIn]) => checkIn.status === "in_progress");
      expect(opened, `${name} never opened a check-in`).toBeDefined();
      const [, config] = opened ?? [];
      expect(config?.schedule, name).toEqual({
        type: "crontab",
        value: DEPLOYED.get(`/api/cron/${name}`),
      });
      expect(config?.timezone, name).toBe("Etc/UTC");
      // A run the platform kills must read as timed out, not as still running.
      expect((config?.maxRuntime ?? 0) * 60, name).toBeGreaterThan(maxDuration ?? 0);
    });
  });
});
