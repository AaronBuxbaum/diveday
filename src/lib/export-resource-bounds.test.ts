import { describe, expect, it, vi } from "vitest";
import { fetchExportPhotos, zipExportBundle } from "./export";

const env = { MEDIA_BUCKET_NAME: "diveday-media", MEDIA_AWS_REGION: "us-east-1" };
const host = "https://diveday-media.s3.us-east-1.amazonaws.com";
const limits = {
  photoConcurrency: 2,
  totalPhotoTimeoutMs: 1_000,
  photoBytes: 4,
  totalPhotoBytes: 6,
  archiveInputBytes: 16,
};

describe("export resource bounds", () => {
  it("bounds concurrent downloads while preserving sorted manifest order", async () => {
    let active = 0;
    let peak = 0;
    const fetchImpl = vi.fn(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      return new Response(new Uint8Array([1]));
    });
    const urls = ["c", "b", "a", "d", "e"].map((name) => `${host}/cards/${name}`);
    const result = await fetchExportPhotos(urls, fetchImpl, env, limits);
    expect(peak).toBe(2);
    expect(result.manifest.complete).toBe(true);
    expect(result.manifest.files.map((file) => file.path)).toEqual(
      ["a", "b", "c", "d", "e"].map((name) => `photos/cards/${name}`),
    );
  });

  it("holds a concurrency slot until the streamed body has finished", async () => {
    let active = 0;
    let peak = 0;
    const result = await fetchExportPhotos(
      ["a", "b", "c", "d"].map((name) => `${host}/cards/${name}`),
      vi.fn(async () => {
        active++;
        peak = Math.max(peak, active);
        return new Response(
          new ReadableStream({
            async start(stream) {
              await new Promise((resolve) => setTimeout(resolve, 2));
              stream.enqueue(new Uint8Array([1]));
              active--;
              stream.close();
            },
          }),
        );
      }),
      env,
      limits,
    );
    expect(result.manifest.complete).toBe(true);
    expect(peak).toBe(2);
    expect(active).toBe(0);
  });

  it("shares the budget across simultaneously arriving partial chunks", async () => {
    const result = await fetchExportPhotos(
      ["a", "b"].map((name) => `${host}/cards/${name}`),
      vi.fn(async () => {
        let chunks = 0;
        return new Response(
          new ReadableStream({
            async pull(stream) {
              await new Promise((resolve) => setTimeout(resolve, 1));
              if (++chunks > 2) stream.close();
              else stream.enqueue(new Uint8Array(2));
            },
          }),
        );
      }),
      env,
      limits,
    );
    expect(result.photos).toHaveLength(1);
    expect(result.photos[0].bytes.byteLength).toBe(4);
    expect(result.manifest.files.filter((file) => file.status === "missing")).toEqual([
      expect.objectContaining({ reason: "resource_limit" }),
    ]);
    expect(result.manifest.complete).toBe(false);
  });

  it("cancels an oversized streamed body without trusting a false content length", async () => {
    const cancel = vi.fn();
    let chunks = 0;
    const body = new ReadableStream({
      pull(controller) {
        if (++chunks > 4) controller.close();
        else controller.enqueue(new Uint8Array(3));
      },
      cancel,
    });
    const result = await fetchExportPhotos(
      [`${host}/cards/a`],
      vi.fn(async () => new Response(body, { headers: { "content-length": "1" } })),
      env,
      limits,
    );
    expect(result.photos).toEqual([]);
    expect(result.manifest).toMatchObject({
      complete: false,
      files: [{ reason: "resource_limit" }],
    });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("enforces a shared byte budget and labels every omitted photo", async () => {
    const result = await fetchExportPhotos(
      ["a", "b", "c", "d"].map((name) => `${host}/cards/${name}`),
      vi.fn(async () => new Response(new Uint8Array(4))),
      env,
      { ...limits, photoConcurrency: 1 },
    );
    expect(result.photos).toHaveLength(1);
    expect(result.manifest).toMatchObject({ expected: 4, included: 1, complete: false });
    expect(result.manifest.files.slice(1)).toEqual(
      ["b", "c", "d"].map((name) => ({
        path: `photos/cards/${name}`,
        status: "missing",
        reason: "resource_limit",
      })),
    );
  });

  it("applies the same streamed byte bound to authenticated private evidence", async () => {
    const result = await fetchExportPhotos(
      [`${host}/import-waivers/a.pdf`],
      vi.fn(async () => new Response(new Uint8Array(5))),
      { ...env, MEDIA_AWS_ACCESS_KEY_ID: "test", MEDIA_AWS_SECRET_ACCESS_KEY: "test" },
      limits,
    );
    expect(result.manifest).toMatchObject({
      complete: false,
      files: [{ reason: "resource_limit" }],
    });
  });

  it("stops active and queued downloads at the shared deadline", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn(
        (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
              once: true,
            });
          }),
      );
      const pending = fetchExportPhotos(
        ["a", "b", "c", "d"].map((name) => `${host}/cards/${name}`),
        fetchImpl,
        env,
        limits,
      );
      await vi.advanceTimersByTimeAsync(limits.totalPhotoTimeoutMs);
      const result = await pending;
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(result.manifest).toMatchObject({ expected: 4, included: 0, complete: false });
      expect(
        result.manifest.files.every(
          (file) => file.status === "missing" && file.reason === "timed_out",
        ),
      ).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps concurrent exports' byte budgets independent", async () => {
    const exportOne = () =>
      fetchExportPhotos(
        [`${host}/cards/a`],
        vi.fn(async () => new Response(new Uint8Array(4))),
        env,
        limits,
      );
    const results = await Promise.all([exportOne(), exportOne()]);
    expect(results.every((result) => result.manifest.complete)).toBe(true);
  });

  it("keeps workers progressing after a failed download", async () => {
    const result = await fetchExportPhotos(
      ["a", "b", "c"].map((name) => `${host}/cards/${name}`),
      vi.fn(async (url) => {
        if (String(url).endsWith("/a")) throw new Error("network failed");
        return new Response(new Uint8Array([1]));
      }),
      env,
      { ...limits, photoConcurrency: 1 },
    );
    expect(result.manifest).toMatchObject({ expected: 3, included: 2, complete: false });
    expect(result.manifest.files[0]).toMatchObject({ reason: "fetch_failed" });
  });

  it("rejects invalid limits rather than silently omitting all work", async () => {
    await expect(
      fetchExportPhotos([], vi.fn(), env, { ...limits, photoConcurrency: 0 }),
    ).rejects.toThrow("export_resource_limits_invalid");
  });

  it("refuses an oversized archive before compression, counting UTF-8 bytes", () => {
    expect(() => zipExportBundle([{ name: "a.csv", content: "ééé" }], 5)).toThrow(
      "export_resource_limit",
    );
    expect(() =>
      zipExportBundle(
        [
          { name: "a", content: new Uint8Array(3) },
          { name: "b", content: new Uint8Array(3) },
        ],
        5,
      ),
    ).toThrow("export_resource_limit");
    expect(zipExportBundle([{ name: "a", content: "éé" }], 4)).toBeInstanceOf(Uint8Array);
  });
});
