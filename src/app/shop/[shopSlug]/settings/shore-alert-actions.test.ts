import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { activityEvents, shops } from "@/db/schema";
import { getShopById } from "@/db/shops";
import type { Notification } from "@/lib/notifications";
import { rateLimitKey } from "@/lib/rate-limit";
import { fileScopedShopContext } from "@/test/db";
import {
  redirectedTo,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";

/**
 * **The shore contact's address on Settings → Emergency reference** (H-20261014-stale-roll-call-recipients and
 * its reviews): saved only with a tick drawn for that address, confirmed by a
 * link sent to it before any alert goes, written to the activity log, and
 * never sent anything from a demo shop. The real action against a real seeded
 * database; only the session, navigation and the provider are faked.
 */
const ctx = fileScopedShopContext();

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/session", () => ({ requireStaffSession: vi.fn() }));
const sent = vi.hoisted(() => ({ list: [] as Notification[] }));
vi.mock("@/db/notifications", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/notifications")>();
  return {
    ...actual,
    sendNotification: vi.fn(async (_db: unknown, notification: Notification) => {
      sent.list.push(notification);
      return { status: "sent", providerMessageId: "msg" };
    }),
  };
});
// The per-recipient bucket is a fixed three an hour; the file sends to one
// address more often than that, so every check is allowed and only the keys
// asked are recorded.
const limited = vi.hoisted(() => ({ keys: [] as string[] }));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return {
    ...actual,
    checkRateLimit: async (key: string) => {
      limited.keys.push(key);
      return { allowed: true, retryAfterMs: 0 };
    },
  };
});
vi.mock("@/lib/notifications", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/notifications")>();
  return { ...actual, publicAppUrl: () => "https://diveday.example" };
});

const { getDb } = await import("@/db/client");
const { requireStaffSession } = await import("@/lib/session");
const { resendShoreAlertConfirmationAction, saveEmergencyReferenceAction } = await import(
  "./boat-actions"
);

const SHORE = "shore@example.com";

async function signedIn({ demo }: { demo: boolean }) {
  const { db, shop } = ctx;
  vi.mocked(getDb).mockResolvedValue(db);
  await db.update(shops).set({ isDemo: demo }).where(eq(shops.id, shop.id));
  const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  vi.mocked(requireStaffSession).mockResolvedValue(
    staffSession({ shopId: shop.id, shopSlug: shop.slug, personId: owner }),
  );
  sent.list.length = 0;
  const page = `/shop/${shop.slug}/settings/emergency-reference?notice=`;
  return { db, shop, owner, page };
}

/** The form as the page posts it: the box, and the address it was drawn ticked for. */
function form(email: string, consent: boolean, consentFor = "") {
  const data = new FormData();
  data.set("emergencyVessel", "Blue Mantis II");
  data.set("shoreAlertEmail", email);
  data.set("shoreAlertConsentFor", consentFor);
  if (consent) data.set("shoreAlertConsent", "on");
  return data;
}

async function stored() {
  const row = await getShopById(ctx.db, ctx.shop.id);
  return {
    email: row?.shoreAlertEmail ?? null,
    consentAt: row?.shoreAlertConsentAt ?? null,
    confirmedAt: row?.shoreAlertConfirmedAt ?? null,
  };
}

async function activityCodes() {
  const rows = await ctx.db
    .select({ code: activityEvents.code })
    .from(activityEvents)
    .where(and(eq(activityEvents.shopId, ctx.shop.id)));
  return rows.map((row) => row.code).filter((code) => code.startsWith("shore_alert"));
}

describe("saving the shore contact's alert address", () => {
  it("sends the address a confirmation link, and nothing is confirmed until it is opened", async () => {
    const { page } = await signedIn({ demo: false });
    expect(await redirectedTo(() => saveEmergencyReferenceAction(form(SHORE, true)))).toBe(
      `${page}shore-alert-confirmation-sent`,
    );
    const saved = await stored();
    expect(saved.email).toBe(SHORE);
    expect(saved.consentAt).toBeInstanceOf(Date);
    expect(saved.confirmedAt).toBeNull();
    expect(sent.list).toHaveLength(1);
    expect(sent.list[0]).toMatchObject({
      kind: "address_confirmation",
      purpose: "shore_alert",
      to: SHORE,
    });
    const [confirmation] = sent.list;
    if (confirmation?.kind !== "address_confirmation") throw new Error("expected the link");
    expect(confirmation.confirmUrl.startsWith("https://diveday.example/confirm-contact/")).toBe(
      true,
    );
    expect(await activityCodes()).toEqual(["shore_alert_contact_set"]);
  });

  // Owner review #1 on H-20261014-stale-roll-call-recipients: the box drawn ticked for one address never
  // vouches for another.
  it("refuses a changed address under the tick drawn for the old one", async () => {
    const { page } = await signedIn({ demo: false });
    await redirectedTo(() => saveEmergencyReferenceAction(form(SHORE, true)));
    const before = await stored();
    sent.list.length = 0;
    expect(
      await redirectedTo(() =>
        saveEmergencyReferenceAction(form("other@example.com", true, SHORE)),
      ),
    ).toBe(`${page}shore-alert-consent-missing`);
    expect(await stored()).toEqual(before);
    expect(sent.list).toEqual([]);
  });

  it("takes a changed address under a fresh tick, unconfirmed, and asks it to confirm", async () => {
    const { db, shop, page } = await signedIn({ demo: false });
    await redirectedTo(() => saveEmergencyReferenceAction(form(SHORE, true)));
    await db.update(shops).set({ shoreAlertConfirmedAt: new Date() }).where(eq(shops.id, shop.id));
    sent.list.length = 0;
    expect(
      await redirectedTo(() => saveEmergencyReferenceAction(form("other@example.com", true, ""))),
    ).toBe(`${page}shore-alert-confirmation-sent`);
    expect(await stored()).toMatchObject({ email: "other@example.com", confirmedAt: null });
    expect(sent.list.map((notification) => notification.to)).toEqual(["other@example.com"]);
    expect(await activityCodes()).toEqual([
      "shore_alert_contact_set",
      "shore_alert_contact_changed",
    ]);
  });

  it("keeps the consent and the confirmation when the same address is saved again", async () => {
    const { db, shop, page } = await signedIn({ demo: false });
    await redirectedTo(() => saveEmergencyReferenceAction(form(SHORE, true)));
    const confirmedAt = new Date("2026-10-15T09:00:00Z");
    await db.update(shops).set({ shoreAlertConfirmedAt: confirmedAt }).where(eq(shops.id, shop.id));
    const before = await stored();
    sent.list.length = 0;
    expect(await redirectedTo(() => saveEmergencyReferenceAction(form(SHORE, true, SHORE)))).toBe(
      `${page}emergency-saved`,
    );
    expect(await stored()).toEqual(before);
    expect(sent.list).toEqual([]);
    expect(await activityCodes()).toEqual(["shore_alert_contact_set"]);
  });

  it("clears the address and says so", async () => {
    const { page } = await signedIn({ demo: false });
    await redirectedTo(() => saveEmergencyReferenceAction(form(SHORE, true)));
    expect(await redirectedTo(() => saveEmergencyReferenceAction(form("", false, SHORE)))).toBe(
      `${page}shore-alert-cleared`,
    );
    expect(await stored()).toEqual({ email: null, consentAt: null, confirmedAt: null });
    expect(await activityCodes()).toEqual([
      "shore_alert_contact_set",
      "shore_alert_contact_cleared",
    ]);
  });

  // Security re-review #4: one inbox, one hourly allowance, whichever of the
  // shop's two confirmation links (front desk, shore contact) asks for it.
  it("counts the link against the same per-recipient bucket as the front desk's", async () => {
    await signedIn({ demo: false });
    limited.keys.length = 0;
    await redirectedTo(() => saveEmergencyReferenceAction(form(SHORE, true)));
    expect(limited.keys).toContain(rateLimitKey("contact-confirmation", "recipient", SHORE));
  });

  it("sends nothing from a demo shop, and says so", async () => {
    const { page } = await signedIn({ demo: true });
    expect(await redirectedTo(() => saveEmergencyReferenceAction(form(SHORE, true)))).toBe(
      `${page}shore-alert-saved-demo`,
    );
    expect(sent.list).toEqual([]);
    expect((await stored()).confirmedAt).toBeNull();
  });

  it("sends the link again only while the address waits for it", async () => {
    const { db, shop, page } = await signedIn({ demo: false });
    await redirectedTo(() => saveEmergencyReferenceAction(form(SHORE, true)));
    sent.list.length = 0;
    expect(await redirectedTo(() => resendShoreAlertConfirmationAction())).toBe(
      `${page}shore-alert-confirmation-sent`,
    );
    expect(sent.list.map((notification) => notification.kind)).toEqual(["address_confirmation"]);

    await db.update(shops).set({ shoreAlertConfirmedAt: new Date() }).where(eq(shops.id, shop.id));
    sent.list.length = 0;
    expect(await redirectedTo(() => resendShoreAlertConfirmationAction())).toBe(
      `${page}emergency-saved`,
    );
    expect(sent.list).toEqual([]);
  });
});
