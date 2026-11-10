import { DIVEDAY_BRAND_COLOR } from "@/lib/brand";
// @vitest-environment node

import { execFileSync } from "node:child_process";
import { createHash, verify } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateWalletTestCredentials, walletContentFixture } from "@/test/wallet-credentials";
import { applePassBytes } from "./apple";
import { googlePassSaveUrl } from "./google";

const credentials = generateWalletTestCredentials();
afterEach(() => vi.unstubAllEnvs());

describe("native signatures", () => {
  it("signs every Apple archive file with a detached verifiable PKCS7 manifest, without a barcode", () => {
    vi.stubEnv("APPLE_PASS_TYPE_ID", "pass.app.diveday.test");
    vi.stubEnv("APPLE_TEAM_ID", "TESTTEAM01");
    vi.stubEnv("APPLE_PASS_CERTIFICATE_PEM", credentials.certificate);
    vi.stubEnv("APPLE_PASS_KEY_PEM", credentials.key);
    vi.stubEnv("APP_HOST", "https://test.invalid");
    const content = walletContentFixture();
    const files = unzipSync(applePassBytes("generated-serial", content));
    const manifest = JSON.parse(strFromU8(files["manifest.json"]));
    const document = JSON.parse(strFromU8(files["pass.json"]));
    expect(Object.keys(manifest).sort()).toEqual(
      Object.keys(files)
        .filter((name) => !["manifest.json", "signature"].includes(name))
        .sort(),
    );
    for (const [name, digest] of Object.entries(manifest))
      expect(createHash("sha1").update(files[name]).digest("hex")).toBe(digest);
    expect(document.webServiceURL).toBe("https://test.invalid/api/wallet");
    expect(document.logoText).toBe(content.shopName);
    expect(document).not.toHaveProperty("barcode");
    expect(document).not.toHaveProperty("barcodes");
    const directory = mkdtempSync(join(tmpdir(), "diveday-pass-signature-"));
    try {
      writeFileSync(join(directory, "manifest"), files["manifest.json"]);
      writeFileSync(join(directory, "signature"), files.signature);
      const verified = execFileSync(
        "openssl",
        [
          "smime",
          "-verify",
          "-inform",
          "DER",
          "-in",
          join(directory, "signature"),
          "-content",
          join(directory, "manifest"),
          "-noverify",
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      expect(verified).toEqual(Buffer.from(files["manifest.json"]));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it("signs Google's full branded generic object with RS256 and no links or barcode", () => {
    vi.stubEnv("GOOGLE_WALLET_ISSUER_ID", "12345");
    vi.stubEnv(
      "GOOGLE_WALLET_SERVICE_ACCOUNT_JSON",
      JSON.stringify({ client_email: "generated@test.invalid", private_key: credentials.key }),
    );
    const url = googlePassSaveUrl(
      "12345.generated",
      walletContentFixture(),
      new Date("2026-07-20T00:00:00Z"),
      "en-US",
    );
    const jwt = url.split("/").at(-1) ?? "";
    const [header, payload, signature] = jwt.split(".");
    expect(
      verify(
        "RSA-SHA256",
        Buffer.from(`${header}.${payload}`),
        credentials.publicKey,
        Buffer.from(signature, "base64url"),
      ),
    ).toBe(true);
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString());
    expect(parsed.payload.genericObjects).toHaveLength(1);
    expect(parsed.payload.genericObjects[0]).toMatchObject({
      hexBackgroundColor: DIVEDAY_BRAND_COLOR,
      state: "ACTIVE",
      classId: "12345.diveday-departure",
    });
    expect(parsed.payload.genericObjects[0]).not.toHaveProperty("barcode");
    expect(parsed.payload.genericObjects[0]).not.toHaveProperty("linksModuleData");
  });
});
