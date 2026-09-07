import { describe, expect, it, vi } from "vitest";
import {
  inboundMailStore,
  inboundMailStoreFromEnvironment,
  MAX_INBOUND_MESSAGE_BYTES,
} from "./inbound-mail-store";

function client(body: string | null, contentLength?: number, fail = false) {
  return {
    send: vi.fn().mockImplementation(async () => {
      if (fail) throw Object.assign(new Error("denied"), { name: "AccessDenied" });
      return {
        ContentLength: contentLength,
        Body:
          body === null
            ? null
            : { transformToByteArray: async () => new Uint8Array(Buffer.from(body, "utf8")) },
      };
    }),
  };
}

describe("inboundMailStore", () => {
  it("reads the object by key from the configured bucket", async () => {
    const s3 = client("From: a@example.com\r\n\r\nhi");
    const store = inboundMailStore("diveday-inbound-mail", s3);
    await expect(store.read("mail/abc")).resolves.toEqual({
      status: "ok",
      message: "From: a@example.com\r\n\r\nhi",
    });
    const command = s3.send.mock.calls[0]?.[0] as { input: { Bucket: string; Key: string } };
    expect(command.input).toEqual({ Bucket: "diveday-inbound-mail", Key: "mail/abc" });
  });

  it("refuses an oversized message by declared length and by measured length", async () => {
    const declared = inboundMailStore("b", client("x", MAX_INBOUND_MESSAGE_BYTES + 1));
    await expect(declared.read("k")).resolves.toEqual({ status: "too_large" });
    const measured = inboundMailStore("b", client("x".repeat(MAX_INBOUND_MESSAGE_BYTES + 1)));
    await expect(measured.read("k")).resolves.toEqual({ status: "too_large" });
  });

  it("reports a failed read and an empty body without throwing", async () => {
    await expect(inboundMailStore("b", client(null)).read("k")).resolves.toEqual({
      status: "failed",
    });
    await expect(inboundMailStore("b", client("x", undefined, true)).read("k")).resolves.toEqual({
      status: "failed",
    });
  });
});

describe("inboundMailStoreFromEnvironment", () => {
  it("is null unless the bucket and the SES credentials are all present", () => {
    expect(inboundMailStoreFromEnvironment({})).toBeNull();
    expect(
      inboundMailStoreFromEnvironment({
        SES_AWS_REGION: "us-east-1",
        SES_AWS_ACCESS_KEY_ID: "k",
        SES_AWS_SECRET_ACCESS_KEY: "s",
      }),
    ).toBeNull();
    const store = inboundMailStoreFromEnvironment(
      {
        SES_AWS_REGION: "us-east-1",
        SES_AWS_ACCESS_KEY_ID: "k",
        SES_AWS_SECRET_ACCESS_KEY: "s",
        EMAIL_INBOUND_S3_BUCKET: " diveday-inbound-mail ",
      },
      client("x"),
    );
    expect(store?.bucketName).toBe("diveday-inbound-mail");
  });
});
