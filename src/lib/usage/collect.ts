import { nowDate } from "@/lib/clock";
import type { UsageSample } from "@/lib/cost-guardrails";
import { fetchNeonUsage } from "./neon";
import type { ProbeOptions } from "./probe";
import { fetchVercelSpend } from "./vercel";

/**
 * Every probe, run once, keyed by the ceiling id each reading answers.
 *
 * A ceiling with no entry in the returned map is `unobservable` by the time
 * `evaluateCeilings` is done with it — which is the correct reading for the
 * `console_only` entries in the registry, and a visible bug for a `polled` one
 * that nobody wired up here.
 *
 * Probes run concurrently and **independently**: one provider being down must
 * not cost us the reading from the other, so each is wrapped in its own guard
 * and a throw becomes `unavailable`, never an exception that ends the cron.
 * The probes already return rather than throw; this is the belt to that
 * braces, because a monitor that dies on an unexpected error is a monitor that
 * stops watching exactly when something unexpected is happening.
 */
export async function collectUsageSamples(
  options: ProbeOptions = {},
): Promise<Record<string, UsageSample>> {
  const now = options.now ?? nowDate();
  const probeOptions = { ...options, now };

  const [vercel, neon] = await Promise.all([
    fetchVercelSpend(probeOptions).catch((): { sample: UsageSample } => ({
      sample: { status: "unavailable", reason: "probe_threw" },
    })),
    fetchNeonUsage(probeOptions).catch(() => {
      const sample: UsageSample = { status: "unavailable", reason: "probe_threw" };
      return { compute: sample, storage: sample, egress: sample, projects: 0 };
    }),
  ]);

  return {
    vercel_spend: vercel.sample,
    neon_compute: neon.compute,
    neon_storage: neon.storage,
    neon_egress: neon.egress,
  };
}
