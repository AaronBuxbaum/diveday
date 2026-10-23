import { describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import {
  getShopBySlug,
  setShopCrewScheduleEnabled,
  setShopDivingOptions,
  setShopFeature,
} from "@/db/shops";
import { listShopStaff } from "@/db/staff-accounts";
import type { DiveDaySession } from "@/lib/auth";
import type { Role } from "@/lib/authz";
import { fileScopedShopContext } from "@/test/db";
import { findElements, hrefsIn, inputNamesIn } from "@/test/jsx-inspect";
import { nextHeadersStub } from "@/test/next-headers";

const ctx = fileScopedShopContext();

// Same mocking shape as ../SettingsPage.test.tsx: the page is invoked directly,
// outside Next's request scope, so only the db handle, better-auth and request
// headers are stubbed.
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn<() => Promise<DiveDaySession | null>>() }));
vi.mock("next/headers", () => nextHeadersStub());

const { getDb } = await import("@/db/client");
const authModule = (await import("@/lib/auth")) as unknown as {
  auth: ReturnType<typeof vi.fn<() => Promise<DiveDaySession | null>>>;
};
const FeaturesPage = (await import("./page")).default;
const { darkWhileOnKey } = await import("./feature-rows");

const SHOP_SLUG = "blue-mantis";

async function renderFeatures(
  role: Role,
  seed?: (db: AppDb, shopId: string) => Promise<void>,
  searchParams: { notice?: string; saved?: string } = {},
) {
  const db: AppDb = ctx.db;
  const shop = await getShopBySlug(db, SHOP_SLUG);
  if (!shop) throw new Error("demo shop missing");
  const member = (await listShopStaff(db, shop.id)).find((staff) => staff.roles.includes(role));
  if (!member) throw new Error(`the seed has no ${role}`);
  if (seed) await seed(db, shop.id);
  vi.mocked(getDb).mockResolvedValue(db);
  authModule.auth.mockResolvedValue({
    user: {
      personId: member.personId,
      shopId: shop.id,
      shopSlug: SHOP_SLUG,
      name: member.fullName,
      email: "staff@demo.invalid",
      roles: member.roles,
    },
  });
  return FeaturesPage({
    params: Promise.resolve({ shopSlug: SHOP_SLUG }),
    searchParams: Promise.resolve(searchParams),
  });
}

const rowsIn = (element: unknown) =>
  findElements<{ name: string; value: string }>(element, "input")
    .filter((input) => input.props.name === "row")
    .map((input) => input.props.value);

describe("the Features page", () => {
  it("lists the eleven switches, once each, in the issue's order", async () => {
    expect(rowsIn(await renderFeatures("owner"))).toEqual([
      "reviews",
      "tips",
      "dateRequests",
      "lastMinuteList",
      "publicYear",
      "padiChecks",
      "claudeSuggestions",
      "recapAutoApprove",
      "crewSchedule",
      "tax",
      "divingOptions",
    ]);
  });

  it("offers each switch under the name its column had, and the three diving modes together", async () => {
    const names = inputNamesIn(await renderFeatures("owner"));
    expect(names.filter((name) => name === "enabled")).toHaveLength(10);
    for (const name of ["hasBoatDiving", "hasShoreDiving", "hasPoolDiving"]) {
      expect(names).toContain(name);
    }
  });

  it("does not render at all for a divemaster", async () => {
    await expect(renderFeatures("divemaster")).rejects.toThrow(/NEXT_REDIRECT/);
  });

  it("links to a row's value settings only while its switch is on", async () => {
    const base = `/shop/${SHOP_SLUG}`;
    // The seeded demo plans its crew and runs boats.
    const on = hrefsIn(await renderFeatures("owner"));
    expect(on).toContain(`${base}/settings#crew-schedule`);
    expect(on).toContain(`${base}/boats`);

    const off = hrefsIn(
      await renderFeatures("owner", async (db, shopId) => {
        await setShopCrewScheduleEnabled(db, shopId, false);
        await setShopDivingOptions(db, shopId, {
          hasBoatDiving: false,
          hasShoreDiving: true,
          hasPoolDiving: false,
        });
      }),
    );
    expect(off).not.toContain(`${base}/settings#crew-schedule`);
    expect(off).not.toContain(`${base}/boats`);
  });

  it("says why AI suggestions stay hidden while their switch is on", async () => {
    // No ANTHROPIC_API_KEY in the unit run, so the assists are dark on this server.
    const lines = (page: unknown) =>
      findElements<{ children?: unknown }>(page, "p").map((p) => String(p.props.children));
    const on = await renderFeatures("owner", (db, shopId) =>
      setShopFeature(db, shopId, "claudeSuggestions", true).then(() => undefined),
    );
    expect(lines(on)).toContain(
      "AI isn’t connected on this server yet, so suggestions stay hidden even with this on.",
    );

    const off = await renderFeatures("owner", (db, shopId) =>
      setShopFeature(db, shopId, "claudeSuggestions", false).then(() => undefined),
    );
    expect(lines(off).join(" ")).not.toMatch(/stay hidden/);
  });
});

describe("the line under the AI switch", () => {
  it("names the reason the switch can't, and nothing when it may run or is off", () => {
    expect(darkWhileOnKey(null)).toBeNull();
    expect(darkWhileOnKey("shop_off")).toBeNull();
    expect(darkWhileOnKey("no_key")).toBe(
      "settings.main.features.claudeSuggestions.dark.noProvider",
    );
    expect(darkWhileOnKey("demo_shop")).toBe(
      "settings.main.features.claudeSuggestions.dark.demoShop",
    );
    expect(darkWhileOnKey("over_cap")).toBe(
      "settings.main.features.claudeSuggestions.dark.overCap",
    );
  });
});
