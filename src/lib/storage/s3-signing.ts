import { createHash, createHmac } from "node:crypto";

/** RFC 3986 encoding as required by SigV4. */
export function encodeS3KeySegment(segment: string): string {
  return encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** A key's URI path, encoding each slash-separated segment once. */
export function encodeS3KeyPath(key: string): string {
  return key.split("/").map(encodeS3KeySegment).join("/");
}

export function sha256S3Payload(data: ArrayBuffer | Uint8Array | string): string {
  const payload = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  return createHash("sha256").update(payload).digest("hex");
}

export type S3SignatureInput = {
  method: string;
  url: URL;
  headers?: Record<string, string>;
  payloadSha256Hex: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  now: Date;
};

/** Shared, deterministic S3 SigV4 mechanics. Callers retain their own policy and credential inputs. */
export function signS3RequestHeaders(input: S3SignatureInput): Record<string, string> {
  const dateTime = input.now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
  const date = dateTime.slice(0, 8);
  const headers: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(input.headers ?? {}).map(([name, value]) => [
        name.toLowerCase(),
        value.trim(),
      ]),
    ),
    host: input.url.host,
    "x-amz-content-sha256": input.payloadSha256Hex,
    "x-amz-date": dateTime,
  };
  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers[name]}\n`).join("");
  const signedHeaders = signedHeaderNames.join(";");
  const canonicalRequest = [
    input.method,
    input.url.pathname || "/",
    "",
    canonicalHeaders,
    signedHeaders,
    input.payloadSha256Hex,
  ].join("\n");
  const hashCanonical = createHash("sha256").update(canonicalRequest).digest("hex");
  const scope = `${date}/${input.region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", dateTime, scope, hashCanonical].join("\n");
  const hmac = (key: Buffer | string, data: string): Buffer =>
    createHmac("sha256", key).update(data).digest();
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, date), input.region), "s3"),
    "aws4_request",
  );
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");

  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}
