import { nowMs } from "../clock";
import { batchRecords, type LogRecord, MAX_BATCH_RECORDS } from "./cloudwatch-batch";
import { type CloudWatchLogsConfig, readCloudWatchLogsConfig } from "./cloudwatch-config";

/**
 * Ships the structured lines `log()` already writes to CloudWatch Logs, so they
 * outlive the request that produced them (ADR 20260806-cloudwatch-log-shipping).
 *
 * The console write is never replaced, only followed. Whatever drain the
 * deployment already tails keeps seeing exactly what it saw before, and a
 * CloudWatch outage costs the app nothing it had yesterday. That ordering is
 * the whole safety argument for putting a network call behind `log()` at all:
 * every failure path here degrades to "the line is still on stdout".
 *
 * Three properties this file exists to hold, each of which has a test:
 *
 * 1. **Nothing here ever throws or rejects.** `log()` is called from the Stripe
 *    webhook and the roll-call path; a logger that can fail a caller is worse
 *    than no logger.
 * 2. **Memory is bounded.** A burst buffers up to `MAX_BUFFERED_RECORDS` and
 *    then drops the *oldest* lines, counting them — an unbounded buffer on a
 *    serverless instance is an out-of-memory kill dressed as observability.
 * 3. **A broken credential goes quiet, not loud.** Repeated failure trips a
 *    breaker for the life of the instance, reported once. Without it, wrong
 *    credentials mean an SDK retry storm on every request, forever.
 */

/** The slice of the SDK this module uses, so a test fakes an object rather than a client. */
export interface CloudWatchLogsSink {
  createLogStream(input: { logGroupName: string; logStreamName: string }): Promise<void>;
  putLogEvents(input: {
    logGroupName: string;
    logStreamName: string;
    logEvents: readonly LogRecord[];
  }): Promise<void>;
}

/**
 * Roughly 400 KB of this app's log lines. Past it the oldest are dropped: a
 * flush that cannot keep up is a symptom, and the newest lines are the ones
 * describing whatever is going wrong right now.
 */
const MAX_BUFFERED_RECORDS = 2_000;

/** Consecutive failed flushes before this instance stops trying. */
const MAX_CONSECUTIVE_FAILURES = 5;

/**
 * Runs a flush after the response, where the host provides a way to.
 *
 * `src/instrumentation.ts` installs Next's `after()` here. It is injected
 * rather than imported because `src/lib` is framework-free by rule — and
 * because the fallback has to work anywhere, including a plain `node` process
 * and the unit suite.
 */
export type FlushDeferrer = (task: () => Promise<void>) => void;

/**
 * Long enough that the lines from one request batch into a single call, short
 * enough that a `pnpm dev` session or a script sees its own logs promptly. Only
 * the fallback deferrer uses it; under Next, `after()` decides the timing.
 */
const FALLBACK_FLUSH_DELAY_MS = 250;

const timerDeferrer: FlushDeferrer = (task) => {
  const timer = setTimeout(() => {
    // `flushLogs` is documented never to reject, so there is no rejection to
    // handle — but an unhandled rejection would take the process down, so this
    // stays defensive rather than trusting a promise made three functions away.
    void task().catch(() => {});
  }, FALLBACK_FLUSH_DELAY_MS);
  // Node holds the event loop open for a pending timer. A log flush must never
  // be the reason a script does not exit; the buffer is drained by an explicit
  // `flushLogs()` or lost, and losing it costs nothing the console did not keep.
  (timer as unknown as { unref?: () => void }).unref?.();
};

let deferFlush: FlushDeferrer = timerDeferrer;
let cachedConfig: CloudWatchLogsConfig | null | undefined;
let injectedSink: CloudWatchLogsSink | null = null;
let sinkPromise: Promise<CloudWatchLogsSink | null> | null = null;
let buffer: LogRecord[] = [];
let droppedRecords = 0;
let logStreamName: string | null = null;
let streamCreated = false;
let flushScheduled = false;
let inFlight: Promise<void> | null = null;
let consecutiveFailures = 0;
let shipperDisabled = false;

/**
 * Installs the host's post-response hook. Called once per server instance from
 * `register()` in `src/instrumentation.ts`; a host with nothing to install
 * simply never calls it and keeps the short-timer default above.
 */
export function setFlushDeferrer(deferrer: FlushDeferrer): void {
  deferFlush = deferrer;
}

/**
 * The injection seam, matching `options.client` in the SES and Location
 * adapters: a test hands over a plain object instead of an SDK client. Passing
 * `null` restores the real one.
 */
export function setLogShipperSink(sink: CloudWatchLogsSink | null): void {
  injectedSink = sink;
  sinkPromise = null;
}

/** Clears every piece of per-instance state. For tests, and for nothing else. */
export function resetLogShipper(): void {
  deferFlush = timerDeferrer;
  cachedConfig = undefined;
  injectedSink = null;
  sinkPromise = null;
  buffer = [];
  droppedRecords = 0;
  logStreamName = null;
  streamCreated = false;
  flushScheduled = false;
  inFlight = null;
  consecutiveFailures = 0;
  shipperDisabled = false;
}

/**
 * Read once per instance. `log()` is on the hot path — a zod parse of four
 * environment variables per line is a tax for an answer that cannot change
 * while the process lives.
 */
function config(): CloudWatchLogsConfig | null {
  if (cachedConfig === undefined) cachedConfig = readCloudWatchLogsConfig();
  return cachedConfig;
}

/**
 * One stream per instance, named so a human scanning the group can tell
 * deployments and instances apart at a glance. The date is a reading aid only:
 * CloudWatch indexes by each event's own timestamp, so an instance that lives
 * across midnight keeps writing here and its lines still land on the right day.
 */
function streamNameFor(environment: string): string {
  const day = new Date(nowMs()).toISOString().slice(0, 10);
  const instance = globalThis.crypto?.randomUUID?.().slice(0, 8) ?? `${nowMs().toString(36)}`;
  return `${day}/${environment}/${instance}`;
}

async function resolveSink(target: CloudWatchLogsConfig): Promise<CloudWatchLogsSink | null> {
  if (injectedSink) return injectedSink;
  if (!sinkPromise) sinkPromise = createSdkSink(target);
  return sinkPromise;
}

/**
 * The SDK is loaded here and nowhere else, on the first flush of a configured
 * deployment.
 *
 * A static import would put `@aws-sdk/client-cloudwatch-logs` in the module
 * graph of everything that imports `log()` — which is most of `src/db` and
 * `src/lib` — and so in the cold start of every route, including the ones with
 * no credentials to use it with. Deferring it means an unconfigured deployment
 * never loads the client at all.
 */
async function createSdkSink(target: CloudWatchLogsConfig): Promise<CloudWatchLogsSink | null> {
  try {
    const { CloudWatchLogsClient, CreateLogStreamCommand, PutLogEventsCommand } = await import(
      "@aws-sdk/client-cloudwatch-logs"
    );
    const client = new CloudWatchLogsClient({
      region: target.region,
      credentials: {
        accessKeyId: target.accessKeyId,
        secretAccessKey: target.secretAccessKey,
      },
      // Two attempts, not the SDK's default three: a flush that is failing is
      // holding a serverless invocation open, and the next flush retries the
      // remaining buffer anyway.
      maxAttempts: 2,
    });
    return {
      async createLogStream(input) {
        await client.send(new CreateLogStreamCommand(input));
      },
      async putLogEvents(input) {
        await client.send(
          new PutLogEventsCommand({
            logGroupName: input.logGroupName,
            logStreamName: input.logStreamName,
            logEvents: input.logEvents.map((record) => ({
              timestamp: record.timestamp,
              message: record.message,
            })),
          }),
        );
      },
    };
  } catch {
    return null;
  }
}

/**
 * Reports a shipping failure without going through `log()` — which would append
 * the report to the very buffer that just failed to flush, and do it again on
 * the next failure. Shape only, never an error message: an AWS exception can
 * echo request content back, and this app's logs carry ids and codes only.
 */
function noteFailure(error: unknown): void {
  consecutiveFailures += 1;
  const shape = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  const detail = {
    time: new Date(nowMs()).toISOString(),
    level: "warn",
    event: "cloudwatch_shipper.flush_failed",
    error: typeof shape?.name === "string" ? shape.name : "unknown",
    status:
      typeof shape?.$metadata?.httpStatusCode === "number" ? shape.$metadata.httpStatusCode : null,
    consecutiveFailures,
  };
  if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
    shipperDisabled = true;
    console.warn(JSON.stringify({ ...detail, event: "cloudwatch_shipper.disabled" }));
    return;
  }
  // Only the first failure of a run is reported. A wrong credential fails every
  // flush, and a warning per flush is how a log drain turns into noise.
  if (consecutiveFailures === 1) console.warn(JSON.stringify(detail));
}

/** The line standing in for what the buffer ceiling threw away. */
function overflowRecord(count: number): LogRecord {
  return {
    timestamp: nowMs(),
    message: JSON.stringify({
      time: new Date(nowMs()).toISOString(),
      level: "warn",
      event: "cloudwatch_shipper.buffer_overflow",
      dropped: count,
    }),
  };
}

async function drain(): Promise<void> {
  flushScheduled = false;
  const target = config();
  if (!target || shipperDisabled) {
    // Nothing is coming to collect these, so holding them is a memory leak with
    // no upside. The console already has every one of them.
    buffer = [];
    droppedRecords = 0;
    return;
  }
  if (buffer.length === 0 && droppedRecords === 0) return;

  const records = buffer;
  buffer = [];
  if (droppedRecords > 0) {
    records.push(overflowRecord(droppedRecords));
    droppedRecords = 0;
  }

  const sink = await resolveSink(target);
  if (!sink) {
    noteFailure(new Error("sink_unavailable"));
    return;
  }

  try {
    if (!logStreamName) logStreamName = streamNameFor(target.environment);
    if (!streamCreated) {
      try {
        await sink.createLogStream({
          logGroupName: target.logGroupName,
          logStreamName: logStreamName,
        });
      } catch (error) {
        // The stream outliving a cold start is the normal case once an instance
        // is recycled onto the same name, and CloudWatch says so with a typed
        // exception. Anything else is a real failure and belongs in the catch
        // below.
        if ((error as { name?: string })?.name !== "ResourceAlreadyExistsException") throw error;
      }
      streamCreated = true;
    }

    for (const batch of batchRecords(records)) {
      await sink.putLogEvents({
        logGroupName: target.logGroupName,
        logStreamName: logStreamName,
        logEvents: batch,
      });
    }
    consecutiveFailures = 0;
  } catch (error) {
    // The batch is not re-buffered. Retrying lines the console already carries
    // would grow the buffer during exactly the incident that made flushing
    // fail, and the breaker exists so a persistent failure stops costing
    // latency rather than accumulating work.
    streamCreated = false;
    noteFailure(error);
  }
}

/**
 * Ships everything buffered so far, and never rejects.
 *
 * Awaited at the boundaries where the record matters more than the millisecond:
 * the four cron routes, whose log line *is* the evidence that the pass ran and
 * what it decided, and `/api/vitals`, whose response is nobody's latency
 * because the page is already going away. Everywhere else the deferrer runs it
 * after the response.
 */
export async function flushLogs(): Promise<void> {
  const previous = inFlight;
  if (previous) await previous;
  const task = drain().catch(() => {});
  inFlight = task;
  try {
    await task;
  } finally {
    if (inFlight === task) inFlight = null;
  }
}

/**
 * Buffers one already-serialized line. Called by `log()` after the console
 * write, never instead of it.
 */
export function recordLogLine(message: string, timestamp: number): void {
  if (!config() || shipperDisabled) return;

  buffer.push({ timestamp, message });
  if (buffer.length > MAX_BUFFERED_RECORDS) {
    buffer.shift();
    droppedRecords += 1;
  }

  // A full batch's worth is shipped now rather than at the end of the response:
  // it bounds the buffer under a burst, and a batch is the largest useful unit
  // of work anyway. Never while one is already in flight — that flush picks the
  // rest up when it drains, whereas a `flushLogs()` per line during a slow call
  // is thousands of pending promises all waiting on the same one.
  if (buffer.length >= MAX_BATCH_RECORDS && !inFlight) {
    void flushLogs();
    return;
  }

  if (flushScheduled) return;
  flushScheduled = true;
  try {
    deferFlush(flushLogs);
  } catch {
    // `after()` throws when there is no request to run after — a build-time
    // render, a background timer, a script. The line still ships, just inline.
    flushScheduled = false;
    void flushLogs();
  }
}
