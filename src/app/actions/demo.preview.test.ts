import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { demoRoleEmail } from "@/db/people";
import {
  boardingObservations,
  bookings,
  demoPreviews,
  people,
  personRoles,
  shops,
} from "@/db/schema";
import { DEMO_SHOP_BRAND } from "@/db/seed-shop-brand";
import { findPreview, issuePreview, type PreviewInput } from "@/features/demo/demo-preview";
import { nowDate } from "@/lib/clock";
import { DEMO_BYPASS_PASSWORD } from "@/lib/demo-bypass";
import { ALERT_EMAIL } from "@/lib/platform-mail";
import { fileScopedShopContext } from "@/test/db";
import { nextHeadersStub } from "@/test/next-headers";
import { QUIET_DEMO_COOKIE, quietDemoToken } from "../../features/demo/quiet-demo-device";

/** Any real brand colour; the canonical demo's own, so no hex is typed here. */
const BLUE = DEMO_SHOP_BRAND.brandColor as string;

const ctx = fileScopedShopContext();

/**
 * **A prospect's preview link, from the tap to the founder's inbox** (ADR
 * 20261116-demo-previews). What these hold apart is the whole point of the
 * feature: an open is counted when a browser posts, real use only when a staff
 * session is touched, and the founder is mailed about the second and never the
 * first. A week-old link, a deleted shop and a made-up id all go back to the
 * link's page, which says the preview ended, and none of them signs anyone in.
 */

const hoisted = vi.hoisted(() => ({
  signInDiveDayCredentials: vi.fn(async () => ({})),
  cookies: {} as Record<string, string>,
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("next/headers", () => nextHeadersStub({ cookies: hoisted.cookies }));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
  getAuth: vi.fn(async () => ({
    api: { signInDiveDayCredentials: hoisted.signInDiveDayCredentials },
  })),
}));
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/request-ip", () => ({ clientIp: vi.fn(async () => "203.0.113.7") }));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, checkRateLimit: vi.fn(async () => ({ allowed: true })) };
});
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn(async () => {}) }));
vi.mock("@/db/notifications", () => ({
  sendNotification: vi.fn(async () => ({ status: "sent" })),
}));

const { getDb } = await import("@/db/client");
const { checkRateLimit } = await import("@/lib/rate-limit");
const { sendNotification } = await import("@/db/notifications");
const { enterDemoAction, enterPreviewAction } = await import("./demo");
const { announcePreviewActivity } = await import("./demo-instrumentation");

const NOW = nowDate();
const PROSPECT: PreviewInput = {
  name: "Reef Line Divers",
  site: "https://reefline.example",
  brandColor: BLUE,
  tagline: null,
  locality: "Islamorada",
  region: "FL",
  position: null,
};

async function enter(id: unknown): Promise<string> {
  const form = new FormData();
  if (typeof id === "string") form.set("preview", id);
  try {
    await enterPreviewAction(form);
    return "";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.startsWith("REDIRECT:")) throw error;
    return message.slice("REDIRECT:".length);
  }
}

beforeEach(() => {
  for (const name of Object.keys(hoisted.cookies)) delete hoisted.cookies[name];
  vi.mocked(getDb).mockReset();
  vi.mocked(getDb).mockImplementation(async () => ctx.db);
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true } as never);
  vi.mocked(sendNotification).mockReset();
  vi.mocked(sendNotification).mockResolvedValue({ status: "sent", providerMessageId: "m1" });
  hoisted.signInDiveDayCredentials.mockReset().mockResolvedValue({});
});

describe("enterPreviewAction", () => {
  it("refuses a first open without consuming it when reset encounters a sighting", async () => {
    const preview = await issuePreview(ctx.db, PROSPECT, NOW);
    const [shop] = await ctx.db.select().from(shops).where(eq(shops.slug, preview.shopSlug));
    const [booking] = await ctx.db.select().from(bookings).where(eq(bookings.shopId, shop.id));
    const [staff] = await ctx.db
      .select({ id: personRoles.personId })
      .from(personRoles)
      .innerJoin(people, eq(people.id, personRoles.personId))
      .where(eq(people.shopId, shop.id));
    if (!booking || !staff) throw new Error("fixture missing");
    const [observation] = await ctx.db
      .insert(boardingObservations)
      .values({
        shopId: shop.id,
        bookingId: booking.id,
        tripId: booking.tripId,
        recordedByPersonId: staff.id,
        clientKey: crypto.randomUUID(),
      })
      .returning();
    expect(await enter(preview.id)).toBe("/sign-in?error=demo");
    expect((await findPreview(ctx.db, preview.id))?.openCount).toBe(0);
    expect(hoisted.signInDiveDayCredentials).not.toHaveBeenCalled();
    expect(
      await ctx.db
        .select()
        .from(boardingObservations)
        .where(eq(boardingObservations.id, observation.id)),
    ).toEqual([observation]);
  });
  it("signs the visitor in as the preview shop's owner, lands on Today, and counts one open", async () => {
    const preview = await issuePreview(ctx.db, PROSPECT, NOW);

    const landing = await enter(preview.id);

    expect(landing).toBe(`/shop/${preview.shopSlug}`);
    const [shop] = await ctx.db.select().from(shops).where(eq(shops.slug, preview.shopSlug));
    expect(hoisted.signInDiveDayCredentials).toHaveBeenCalledWith(
      expect.objectContaining({
        body: {
          email: await demoRoleEmail(ctx.db, shop.id, "owner"),
          password: DEMO_BYPASS_PASSWORD,
        },
      }),
    );
    expect(await findPreview(ctx.db, preview.id)).toMatchObject({ openCount: 1, activeCount: 0 });
    // The open alone is not a person: nothing is mailed for it.
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("enters without counting for a browser the founder marked as his own", async () => {
    const preview = await issuePreview(ctx.db, PROSPECT, NOW);
    hoisted.cookies[QUIET_DEMO_COOKIE] = quietDemoToken() ?? "";

    expect(await enter(preview.id)).toBe(`/shop/${preview.shopSlug}`);
    expect((await findPreview(ctx.db, preview.id))?.openCount).toBe(0);
  });

  it("sends an ended week back to the link's page and signs nobody in", async () => {
    const preview = await issuePreview(ctx.db, PROSPECT, new Date(NOW.getTime() - 8 * 86_400_000));

    expect(await enter(preview.id)).toBe(`/preview/${preview.id}`);
    expect(hoisted.signInDiveDayCredentials).not.toHaveBeenCalled();
    expect((await findPreview(ctx.db, preview.id))?.openCount).toBe(0);
  });

  it("refuses a preview whose shop is no longer a demo", async () => {
    const preview = await issuePreview(ctx.db, PROSPECT, NOW);
    await ctx.db.update(shops).set({ isDemo: false }).where(eq(shops.slug, preview.shopSlug));

    expect(await enter(preview.id)).toBe(`/preview/${preview.id}`);
    expect(hoisted.signInDiveDayCredentials).not.toHaveBeenCalled();
  });

  it("refuses when a later demo has drawn the preview's slug", async () => {
    // The reaper took the preview's shop and a stranger's demo drew its slug.
    const preview = await issuePreview(ctx.db, PROSPECT, NOW);
    await ctx.db
      .update(demoPreviews)
      .set({ demoShopId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301" })
      .where(eq(demoPreviews.id, preview.id));

    expect(await enter(preview.id)).toBe(`/preview/${preview.id}`);
    expect(hoisted.signInDiveDayCredentials).not.toHaveBeenCalled();
  });

  it("goes home for a token that is not an id, and back to the page for one nobody issued", async () => {
    expect(await enter("../shop/blue-mantis")).toBe("/");
    expect(await enter(undefined)).toBe("/");
    const unknown = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
    expect(await enter(unknown)).toBe(`/preview/${unknown}`);
    expect(hoisted.signInDiveDayCredentials).not.toHaveBeenCalled();
  });

  it("looks nothing up for a throttled caller", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false } as never);
    const preview = await issuePreview(ctx.db, PROSPECT, NOW);
    vi.mocked(getDb).mockClear();

    expect(await enter(preview.id)).toBe("/sign-in?error=demo");
    expect(getDb).not.toHaveBeenCalled();
  });
});

it("reports demo unavailable when every eviction candidate has a sighting", async () => {
  const preview = await issuePreview(ctx.db, PROSPECT, NOW);
  const [shop] = await ctx.db.select().from(shops).where(eq(shops.slug, preview.shopSlug));
  const [booking] = await ctx.db.select().from(bookings).where(eq(bookings.shopId, shop.id));
  const [staff] = await ctx.db
    .select({ id: personRoles.personId })
    .from(personRoles)
    .innerJoin(people, eq(people.id, personRoles.personId))
    .where(eq(people.shopId, shop.id));
  if (!booking || !staff) throw new Error("fixture missing");
  const [observation] = await ctx.db
    .insert(boardingObservations)
    .values({
      shopId: shop.id,
      bookingId: booking.id,
      tripId: booking.tripId,
      recordedByPersonId: staff.id,
      clientKey: crypto.randomUUID(),
    })
    .returning();
  vi.stubEnv("DEMO_SHOP_MAX_LIVE", "1");
  try {
    await expect(enterDemoAction()).rejects.toThrow("REDIRECT:/sign-in?error=demo");
  } finally {
    vi.unstubAllEnvs();
  }
  expect(
    await ctx.db
      .select()
      .from(boardingObservations)
      .where(eq(boardingObservations.id, observation.id)),
  ).toEqual([observation]);
  expect(await ctx.db.select().from(bookings).where(eq(bookings.id, booking.id))).toEqual([
    booking,
  ]);
  expect(await ctx.db.select().from(shops).where(eq(shops.id, shop.id))).toEqual([shop]);
  expect(hoisted.signInDiveDayCredentials).not.toHaveBeenCalled();
});

describe("announcePreviewActivity", () => {
  it("mails the founder once, on the first real use, with the counts beside it", async () => {
    const preview = await issuePreview(ctx.db, PROSPECT, NOW);
    await enter(preview.id);

    await announcePreviewActivity(preview.demoShopId);
    await announcePreviewActivity(preview.demoShopId);

    expect(sendNotification).toHaveBeenCalledTimes(1);
    const [, notification] = vi.mocked(sendNotification).mock.calls[0];
    expect(notification).toMatchObject({
      kind: "operator_alert",
      event: "preview_active",
      to: ALERT_EMAIL,
      previewId: preview.id,
      prospectName: "Reef Line Divers",
      shopSlug: preview.shopSlug,
      openCount: 1,
    });
    // A business and three counts: no IP, user agent, or anything about the visitor.
    expect(Object.keys(notification).sort()).toEqual([
      "event",
      "fetchCount",
      "kind",
      "openCount",
      "previewId",
      "prospectName",
      "shopId",
      "shopSlug",
      "to",
    ]);
    const [row] = await ctx.db.select().from(demoPreviews).where(eq(demoPreviews.id, preview.id));
    expect(row.activeCount).toBe(2);
  });

  it("does nothing for a shop that is not a preview", async () => {
    await announcePreviewActivity(ctx.shop.id);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("never throws, whatever the database does", async () => {
    vi.mocked(getDb).mockRejectedValue(new Error("down"));
    await expect(announcePreviewActivity("anything")).resolves.toBeUndefined();
  });
});
