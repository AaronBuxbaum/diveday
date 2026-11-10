import { z } from "zod";
import { nowDate } from "../../lib/clock";
import { periodBounds, type UsageSample } from "../../lib/cost-guardrails";
import { type Environment, externalHttpBlocked, type Fetch } from "../../lib/seam";
import { httpFailureReason, type ProbeOptions, probeRequest, unavailable } from "./probe";

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
              .array(
                z
                  .object({
                    timeframe_start: z.string().optional(),
                    timeframe_end: z.string().optional(),
                    metrics: metricsSchema.optional(),
                  })
                  .passthrough(),
              )
              .optional(),
          }),
        )
        .optional(),
    }),
  ),
});

const SECONDS_PER_HOUR = 3_600;
const BYTES_PER_GIB = 1_024 ** 3;

export type NeonProjectUsage = {
  readonly projectId: string | null;
  readonly periodStart: string | null;
  readonly periodEnd: string | null;
  readonly observedAt: string;
  readonly compute: UsageSample;
  readonly storage: UsageSample;
  readonly egress: UsageSample;
};

export type NeonUsageResult = {
  /** `neon_compute` — compute-unit hours. */
  readonly compute: UsageSample;
  /** `neon_storage` — GiB-months across root and child branches. */
  readonly storage: UsageSample;
  /** `neon_egress` — GiB of public network transfer. */
  readonly egress: UsageSample;
  /** How many projects contributed. Logged so a zero reading is legible. */
  readonly projects: number;
  /** Identity-preserving observations; never use an org sum as a project quota. */
  readonly projectUsage: readonly NeonProjectUsage[];
};

/** The same non-answer for all three ceilings — one failed read, three blind spots. */
function allSamples(sample: UsageSample, projects = 0): NeonUsageResult {
  return { compute: sample, storage: sample, egress: sample, projects, projectUsage: [] };
}

function credentials(env: Environment): { apiKey: string; orgId: string } | null {
  const apiKey = env.USAGE_NEON_API_KEY?.trim();
  const orgId = env.USAGE_NEON_ORG_ID?.trim();
  if (!apiKey || !orgId) return null;
  return { apiKey, orgId };
}

export async function fetchNeonUsage(options: ProbeOptions = {}): Promise<NeonUsageResult> {
  const env = options.env ?? process.env;
  const fetcher: Fetch = options.fetcher ?? fetch;
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

  let incompleteCompute = false;
  let incompleteStorage = false;
  let incompleteEgress = false;
  const projectUsage: NeonProjectUsage[] = [];
  const measured = (total: number | null, divisor: number, complete: boolean): UsageSample =>
    total === null
      ? unavailable("metric_absent")
      : !complete
        ? unavailable("metric_incomplete")
        : { status: "measured", value: total / divisor };
  for (const project of parsed.data.projects) {
    let projectCompute: number | null = null;
    let projectStorage: number | null = null;
    let projectEgress: number | null = null;
    let computeComplete = true;
    let storageComplete = true;
    let egressComplete = true;
    let periodMatches = true;
    let entries = 0;
    for (const period of project.periods ?? []) {
      if (!period.consumption?.length) {
        computeComplete = storageComplete = egressComplete = periodMatches = false;
      }
      for (const entry of period.consumption ?? []) {
        entries += 1;
        periodMatches &&=
          Date.parse(entry.timeframe_start ?? "") === start.getTime() &&
          Date.parse(entry.timeframe_end ?? "") === end.getTime();
        const metrics = entry.metrics;
        computeComplete &&= metrics?.compute_unit_seconds !== undefined;
        storageComplete &&=
          metrics?.root_branch_bytes_month !== undefined &&
          metrics?.child_branch_bytes_month !== undefined;
        egressComplete &&= metrics?.public_network_transfer_bytes !== undefined;
        if (!metrics) continue;
        projectCompute = add(projectCompute, metrics.compute_unit_seconds);
        projectStorage = add(projectStorage, metrics.root_branch_bytes_month);
        projectStorage = add(projectStorage, metrics.child_branch_bytes_month);
        projectEgress = add(projectEgress, metrics.public_network_transfer_bytes);
        computeUnitSeconds = add(computeUnitSeconds, metrics.compute_unit_seconds);
        storageBytesMonth = add(storageBytesMonth, metrics.root_branch_bytes_month);
        storageBytesMonth = add(storageBytesMonth, metrics.child_branch_bytes_month);
        egressBytes = add(egressBytes, metrics.public_network_transfer_bytes);
      }
    }
    incompleteCompute ||= !computeComplete || entries === 0;
    incompleteStorage ||= !storageComplete || entries === 0;
    incompleteEgress ||= !egressComplete || entries === 0;
    projectUsage.push({
      projectId: project.project_id?.trim() || null,
      periodStart: periodMatches && entries > 0 ? start.toISOString() : null,
      periodEnd: periodMatches && entries > 0 ? end.toISOString() : null,
      observedAt: now.toISOString(),
      compute: measured(projectCompute, SECONDS_PER_HOUR, computeComplete),
      storage: measured(projectStorage, BYTES_PER_GIB, storageComplete),
      egress: measured(projectEgress, BYTES_PER_GIB, egressComplete),
    });
  }

  // `null` means the metric never appeared in any row — a renamed field, an
  // empty account, a scope the key cannot see. Per ceiling, so one missing
  // metric costs one blind spot rather than three.
  return {
    compute: measured(computeUnitSeconds, SECONDS_PER_HOUR, !incompleteCompute),
    storage: measured(storageBytesMonth, BYTES_PER_GIB, !incompleteStorage),
    egress: measured(egressBytes, BYTES_PER_GIB, !incompleteEgress),
    projects: parsed.data.projects.length,
    projectUsage,
  };
}
