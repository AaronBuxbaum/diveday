import { describe, expect, it } from "vitest";
import {
  batchRecords,
  EVENT_OVERHEAD_BYTES,
  MAX_BATCH_BYTES,
  MAX_BATCH_RECORDS,
  MAX_EVENT_BYTES,
  TRUNCATION_EVENT,
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

  it("replaces an oversized line with valid JSON that fits", () => {
    // The property that matters: every line `log()` produces stays parseable,
    // because the metric filters read `$.level` and `$.event` out of it. A
    // spliced-together string would only be JSON by luck.
    const truncated = truncateMessage("x".repeat(MAX_EVENT_BYTES * 2));

    expect(bytes(truncated) + EVENT_OVERHEAD_BYTES).toBeLessThanOrEqual(MAX_EVENT_BYTES);
    expect(() => JSON.parse(truncated)).not.toThrow();
    expect(JSON.parse(truncated)).toMatchObject({
      event: TRUNCATION_EVENT,
      truncated: true,
      originalBytes: MAX_EVENT_BYTES * 2,
    });
  });

  it("carries the start of the original so a human can still tell what it was", () => {
    const original = `${JSON.stringify({ event: "stripe_webhook.event_received" })}${"y".repeat(MAX_EVENT_BYTES * 2)}`;
    const head = JSON.parse(truncateMessage(original)).head as string;
    expect(head.startsWith('{"event":"stripe_webhook.event_received"}')).toBe(true);
  });

  it("stays valid and within the ceiling when every character needs escaping", () => {
    // A quote becomes two bytes once escaped and a control character up to six,
    // so a head chosen by raw byte count can overshoot after JSON.stringify.
    for (const filler of ['"', "\\", "\u0000", "🤿"]) {
      const truncated = truncateMessage(filler.repeat(MAX_EVENT_BYTES));
      expect(bytes(truncated) + EVENT_OVERHEAD_BYTES).toBeLessThanOrEqual(MAX_EVENT_BYTES);
      expect(() => JSON.parse(truncated)).not.toThrow();
    }
  });

  it("never splits a multi-byte character into a replacement glyph", () => {
    const head = JSON.parse(truncateMessage("🤿".repeat(MAX_EVENT_BYTES))).head as string;
    expect(head).not.toContain("�");
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

  it("replaces an oversized record rather than emitting a batch AWS would reject", () => {
    const [batch] = batchRecords([record(0, "z".repeat(MAX_EVENT_BYTES * 3))]);
    expect(batch).toHaveLength(1);
    expect(batchBytes(batch ?? [])).toBeLessThanOrEqual(MAX_EVENT_BYTES);
    // Still parseable, so a metric filter can still read it.
    expect(JSON.parse(batch?.[0]?.message ?? "")).toMatchObject({ event: TRUNCATION_EVENT });
  });
});
