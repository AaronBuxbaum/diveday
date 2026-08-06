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
 * Marks a line the byte ceiling cut short, so a truncated record is never
 * mistaken for a complete one. Deliberately not valid JSON on its own — a line
 * this long is already malformed for a Logs Insights `parse`, and saying so
 * plainly beats a silently short object.
 */
export const TRUNCATION_MARKER = '…","truncated":true}';

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/**
 * Cuts a line down to what CloudWatch will accept, on a UTF-8 byte boundary.
 *
 * The cut is made in the encoded bytes rather than in the string, because a
 * character's byte length is not its length: slicing by characters and hoping
 * either overshoots the ceiling (and CloudWatch rejects the whole batch) or
 * undershoots it by a factor of four. Walking back off UTF-8 continuation bytes
 * — every one of which matches `10xxxxxx` — is what keeps a multi-byte
 * character from being cut in half and decoded as `U+FFFD`.
 *
 * Nothing this app logs is remotely near 256 KiB; the context is ids and codes.
 * This is the guard for the line nobody predicted.
 */
export function truncateMessage(message: string): string {
  const limit = MAX_EVENT_BYTES - EVENT_OVERHEAD_BYTES;
  const encoded = new TextEncoder().encode(message);
  if (encoded.length <= limit) return message;

  let end = limit - byteLength(TRUNCATION_MARKER);
  while (end > 0 && ((encoded[end] ?? 0) & 0b1100_0000) === 0b1000_0000) end -= 1;
  return new TextDecoder().decode(encoded.subarray(0, end)) + TRUNCATION_MARKER;
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
