import { getDb } from "@/db/client";
import { cronRoute } from "@/features/cron-route";
import {
  dispatchDueIntegrationDeliveries,
  INTEGRATIONS_CRON_BUDGET_MS,
  INTEGRATIONS_CRON_CRONTAB,
} from "@/features/integrations";

export const maxDuration = 300;

/**
 * Drain the provider-neutral integration outbox.
 *
 * Its own Sentry monitor, like every other scheduled route. The outbox is
 * drained only here, so a cron Vercel silently stopped invoking means
 * deliveries to a shop's Shopify, QuickBooks or Zapier stop retrying and
 * nothing anywhere says so; and ADR 20260919-health-check-does-not-wake-the-database
 * moved database liveness onto the cron monitors' dead-man's switches on the
 * stated grounds that every cron has one.
 *
 * The schedule comes from the dispatcher rather than being restated here, and
 * `src/features/integrations/dispatcher.test.ts` asserts it against
 * vercel.json. The default margin matches the other sub-daily passes: twenty
 * minutes late on an hourly drain is worth a look, and anything tighter would
 * page on a slow provider rather than on a cron that stopped.
 */
export const GET = cronRoute({
  id: "integrations",
  crontab: INTEGRATIONS_CRON_CRONTAB,
  run: async () =>
    dispatchDueIntegrationDeliveries(await getDb(), {
      limit: 50,
      timeBudgetMs: INTEGRATIONS_CRON_BUDGET_MS,
      startedAtMs: performance.now(),
    }),
});
