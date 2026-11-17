import { describe, expect, it } from "vitest";
import { signS3RequestHeaders } from "./s3-signing";

const base = {
  method: "GET",
  payloadSha256Hex: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "secret",
  region: "us-east-1",
  now: new Date("2026-07-21T13:30:00.000Z"),
};

const sign = (url: string) => signS3RequestHeaders({ ...base, url: new URL(url) }).authorization;

describe("signS3RequestHeaders", () => {
  it("signs the query string, so a different query is a different signature", () => {
    const plain = sign("https://bucket.s3.amazonaws.com/key");
    expect(sign("https://bucket.s3.amazonaws.com/key?versionId=1")).not.toBe(plain);
    expect(sign("https://bucket.s3.amazonaws.com/key?versionId=1")).not.toBe(
      sign("https://bucket.s3.amazonaws.com/key?versionId=2"),
    );
  });

  it("sorts the query, so parameter order does not change the signature", () => {
    expect(sign("https://bucket.s3.amazonaws.com/?prefix=a&list-type=2")).toBe(
      sign("https://bucket.s3.amazonaws.com/?list-type=2&prefix=a"),
    );
  });
});
