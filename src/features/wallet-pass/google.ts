import { createSign } from "node:crypto";
import { nowDate } from "@/lib/clock";
import type { PassContent } from "@/lib/wallet-passes";
import { googleCredentials } from "./config";

export function signWalletJwt(payload: object, key: string): string {
  const input = [{ alg: "RS256", typ: "JWT" }, payload]
    .map((part) => Buffer.from(JSON.stringify(part)).toString("base64url"))
    .join(".");
  return `${input}.${createSign("RSA-SHA256").update(input).sign(key, "base64url")}`;
}

export function googlePassObject(
  objectId: string,
  content: PassContent,
  issuedAt: Date,
  locale: string,
) {
  const credentials = googleCredentials();
  if (!credentials) throw new Error("google_wallet_unconfigured");
  const localized = (value: string) => ({ defaultValue: { language: locale, value } });
  return {
    id: objectId,
    classId: `${credentials.issuerId}.diveday-departure`,
    cardTitle: localized(content.shopName),
    header: localized(content.primaryFields[0]?.value ?? content.description),
    subheader: localized(content.secondaryFields[0]?.value ?? ""),
    textModulesData: [
      ...content.headerFields,
      ...content.secondaryFields.slice(1),
      ...content.auxiliaryFields,
      ...content.backFields,
    ].map((field) => ({
      id: field.key,
      ...(field.label ? { header: field.label } : {}),
      body: field.value,
    })),
    hexBackgroundColor: content.hexBackgroundColor,
    state: content.voided ? "INACTIVE" : "ACTIVE",
    validTimeInterval: {
      start: { date: issuedAt.toISOString() },
      end: { date: content.expirationDate },
    },
  };
}

export function googlePassSaveUrl(
  objectId: string,
  content: PassContent,
  issuedAt: Date,
  locale: string,
): string {
  const credentials = googleCredentials();
  if (!credentials) throw new Error("google_wallet_unconfigured");
  const jwt = signWalletJwt(
    {
      iss: credentials.clientEmail,
      aud: "google",
      typ: "savetowallet",
      iat: Math.floor(nowDate().getTime() / 1000),
      payload: { genericObjects: [googlePassObject(objectId, content, issuedAt, locale)] },
    },
    credentials.privateKey,
  );
  return `https://pay.google.com/gp/v/save/${jwt}`;
}

async function googleAccessToken(): Promise<string> {
  const credentials = googleCredentials();
  if (!credentials) throw new Error("google_wallet_unconfigured");
  const iat = Math.floor(nowDate().getTime() / 1000);
  const assertion = signWalletJwt(
    {
      iss: credentials.clientEmail,
      scope: "https://www.googleapis.com/auth/wallet_object.issuer",
      aud: "https://oauth2.googleapis.com/token",
      iat,
      exp: iat + 3600,
    },
    credentials.privateKey,
  );
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error("wallet_google_auth_failed");
  const result: unknown = await response.json();
  if (
    !result ||
    typeof result !== "object" ||
    !("access_token" in result) ||
    typeof result.access_token !== "string"
  )
    throw new Error("wallet_google_auth_failed");
  return result.access_token;
}

export async function ensureGoogleClass(): Promise<void> {
  const credentials = googleCredentials();
  if (!credentials) throw new Error("google_wallet_unconfigured");
  const accessToken = await googleAccessToken();
  const response = await fetch(
    "https://walletobjects.googleapis.com/walletobjects/v1/genericClass",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ id: `${credentials.issuerId}.diveday-departure` }),
      signal: AbortSignal.timeout(8000),
    },
  );
  if (!response.ok && response.status !== 409) throw new Error("wallet_google_class_failed");
}

export async function pushGoogleObject(
  objectId: string,
  content: PassContent,
  issuedAt: Date,
  locale: string,
): Promise<void> {
  const accessToken = await googleAccessToken();
  const object = googlePassObject(objectId, content, issuedAt, locale);
  const init = {
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(object),
    signal: AbortSignal.timeout(8000),
  };
  const response = await fetch(
    `https://walletobjects.googleapis.com/walletobjects/v1/genericObject/${encodeURIComponent(objectId)}`,
    { ...init, method: "PATCH" },
  );
  // A pass issued but not saved yet does not have an object at Google.
  if (response.status === 404) {
    const created = await fetch(
      "https://walletobjects.googleapis.com/walletobjects/v1/genericObject",
      { ...init, method: "POST" },
    );
    if (!created.ok && created.status !== 409) throw new Error("wallet_google_push_failed");
  } else if (!response.ok) throw new Error("wallet_google_push_failed");
}
