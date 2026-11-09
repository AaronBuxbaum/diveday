import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  type DeleteObjectsCommandInput,
  type DeleteObjectsCommandOutput,
  ListObjectVersionsCommand,
  type ListObjectVersionsCommandInput,
  type ListObjectVersionsCommandOutput,
  S3Client,
} from "@aws-sdk/client-s3";
import type { DeleteImageResult } from "./index";
import { encodeS3KeyPath, type S3StorageConfig } from "./s3";

type VersionApi = {
  hide(bucket: string, key: string, signal: AbortSignal): Promise<unknown>;
  list(
    input: ListObjectVersionsCommandInput,
    signal: AbortSignal,
  ): Promise<ListObjectVersionsCommandOutput>;
  remove(
    input: DeleteObjectsCommandInput,
    signal: AbortSignal,
  ): Promise<DeleteObjectsCommandOutput>;
};

/** Exact-key erasure, including noncurrent versions and delete markers. Never a prefix erase. */
export async function purgeS3Versions(
  url: string,
  config: S3StorageConfig,
  api?: VersionApi,
): Promise<DeleteImageResult> {
  let client: S3Client | undefined;
  const signal = AbortSignal.timeout(20_000);
  try {
    const parsed = new URL(url);
    const origins = [
      `https://${config.bucket}.s3.${config.region}.amazonaws.com`,
      `https://${config.bucket}.s3.amazonaws.com`,
    ];
    if (config.publicUrlBase) origins.push(new URL(config.publicUrlBase).origin);
    const key = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
    const encoded = encodeS3KeyPath(key);
    if (
      !origins.includes(parsed.origin) ||
      !key ||
      new URL(`https://s3.invalid/${encoded}`).pathname !== `/${encoded}`
    )
      return { ok: false, error: "media_url_invalid" };
    if (!api) {
      client = new S3Client({
        region: config.region,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
        maxAttempts: 2,
      });
      const sender = client;
      api = {
        hide: (Bucket, Key, abortSignal) =>
          sender.send(new DeleteObjectCommand({ Bucket, Key }), { abortSignal }),
        list: (input, abortSignal) =>
          sender.send(new ListObjectVersionsCommand(input), { abortSignal }),
        remove: (input, abortSignal) =>
          sender.send(new DeleteObjectsCommand(input), { abortSignal }),
      };
    }
    // Hide the live key before removing any version; deleting the latest byte version first
    // could otherwise expose an older one during a partial provider failure.
    await api.hide(config.bucket, key, signal);
    const versions: { Key: string; VersionId: string }[] = [];
    const markers: { Key: string; VersionId: string }[] = [];
    let keyMarker: string | undefined;
    let versionMarker: string | undefined;
    let incomplete = false;
    for (let page = 0; ; page++) {
      if (page === 20) {
        incomplete = true;
        break;
      }
      const result = await api.list(
        {
          Bucket: config.bucket,
          Prefix: key,
          KeyMarker: keyMarker,
          VersionIdMarker: versionMarker,
        },
        signal,
      );
      for (const [rows, target] of [
        [result.Versions, versions],
        [result.DeleteMarkers, markers],
      ] as const) {
        for (const row of rows ?? []) {
          if (row.Key !== key) continue;
          if (!row.VersionId) return { ok: false, error: "media_version_id_missing" };
          target.push({ Key: key, VersionId: row.VersionId });
        }
      }
      if (!result.IsTruncated) break;
      if (
        !result.NextKeyMarker ||
        (keyMarker === result.NextKeyMarker && versionMarker === result.NextVersionIdMarker)
      )
        return { ok: false, error: "media_version_cursor_invalid" };
      keyMarker = result.NextKeyMarker;
      versionMarker = result.NextVersionIdMarker;
    }
    // Keep deletion markers in place until every historical byte is gone.
    for (const rows of incomplete ? [versions] : [versions, markers]) {
      for (let start = 0; start < rows.length; start += 1000) {
        const result = await api.remove(
          {
            Bucket: config.bucket,
            Delete: { Objects: rows.slice(start, start + 1000), Quiet: true },
          },
          signal,
        );
        if (result.Errors?.length) return { ok: false, error: "media_version_delete_failed" };
      }
    }
    if (incomplete) return { ok: false, error: "media_version_page_limit" };
    const remaining = await api.list({ Bucket: config.bucket, Prefix: key }, signal);
    if (
      remaining.IsTruncated ||
      [...(remaining.Versions ?? []), ...(remaining.DeleteMarkers ?? [])].some(
        (row) => row.Key === key,
      )
    )
      return { ok: false, error: "media_versions_remain" };
    return { ok: true };
  } catch {
    return { ok: false, error: "media_version_erase_failed" };
  } finally {
    client?.destroy();
  }
}
