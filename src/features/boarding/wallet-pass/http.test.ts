// @vitest-environment node
import { and, eq } from "drizzle-orm";
import { strFromU8, unzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { issueBookingCapability } from "@/db/booking-capabilities";
import { bookings, shops, trips, walletPasses } from "@/db/schema";
import { fileScopedShopContext } from "@/test/db";
import { generateWalletTestCredentials } from "@/test/wallet-credentials";
import { appleServiceResponse, walletDepartureResponse, walletUrlForToken } from "./http";

vi.mock("@/i18n/request", () => ({ requestLocale: async () => "es-ES" }));
const ctx = fileScopedShopContext();
const credentials = generateWalletTestCredentials();
beforeEach(() => {
  vi.stubEnv("APPLE_PASS_TYPE_ID", "pass.app.diveday.test");
  vi.stubEnv("APPLE_TEAM_ID", "TESTTEAM01");
  vi.stubEnv("APPLE_PASS_CERTIFICATE_PEM", credentials.certificate);
  vi.stubEnv("APPLE_PASS_KEY_PEM", credentials.key);
  vi.stubEnv("APP_HOST", "https://test.invalid");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function capability() {
  const [booking] = await ctx.db
    .select({ id: bookings.id })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(bookings.shopId, ctx.shop.id),
        eq(bookings.status, "booked"),
        eq(trips.status, "scheduled"),
      ),
    )
    .limit(1);
  const issued = await issueBookingCapability(ctx.db, {
    shopId: ctx.shop.id,
    bookingId: booking.id,
    purpose: "readiness",
    delivered: true,
  });
  if (!issued) throw new Error("expected readiness capability");
  return { token: issued.token, bookingId: booking.id };
}
const request = (agent = "") =>
  new Request("https://test.invalid/ready/redacted/wallet", { headers: { "User-Agent": agent } });

describe("capability-scoped Wallet routes", () => {
  it("is completely dark with no credential, including the PassKit API and invalid tokens", async () => {
    vi.stubEnv("APPLE_PASS_KEY_PEM", "");
    vi.stubEnv("GOOGLE_WALLET_ISSUER_ID", "");
    expect(walletUrlForToken("private-token")).toBeUndefined();
    expect((await walletDepartureResponse(ctx.db, request(), "private-token")).status).toBe(404);
    expect((await appleServiceResponse(ctx.db, request(), {}, "log")).status).toBe(404);
  });
  it("gates the link on configuration and the shop switch, and refuses a wrong capability", async () => {
    expect(walletUrlForToken("private-token")).toBe("/ready/private-token/wallet");
    expect(walletUrlForToken("private-token", false)).toBeUndefined();
    expect((await walletDepartureResponse(ctx.db, request(), "wrong-token", "apple")).status).toBe(
      404,
    );
    const { token } = await capability();
    await ctx.db.update(shops).set({ walletPassesEnabled: false }).where(eq(shops.id, ctx.shop.id));
    expect((await walletDepartureResponse(ctx.db, request(), token, "apple")).status).toBe(404);
  });
  it("selects iPhone or a safe fallback and downloads a signed localized archive without leaking the capability", async () => {
    const { token, bookingId } = await capability();
    const selected = await walletDepartureResponse(ctx.db, request("iPhone Safari"), token);
    expect(selected.status).toBe(302);
    expect(selected.headers.get("Location")).toBe(`/ready/${token}/wallet/apple`);
    const fallback = await walletDepartureResponse(ctx.db, request("Linux"), token);
    expect(fallback.status).toBe(200);
    expect(await fallback.text()).toContain("Agregar a Apple Wallet");
    const downloaded = await walletDepartureResponse(
      ctx.db,
      request("iPhone Safari"),
      token,
      "apple",
    );
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers.get("Content-Type")).toBe("application/vnd.apple.pkpass");
    expect(downloaded.headers.get("Cache-Control")).toContain("no-store");
    expect(downloaded.headers.get("Referrer-Policy")).toBe("no-referrer");
    const files = unzipSync(new Uint8Array(await downloaded.arrayBuffer()));
    const document = strFromU8(files["pass.json"]);
    expect(document).toContain(ctx.shop.name);
    expect(document).not.toContain(token);
    expect(document).not.toContain(bookingId);
    const [pass] = await ctx.db
      .select()
      .from(walletPasses)
      .where(eq(walletPasses.bookingId, bookingId));
    expect(pass.locale).toBe("es-ES");
    const before = JSON.stringify(pass.contentJson);
    expect(before).not.toContain("http");
  });
  it("never forwards arbitrary Apple device log bodies into telemetry", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const body = "authenticationToken=private-secret /ready/another-secret";
    expect(
      (
        await appleServiceResponse(
          ctx.db,
          new Request("https://test.invalid/api/wallet/v1/log", { method: "POST", body }),
          {},
          "log",
        )
      ).status,
    ).toBe(200);
    expect(JSON.stringify(spy.mock.calls)).not.toContain("private-secret");
    expect(JSON.stringify(spy.mock.calls)).not.toContain("another-secret");
    spy.mockRestore();
  });
});
