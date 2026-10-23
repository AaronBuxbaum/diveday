import { describe, expect, it, vi } from "vitest";
import { SubmitButton } from "@/components/SubmitButton";
import type { AppDb } from "@/db/client";
import { getShopBySlug, setShopCrewScheduleEnabled, setShopDivingOptions } from "@/db/shops";
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

const SHOP_SLUG = "blue-mantis";

async function renderFeatures(
  role: Role,
  seed?: (db: AppDb, shopId: string) => Promise<void>,
  searchParams: { notice?: string } = {},
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
    .filter((input) => input.props.name === "rows")
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

  it("offers each switch under its row's own name, and the three diving modes together", async () => {
    const names = inputNamesIn(await renderFeatures("owner"));
    const switches = names.filter((name) => name.startsWith("feature:"));
    expect(switches).toEqual([
      "feature:reviews",
      "feature:tips",
      "feature:dateRequests",
      "feature:lastMinuteList",
      "feature:publicYear",
      "feature:padiChecks",
      "feature:claudeSuggestions",
      "feature:recapAutoApprove",
      "feature:crewSchedule",
      "feature:tax",
    ]);
    for (const name of ["hasBoatDiving", "hasShoreDiving", "hasPoolDiving"]) {
      expect(names).toContain(name);
    }
  });

  it("is one form with one Save for every switch", async () => {
    const page = await renderFeatures("owner");
    expect(findElements(page, "form")).toHaveLength(1);
    expect(findElements(page, SubmitButton)).toHaveLength(1);
    // Every row the page drew is named, so the save knows which rows it may write.
    const [form] = findElements<{ children: unknown }>(page, "form");
    expect(rowsIn(form)).toHaveLength(11);
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
});
