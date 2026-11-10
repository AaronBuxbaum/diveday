import { verifyBookingCapability } from "@/db/booking-capabilities";
import type { AppDb } from "@/db/client";
import { getShopById } from "@/db/shops";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { escapeHtml } from "@/lib/html";
import { log } from "@/lib/log";
import type { WalletPlatform } from "@/lib/wallet-passes";
import { configuredWalletPlatforms } from "./config";
import { walletPlatformForAgent } from "./rules";
import { applePassService } from "./service";
import { googleSaveUrl, issueWalletPass, renderApplePass } from "./store";

export const WALLET_HEADERS = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
};
const empty = (status: number) => new Response(null, { status, headers: WALLET_HEADERS });
const walletRedirect = (url: string) =>
  new Response(null, { status: 302, headers: { ...WALLET_HEADERS, Location: url } });

export function walletUrlForToken(token: string, enabled = true): string | undefined {
  return enabled && configuredWalletPlatforms().length
    ? `/ready/${encodeURIComponent(token)}/wallet`
    : undefined;
}

/** The capability authorizes only this booking, regardless of request body, query or headers. */
export async function walletDepartureResponse(
  db: AppDb,
  request: Request,
  token: string,
  platform?: WalletPlatform,
): Promise<Response> {
  const platforms = configuredWalletPlatforms();
  if (!platforms.length || (platform && !platforms.includes(platform))) return empty(404);
  try {
    const capability = await verifyBookingCapability(db, { token, purpose: "readiness" });
    if (!capability) return empty(404);
    const shop = await getShopById(db, capability.shopId);
    if (!shop?.walletPassesEnabled) return empty(404);
    const locale = await requestLocale(shop.defaultLocale);
    if (!platform) {
      const chosen = walletPlatformForAgent(request.headers.get("User-Agent") ?? "", platforms);
      const base = `/ready/${encodeURIComponent(token)}/wallet`;
      if (chosen) return walletRedirect(`${base}/${chosen}`);
      const t = diverTranslator(locale);
      const links = platforms
        .map(
          (name) =>
            `<p><a href="${escapeHtml(`${base}/${name}`)}">${escapeHtml(t(`wallet.${name}`))}</a></p>`,
        )
        .join("");
      return new Response(
        `<!doctype html><html lang="${escapeHtml(locale)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(t("wallet.choose"))}</title></head><body><main><h1>${escapeHtml(t("wallet.choose"))}</h1>${links}</main></body></html>`,
        {
          headers: {
            ...WALLET_HEADERS,
            "Content-Type": "text/html; charset=utf-8",
            "Content-Security-Policy":
              "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
          },
        },
      );
    }
    const pass = await issueWalletPass(db, {
      bookingId: capability.bookingId,
      shopId: capability.shopId,
      locale,
      platform,
    });
    if (!pass) return empty(404);
    if (platform === "google") {
      const url = await googleSaveUrl(db, pass.id);
      return url ? walletRedirect(url) : empty(404);
    }
    const rendered = await renderApplePass(db, pass.id);
    return rendered
      ? new Response(Buffer.from(rendered.bytes), {
          headers: {
            ...WALLET_HEADERS,
            "Content-Type": "application/vnd.apple.pkpass",
            "Content-Disposition": 'attachment; filename="departure.pkpass"',
          },
        })
      : empty(404);
  } catch {
    log("wallet_pass.request_failed", "error");
    return empty(503);
  }
}

export type AppleRouteParams = {
  deviceLibraryIdentifier?: string;
  passTypeIdentifier?: string;
  serialNumber?: string;
};
const identifier = (text: string | undefined) => !!text && /^[A-Za-z0-9._-]{1,256}$/.test(text);

/** One protocol boundary for all PassKit handlers. Raw device logs are deliberately discarded. */
export async function appleServiceResponse(
  db: AppDb,
  request: Request,
  params: AppleRouteParams,
  kind: "register" | "unregister" | "updated" | "latest" | "log",
): Promise<Response> {
  if (!configuredWalletPlatforms().includes("apple")) return empty(404);
  if (kind === "log") {
    log("wallet_pass.device_log_received", "info");
    return empty(200);
  }
  if (
    !identifier(params.passTypeIdentifier) ||
    (kind !== "latest" && !identifier(params.deviceLibraryIdentifier))
  )
    return empty(404);
  const token =
    /^ApplePass ([A-Za-z0-9_-]{16,256})$/i.exec(request.headers.get("Authorization") ?? "")?.[1] ??
    "";
  const identity = {
    passTypeIdentifier: params.passTypeIdentifier ?? "",
    serialNumber: params.serialNumber ?? "",
    token,
  };
  const registration = {
    ...identity,
    deviceLibraryIdentifier: params.deviceLibraryIdentifier ?? "",
  };
  try {
    if (kind === "register") {
      const body: unknown = await request.json().catch(() => null);
      if (
        !body ||
        typeof body !== "object" ||
        !("pushToken" in body) ||
        typeof body.pushToken !== "string" ||
        !/^[a-f0-9]{32,256}$/i.test(body.pushToken)
      )
        return empty(400);
      return empty(
        await applePassService.register(db, { ...registration, pushToken: body.pushToken }),
      );
    }
    if (kind === "unregister") return empty(await applePassService.unregister(db, registration));
    if (kind === "updated") {
      const result = await applePassService.updatedSince(db, {
        ...registration,
        passesUpdatedSince:
          new URL(request.url).searchParams.get("passesUpdatedSince") ?? undefined,
      });
      return result === 204 ? empty(204) : Response.json(result, { headers: WALLET_HEADERS });
    }
    const since = request.headers.get("If-Modified-Since");
    const parsed = since ? new Date(since) : undefined;
    const result = await applePassService.latest(db, {
      ...identity,
      ifModifiedSince: parsed && Number.isFinite(parsed.getTime()) ? parsed : undefined,
    });
    return typeof result === "number"
      ? empty(result)
      : new Response(Buffer.from(result.bytes), {
          headers: {
            ...WALLET_HEADERS,
            "Content-Type": "application/vnd.apple.pkpass",
            "Last-Modified": result.lastModified.toUTCString(),
          },
        });
  } catch {
    log("wallet_pass.request_failed", "error");
    return empty(503);
  }
}
