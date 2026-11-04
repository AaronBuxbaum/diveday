/**
 * **The scheduled routes' caller** (issue #3691). Vercel Cron used to GET each
 * `/api/cron/*` route with `Authorization: Bearer <CRON_SECRET>`. Now one
 * EventBridge Scheduler schedule per route invokes this function with
 * `{ "path": "/api/cron/..." }`, and it makes that same request.
 *
 * The token is the stack's own `diveday/cron-secret`, the same value Vercel
 * holds as `CRON_SECRET`. This function reads that one secret and nothing
 * else; in particular not the app secret seed.
 *
 * A route answering anything but 2xx throws, so the Lambda's Errors metric
 * (alarmed in infra-stack.ts) says "a pass did not run". Nothing retries: the
 * schedule and the function's async config both allow zero, because a route that
 * half-ran must not run again on a timer.
 */

const SDK_MODULE = "@aws-sdk/client-secrets-manager";

/** Only https, and only an app route under /api/cron/, whatever the event says. */
export function cronUrl(origin: string, path: unknown): string {
  if (typeof path !== "string" || !/^\/api\/cron\/[a-z0-9-]+$/.test(path)) {
    throw new Error("cron dispatcher: event.path must be /api/cron/<route>");
  }
  const url = new URL(path, origin);
  if (url.protocol !== "https:") throw new Error("cron dispatcher: the origin must be https");
  return url.toString();
}

type Deps = {
  readSecret: () => Promise<string>;
  fetchFn: typeof fetch;
  origin: string;
  timeoutMs: number;
};

export async function dispatch(event: { path?: unknown }, deps: Deps): Promise<{ status: number }> {
  const url = cronUrl(deps.origin, event.path);
  const secret = await deps.readSecret();
  const response = await deps.fetchFn(url, {
    method: "GET",
    headers: { authorization: `Bearer ${secret}` },
    // A redirect would carry the bearer token to wherever it points.
    redirect: "error",
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
    readSecret: async () => {
      const out = await client.send(
        new sdk.GetSecretValueCommand({ SecretId: process.env.CRON_SECRET_ID }),
      );
      return out.SecretString as string;
    },
  });
}
