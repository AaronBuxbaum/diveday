/**
 * Where DiveDay's own structured log lines go once they have been written.
 *
 * `src/lib/log.ts` stays the seam every call site uses; this directory is the
 * transport underneath it. Consumers only ever need two of these: `flushLogs`
 * at a boundary that must not lose its record, and `setFlushDeferrer` once per
 * server instance.
 */
export {
  type CloudWatchLogsSink,
  type FlushDeferrer,
  flushLogs,
  recordLogLine,
  resetLogShipper,
  setFlushDeferrer,
  setLogShipperSink,
} from "./cloudwatch";
export { type CloudWatchLogsConfig, readCloudWatchLogsConfig } from "./cloudwatch-config";
