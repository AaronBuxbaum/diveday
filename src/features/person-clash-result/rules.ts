import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { authSecret } from "@/lib/auth-secret";
import { nowMs } from "@/lib/clock";
import { deriveLabelKey } from "@/lib/signed-token";

type Clash = { personName: string; otherTitle: string };
const PURPOSE = "person-clash-result-v1";
const MAX_AGE = 120_000;

function key() {
  if (!authSecret) throw new Error("AUTH_SECRET is required for person clash results.");
  return deriveLabelKey(authSecret, "diveday-person-clash-result");
}

/** Preserve the transaction's facts across a redirect without putting names in a URL. */
export function sealPersonClashResult(shopId: string, tripId: string, clashes: readonly Clash[]) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const included: Clash[] = [];
  for (const clash of clashes) {
    const candidate = [...included, clash];
    if (Buffer.byteLength(JSON.stringify(candidate), "utf8") > 4000) break;
    included.push(clash);
  }
  const body = JSON.stringify({
    purpose: PURPOSE,
    shopId,
    tripId,
    issuedAt: nowMs(),
    clashes: included,
    omitted: clashes.length - included.length,
  });
  const encrypted = Buffer.concat([cipher.update(body, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
}

export function openPersonClashResult(
  token: string | undefined,
  shopId: string,
  tripId: string,
): { clashes: Clash[]; omitted: number } | null {
  if (
    !token ||
    token.length > 16384 ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)
  )
    return null;
  try {
    const parts = token.split(".");
    const decoded = parts.map((part) => Buffer.from(part, "base64url"));
    if (decoded.some((part, index) => part.toString("base64url") !== parts[index])) return null;
    const [iv, tag, body] = decoded;
    if (!iv || !tag || !body || iv.length !== 12 || tag.length !== 16) return null;
    const decipher = createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    const value: unknown = JSON.parse(
      Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8"),
    );
    if (!value || typeof value !== "object") return null;
    const data = value as {
      purpose?: unknown;
      shopId?: unknown;
      tripId?: unknown;
      issuedAt?: unknown;
      clashes?: unknown;
      omitted?: unknown;
    };
    if (
      data.purpose !== PURPOSE ||
      data.shopId !== shopId ||
      data.tripId !== tripId ||
      typeof data.issuedAt !== "number" ||
      !Number.isSafeInteger(data.issuedAt) ||
      nowMs() - data.issuedAt > MAX_AGE ||
      data.issuedAt - nowMs() > 30_000 ||
      !Array.isArray(data.clashes) ||
      typeof data.omitted !== "number" ||
      !Number.isSafeInteger(data.omitted) ||
      data.omitted < 0
    )
      return null;
    if (
      !data.clashes.every(
        (row: unknown) =>
          row &&
          typeof row === "object" &&
          typeof (row as Clash).personName === "string" &&
          typeof (row as Clash).otherTitle === "string",
      )
    )
      return null;
    return { clashes: data.clashes, omitted: data.omitted };
  } catch {
    return null;
  }
}
