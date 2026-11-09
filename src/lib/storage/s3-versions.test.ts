import { describe, expect, it, vi } from "vitest";
import { purgeStoredImageTracked } from "./index";
import { purgeS3Versions } from "./s3-versions";

const config = {
  bucket: "media",
  region: "us-east-1",
  accessKeyId: "test",
  secretAccessKey: "test",
  publicUrlBase: "https://media.example.com",
};
const url = "https://media.example.com/recap/person.jpg";
const Key = "recap/person.jpg";
describe("version erasure", () => {
  it("paginates exact-key versions, erases bytes before markers, then verifies", async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce({
        Versions: [
          { Key, VersionId: "old" },
          { Key: `${Key}.other`, VersionId: "untouched" },
        ],
        IsTruncated: true,
        NextKeyMarker: Key,
        NextVersionIdMarker: "old",
      })
      .mockResolvedValueOnce({
        Versions: [{ Key, VersionId: "new" }],
        DeleteMarkers: [{ Key, VersionId: "marker" }],
      })
      .mockResolvedValueOnce({});
    const remove = vi.fn().mockResolvedValue({});
    expect(
      await purgeS3Versions(url, config, { hide: vi.fn().mockResolvedValue({}), list, remove }),
    ).toEqual({ ok: true });
    expect(list.mock.calls[1][0]).toMatchObject({ KeyMarker: Key, VersionIdMarker: "old" });
    expect(remove.mock.calls.map(([input]) => input.Delete.Objects)).toEqual([
      [
        { Key, VersionId: "old" },
        { Key, VersionId: "new" },
      ],
      [{ Key, VersionId: "marker" }],
    ]);
  });
  it("keeps markers and fails when any byte deletion fails", async () => {
    const list = vi.fn().mockResolvedValue({
      Versions: [{ Key, VersionId: "old" }],
      DeleteMarkers: [{ Key, VersionId: "marker" }],
    });
    const remove = vi.fn().mockResolvedValue({ Errors: [{ Code: "AccessDenied" }] });
    expect(
      await purgeS3Versions(url, config, { hide: vi.fn().mockResolvedValue({}), list, remove }),
    ).toEqual({
      ok: false,
      error: "media_version_delete_failed",
    });
    expect(remove).toHaveBeenCalledTimes(1);
  });
  it("refuses foreign hosts before provider calls", async () => {
    const list = vi.fn();
    const remove = vi.fn();
    expect(
      (
        await purgeS3Versions("https://evil.example/recap/person.jpg", config, {
          hide: vi.fn().mockResolvedValue({}),
          list,
          remove,
        })
      ).ok,
    ).toBe(false);
    expect(list).not.toHaveBeenCalled();
  });
  it("fails closed on repeated pagination and never leaks errors", async () => {
    const list = vi
      .fn()
      .mockResolvedValue({ IsTruncated: true, NextKeyMarker: Key, NextVersionIdMarker: "same" });
    expect(
      (
        await purgeS3Versions(url, config, {
          hide: vi.fn().mockResolvedValue({}),
          list,
          remove: vi.fn(),
        })
      ).ok,
    ).toBe(false);
    list.mockRejectedValue(new Error("secret url and rows"));
    expect(
      await purgeS3Versions(url, config, {
        hide: vi.fn().mockResolvedValue({}),
        list,
        remove: vi.fn(),
      }),
    ).toEqual({
      ok: false,
      error: "media_version_erase_failed",
    });
  });
  it("does not claim success if a concurrent version remains", async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Versions: [{ Key, VersionId: "late" }] });
    expect(
      await purgeS3Versions(url, config, {
        hide: vi.fn().mockResolvedValue({}),
        list,
        remove: vi.fn(),
      }),
    ).toEqual({
      ok: false,
      error: "media_versions_remain",
    });
  });
});

it("rejects folded paths and missing version ids", async () => {
  const list = vi.fn().mockResolvedValue({ Versions: [{ Key }] });
  const remove = vi.fn();
  expect(
    (
      await purgeS3Versions(
        "https://media.example.com/recap%2F..%2Fmedical-clearances%2Fx",
        config,
        { hide: vi.fn().mockResolvedValue({}), list, remove },
      )
    ).ok,
  ).toBe(false);
  expect(list).not.toHaveBeenCalled();
  expect(
    await purgeS3Versions(url, config, { hide: vi.fn().mockResolvedValue({}), list, remove }),
  ).toEqual({
    ok: false,
    error: "media_version_id_missing",
  });
  expect(remove).not.toHaveBeenCalled();
});

it("does not discharge erasure without storage credentials", async () => {
  vi.stubEnv("MEDIA_AWS_ACCESS_KEY_ID", "");
  try {
    expect(await purgeStoredImageTracked(url)).toEqual({
      ok: false,
      error: "media_storage_unconfigured",
    });
  } finally {
    vi.unstubAllEnvs();
  }
});

it("hides a live key before listing and leaves the marker on partial failure", async () => {
  const order: string[] = [];
  const hide = vi.fn(async () => {
    order.push("hide");
  });
  const list = vi.fn(async () => {
    order.push("list");
    return {
      $metadata: {},
      Versions: [{ Key, VersionId: "current" }],
      DeleteMarkers: [{ Key, VersionId: "tombstone" }],
    };
  });
  const remove = vi.fn(async () => {
    order.push("remove");
    return { $metadata: {}, Errors: [{ Code: "Denied" }] };
  });
  expect((await purgeS3Versions(url, config, { hide, list, remove })).ok).toBe(false);
  expect(order).toEqual(["hide", "list", "remove"]);
  expect(remove.mock.calls).toHaveLength(1);
});

it("makes bounded progress without removing markers when version pagination exceeds one attempt", async () => {
  let page = 0;
  const list = vi.fn(async () => ({
    $metadata: {},
    IsTruncated: true,
    NextKeyMarker: Key,
    NextVersionIdMarker: String(++page),
    Versions: [{ Key, VersionId: `v${page}` }],
    DeleteMarkers: [{ Key, VersionId: `m${page}` }],
  }));
  const remove = vi.fn().mockResolvedValue({});
  const result = await purgeS3Versions(url, config, {
    hide: vi.fn().mockResolvedValue({}),
    list,
    remove,
  });
  expect(result).toEqual({ ok: false, error: "media_version_page_limit" });
  expect(list).toHaveBeenCalledTimes(20);
  expect(remove).toHaveBeenCalledTimes(1);
  expect(remove.mock.calls[0][0].Delete.Objects).toHaveLength(20);
  expect(
    remove.mock.calls[0][0].Delete.Objects.every((row: { VersionId: string }) =>
      row.VersionId.startsWith("v"),
    ),
  ).toBe(true);
});
