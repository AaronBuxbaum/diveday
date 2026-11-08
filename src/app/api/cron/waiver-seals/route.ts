import { getDb } from "@/db/client";
import { recheckWaiverSeals, waiverSealPassHealthy } from "@/db/waiver-seal-checks";
import { cronRoute } from "@/features/cron-route";
import { nowDate } from "@/lib/clock";
import { WAIVER_SEAL_CHECK_CRONTAB } from "@/lib/waiver-integrity";

/** A capped pass's few thousand HMACs take seconds; the rest is the row reads. */
export const maxDuration = 60;

/**
 * **Every signed release's seal, re-checked nightly** (issue #2562): the
 * verdict the signature log's "Unsealed or changed" view filters on
 * (`recheckWaiverSeals`). A pass that checked any broken release, one changed
 * after signing or stripped of its seal, checks in as an error
 * (`waiverSealPassHealthy`), and each such release is logged by its shop's id
 * and its own (`cron_waiver_seals.seal_invalid`): a release edited after
 * signing is the record a reviewer must hear about. A pass that stops at its
 * limit is not an error, since the next one resumes with the rows checked
 * longest ago.
 */
export const GET = cronRoute({
  id: "waiver-seals",
  crontab: WAIVER_SEAL_CHECK_CRONTAB,
  run: async () => recheckWaiverSeals(await getDb(), { now: nowDate() }),
  healthy: waiverSealPassHealthy,
});
