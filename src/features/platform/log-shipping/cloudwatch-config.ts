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

/**
 * Trimmed, or `null` if there is nothing left.
 *
 * This was a five-field `z.object` of `z.string().trim().min(1)`, and the
 * behaviour is identical — but zod is not. `log()` imports `./cloudwatch`,
 * which imported this module, and `src/i18n/on-error.ts` imports `log`, so
 * every client component that reads a translated string pulled a **375 KB
 * (83.5 KB gzipped) zod chunk** into its browser bundle to validate five
 * server-side environment variables it can never see. Five trimmed non-empty
 * strings do not need a schema library; a browser bundle very much does not
 * need one for this.
 */
function required(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

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
  const region = required(env.CLOUDWATCH_AWS_REGION);
  const logGroupName = required(env.CLOUDWATCH_LOG_GROUP);
  const accessKeyId = required(env.CLOUDWATCH_AWS_ACCESS_KEY_ID);
  const secretAccessKey = required(env.CLOUDWATCH_AWS_SECRET_ACCESS_KEY);
  const environment = required(env.VERCEL_ENV || env.NODE_ENV || "development");
  if (!region || !logGroupName || !accessKeyId || !secretAccessKey || !environment) return null;
  return { region, logGroupName, accessKeyId, secretAccessKey, environment };
}
