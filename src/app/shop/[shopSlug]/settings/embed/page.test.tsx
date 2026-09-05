import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { getShopBySlug } from "@/db/shops";
import type { DiveDaySession } from "@/lib/auth";
import { seededTestDb } from "@/test/db";
import { nextHeadersStub } from "@/test/next-headers";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "@/test/staff-session";

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
// Same reasoning as src/app/api/offline-manifests/sync/route.test.ts: a bare
// mock avoids ever loading the real better-auth module outside Next's bundler.
vi.mock("@/lib/auth", () => ({ auth: vi.fn<() => Promise<DiveDaySession | null>>() }));
// `requestLocale` reads `next/headers`' `headers()`, which only resolves
// inside a real Next request scope — absent here since the page is invoked
// directly. An empty header set negotiates down to the shop's default
// locale, same as a real request that sends no Accept-Language.
vi.mock("next/headers", () => nextHeadersStub());

const { getDb } = await import("@/db/client");
const authModule = (await import("@/lib/auth")) as unknown as {
  auth: ReturnType<typeof vi.fn<() => Promise<DiveDaySession | null>>>;
};
const auth = authModule.auth;
const EmbedSettingsPage = (await import("./page")).default;
const { EmbedGenerator } = await import("./EmbedGenerator");
const { EmbedSets } = await import("./EmbedSets");

async function seededContext() {
  const db: AppDb = await seededTestDb();
  const shop = await getShopBySlug(db, "blue-mantis");
  if (!shop) throw new Error("demo shop missing");
  // A *real* seeded person, not a placeholder id: the page re-checks the
  // settings gate against live roles now (`canPersonManageShopSettings`),
  // which reads `people` by this id.
  const personId = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  return { db, shop, personId };
}

const staffSession = (shopId: string, personId: string): DiveDaySession => ({
  user: {
    personId,
    shopId,
    shopSlug: "blue-mantis",
    name: "Dana Reyes",
    email: "staff@demo.invalid",
    roles: ["owner"],
  },
});

/** Depth-first walk of a returned React element tree, collecting every
 * element whose `type` matches `component` — this reads the exact props
 * `EmbedSettingsPage` builds (the raw `snippet` string) without going through
 * HTML serialization, which would otherwise entity-escape the `&` separators
 * in the UTM query string and make substring assertions fragile. */
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

describe("EmbedSettingsPage", () => {
  it("hands the generator the origin, the shop, its departures and every word", async () => {
    const { db, shop, personId } = await seededContext();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(staffSession(shop.id, personId));
    const previousAppHost = process.env.APP_HOST;
    process.env.APP_HOST = "http://localhost:3000";
    try {
      const element = await EmbedSettingsPage({
        params: Promise.resolve({ shopSlug: shop.slug }),
        searchParams: Promise.resolve({}),
      });
      const [generator] = findElements<{
        origin: string;
        shopSlug: string;
        trips: { id: string; label: string }[];
        copy: { kinds: Record<string, string>; code: string };
      }>(element, EmbedGenerator);
      expect(generator).toBeDefined();
      expect(generator?.props.origin).toBe("http://localhost:3000");
      expect(generator?.props.shopSlug).toBe(shop.slug);
      // The seeded shop has departures to pin a widget to.
      expect(generator?.props.trips.length).toBeGreaterThan(0);
      // Eight kinds, each with a name (ADR 20260901-diveday-reimagined, 13d).
      expect(Object.keys(generator?.props.copy.kinds ?? {})).toHaveLength(8);
      expect(generator?.props.copy.code).toBe("Embed code");
    } finally {
      process.env.APP_HOST = previousAppHost;
    }
  });

  it("renders the named lists editor beside the generator", async () => {
    const { db, shop, personId } = await seededContext();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(staffSession(shop.id, personId));
    const previousAppHost = process.env.APP_HOST;
    process.env.APP_HOST = "http://localhost:3000";
    try {
      const element = await EmbedSettingsPage({
        params: Promise.resolve({ shopSlug: shop.slug }),
        searchParams: Promise.resolve({}),
      });
      const [editor] = findElements<{
        sets: { name: string }[];
        trips: { id: string }[];
        copy: { title: string };
      }>(element, EmbedSets);
      expect(editor).toBeDefined();
      expect(editor?.props.copy.title).toBe("Named lists");
      // The demo shop seeds one (`src/db/seed-embed-sets.ts`), so the card is a
      // populated one rather than an empty form.
      expect(editor?.props.sets.length).toBeGreaterThan(0);
      expect(editor?.props.trips.length).toBeGreaterThan(0);
    } finally {
      process.env.APP_HOST = previousAppHost;
    }
  });

  it("routes a list's notice to the lists form rather than to a page banner", async () => {
    const { db, shop, personId } = await seededContext();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(staffSession(shop.id, personId));
    const previousAppHost = process.env.APP_HOST;
    process.env.APP_HOST = "http://localhost:3000";
    try {
      const element = await EmbedSettingsPage({
        params: Promise.resolve({ shopSlug: shop.slug }),
        searchParams: Promise.resolve({ notice: "embed-set-saved", form: "embed-sets" }),
      });
      const [editor] = findElements<{ notice?: { tone: string; text: string } }>(
        element,
        EmbedSets,
      );
      expect(editor?.props.notice).toEqual({
        form: "embed-sets",
        tone: "success",
        text: "List saved.",
      });
    } finally {
      process.env.APP_HOST = previousAppHost;
    }
  });
});
