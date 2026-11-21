import { createPrivateKey, X509Certificate } from "node:crypto";
import { authSecret } from "@/lib/auth-secret";
import { publicAppUrl } from "@/lib/notifications";
import type { WalletPlatform } from "@/lib/wallet-passes";

export function appleCredentials(env: Partial<NodeJS.ProcessEnv> = process.env) {
  const passTypeIdentifier = env.APPLE_PASS_TYPE_ID?.trim();
  const teamIdentifier = env.APPLE_TEAM_ID?.trim();
  const signerCert = env.APPLE_PASS_CERTIFICATE_PEM?.trim();
  const signerKey = env.APPLE_PASS_KEY_PEM?.trim();
  if (!passTypeIdentifier || !teamIdentifier || !signerCert || !signerKey) return null;
  try {
    const certificate = new X509Certificate(signerCert);
    const key = createPrivateKey({
      key: signerKey,
      passphrase: env.APPLE_PASS_KEY_PASSPHRASE || undefined,
    });
    if (!certificate.checkPrivateKey(key)) return null;
  } catch {
    return null;
  }
  return {
    passTypeIdentifier,
    teamIdentifier,
    signerCert,
    signerKey,
    signerKeyPassphrase: env.APPLE_PASS_KEY_PASSPHRASE || undefined,
  };
}

export function googleCredentials(env: Partial<NodeJS.ProcessEnv> = process.env) {
  const issuerId = env.GOOGLE_WALLET_ISSUER_ID?.trim();
  if (!issuerId || !env.GOOGLE_WALLET_SERVICE_ACCOUNT_JSON?.trim()) return null;
  try {
    const key: unknown = JSON.parse(env.GOOGLE_WALLET_SERVICE_ACCOUNT_JSON);
    if (
      !key ||
      typeof key !== "object" ||
      !("client_email" in key) ||
      !("private_key" in key) ||
      typeof key.client_email !== "string" ||
      typeof key.private_key !== "string" ||
      !key.client_email ||
      !key.private_key
    )
      return null;
    if (createPrivateKey(key.private_key).asymmetricKeyType !== "rsa") return null;
    return { issuerId, clientEmail: key.client_email, privateKey: key.private_key };
  } catch {
    return null;
  }
}

/** ADR 20260907-nothing-from-nowhere: incomplete credentials keep each platform dark. */
export function configuredWalletPlatforms(
  env: Partial<NodeJS.ProcessEnv> = process.env,
): readonly WalletPlatform[] {
  const platforms: WalletPlatform[] = [];
  if (appleCredentials(env) && authSecret && walletOrigin(env)) platforms.push("apple");
  if (googleCredentials(env)) platforms.push("google");
  return platforms;
}

export function walletOrigin(env: Partial<NodeJS.ProcessEnv> = process.env): string | null {
  const origin = publicAppUrl(env);
  return origin?.startsWith("https://") ? origin : null;
}
