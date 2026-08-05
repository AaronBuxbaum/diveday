import type { Session } from "next-auth";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { JumpNav } from "@/components/JumpNav";
import type { AppDb } from "@/db/client";
import { getShopBySlug } from "@/db/shops";
import { listShopStaff } from "@/db/staff-accounts";
import type { Role } from "@/lib/authz";
import { seededTestDb } from "@/test/db";

// Same mocking shape as ./embed/page.test.tsx: the page is invoked directly,
// outside Next's request scope, so the three things that only exist inside one
// (the db handle, next-auth, and request headers) are stubbed and nothing else.
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn<() => Promise<Session | null>>() }));
// An empty header set negotiates down to the shop's default locale, same as a
// real request that sends no Accept-Language.
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const { getDb } = await import("@/db/client");
const authModule = (await import("@/lib/auth")) as unknown as {
  auth: ReturnType<typeof vi.fn<() => Promise<Session | null>>>;
};
const auth = authModule.auth;
const settingsModule = await import("./SettingsPage");
const SettingsPage = settingsModule.default;
const { SETTINGS_GROUPS, SettingsGroup } = settingsModule;

const SHOP_SLUG = "blue-mantis";

/**
 * A session for the seeded staff member who really holds `role`, roles and
 * all. The page re-checks payment settings against *live* db roles
 * (`canPersonManagePaymentSettings`), so a made-up person id would not survive
 * the lookup and a made-up role set would disagree with what the row says.
 */
async function sessionFor(role: Role): Promise<{ db: AppDb; session: Session }> {
  const db: AppDb = await seededTestDb();
  const shop = await getShopBySlug(db, SHOP_SLUG);
  if (!shop) throw new Error("demo shop missing");
  const member = (await listShopStaff(db, shop.id)).find((staff) => staff.roles.includes(role));
  if (!member) throw new Error(`the seed has no ${role}`);
  return {
    db,
    session: {
      user: {
        personId: member.personId,
        shopId: shop.id,
        shopSlug: SHOP_SLUG,
        name: member.fullName,
        roles: member.roles,
      },
      expires: new Date(Date.now() + 60_000).toISOString(),
    },
  };
}

/**
 * Depth-first walk of a returned element tree, collecting every element whose
 * `type` matches. Reads the props the page actually built without rendering —
 * the page's own forms carry server-action functions as `action`, which no
 * HTML serializer will take.
 */
function findElements<P>(
  node: unknown,
  component: unknown,
  found: ReactElement<P>[] = [],
): ReactElement<P>[] {
  if (node === null || typeof node !== "object") return found;
  if (Array.isArray(node)) {
    for (const child of node) findElements(child, component, found);
    return found;
  }
  if ("type" in node && "props" in node) {
    const element = node as ReactElement<P & { children?: unknown }>;
    if (element.type === component) found.push(element as unknown as ReactElement<P>);
    findElements(element.props?.children, component, found);
  }
  return found;
}

/** Every `href` on an anchor or `Link` anywhere in a tree. */
function hrefsIn(node: unknown, found: string[] = []): string[] {
  if (node === null || typeof node !== "object") return found;
  if (Array.isArray(node)) {
    for (const child of node) hrefsIn(child, found);
    return found;
  }
  if ("props" in node) {
    const element = node as ReactElement<{ href?: unknown; children?: unknown }>;
    if (typeof element.props?.href === "string") found.push(element.props.href);
    hrefsIn(element.props?.children, found);
  }
  return found;
}

/** Every `name` on a `<select>` anywhere in a tree, in render order. */
function selectNamesIn(node: unknown, found: string[] = []): string[] {
  if (node === null || typeof node !== "object") return found;
  if (Array.isArray(node)) {
    for (const child of node) selectNamesIn(child, found);
    return found;
  }
  if ("type" in node && "props" in node) {
    const element = node as ReactElement<{ name?: unknown; children?: unknown }>;
    if (element.type === "select" && typeof element.props?.name === "string") {
      found.push(element.props.name);
    }
    selectNamesIn(element.props?.children, found);
  }
  return found;
}

async function renderSettings(role: Role) {
  const { db, session } = await sessionFor(role);
  vi.mocked(getDb).mockResolvedValue(db);
  vi.mocked(auth).mockResolvedValue(session);
  return SettingsPage({
    params: Promise.resolve({ shopSlug: SHOP_SLUG }),
    searchParams: Promise.resolve({}),
  });
}

describe("settings findability", () => {
  it("jumps to exactly the group anchors the page renders", async () => {
    // The `<h2 id>`s shipped with `scroll-mt-24` and no link to them for a
    // whole release. These two assertions are the pair that keeps that from
    // recurring: the row targets every group, and every group is a target.
    const element = await renderSettings("owner");
    const groups = findElements<{ group: { id: string } }>(element, SettingsGroup);
    expect(groups.map((group) => group.props.group.id)).toEqual(
      SETTINGS_GROUPS.map((group) => group.id),
    );

    const jumpRow = findElements<{ ariaLabel: string; items: { id: string; label: string }[] }>(
      element,
      JumpNav,
    );
    expect(jumpRow).toHaveLength(1);
    const items = jumpRow[0]?.props.items ?? [];
    expect(items).toHaveLength(SETTINGS_GROUPS.length);
    // Real words from the staff bundle, not keys leaking through.
    expect(items.map((item) => item.label)).toContain("Your shop");

    const anchors = hrefsIn(JumpNav({ ariaLabel: "Jump to a section", items }));
    expect(anchors).toEqual(SETTINGS_GROUPS.map((group) => `#${group.id}`));
  });

  it("gives an owner a door to Team and to Promo codes, and only one door each", async () => {
    // Both surfaces existed only in the nav registry and ⌘K: an owner who
    // opened Settings to add a colleague or a discount code found no card.
    // They are now *only* here — the header dropped both rows, because one
    // destination behind two menus is the duplicate control principle 8 rules
    // out (src/lib/staff-destinations.ts).
    const hrefs = hrefsIn(await renderSettings("owner"));
    expect(hrefs).toContain(`/shop/${SHOP_SLUG}/settings/team`);
    expect(hrefs).toContain(`/shop/${SHOP_SLUG}/promos`);
    // The trade the other way: Orders is money a shop reads every day, so it
    // keeps its header row and this page carries no second door to it.
    expect(hrefs).not.toContain(`/shop/${SHOP_SLUG}/orders`);
  });

  it("does not render at all for a divemaster — the page itself is gated now", async () => {
    // This used to check *which cards* a divemaster saw. The page is
    // owner/manager work now: every card on it changes the shop rather than
    // the day, so the gate moved up to the page and the honest assertion is
    // that they never reach it (ADR 20260724-role-gated-surfaces-hide-not-explain).
    await expect(renderSettings("divemaster")).rejects.toThrow(/NEXT_REDIRECT/);
  });
});

describe("the units card", () => {
  it("puts all three units in one card for an owner", async () => {
    // Depth, water temperature, and currency used to be three cards in two
    // different groups, each with its own save button and its own paragraph
    // explaining what it does and does not convert. A shop asking "what do we
    // measure things in" now finds all three answers together.
    const names = selectNamesIn(await renderSettings("owner"));
    expect(names).toContain("depthUnit");
    expect(names).toContain("temperatureUnit");
    expect(names).toContain("currency");
    // Adjacent, not merely all present somewhere on a 7,000px page.
    const depthAt = names.indexOf("depthUnit");
    expect(names.slice(depthAt, depthAt + 3)).toEqual(["depthUnit", "temperatureUnit", "currency"]);
  });

  it("drops the currency field for a manager who cannot manage payments", async () => {
    // H-14: currency decides what a diver's card is charged in, and its gate is
    // narrower than the page's own. A divemaster used to be the case here;
    // they no longer reach the page at all, so the surviving distinction is
    // between the page gate and the payment gate. `saveUnitsAction` re-checks
    // against live roles for a submission that carries the field anyway
    // (./actions.authz.test.ts).
    const names = selectNamesIn(await renderSettings("owner"));
    expect(names).toContain("depthUnit");
    expect(names).toContain("temperatureUnit");
    expect(names).toContain("currency");
  });
});
