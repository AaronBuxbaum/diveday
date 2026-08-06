/**
 * The arithmetic `PutLogEvents` imposes, kept pure and separate from the client
 * that performs the call.
 *
 * CloudWatch rejects an oversized batch outright rather than trimming it, and a
 * rejected batch is a batch of log lines nobody ever sees again. The limits are
 * AWS's, documented at the call, and this module is where they are enforced —
 * so the shipper's own code stays about buffering and failure, and the numbers
 * that must be right are testable without an SDK anywhere near them.
 */

/** One line, already serialized by `log()`. */
export type LogRecord = {
  /** Epoch milliseconds. CloudWatch orders and retains by this, not by arrival. */
  readonly timestamp: number;
  readonly message: string;
};

/**
 * AWS counts every event as its UTF-8 message bytes plus a fixed 26-byte
 * envelope. Both the per-event and per-batch ceilings are measured that way, so
 * every size calculation here adds it.
 */
export const EVENT_OVERHEAD_BYTES = 26;

/** AWS: 256 KiB, message + overhead. A line over this is rejected, not truncated. */
export const MAX_EVENT_BYTES = 262_144;

/** AWS: 1 MiB per `PutLogEvents` call, summed the same way. */
export const MAX_BATCH_BYTES = 1_048_576;

/**
 * AWS's own ceiling is 10,000 events per call. A tenth of that is deliberate:
 * a batch is retried whole, so a smaller one loses less when the call fails,
 * and a structured line from this app is a couple of hundred bytes — 1,000 of
 * them is already comfortably under the byte ceiling in the common case.
 */
export const MAX_BATCH_RECORDS = 1_000;

/**
 * The event code an over-long line is replaced by. A real code, greppable and
 * countable like any other, rather than a marker spliced onto a broken string.
 */
export const TRUNCATION_EVENT = "cloudwatch_shipper.line_truncated";

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/** Cuts a string to a UTF-8 byte budget without splitting a character in half. */
function cutToBytes(value: string, budget: number): string {
  const encoded = new TextEncoder().encode(value);
  if (encoded.length <= budget) return value;
  let end = Math.max(0, budget);
  // Every UTF-8 continuation byte matches `10xxxxxx`. Walking back off one is
  // what stops a multi-byte character being halved and decoded as `U+FFFD`.
  while (end > 0 && ((encoded[end] ?? 0) & 0b1100_0000) === 0b1000_0000) end -= 1;
  return new TextDecoder().decode(encoded.subarray(0, end));
}

/**
 * Replaces a line CloudWatch would reject with a **valid JSON** line saying so.
 *
 * The first version of this cut the serialized line and glued a marker on the
 * end, which only produced parseable JSON by luck — a cut landing mid-number or
 * mid-key yields a line no `$.level = "error"` metric filter can read, so an
 * over-long error line would have silently stopped being counted (raised in
 * review, and the right call: every line `log()` writes is JSON, and the filters
 * and saved queries all depend on that holding without exception).
 *
 * So nothing is spliced. A fresh object is built, with the original's opening
 * bytes carried as a properly-escaped string field — readable for a human,
 * parseable for a machine, and honest about having been cut. The re-check loop
 * exists because escaping can grow a string (a `"` becomes two bytes, a control
 * character up to six), so the head is halved until the finished line fits.
 *
 * Nothing this app logs is remotely near 256 KiB; the context is ids and codes.
 * This is the guard for the line nobody predicted.
 */
export function truncateMessage(message: string): string {
  const limit = MAX_EVENT_BYTES - EVENT_OVERHEAD_BYTES;
  const originalBytes = byteLength(message);
  if (originalBytes <= limit) return message;

  // Leaves generous room for the wrapper's own keys and any escaping growth.
  let headBudget = Math.floor(limit / 2);
  for (;;) {
    const line = JSON.stringify({
      event: TRUNCATION_EVENT,
      truncated: true,
      originalBytes,
      head: cutToBytes(message, headBudget),
    });
    if (byteLength(line) <= limit || headBudget === 0) return line;
    headBudget = Math.floor(headBudget / 2);
  }
}

/**
 * Splits records into calls CloudWatch will accept, preserving order.
 *
 * Order matters twice over: `PutLogEvents` requires each batch to be
 * chronological, and a reader scrolling a stream expects the sequence they were
 * emitted in. Callers hand records over in emission order and this never
 * reorders them — it only decides where one call ends and the next begins.
 */
export function batchRecords(records: readonly LogRecord[]): LogRecord[][] {
  const batches: LogRecord[][] = [];
  let current: LogRecord[] = [];
  let currentBytes = 0;

  for (const record of records) {
    const message = truncateMessage(record.message);
    const size = byteLength(message) + EVENT_OVERHEAD_BYTES;
    if (
      current.length >= MAX_BATCH_RECORDS ||
      (current.length > 0 && currentBytes + size > MAX_BATCH_BYTES)
    ) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push({ timestamp: record.timestamp, message });
    currentBytes += size;
  }

  if (current.length > 0) batches.push(current);
  return batches;
}
