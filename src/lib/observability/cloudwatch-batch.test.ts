import { describe, expect, it } from "vitest";
import {
  batchRecords,
  EVENT_OVERHEAD_BYTES,
  MAX_BATCH_BYTES,
  MAX_BATCH_RECORDS,
  MAX_EVENT_BYTES,
  TRUNCATION_MARKER,
  truncateMessage,
} from "./cloudwatch-batch";

const bytes = (value: string) => new TextEncoder().encode(value).length;

const batchBytes = (batch: { message: string }[]) =>
  batch.reduce((total, record) => total + bytes(record.message) + EVENT_OVERHEAD_BYTES, 0);

describe("truncateMessage", () => {
  it("leaves an ordinary log line exactly as it was", () => {
    const line = JSON.stringify({ time: "2026-08-01T12:00:00.000Z", event: "cron.tick" });
    expect(truncateMessage(line)).toBe(line);
  });

  it("cuts an oversized line to what CloudWatch accepts, marker included", () => {
    const truncated = truncateMessage("x".repeat(MAX_EVENT_BYTES * 2));
    expect(bytes(truncated) + EVENT_OVERHEAD_BYTES).toBeLessThanOrEqual(MAX_EVENT_BYTES);
    expect(truncated.endsWith(TRUNCATION_MARKER)).toBe(true);
  });

  it("cuts on a byte boundary, so a multi-byte character never straddles the limit", () => {
    // Four bytes per emoji: a naive character-count cut lands over the ceiling.
    const truncated = truncateMessage("🤿".repeat(MAX_EVENT_BYTES));
    expect(bytes(truncated) + EVENT_OVERHEAD_BYTES).toBeLessThanOrEqual(MAX_EVENT_BYTES);
    expect(truncated).not.toContain("�");
  });
});

describe("batchRecords", () => {
  const record = (index: number, message = `line-${index}`) => ({
    timestamp: 1_754_000_000_000 + index,
    message,
  });

  it("returns nothing for nothing", () => {
    expect(batchRecords([])).toEqual([]);
  });

  it("keeps a small run in one call, in emission order", () => {
    const batches = batchRecords([record(0), record(1), record(2)]);
    expect(batches).toHaveLength(1);
    expect(batches[0]?.map((entry) => entry.message)).toEqual(["line-0", "line-1", "line-2"]);
  });

  it("splits on the record ceiling", () => {
    const batches = batchRecords(
      Array.from({ length: MAX_BATCH_RECORDS + 5 }, (_unused, index) => record(index)),
    );
    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(MAX_BATCH_RECORDS);
    expect(batches[1]).toHaveLength(5);
  });

  it("splits on the byte ceiling well before the record ceiling", () => {
    // 64 KiB each: seventeen of these exceed 1 MiB, so the first batch can hold
    // at most sixteen however far the record count still has to run.
    const heavy = Array.from({ length: 40 }, (_unused, index) =>
      record(index, "y".repeat(64 * 1024)),
    );
    const batches = batchRecords(heavy);
    expect(batches.length).toBeGreaterThan(1);
    for (const batch of batches) {
      expect(batchBytes(batch)).toBeLessThanOrEqual(MAX_BATCH_BYTES);
    }
    expect(batches.flat()).toHaveLength(40);
  });

  it("never drops or reorders a record while splitting", () => {
    const records = Array.from({ length: MAX_BATCH_RECORDS * 2 + 7 }, (_unused, index) =>
      record(index),
    );
    const flattened = batchRecords(records).flat();
    expect(flattened.map((entry) => entry.message)).toEqual(records.map((entry) => entry.message));
  });

  it("truncates an oversized record rather than emitting a batch AWS would reject", () => {
    const [batch] = batchRecords([record(0, "z".repeat(MAX_EVENT_BYTES * 3))]);
    expect(batch).toHaveLength(1);
    expect(batchBytes(batch ?? [])).toBeLessThanOrEqual(MAX_EVENT_BYTES);
  });
});
