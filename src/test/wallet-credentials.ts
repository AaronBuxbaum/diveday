import { createRequire } from "node:module";
import { join } from "node:path";
import type { PassContent } from "@/lib/wallet-passes";

/** Test-only identities, generated in memory. No real issuer, certificate or saved key. */
export function generateWalletTestCredentials() {
  const rootRequire = createRequire(join(process.cwd(), "package.json"));
  const require = createRequire(rootRequire.resolve("passkit-generator"));
  const forge = require("node-forge");
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date("2026-01-01T00:00:00Z");
  cert.validity.notAfter = new Date("2036-01-01T00:00:00Z");
  const attributes = [{ name: "commonName", value: "DiveDay generated test only" }];
  cert.setSubject(attributes);
  cert.setIssuer(attributes);
  cert.setExtensions([
    { name: "basicConstraints", cA: true },
    { name: "keyUsage", keyCertSign: true, digitalSignature: true },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return {
    certificate: String(forge.pki.certificateToPem(cert)),
    key: String(forge.pki.privateKeyToPem(keys.privateKey)),
    publicKey: String(forge.pki.publicKeyToPem(keys.publicKey)),
  };
}

export function walletContentFixture(): PassContent {
  return {
    shopName: "Blue Mantis",
    description: "Your departure",
    headerFields: [],
    primaryFields: [{ key: "departure", label: "", value: "Two-Tank Reef" }],
    secondaryFields: [
      { key: "date", label: "Date", value: "Jul 21, 2026" },
      { key: "dockCall", label: "Dock call", value: "7:30 AM EDT" },
      { key: "departs", label: "Departs", value: "8:00 AM EDT" },
    ],
    auxiliaryFields: [{ key: "diver", label: "Diver", value: "Yara Test" }],
    backFields: [],
    relevantDate: "2026-07-21T11:30:00.000Z",
    expirationDate: "2026-07-22T16:00:00.000Z",
    backgroundColor: "rgb(0, 100, 210)",
    foregroundColor: "rgb(255, 255, 255)",
    hexBackgroundColor: "#0064d2",
    voided: false,
  };
}
