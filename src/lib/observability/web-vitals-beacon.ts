import { z } from "zod";

import { WEB_VITAL_NAMES, WEB_VITALS } from "./web-vitals";

/**
 * The two request bodies `/api/vitals` accepts, kept apart from the constants
 * beside them for one reason: **zod does not belong in a browser bundle.**
 *
 * `web-vitals.ts` is imported by `src/app/web-vitals-client.tsx`, which the
 * root layout mounts, which means it is in the client graph of *every* route.
 * While the schemas lived there, `import { z } from "zod"` came with them:
 * measured on the build before this split, chunk `0aud-s06ac1ik.js` was
 * **375,158 bytes raw / 83.5 KB gzipped, in the first load of all 75 routes** —
 * 26.6% of the 314 KB gzip floor every page paid before rendering anything.
 * The client imports two names off that module, `WEB_VITAL_NAMES` and the
 * `WebVitalName` type, and neither needs a validator.
 *
 * The constants stay put rather than moving here, because
 * `infra/lib/observability.test.ts` greps `field: "..."` out of
 * `src/lib/observability/web-vitals.ts` by path to prove the CloudWatch metric
 * filters name fields the log line actually writes. Splitting the other way
 * would have left that guard reading an empty file and passing.
 */

/**
 * Rejects a body before it can become a log line and a CloudWatch metric.
 *
 * This endpoint is public and unauthenticated — it has to be, the report comes
 * from a diver's browser — so every bound here is doing real work. The value
 * ceiling matters most: an unbounded number would let anyone move the p75 of a
 * Core Web Vital to whatever they liked, and an alarm that a stranger can fire
 * is an alarm that gets muted. An hour is far past any real measurement and
 * still finite.
 */
export const webVitalsBeaconSchema = z.object({
  url: z.string().trim().min(1).max(2_048),
  // An enum, not a bounded string. This value is grouped on in Logs Insights,
  // and a free-form field on a public endpoint is a field an anonymous caller
  // chooses the cardinality of. The set is the Navigation Timing API's own.
  navigationType: z
    .enum(["navigate", "reload", "back-forward", "back-forward-cache", "prerender", "restore"])
    .optional(),
  metrics: z
    .array(
      z.object({
        name: z.enum(WEB_VITAL_NAMES),
        value: z.number().finite().nonnegative().max(3_600_000),
      }),
    )
    .min(1)
    .max(WEB_VITALS.length),
});

export type WebVitalsBeacon = z.infer<typeof webVitalsBeaconSchema>;

/**
 * A settled staff mutation, measured in the browser from the tap through the
 * server action's response. It deliberately carries no URL or record id: the
 * action name is a bounded enum-like label, and the duration is the only
 * number the observability question needs.
 */
export const mutationDurationBeaconSchema = z.object({
  mutations: z
    .array(
      z.object({
        action: z
          .string()
          .trim()
          .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
        durationMs: z.number().finite().nonnegative().max(600_000),
      }),
    )
    .min(1)
    .max(10),
});

export type MutationDurationBeacon = z.infer<typeof mutationDurationBeaconSchema>;
