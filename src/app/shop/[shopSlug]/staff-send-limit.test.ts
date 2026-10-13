import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bookings, userAccounts } from "@/db/schema";
import { inviteStaffMember } from "@/db/staff-accounts";
import { fileScopedShopContext } from "@/test/db";
import {
  redirectedTo,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";

/**
 * **A staff member past the hourly send bound** (`RATE_LIMITS.staffSendByActor`)
 * on each of the one-tap sends to someone outside the shop: a fresh waiver
 * link, a reply to a diver, a staff invite and its resend, an invoice resend,
 * a departure's recaps and a note to everyone on a departure.
 *
 * Each is refused with words before anything is written or sent. The real gate
 * runs behind a mocked `auth()`; only the bucket's answer is forced.
 */

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: vi.fn() };
});
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, checkRateLimit: vi.fn() };
});
vi.mock("@/db/notifications", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/notifications")>();
  return { ...actual, sendNotification: vi.fn() };
});
vi.mock("@/db/staff-reply", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/staff-reply")>();
  return { ...actual, sendStaffReply: vi.fn() };
});
vi.mock("@/db/orders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/orders")>();
  return { ...actual, resendOrderInvoice: vi.fn() };
});
vi.mock("@/db/waiver-issue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/waiver-issue")>();
  return { ...actual, deliverWaiverBatch: vi.fn() };
});
vi.mock("@/db/recap", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/recap")>();
  return { ...actual, sendTripRecaps: vi.fn() };
});
vi.mock("@/db/held-sends", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/held-sends")>();
  return { ...actual, holdSend: vi.fn() };
});
vi.mock("@/db/waivers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/waivers")>();
  return { ...actual, retireMedicalRefusal: vi.fn() };
});

const { getDb } = await import("@/db/client");
const { auth } = await import("@/lib/auth");
const { checkRateLimit, RATE_LIMITS } = await import("@/lib/rate-limit");
const { sendNotification } = await import("@/db/notifications");
const { sendStaffReply } = await import("@/db/staff-reply");
const { resendOrderInvoice } = await import("@/db/orders");
const { deliverWaiverBatch } = await import("@/db/waiver-issue");
const { retireMedicalRefusal } = await import("@/db/waivers");
const { sendNewWaiverAction } = await import("./trips/[id]/actions");
const { replyToDiverAction } = await import("./divers/[personId]/details-actions");
const { inviteStaffAction, resendInviteAction } = await import("./settings/team/actions");
const { resendInvoiceAction } = await import("@/app/actions/invoices");
const { sendTripRecaps } = await import("@/db/recap");
const { holdSend } = await import("@/db/held-sends");
const { sendRecapAction } = await import("./actions");
const { holdDepartureNoteAction } = await import("./trips/[id]/departure-note-actions");

const ctx = fileScopedShopContext();

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(getDb).mockResolvedValue(ctx.db);
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, retryAfterMs: 60_000 });
  const owner = await seededStaffPersonId(ctx.db, ctx.shop.id, SEEDED_OWNER_EMAIL);
  vi.mocked(auth).mockResolvedValue(
    staffSession({ shopId: ctx.shop.id, shopSlug: ctx.shop.slug, personId: owner }) as never,
  );
});

async function aSeatedBooking() {
  const [row] = await ctx.db
    .select({ id: bookings.id, tripId: bookings.tripId, personId: bookings.personId })
    .from(bookings)
    .where(and(eq(bookings.shopId, ctx.shop.id), eq(bookings.status, "booked")))
    .limit(1);
  if (!row?.tripId) throw new Error("seeded shop has no seated booking");
  return { ...row, tripId: row.tripId };
}

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

function lastBucketPolicy() {
  return vi.mocked(checkRateLimit).mock.calls.at(-1)?.[1];
}

describe("a staff member past the hourly send bound", () => {
  it("a fresh waiver link is refused before the refusal is retired or a link sent", async () => {
    const booking = await aSeatedBooking();
    const to = await redirectedTo(() =>
      sendNewWaiverAction(ctx.shop.slug, booking.tripId, form({ bookingId: booking.id })),
    );
    expect(to).toContain("notice=send-limit");
    expect(lastBucketPolicy()).toBe(RATE_LIMITS.staffSendByActor);
    expect(retireMedicalRefusal).not.toHaveBeenCalled();
    expect(deliverWaiverBatch).not.toHaveBeenCalled();
  });

  it("a reply to a diver is refused before it is sent", async () => {
    const booking = await aSeatedBooking();
    const to = await redirectedTo(() =>
      replyToDiverAction(
        ctx.shop.slug,
        booking.personId,
        form({ messageId: randomUUID(), body: "See you at seven." }),
      ),
    );
    expect(to).toContain("notice=reply-send-limit");
    expect(lastBucketPolicy()).toBe(RATE_LIMITS.staffSendByActor);
    expect(sendStaffReply).not.toHaveBeenCalled();
  });

  it("an invite is refused before the account is made or the email sent", async () => {
    const email = "new.hand@example.com";
    const to = await redirectedTo(() =>
      inviteStaffAction(form({ fullName: "New Hand", email, role_divemaster: "on" })),
    );
    expect(to).toContain("notice=send-limit");
    expect(lastBucketPolicy()).toBe(RATE_LIMITS.staffSendByActor);
    const made = await ctx.db
      .select({ id: userAccounts.id })
      .from(userAccounts)
      .where(eq(userAccounts.email, email));
    expect(made).toEqual([]);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("an invite resend is refused before the email is sent", async () => {
    const invited = await inviteStaffMember(ctx.db, {
      shopId: ctx.shop.id,
      fullName: "Waiting Hand",
      email: "waiting.hand@example.com",
      roles: ["divemaster"],
    });
    if (!invited.ok) throw new Error(`invite fixture refused: ${invited.reason}`);
    const to = await redirectedTo(() =>
      resendInviteAction(form({ userAccountId: invited.userAccountId })),
    );
    expect(to).toContain("notice=send-limit");
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("an invoice resend answers rate_limited and sends nothing", async () => {
    const result = await resendInvoiceAction(
      ctx.shop.slug,
      { status: "idle" },
      form({ orderId: randomUUID() }),
    );
    expect(result).toEqual({ status: "error", reason: "rate_limited" });
    expect(lastBucketPolicy()).toBe(RATE_LIMITS.staffSendByActor);
    expect(resendOrderInvoice).not.toHaveBeenCalled();
  });

  it("a departure's recaps are refused before any goes out", async () => {
    const booking = await aSeatedBooking();
    const to = await redirectedTo(() => sendRecapAction(booking.tripId));
    expect(to).toContain("notice=recap-send-limit");
    expect(lastBucketPolicy()).toBe(RATE_LIMITS.staffSendByActor);
    expect(sendTripRecaps).not.toHaveBeenCalled();
  });

  it("a note to everyone on a departure answers rate_limited and holds nothing", async () => {
    const booking = await aSeatedBooking();
    const result = await holdDepartureNoteAction(
      booking.tripId,
      form({ body: "Meet at the dock at seven." }),
    );
    expect(result).toEqual({ ok: false, reason: "rate_limited" });
    expect(lastBucketPolicy()).toBe(RATE_LIMITS.staffSendByActor);
    expect(holdSend).not.toHaveBeenCalled();
  });

  it("each kind of send has its own bucket per staff member", async () => {
    const booking = await aSeatedBooking();
    await redirectedTo(() =>
      sendNewWaiverAction(ctx.shop.slug, booking.tripId, form({ bookingId: booking.id })),
    );
    await resendInvoiceAction(ctx.shop.slug, { status: "idle" }, form({ orderId: randomUUID() }));
    const [waiverKey, invoiceKey] = vi.mocked(checkRateLimit).mock.calls.map((call) => call[0]);
    expect(waiverKey).not.toBe(invoiceKey);
  });
});
