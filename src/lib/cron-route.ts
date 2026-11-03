import { requireCronSecret } from "@/lib/cron-auth";
import { log } from "@/lib/log";
import { flushLogs, reportScrubbedError, sentry } from "@/lib/observability";

/**
 * **A scheduled route is a name, a schedule and a body** (issue #2780).
 *
 * Eighteen `/api/cron/*` routes each wrote the same frame by hand: the bearer
 * gate, a Sentry check-in pair around the pass, the `diveday-<id>` monitor slug
 * with its `SENTRY_*_CRON_MONITOR_SLUG` override, a `cron_<id>.scan_complete` or
 * `scan_failed` line, a `scan_unavailable` 503, and a final log flush. This is
 * that frame, once. A route that fits it is its `run` body.
 *
 * What it keeps, because each is a contract:
 *
 * - **The gate runs first.** `requireCronSecret` answers before any check-in or
 *   `run`, so an unauthorized probe can neither tell the monitor a tick
 *   happened nor reach the database or a provider. The tests assert that
 *   nothing else is called on a refusal.
 * - **The log codes are derived, so the alarm reads them from the call.**
 *   `cron_<id>.scan_failed` is a CloudWatch contract (`infra/lib/observability.ts`
 *   `CronPassFailures`); `infra/lib/observability.test.ts` finds it from the
 *   `cronRoute({ id: "..." })` call as it finds a literal `log("...")`.
 * - **The slug override is read here and nowhere else.** `slugEnv` names a
 *   route whose variable predates the `SENTRY_<ID>_CRON_MONITOR_SLUG` shape.
 * - **A thrown pass reaches Sentry without its message.** A database or
 *   provider error can quote the row it refused (a diver's name or email), and
 *   Sentry's `beforeSend` does not scrub exception text, so the failure goes
 *   through `reportScrubbedError`: its stack frames and error class, never what
 *   it said (issue #2334).
 *
 * `maxDuration` is deliberately not an option. Next reads route segment config
 * from the route file's own `export const`, statically; a value passed through
 * a helper is invisible to it and would silently fall back to the default.
 *
 * Not for a route whose frame differs (the platform backup's configuration
 * preflight, a route that answers a status other than 503). Those keep their
 * own, and still open with `requireCronSecret`.
 */
export type CronRouteOptions<Summary = unknown> = {
  /** Kebab-case name: the monitor `diveday-<id>`, the log `cron_<id_>` and the `cron_scan` tag. */
  id: string;
  /** The deployed schedule (vercel.json); Sentry reads it to decide a check-in is missing. */
  crontab: string;
  /** Minutes late before Sentry calls the check-in missing. */
  checkinMargin?: number;
  /** Minutes a run may take before Sentry calls it timed out; above `maxDuration`. */
  maxRuntime?: number;
  /** Override variable when it is not `SENTRY_<ID>_CRON_MONITOR_SLUG`. */
  slugEnv?: string;
  /** The pass. Its return value is the 200 body; a throw is the 503. */
  run: (request: Request) => Promise<Summary>;
  /**
   * Whether a pass that returned did its work. False answers 200 with the body
   * but checks in as error, for a route whose isolated scans can fail without
   * failing the pass. Omitted, a pass that returns is ok.
   */
  healthy?: (summary: Summary) => boolean;
};

export function cronRoute<Summary>(
  options: CronRouteOptions<Summary>,
): (request: Request) => Promise<Response> {
  const { id, crontab, run } = options;
  const logName = `cron_${id.replaceAll("-", "_")}`;
  const slugEnv =
    options.slugEnv ?? `SENTRY_${id.toUpperCase().replaceAll("-", "_")}_CRON_MONITOR_SLUG`;
  const monitorSlug = process.env[slugEnv] || `diveday-${id}`;
  const monitorConfig = {
    schedule: { type: "crontab", value: crontab },
    checkinMargin: options.checkinMargin ?? 20,
    maxRuntime: options.maxRuntime ?? 10,
    timezone: "Etc/UTC",
  } as const;

  return async (request: Request): Promise<Response> => {
    const refusal = requireCronSecret(request);
    if (refusal) return refusal;

    const checkInId = await sentry.captureCheckIn(
      { monitorSlug, status: "in_progress" },
      monitorConfig,
    );
    try {
      const summary = await run(request);
      log(`${logName}.scan_complete`, "info", summary as Parameters<typeof log>[2]);
      const ok = options.healthy ? options.healthy(summary) : true;
      await sentry.captureCheckIn({ checkInId, monitorSlug, status: ok ? "ok" : "error" });
      return Response.json(summary);
    } catch (error) {
      await reportScrubbedError(error, {
        name: "CronPassFailed",
        message: `cron pass ${id} failed`, // i18n-exempt: Sentry event title, never shown to a person
        tags: { cron_scan: id },
      });
      log(`${logName}.scan_failed`, "error", { scan: id });
      await sentry.captureCheckIn({ checkInId, monitorSlug, status: "error" });
      return Response.json({ error: "scan_unavailable" }, { status: 503 });
    } finally {
      await flushLogs();
    }
  };
}
