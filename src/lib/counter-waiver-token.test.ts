import { afterEach, expect, it, vi } from "vitest";
import { nowDate } from "@/lib/clock";
import { openCounterWaiverToken, sealCounterWaiverToken } from "./counter-waiver-token";
import { sealSecret, secretKeyFromEnvironment } from "./secret-box";

afterEach(() => vi.unstubAllEnvs());
it("binds an opaque counter envelope to its purpose and own expiry", () => {
  vi.stubEnv("SECRET_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  const expiresAt = new Date(nowDate().getTime() + 60_000);
  const token = "underlying-waiver-secret";
  const envelope = sealCounterWaiverToken(token, expiresAt);
  if (!envelope) throw new Error("sealing failed");
  expect(envelope).not.toContain(token);
  expect(openCounterWaiverToken(envelope)).toBe(token);
  expect(openCounterWaiverToken(envelope, expiresAt)).toBeNull();
  expect(openCounterWaiverToken(`${envelope}tampered`)).toBeNull();
  const key = secretKeyFromEnvironment();
  if (key.status !== "ok") throw new Error("key missing");
  const wrongPurpose = `counter_${sealSecret(JSON.stringify({ purpose: "another-purpose", token, expiresAt: expiresAt.toISOString() }), key.key)}`;
  expect(openCounterWaiverToken(wrongPurpose)).toBeNull();
  vi.stubEnv("SECRET_ENCRYPTION_KEY", "");
  expect(openCounterWaiverToken(envelope)).toBeNull();
  expect(sealCounterWaiverToken(token, expiresAt)).toBeNull();
});
