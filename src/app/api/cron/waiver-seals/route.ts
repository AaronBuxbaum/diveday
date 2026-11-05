import { getDb } from "@/db/client";
import { recheckWaiverSeals, waiverSealPassHealthy } from "@/db/waiver-seal-checks";
import { nowDate } from "@/lib/clock";
import { cronRoute } from "@/lib/cron-route";
import { WAIVER_SEAL_CHECK_CRONTAB } from "@/lib/waiver-integrity";

/** A capped pass's few thousand HMACs take seconds; the rest is the row reads. */
export const maxDuration = 60;

/**
 * **Every signed release's seal, re-checked nightly** (issue #2562): the
 * verdict the signature log's "Unsealed or changed" view filters on
 * (`recheckWaiverSeals`). A seal that broke since its last check, or a pass
 * that stopped at its limit, checks in as an error: a release edited after
 * signing is the record a reviewer must hear about, and the next pass resumes
 * with the rows checked longest ago.
 */
export const GET = cronRoute({
  id: "waiver-seals",
  crontab: WAIVER_SEAL_CHECK_CRONTAB,
  run: async () => recheckWaiverSeals(await getDb(), { now: nowDate() }),
  healthy: waiverSealPassHealthy,
});
