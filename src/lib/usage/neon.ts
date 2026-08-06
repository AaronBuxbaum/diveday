import { z } from "zod";
import { nowDate } from "@/lib/clock";
import { periodBounds, type UsageSample } from "@/lib/cost-guardrails";
import {
  externalHttpBlocked,
  type Fetcher,
  httpFailureReason,
  type ProbeEnvironment,
  type ProbeOptions,
  probeRequest,
  unavailable,
} from "./probe";

/**
 * What Neon has consumed this period, across every project on the account.
 *
 * Reads `GET https://console.neon.tech/api/v2/consumption_history/v2/projects`
 * with `from`, `to`, `granularity=monthly`, `org_id`, and an explicit `metrics`
 * list. This is the **v2** consumption endpoint: the older
 * `/consumption_history/account` route was removed in June 2026 along with its
 * legacy metric names (`active_time_seconds`, `compute_time_seconds`,
 * `written_data_bytes`, `synthetic_storage_size_bytes`), so anything written
 * against those names is reading an endpoint that no longer exists.
 *
 * Three ceilings come out of one request, because they come out of one row:
 * compute, storage, and egress. Making that three round trips would triple the
 * failure surface for no extra information.
 *
 * **Not verified against a live response.** No Neon API key exists in this
 * repo, so the shape below comes from Neon's published documentation rather
 * than a recorded payload. Every metric is therefore optional in the schema and
 * a metric that is absent yields `unavailable` for *its own* ceiling only —
 * never a zero, and never a failure that takes the other two down with it. The
 * runbook says to reconcile the first logged figures against the Neon console
 * once.
 */

/**
 * The v2 metric names, as documented. Requested explicitly rather than relying
 * on a default set, so a Neon-side change to what "all metrics" means cannot
 * silently change what this measures.
 */
const REQUESTED_METRICS = [
  "compute_unit_seconds",
  "root_branch_bytes_month",
  "child_branch_bytes_month",
  "public_network_transfer_bytes",
] as const;

const metricsSchema = z
  .object({
    compute_unit_seconds: z.number().finite().nonnegative().optional(),
    root_branch_bytes_month: z.number().finite().nonnegative().optional(),
    child_branch_bytes_month: z.number().finite().nonnegative().optional(),
    public_network_transfer_bytes: z.number().finite().nonnegative().optional(),
  })
  .passthrough();

const consumptionResponseSchema = z.object({
  projects: z.array(
    z.object({
      project_id: z.string().optional(),
      periods: z
        .array(
          z.object({
            consumption: z
              .array(z.object({ metrics: metricsSchema.optional() }).passthrough())
              .optional(),
          }),
        )
        .optional(),
    }),
  ),
});

const SECONDS_PER_HOUR = 3_600;
const BYTES_PER_GIB = 1_024 ** 3;

export type NeonUsageResult = {
  /** `neon_compute` — compute-unit hours. */
  readonly compute: UsageSample;
  /** `neon_storage` — GiB-months across root and child branches. */
  readonly storage: UsageSample;
  /** `neon_egress` — GiB of public network transfer. */
  readonly egress: UsageSample;
  /** How many projects contributed. Logged so a zero reading is legible. */
  readonly projects: number;
};

/** The same non-answer for all three ceilings — one failed read, three blind spots. */
function allSamples(sample: UsageSample, projects = 0): NeonUsageResult {
  return { compute: sample, storage: sample, egress: sample, projects };
}

function credentials(env: ProbeEnvironment): { apiKey: string; orgId: string } | null {
  const apiKey = env.USAGE_NEON_API_KEY?.trim();
  const orgId = env.USAGE_NEON_ORG_ID?.trim();
  if (!apiKey || !orgId) return null;
  return { apiKey, orgId };
}

export async function fetchNeonUsage(options: ProbeOptions = {}): Promise<NeonUsageResult> {
  const env = options.env ?? process.env;
  const fetcher: Fetcher = options.fetcher ?? fetch;
  const now = options.now ?? nowDate();

  const configured = credentials(env);
  if (!configured) return allSamples({ status: "not_configured" });
  if (externalHttpBlocked(env, fetcher)) {
    return allSamples(unavailable("external_http_disabled"));
  }

  const { start, end } = periodBounds("calendar_month", now);
  const query = new URLSearchParams({
    from: start.toISOString(),
    to: end.toISOString(),
    granularity: "monthly",
    org_id: configured.orgId,
    metrics: REQUESTED_METRICS.join(","),
  });

  let response: Response;
  try {
    response = await fetcher(
      `https://console.neon.tech/api/v2/consumption_history/v2/projects?${query}`,
      probeRequest(configured.apiKey),
    );
  } catch {
    return allSamples(unavailable("network_error"));
  }
  if (!response.ok) return allSamples(unavailable(httpFailureReason(response.status)));

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return allSamples(unavailable("body_read_error"));
  }

  const parsed = consumptionResponseSchema.safeParse(payload);
  if (!parsed.success) return allSamples(unavailable("unrecognised_shape"));

  // Sum every period of every project. `granularity=monthly` over a
  // single-month window should return one period per project, but summing is
  // correct either way and cannot silently drop a project that reported two.
  let computeUnitSeconds: number | null = null;
  let storageBytesMonth: number | null = null;
  let egressBytes: number | null = null;
  const add = (running: number | null, value: number | undefined) =>
    value === undefined ? running : (running ?? 0) + value;

  for (const project of parsed.data.projects) {
    for (const period of project.periods ?? []) {
      for (const entry of period.consumption ?? []) {
        const metrics = entry.metrics;
        if (!metrics) continue;
        computeUnitSeconds = add(computeUnitSeconds, metrics.compute_unit_seconds);
        storageBytesMonth = add(storageBytesMonth, metrics.root_branch_bytes_month);
        storageBytesMonth = add(storageBytesMonth, metrics.child_branch_bytes_month);
        egressBytes = add(egressBytes, metrics.public_network_transfer_bytes);
      }
    }
  }

  // `null` means the metric never appeared in any row — a renamed field, an
  // empty account, a scope the key cannot see. Per ceiling, so one missing
  // metric costs one blind spot rather than three.
  const measured = (total: number | null, divisor: number): UsageSample =>
    total === null ? unavailable("metric_absent") : { status: "measured", value: total / divisor };

  return {
    compute: measured(computeUnitSeconds, SECONDS_PER_HOUR),
    storage: measured(storageBytesMonth, BYTES_PER_GIB),
    egress: measured(egressBytes, BYTES_PER_GIB),
    projects: parsed.data.projects.length,
  };
}
