import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { z } from "zod";
import { log } from "@/lib/log";
import type { NotificationEnvironment } from "./provider";

/**
 * Reading a received message's bytes out of the inbound bucket (ADR
 * 20260907-two-way-inbox). SES's receipt rule writes the raw RFC 5322 message
 * to S3 and tells the app *where* through SNS; this is the one place the app
 * goes and gets it.
 *
 * The SES sender's own credentials are reused — the stack grants that user
 * `s3:GetObject` on this one bucket beside its `ses:SendEmail` — so inbound
 * mail costs no new key. The bucket name is configuration, and a notification
 * naming any *other* bucket is refused before a request is made: the envelope
 * is signed by SNS, but the bucket it names is still data, and reading from a
 * bucket the stack did not provision on the strength of a message is the SSRF
 * shape `sns.ts` refuses for certificate URLs.
 */

/**
 * SES refuses messages over 40 MB, and a reply a person typed is a few KB.
 * The cap bounds what this will pull through memory for one webhook call —
 * anything larger is a forwarded thread of attachments, recorded as arrived
 * and not read.
 */
export const MAX_INBOUND_MESSAGE_BYTES = 2 * 1024 * 1024;

export interface InboundMailObjectClient {
  send(command: GetObjectCommand): Promise<{
    /**
     * `destroy` is optional and present on the real SDK's stream: a body we
     * decline to read on the `ContentLength` path would otherwise hold its
     * socket until the agent times it out, and whoever holds a shop's reply
     * address decides how many oversized messages arrive. The fakes in
     * `inbound-mail-store.test.ts` may omit it.
     */
    Body?: { transformToByteArray(): Promise<Uint8Array>; destroy?(): void } | null;
    ContentLength?: number;
  }>;
}

export type InboundMailRead =
  | { status: "ok"; message: string }
  /** Recorded as arrived and not read — see MAX_INBOUND_MESSAGE_BYTES. */
  | { status: "too_large" }
  /** Missing, forbidden, or the network: worth SNS's handful of retries. */
  | { status: "failed" };

export type InboundMailStore = {
  bucketName: string;
  read(objectKey: string): Promise<InboundMailRead>;
};

const configSchema = z.object({
  region: z.string().trim().min(1),
  bucketName: z.string().trim().min(1),
  accessKeyId: z.string().trim().min(1),
  secretAccessKey: z.string().trim().min(1),
});

/**
 * The store from the environment, or null when inbound mail is not configured
 * — the route answers 503 then, exactly as it does for a missing topic ARN.
 */
export function inboundMailStoreFromEnvironment(
  env: NotificationEnvironment = process.env,
  client?: InboundMailObjectClient,
): InboundMailStore | null {
  const config = configSchema.safeParse({
    region: env.SES_AWS_REGION,
    bucketName: env.EMAIL_INBOUND_S3_BUCKET,
    accessKeyId: env.SES_AWS_ACCESS_KEY_ID,
    secretAccessKey: env.SES_AWS_SECRET_ACCESS_KEY,
  });
  if (!config.success) return null;
  const s3: InboundMailObjectClient =
    client ??
    new S3Client({
      region: config.data.region,
      credentials: {
        accessKeyId: config.data.accessKeyId,
        secretAccessKey: config.data.secretAccessKey,
      },
    });
  return inboundMailStore(config.data.bucketName, s3);
}

export function inboundMailStore(
  bucketName: string,
  client: InboundMailObjectClient,
): InboundMailStore {
  return {
    bucketName,
    async read(objectKey) {
      try {
        const result = await client.send(
          new GetObjectCommand({ Bucket: bucketName, Key: objectKey }),
        );
        if (
          result.ContentLength !== undefined &&
          result.ContentLength > MAX_INBOUND_MESSAGE_BYTES
        ) {
          log("email_inbound.message_too_large", "warn", { bytes: result.ContentLength });
          // Abandoning the body holds its socket until the agent times out, and
          // whoever holds the shop's reply address chooses how many of these
          // arrive. Release it rather than leaving it to a timeout.
          result.Body?.destroy?.();
          return { status: "too_large" };
        }
        const bytes = await result.Body?.transformToByteArray();
        if (!bytes) return { status: "failed" };
        if (bytes.byteLength > MAX_INBOUND_MESSAGE_BYTES) {
          log("email_inbound.message_too_large", "warn", { bytes: bytes.byteLength });
          return { status: "too_large" };
        }
        return { status: "ok", message: Buffer.from(bytes).toString("utf8") };
      } catch (error) {
        // The key is SES's opaque message id, safe to log; the bucket is ours.
        log("email_inbound.read_failed", "warn", {
          objectKey,
          errorCode: error instanceof Error ? error.name : "unknown_error",
        });
        return { status: "failed" };
      }
    },
  };
}
