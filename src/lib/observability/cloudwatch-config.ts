import { z } from "zod";

/**
 * Where the structured log lines go, when they go anywhere at all.
 *
 * Absent is a first-class state, exactly like every other adapter in this app:
 * with no credentials `log()` behaves byte for byte as it always has — a JSON
 * line on `console.*` and nothing else — and nothing throws, warns, or
 * degrades. Local dev, the unit suite, the e2e fleet and a fork all run in that
 * state permanently (ADR 20260806-cloudwatch-log-shipping).
 */
export type CloudWatchLogsConfig = {
  readonly region: string;
  /** The group the CDK stack created (§17). The shipper may not create groups. */
  readonly logGroupName: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /**
   * Names the deployment inside the log stream name, so a preview deploy's
   * lines never sit unlabelled beside production's in the same group. Read from
   * Vercel's own `VERCEL_ENV` where there is one.
   */
  readonly environment: string;
};

const configSchema = z.object({
  region: z.string().trim().min(1),
  logGroupName: z.string().trim().min(1),
  accessKeyId: z.string().trim().min(1),
  secretAccessKey: z.string().trim().min(1),
  environment: z.string().trim().min(1),
});

/**
 * All four credentials or nothing. A half-configured shipper is the worst of
 * the three states — it looks configured on the settings page it will never
 * have, and ships nothing — so a missing value reads exactly like an unset one.
 *
 * `DIVEDAY_DISABLE_EXTERNAL_HTTP=1` (set fleet-wide by `playwright.config.ts`,
 * same as `marine-forecast.ts` and the usage probes) short-circuits ahead of
 * the parse: an e2e run must never reach AWS even if a stray credential is
 * present in its environment.
 */
export function readCloudWatchLogsConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): CloudWatchLogsConfig | null {
  if (env.DIVEDAY_DISABLE_EXTERNAL_HTTP === "1") return null;
  const parsed = configSchema.safeParse({
    region: env.CLOUDWATCH_AWS_REGION,
    logGroupName: env.CLOUDWATCH_LOG_GROUP,
    accessKeyId: env.CLOUDWATCH_AWS_ACCESS_KEY_ID,
    secretAccessKey: env.CLOUDWATCH_AWS_SECRET_ACCESS_KEY,
    environment: env.VERCEL_ENV || env.NODE_ENV || "development",
  });
  return parsed.success ? parsed.data : null;
}
