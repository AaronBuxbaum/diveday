import { afterEach, describe, expect, it, vi } from "vitest";
import { s3ImageStorageProvider } from "./s3";

const config = {
  bucket: "diveday-media-test",
  region: "us-east-2",
  accessKeyId: "AKIATEST",
  secretAccessKey: "secret",
};

const upload = {
  keyPrefix: "courses",
  filename: "reef.webp",
  contentType: "image/webp",
  bytes: new ArrayBuffer(8),
} as const;

afterEach(() => {
  vi.restoreAllMocks();
});

function warnedEvents(spy: ReturnType<typeof vi.spyOn>): Array<Record<string, unknown>> {
  return spy.mock.calls.map((call: unknown[]) => JSON.parse(String(call[0])));
}

describe("s3ImageStorageProvider.upload", () => {
  it("reports a thrown PUT as failed, and logs it by error name so it is not mistaken for a refusal", async () => {
    const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("fetch failed"));

    const result = await s3ImageStorageProvider(config, fetchImpl).upload(upload);

    expect(result).toEqual({ status: "failed" });
    expect(warnedEvents(warned)).toEqual([
      expect.objectContaining({ event: "storage.upload_threw", errorCode: "TypeError" }),
    ]);
    // The name, never the message, and nothing of the signed request.
    expect(JSON.stringify(warnedEvents(warned))).not.toContain("fetch failed");
    expect(JSON.stringify(warnedEvents(warned))).not.toContain("AKIATEST");
  });

  it("reports a refused PUT as failed without the throw line", async () => {
    const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 403 }));

    const result = await s3ImageStorageProvider(config, fetchImpl).upload(upload);

    expect(result).toEqual({ status: "failed" });
    expect(warned).not.toHaveBeenCalled();
  });
});
