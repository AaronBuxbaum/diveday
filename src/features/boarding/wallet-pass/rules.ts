import { createHash, createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { authSecret } from "@/lib/auth-secret";
import { hashBearerToken } from "@/lib/bearer-tokens";
import { DIVEDAY_BRAND_COLOR, deriveBrandTheme } from "@/lib/brand";
import { DAY_MS } from "@/lib/clock";
import { dockCallAt } from "@/lib/dock-call";
import { formatDateWithYear, formatTimeTz } from "@/lib/format";
import type { PassContent, PassField } from "@/lib/wallet-passes";

export type PassLabels = Record<
  | "date"
  | "dockCall"
  | "departs"
  | "boat"
  | "diver"
  | "meetingPlace"
  | "crew"
  | "sites"
  | "phone"
  | "plan"
  | "description",
  string
>;
export type PassContentInput = {
  shopName: string;
  title: string;
  diverName: string;
  locale: string;
  timeZone: string;
  startsAt: Date;
  endsAt: Date;
  dockCallMinutes: number;
  brandColor: string | null;
  boat: string | null;
  meetingPlace: string | null;
  crew: readonly string[];
  sites: readonly string[];
  phone: string | null;
  stage: string | null;
  voided: boolean;
  labels: PassLabels;
};

const rgb = (hex: string) =>
  `rgb(${[1, 3, 5].map((n) => Number.parseInt(hex.slice(n, n + 2), 16)).join(", ")})`;
// A pass gets shown around. Free-text fields never turn into links or capability URLs.
const safeText = (text: string) =>
  text.replace(/(?:https?:\/\/|www\.)\S+|\/(?:ready|waivers|recap)\/\S+/gi, "").trim();

export function buildPassContent(input: PassContentInput): PassContent {
  const theme = deriveBrandTheme(input.brandColor ?? DIVEDAY_BRAND_COLOR);
  const dockCall = dockCallAt(input.startsAt, input.dockCallMinutes) ?? input.startsAt;
  const field = (key: keyof PassLabels, value: string | null): PassField[] =>
    value && safeText(value) ? [{ key, label: input.labels[key], value: safeText(value) }] : [];
  return {
    shopName: safeText(input.shopName),
    description: input.labels.description,
    headerFields: input.stage ? [{ key: "stage", label: "", value: input.stage }] : [],
    primaryFields: [{ key: "departure", label: "", value: safeText(input.title) }],
    secondaryFields: [
      ...field("date", formatDateWithYear(input.startsAt, input.locale, input.timeZone)),
      ...field("dockCall", formatTimeTz(dockCall, input.locale, input.timeZone)),
      ...field("departs", formatTimeTz(input.startsAt, input.locale, input.timeZone)),
    ],
    auxiliaryFields: [...field("boat", input.boat), ...field("diver", input.diverName)],
    backFields: [
      ...field("meetingPlace", input.meetingPlace),
      ...field("crew", input.crew.join(", ")),
      ...field("sites", input.sites.join(", ")),
      ...field("phone", input.phone),
      { key: "plan", label: "", value: input.labels.plan },
    ],
    relevantDate: dockCall.toISOString(),
    expirationDate: new Date(input.endsAt.getTime() + DAY_MS).toISOString(),
    backgroundColor: rgb(theme.primary),
    foregroundColor: rgb(theme.primaryForeground),
    hexBackgroundColor: theme.primary,
    voided: input.voided,
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  return JSON.stringify(value ?? null);
}

export const passContentHash = (content: PassContent) =>
  createHash("sha256").update(canonicalJson(content)).digest("hex");

/** Stable re-rendering without storing a bearer secret. Separate from every booking capability. */
export function passAuthenticationToken(passId: string): string {
  if (!authSecret) throw new Error("wallet_auth_unconfigured");
  const key = Buffer.from(hkdfSync("sha256", authSecret, "diveday", "wallet-pass-auth-v1", 32));
  return createHmac("sha256", key).update(passId).digest("base64url");
}

export function passTokenMatches(token: string, storedHash: string): boolean {
  const supplied = Buffer.from(hashBearerToken(token));
  const stored = Buffer.from(storedHash);
  return stored.length === supplied.length && timingSafeEqual(supplied, stored);
}

export function walletPlatformForAgent(agent: string, platforms: readonly ("apple" | "google")[]) {
  if (/android/i.test(agent) && platforms.includes("google")) return "google";
  const ios = /(iphone|ipad|ipod)/i.test(agent);
  const macSafari =
    /macintosh/i.test(agent) &&
    /safari/i.test(agent) &&
    !/(chrome|chromium|firefox|crios|fxios|edg|opr)/i.test(agent);
  if ((ios || macSafari) && platforms.includes("apple")) return "apple";
  return null;
}
