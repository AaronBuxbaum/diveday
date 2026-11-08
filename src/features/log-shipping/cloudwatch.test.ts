import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type CloudWatchLogsSink,
  flushLogs,
  recordLogLine,
  resetLogShipper,
  setFlushDeferrer,
  setLogShipperSink,
} from "./cloudwatch";
import { MAX_BATCH_RECORDS } from "./cloudwatch-batch";

type PutCall = { logGroupName: string; logStreamName: string; messages: string[] };

function recordingSink(overrides: Partial<CloudWatchLogsSink> = {}) {
  const streams: string[] = [];
  const puts: PutCall[] = [];
  const sink: CloudWatchLogsSink = {
    async createLogStream(input) {
      streams.push(input.logStreamName);
    },
    async putLogEvents(input) {
      puts.push({
        logGroupName: input.logGroupName,
        logStreamName: input.logStreamName,
        messages: input.logEvents.map((event) => event.message),
      });
    },
    ...overrides,
  };
  return { sink, streams, puts };
}

function configure() {
  vi.stubEnv("CLOUDWATCH_AWS_REGION", "us-east-1");
  vi.stubEnv("CLOUDWATCH_LOG_GROUP", "/diveday/app");
  vi.stubEnv("CLOUDWATCH_AWS_ACCESS_KEY_ID", "AKIAEXAMPLE");
  vi.stubEnv("CLOUDWATCH_AWS_SECRET_ACCESS_KEY", "secret");
  vi.stubEnv("VERCEL_ENV", "production");
}

const line = (event: string) => JSON.stringify({ level: "info", event });

describe("the CloudWatch log shipper", () => {
  beforeEach(() => {
    resetLogShipper();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    resetLogShipper();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("buffers nothing and calls nothing when no credentials are configured", async () => {
    const { sink, puts } = recordingSink();
    setLogShipperSink(sink);

    recordLogLine(line("cron_reminders.scan_complete"), 1_754_000_000_000);
    await flushLogs();

    expect(puts).toEqual([]);
  });

  it("ships buffered lines to the configured group, in order, on one stream", async () => {
    configure();
    const { sink, streams, puts } = recordingSink();
    setLogShipperSink(sink);

    recordLogLine(line("first"), 1_754_000_000_000);
    recordLogLine(line("second"), 1_754_000_000_001);
    await flushLogs();
    recordLogLine(line("third"), 1_754_000_000_002);
    await flushLogs();

    expect(puts.map((call) => call.messages)).toEqual([
      [line("first"), line("second")],
      [line("third")],
    ]);
    expect(puts.every((call) => call.logGroupName === "/diveday/app")).toBe(true);
    // One stream per instance, created once however many flushes follow.
    expect(streams).toHaveLength(1);
    expect(new Set(puts.map((call) => call.logStreamName)).size).toBe(1);
  });

  it("names the stream after the deployment, so preview lines are never mistaken for production", async () => {
    configure();
    vi.stubEnv("VERCEL_ENV", "preview");
    const { sink, streams } = recordingSink();
    setLogShipperSink(sink);

    recordLogLine(line("first"), 1_754_000_000_000);
    await flushLogs();

    expect(streams[0]).toMatch(/^\d{4}-\d{2}-\d{2}\/preview\/[a-z0-9]+$/);
  });

  it("does nothing on a flush with an empty buffer", async () => {
    configure();
    const { sink, streams, puts } = recordingSink();
    setLogShipperSink(sink);

    await flushLogs();

    expect(streams).toEqual([]);
    expect(puts).toEqual([]);
  });

  it("treats an existing stream as success rather than losing the batch", async () => {
    configure();
    const alreadyExists = Object.assign(new Error("exists"), {
      name: "ResourceAlreadyExistsException",
    });
    const { sink, puts } = recordingSink({
      async createLogStream() {
        throw alreadyExists;
      },
    });
    setLogShipperSink(sink);

    recordLogLine(line("first"), 1_754_000_000_000);
    await flushLogs();

    expect(puts).toHaveLength(1);
  });

  it("never rejects when the sink throws, and reports the shape once", async () => {
    configure();
    const { sink } = recordingSink({
      async putLogEvents() {
        throw Object.assign(new Error("denied"), {
          name: "AccessDeniedException",
          $metadata: { httpStatusCode: 403 },
        });
      },
    });
    setLogShipperSink(sink);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      recordLogLine(line("first"), 1_754_000_000_000);
      await expect(flushLogs()).resolves.toBeUndefined();
    }

    expect(console.warn).toHaveBeenCalledTimes(1);
    const reported = JSON.parse(vi.mocked(console.warn).mock.calls[0]?.[0] as string);
    expect(reported).toMatchObject({
      event: "cloudwatch_shipper.flush_failed",
      error: "AccessDeniedException",
      status: 403,
    });
    // Shape only: an AWS message can echo request content back, and these lines
    // are the app's own operational record.
    expect(JSON.stringify(reported)).not.toContain("denied");
  });

  it("stops shipping for the life of the instance after repeated failure", async () => {
    configure();
    let attempts = 0;
    const { sink } = recordingSink({
      async putLogEvents() {
        attempts += 1;
        throw new Error("nope");
      },
    });
    setLogShipperSink(sink);

    for (let attempt = 0; attempt < 8; attempt += 1) {
      recordLogLine(line("first"), 1_754_000_000_000);
      await flushLogs();
    }

    expect(attempts).toBe(5);
    expect(
      vi
        .mocked(console.warn)
        .mock.calls.map((call) => JSON.parse(call[0] as string).event)
        .filter((event) => event === "cloudwatch_shipper.disabled"),
    ).toHaveLength(1);
  });

  it("bounds the buffer while a slow flush is in flight, dropping the oldest and saying how many", async () => {
    configure();
    const { sink, puts } = recordingSink();
    // A flush that has not come back yet is the only way the buffer can grow
    // past a batch — and it is the realistic one, since a burst is exactly when
    // CloudWatch is slowest to answer.
    let release: () => void = () => {};
    const firstPutStarted = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held = false;
    setLogShipperSink({
      createLogStream: sink.createLogStream,
      async putLogEvents(input) {
        if (!held) {
          held = true;
          await firstPutStarted;
        }
        await sink.putLogEvents(input);
      },
    });
    setFlushDeferrer(() => {});

    for (let index = 0; index < 3_400; index += 1) {
      recordLogLine(line(`burst-${index}`), 1_754_000_000_000 + index);
    }
    release();
    await flushLogs();

    const shipped = puts.flatMap((call) => call.messages);
    // The first batch went inline at the batch ceiling; everything after it
    // queued behind the held call and was capped at 2,000, so the oldest of that
    // window are gone and the newest survive.
    expect(shipped).toContain(line("burst-0"));
    expect(shipped).toContain(line("burst-3399"));
    expect(shipped).not.toContain(line("burst-1000"));
    const overflow = shipped.filter((message) => message.includes("buffer_overflow"));
    expect(overflow).toHaveLength(1);
    expect(JSON.parse(overflow[0] as string)).toMatchObject({
      event: "cloudwatch_shipper.buffer_overflow",
      level: "warn",
      dropped: 400,
    });
  });

  it("ships a full batch inline rather than waiting for the response to end", async () => {
    configure();
    const { sink, puts } = recordingSink();
    setLogShipperSink(sink);
    setFlushDeferrer(() => {});

    for (let index = 0; index < MAX_BATCH_RECORDS; index += 1) {
      recordLogLine(line(`n-${index}`), 1_754_000_000_000 + index);
    }
    // The inline flush is deliberately not awaited by `recordLogLine`; awaiting
    // a no-op flush here joins whatever it started.
    await flushLogs();

    expect(puts.flatMap((call) => call.messages)).toHaveLength(MAX_BATCH_RECORDS);
  });

  it("hands the flush to the host's post-response hook when there is one", async () => {
    configure();
    const { sink, puts } = recordingSink();
    setLogShipperSink(sink);
    const deferred: (() => Promise<void>)[] = [];
    setFlushDeferrer((task) => {
      deferred.push(task);
    });

    recordLogLine(line("first"), 1_754_000_000_000);
    expect(puts).toEqual([]);
    expect(deferred).toHaveLength(1);

    await deferred[0]?.();
    expect(puts.flatMap((call) => call.messages)).toEqual([line("first")]);
  });

  it("flushes inline when the host's hook refuses — there is no request to run after", async () => {
    configure();
    const { sink, puts } = recordingSink();
    setLogShipperSink(sink);
    setFlushDeferrer(() => {
      throw new Error("after() called outside a request scope");
    });

    recordLogLine(line("first"), 1_754_000_000_000);
    await flushLogs();

    expect(puts.flatMap((call) => call.messages)).toEqual([line("first")]);
  });
});
