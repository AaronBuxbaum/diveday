import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { allocatePrivatePersonPhoto, uploadPrivatePersonPhoto } from "./private-person-photo";

const env = {
  MEDIA_BUCKET_NAME: "diveday-media-test",
  MEDIA_AWS_REGION: "us-east-2",
  MEDIA_AWS_ACCESS_KEY_ID: "AKIATEST",
  MEDIA_AWS_SECRET_ACCESS_KEY: "secret",
  MEDIA_PUBLIC_URL_BASE: "https://media.example.com",
};

async function fixture() {
  return sharp({ create: { width: 12, height: 10, channels: 3, background: "red" } })
    .jpeg()
    .withMetadata({ exif: { IFD0: { Artist: "private name" } } })
    .toBuffer();
}

describe("private person photo storage", () => {
  it("allocates opaque unique keys before a request, and refuses missing configuration", () => {
    const first = allocatePrivatePersonPhoto(env)?.url;
    const second = allocatePrivatePersonPhoto(env)?.url;
    expect(first).toMatch(
      /^https:\/\/diveday-media-test\.s3\.us-east-2\.amazonaws\.com\/private-person-photos\/[A-Za-z0-9_-]{22}\.jpg$/,
    );
    expect(first).not.toEqual(second);
    expect(allocatePrivatePersonPhoto({})).toBeNull();
  });

  it("writes to the allocated key after stripping metadata and ignores the original filename", async () => {
    const url = allocatePrivatePersonPhoto(env)?.url;
    if (!url) throw new Error("allocation failed");
    const bytes = await fixture();
    expect((await sharp(bytes).metadata()).exif).toBeDefined();
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    expect(
      await uploadPrivatePersonPhoto(
        url,
        { filename: "Private Name.jpg", contentType: "image/jpeg", bytes },
        { env, fetchImpl },
      ),
    ).toBe("stored");
    const [target, options] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(target.toString()).toBe(url);
    expect(target.toString()).not.toContain("Private");
    expect(options.signal).toBeInstanceOf(AbortSignal);
    const uploaded = Buffer.from(await (options.body as Blob).arrayBuffer());
    const metadata = await sharp(uploaded).metadata();
    expect(metadata.format).toBe("jpeg");
    expect(metadata.exif).toBeUndefined();
    expect(uploaded.includes(Buffer.from("private name"))).toBe(false);
  });

  it("refuses other origins, keys, MIME types, and disguised bytes before contacting storage", async () => {
    const url = allocatePrivatePersonPhoto(env)?.url;
    if (!url) throw new Error("allocation failed");
    const bytes = await fixture();
    const fetchImpl = vi.fn();
    for (const bad of [
      url.replace("diveday-media-test", "other"),
      url.replace("private-person-photos", "staff-profiles"),
      `${url}?x=1`,
      url.replace(".jpg", "-name.jpg"),
    ]) {
      expect(
        await uploadPrivatePersonPhoto(
          bad,
          { filename: "x", contentType: "image/jpeg", bytes },
          { env, fetchImpl },
        ),
      ).toBe("rejected");
    }
    expect(
      await uploadPrivatePersonPhoto(
        url,
        { filename: "x", contentType: "text/html", bytes },
        { env, fetchImpl },
      ),
    ).toBe("rejected");
    expect(
      await uploadPrivatePersonPhoto(
        url,
        { filename: "x", contentType: "image/jpeg", bytes: Buffer.from("not an image") },
        { env, fetchImpl },
      ),
    ).toBe("rejected");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("treats a non-success provider response as uncertain after attempting PUT", async () => {
    const url = allocatePrivatePersonPhoto(env)?.url;
    if (!url) throw new Error("allocation failed");
    const fetchImpl = vi.fn(async () => new Response(null, { status: 503 }));
    expect(
      await uploadPrivatePersonPhoto(
        url,
        { filename: "x.jpg", contentType: "image/jpeg", bytes: await fixture() },
        { env, fetchImpl },
      ),
    ).toBe("uncertain");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("returns failure for a lost response while keeping the preallocated key known to the caller", async () => {
    const url = allocatePrivatePersonPhoto(env)?.url;
    if (!url) throw new Error("allocation failed");
    const fetchImpl = vi.fn().mockRejectedValue(new Error("lost response"));
    expect(
      await uploadPrivatePersonPhoto(
        url,
        { filename: "x.jpg", contentType: "image/jpeg", bytes: await fixture() },
        { env, fetchImpl },
      ),
    ).toBe("uncertain");
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(url);
  });
});
