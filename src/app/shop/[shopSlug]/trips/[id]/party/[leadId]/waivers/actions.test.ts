import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireShopSurface: vi.fn() }));
vi.mock("@/lib/notifications/app-url", () => ({ publicAppUrl: () => "https://diveday.test" }));
vi.mock("@/db/party-waiver-queue", () => ({ issuePartyWaiver: vi.fn() }));
const { requireShopSurface } = await import("@/lib/session");
const { issuePartyWaiver } = await import("@/db/party-waiver-queue");
const { issuePartyWaiverQrAction } = await import("./actions");
const tripId = "33333333-3333-4333-8333-333333333333";
const leadId = "44444444-4444-4444-8444-444444444444";
const bookingId = "55555555-5555-4555-8555-555555555555";

describe("party waiver QR action", () => {
  it("gates each issue through shop staff and returns only an image", async () => {
    vi.mocked(requireShopSurface).mockResolvedValue({
      db: {},
      shop: { id: "shop" },
      session: { user: { personId: "staffer" } },
    } as never);
    vi.mocked(issuePartyWaiver).mockResolvedValue({
      token: "secret-credential",
      expiresAt: new Date(),
    } as never);
    const result = await issuePartyWaiverQrAction("shop", tripId, leadId, bookingId);
    expect(requireShopSurface).toHaveBeenCalledWith("shop");
    expect(issuePartyWaiver).toHaveBeenCalledWith(expect.anything(), {
      shopId: "shop",
      tripId,
      leadBookingId: leadId,
      bookingId,
      actorPersonId: "staffer",
      replace: false,
      guardianPresent: false,
    });
    expect(result).toMatchObject({
      ok: true,
      qr: expect.stringMatching(/^data:image\/png;base64,/),
    });
    expect(JSON.stringify(result)).not.toContain("secret-credential");
    expect(await issuePartyWaiverQrAction("shop", tripId, leadId, "invalid")).toEqual({
      ok: false,
    });
    // A code open on the diver's phone is kept, and replaced only on a confirmed `true`.
    vi.mocked(issuePartyWaiver).mockResolvedValue({ openOnPhone: true } as never);
    expect(await issuePartyWaiverQrAction("shop", tripId, leadId, bookingId)).toEqual({
      ok: false,
      openOnPhone: true,
    });
    await issuePartyWaiverQrAction("shop", tripId, leadId, bookingId, "true");
    expect(issuePartyWaiver).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ replace: false }),
    );
    await issuePartyWaiverQrAction("shop", tripId, leadId, bookingId, true);
    expect(issuePartyWaiver).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ replace: true }),
    );
    // A minor's code waits on the desk; only a literal `true` says a guardian is here (#3986).
    vi.mocked(issuePartyWaiver).mockResolvedValue({ guardianCheck: true } as never);
    expect(await issuePartyWaiverQrAction("shop", tripId, leadId, bookingId)).toEqual({
      ok: false,
      guardianCheck: true,
    });
    await issuePartyWaiverQrAction("shop", tripId, leadId, bookingId, false, "true");
    expect(issuePartyWaiver).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ guardianPresent: false }),
    );
    await issuePartyWaiverQrAction("shop", tripId, leadId, bookingId, false, true);
    expect(issuePartyWaiver).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ guardianPresent: true }),
    );
    vi.mocked(issuePartyWaiver).mockResolvedValue(null);
    expect(await issuePartyWaiverQrAction("shop", tripId, leadId, bookingId)).toEqual({
      ok: false,
    });
  });
});
