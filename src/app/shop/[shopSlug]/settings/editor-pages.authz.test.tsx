import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { getShopBySlug } from "@/db/shops";
import type { DiveDaySession } from "@/lib/auth";
import type { Role } from "@/lib/authz";
import { seededTestDb } from "@/test/db";
import { nextHeadersStub } from "@/test/next-headers";
import {
  SEEDED_CAPTAIN_EMAIL,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
} from "@/test/staff-session";

/**
 * **The five editors that left the hub keep the hub's gates** (#1854). Each
 * page is invoked directly, outside Next's request scope, so the db handle,
 * better-auth, request headers and Next's two refusals are stubbed — the
 * refusals throw a readable error, as Next's own do, so the test can say
 * where a refused staffer lands.
 */
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn<() => Promise<DiveDaySession | null>>() }));
vi.mock("next/headers", () => nextHeadersStub());
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));
// The payment half of the rental gate, switchable per test. No seeded role
// holds shop settings without payment settings today, so the only way to
// prove the rental pages ask both is to make the second one say no.
const paymentGate = vi.hoisted(() => ({ open: true }));
vi.mock("@/lib/authz", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authz")>();
  return {
    ...actual,
    canManagePaymentSettings: (roles: readonly Role[] | undefined) =>
      paymentGate.open && actual.canManagePaymentSettings(roles),
  };
});

const { getDb } = await import("@/db/client");
const authModule = (await import("@/lib/auth")) as unknown as {
  auth: ReturnType<typeof vi.fn<() => Promise<DiveDaySession | null>>>;
};

type EditorPage = (props: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ notice?: string }>;
}) => Promise<unknown>;

const PAGES: Record<string, EditorPage> = {
  profile: (await import("./profile/page")).default,
  "dock-day": (await import("./dock-day/page")).default,
  "emergency-reference": (await import("./emergency-reference/page")).default,
  rentals: (await import("./rentals/page")).default,
  "rental-prices": (await import("./rental-prices/page")).default,
};

afterEach(() => {
  paymentGate.open = true;
});

async function signedIn(email: string): Promise<void> {
  const db: AppDb = await seededTestDb();
  const shop = await getShopBySlug(db, "blue-mantis");
  if (!shop) throw new Error("demo shop missing");
  const personId = await seededStaffPersonId(db, shop.id, email);
  vi.mocked(getDb).mockResolvedValue(db);
  authModule.auth.mockResolvedValue({
    user: {
      personId,
      shopId: shop.id,
      shopSlug: "blue-mantis",
      name: "Staff",
      email,
      // Inflated on purpose: the gates read live roles, never the JWT's.
      roles: ["owner", "manager"],
    },
  });
}

async function outcome(page: EditorPage, slug = "blue-mantis"): Promise<string> {
  try {
    await page({ params: Promise.resolve({ shopSlug: slug }), searchParams: Promise.resolve({}) });
    return "rendered";
  } catch (error) {
    return (error as Error).message;
  }
}

describe("the settings editor pages' gates", () => {
  for (const [route, page] of Object.entries(PAGES)) {
    it(`renders ${route} for an owner`, async () => {
      await signedIn(SEEDED_OWNER_EMAIL);
      expect(await outcome(page)).toBe("rendered");
    });

    it(`refuses ${route} to a captain, with the settings notice`, async () => {
      await signedIn(SEEDED_CAPTAIN_EMAIL);
      expect(await outcome(page)).toBe("REDIRECT:/shop/blue-mantis?notice=settings-not-authorized");
    });

    it(`answers ${route} under another shop's slug with not found`, async () => {
      await signedIn(SEEDED_OWNER_EMAIL);
      expect(await outcome(page, "another-shop")).toBe("NOT_FOUND");
    });
  }

  it("refuses the two rental pages, and only them, without payment settings", async () => {
    await signedIn(SEEDED_OWNER_EMAIL);
    paymentGate.open = false;
    for (const route of ["rentals", "rental-prices"]) {
      expect(await outcome(PAGES[route] as EditorPage), route).toBe(
        "REDIRECT:/shop/blue-mantis?notice=settings-not-authorized",
      );
    }
    for (const route of ["profile", "dock-day", "emergency-reference"]) {
      expect(await outcome(PAGES[route] as EditorPage), route).toBe("rendered");
    }
  });
});
