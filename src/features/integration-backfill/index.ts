/** integration-backfill public contract. Internals are imported only within this module. */

export type { BackfillCounts, BackfillPreview, BackfillResult } from "./store";
export {
  BACKFILL_FLOOR_DAYS,
  BACKFILL_MAX_PER_RUN,
  backfillFloor,
  previewIntegrationBackfill,
  runIntegrationBackfill,
} from "./store";
