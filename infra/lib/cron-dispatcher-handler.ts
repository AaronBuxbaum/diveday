import { hkdfSync } from "node:crypto";

/**
 * **The scheduled routes' caller** (issue #3691). Vercel Cron used to GET each
 * `/api/cron/*` route with `Authorization: Bearer <CRON_SECRET>`. Now one
 * EventBridge Scheduler schedule per route invokes this function with
 * `{ "path": "/api/cron/..." }`, and it makes that same request.
 *
 * `CRON_SECRET` is never stored a second time: it is derived from the app
 * secret seed exactly as `scripts/distribute-env.mjs` derives the value Vercel
 * holds, so the two cannot disagree and a rotated seed moves both.
 *
 * A route answering anything but 2xx throws, so the Lambda's Errors metric
 * (alarmed in infra-stack.ts) says "a pass did not run". The schedule does not
 * retry: a route that half-ran must not run again on a timer.
 */

const SDK_MODULE = "@aws-sdk/client-secrets-manager";

/** Same derivation as `derivedValue("cron")` in scripts/distribute-env.mjs. */
export function cronSecretFrom(seed: string): string {
  return Buffer.from(
    hkdfSync("sha256", Buffer.from(seed), "diveday-app-secret-v1", "cron", 32),
  ).toString("base64");
}

/** Only an app route under /api/cron/ is ever called, whatever the event says. */
export function cronUrl(origin: string, path: unknown): string {
  if (typeof path !== "string" || !/^\/api\/cron\/[a-z0-9-]+$/.test(path)) {
    throw new Error("cron dispatcher: event.path must be /api/cron/<route>");
  }
  return new URL(path, origin).toString();
}

type Deps = {
  readSeed: () => Promise<string>;
  fetchFn: typeof fetch;
  origin: string;
  timeoutMs: number;
};

export async function dispatch(event: { path?: unknown }, deps: Deps): Promise<{ status: number }> {
  const url = cronUrl(deps.origin, event.path);
  const secret = cronSecretFrom(await deps.readSeed());
  const response = await deps.fetchFn(url, {
    method: "GET",
    headers: { authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(deps.timeoutMs),
  });
  // Status and path only: the body is a pass summary and none of it is ours to log.
  console.log(
    JSON.stringify({ event: "cron_dispatch", path: event.path, status: response.status }),
  );
  if (!response.ok) throw new Error(`cron dispatcher: ${event.path} answered ${response.status}`);
  return { status: response.status };
}

export async function handler(event: { path?: unknown }): Promise<{ status: number }> {
  const sdk = await import(SDK_MODULE);
  const client = new sdk.SecretsManagerClient({});
  return dispatch(event, {
    origin: process.env.APP_ORIGIN as string,
    timeoutMs: 330_000,
    fetchFn: fetch,
    readSeed: async () => {
      const out = await client.send(
        new sdk.GetSecretValueCommand({ SecretId: process.env.SEED_SECRET_ID }),
      );
      return out.SecretString as string;
    },
  });
}
