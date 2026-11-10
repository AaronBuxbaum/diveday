import { z } from "zod";
import { periodBounds } from "../../lib/cost-guardrails";
import type { NeonProjectUsage } from "./neon";

/** Account evidence is supplied explicitly, never inferred from org budgets or an API key. */
export const neonQuotaEvidenceSchema = z
  .array(
    z
      .object({
        projectId: z.string().trim().min(1),
        plan: z.string().trim().min(1),
        source: z.string().trim().min(1),
        verifiedAt: z.iso.datetime(),
        periodStart: z.iso.datetime(),
        periodEnd: z.iso.datetime(),
        computeLimitHours: z.number().finite().positive(),
        /** Instantaneous storage is separate from the API's cumulative GiB-months. */
        storage: z
          .object({
            usedBytes: z.number().finite().nonnegative(),
            limitBytes: z.number().finite().positive(),
            observedAt: z.iso.datetime(),
            source: z.string().trim().min(1),
          })
          .strict()
          .optional(),
      })
      .strict(),
  )
  .max(1_000);
export type NeonQuotaEvidence = z.infer<typeof neonQuotaEvidenceSchema>;

const DAY_MS = 86_400_000;
const WARN_FRACTION = 0.8;

function unknown(projectId: string | null, reason: string) {
  return { projectId, status: "unknown" as const, reason };
}

/** Alert-only diagnostic. A low org budget cannot mask an individual project's quota risk. */
export function evaluateNeonProjectQuotas(
  projects: readonly NeonProjectUsage[],
  rawEvidence: unknown,
  now: Date,
) {
  const parsed = neonQuotaEvidenceSchema.safeParse(rawEvidence);
  if (!parsed.success) return [unknown(null, "invalid_account_evidence")];
  const evidence = parsed.data;
  const { start, end } = periodBounds("calendar_month", now);
  const ids = new Set([...projects.map((p) => p.projectId), ...evidence.map((e) => e.projectId)]);
  if (ids.size === 0) return [unknown(null, "project_usage_unavailable")];
  return [...ids].map((projectId) => {
    if (!projectId) return unknown(null, "project_identity_absent");
    const accounts = evidence.filter((e) => e.projectId === projectId);
    if (accounts.length !== 1)
      return unknown(
        projectId,
        accounts.length ? "ambiguous_account_evidence" : "plan_quota_unknown",
      );
    const account = accounts[0];
    const age = now.getTime() - Date.parse(account.verifiedAt);
    if (age < 0 || age > DAY_MS) return unknown(projectId, "account_evidence_stale_or_future");
    if (
      Date.parse(account.periodStart) !== start.getTime() ||
      Date.parse(account.periodEnd) !== end.getTime()
    ) {
      return unknown(projectId, "usage_quota_period_mismatch");
    }
    const readings = projects.filter((p) => p.projectId === projectId);
    if (readings.length !== 1)
      return unknown(
        projectId,
        readings.length ? "ambiguous_project_usage" : "project_usage_unavailable",
      );
    const observation = readings[0];
    if (
      !observation.periodStart ||
      !observation.periodEnd ||
      Date.parse(observation.periodStart) !== start.getTime() ||
      Date.parse(observation.periodEnd) !== end.getTime()
    ) {
      return unknown(projectId, "provider_usage_period_unknown_or_mismatched");
    }
    const observedAge = now.getTime() - Date.parse(observation.observedAt);
    if (!Number.isFinite(observedAge) || observedAge < 0 || observedAge > DAY_MS)
      return unknown(projectId, "usage_stale_or_future");
    const sample = readings[0].compute;
    if (sample.status !== "measured" || !Number.isFinite(sample.value) || sample.value < 0)
      return unknown(projectId, "compute_usage_unavailable");
    const fraction = sample.value / account.computeLimitHours;
    const remainingHours = Math.max(0, account.computeLimitHours - sample.value);
    const elapsedDays = (now.getTime() - start.getTime()) / DAY_MS;
    const averageDailyHours = elapsedDays > 0 ? sample.value / elapsedDays : null;
    const estimatedDaysRemaining =
      averageDailyHours && averageDailyHours > 0 ? remainingHours / averageDailyHours : null;
    const level =
      fraction >= 1
        ? "over"
        : fraction >= WARN_FRACTION ||
            (estimatedDaysRemaining !== null && estimatedDaysRemaining <= 1)
          ? "warn"
          : "below_warning";
    const storage = account.storage;
    const storageAge = storage ? now.getTime() - Date.parse(storage.observedAt) : null;
    const storageObservation =
      storage && storageAge !== null && storageAge >= 0 && storageAge <= DAY_MS
        ? {
            status: "supplied_instantaneous_observation" as const,
            usedBytes: storage.usedBytes,
            limitBytes: storage.limitBytes,
            fraction: storage.usedBytes / storage.limitBytes,
            level:
              storage.usedBytes >= storage.limitBytes
                ? "over"
                : storage.usedBytes / storage.limitBytes >= WARN_FRACTION
                  ? "warn"
                  : "below_warning",
            source: storage.source,
            observedAt: storage.observedAt,
          }
        : { status: "unknown" as const, reason: "current_size_unavailable_or_stale" };
    return {
      projectId,
      status: "evaluated_against_supplied_account_evidence" as const,
      plan: account.plan,
      source: account.source,
      verifiedAt: account.verifiedAt,
      periodStart: account.periodStart,
      periodEnd: account.periodEnd,
      compute: {
        usedHours: sample.value,
        limitHours: account.computeLimitHours,
        remainingHours,
        fraction,
        level,
        estimatedDaysRemaining,
      },
      storage: storageObservation,
    };
  });
}
