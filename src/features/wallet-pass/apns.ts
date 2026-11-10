import { connect } from "node:http2";
import { appleCredentials } from "./config";

/** Certificate-authenticated PassKit push. The notification deliberately contains no facts. */
export async function pushAppleDevice(pushToken: string): Promise<number> {
  const credentials = appleCredentials();
  if (!credentials) throw new Error("apple_wallet_unconfigured");
  return new Promise((resolve, reject) => {
    const client = connect("https://api.push.apple.com:443", {
      cert: credentials.signerCert,
      key: credentials.signerKey,
      passphrase: credentials.signerKeyPassphrase,
    });
    const finish = (status?: number) => {
      client.close();
      if (status) resolve(status);
      else reject(new Error("wallet_apple_push_failed"));
    };
    client.setTimeout(8000, () => {
      client.destroy();
      reject(new Error("wallet_apple_push_timeout"));
    });
    client.once("error", () => {
      client.destroy();
      reject(new Error("wallet_apple_push_failed"));
    });
    const request = client.request({
      ":method": "POST",
      ":path": `/3/device/${encodeURIComponent(pushToken)}`,
      "apns-topic": credentials.passTypeIdentifier,
      "apns-push-type": "background",
      "apns-priority": "5",
    });
    request.once("response", (headers) => {
      request.resume();
      request.once("end", () => finish(Number(headers[":status"])));
    });
    request.once("error", () => finish());
    request.end("{}");
  });
}
