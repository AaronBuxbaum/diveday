import type { Session } from "next-auth";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { getShopBySlug } from "@/db/shops";
import { seededTestDb } from "@/test/db";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "@/test/staff-session";

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
// Same reasoning as src/app/api/offline-manifests/sync/route.test.ts: a bare
// mock avoids ever loading the real next-auth module outside Next's bundler.
vi.mock("@/lib/auth", () => ({ auth: vi.fn<() => Promise<Session | null>>() }));
// `requestLocale` reads `next/headers`' `headers()`, which only resolves
// inside a real Next request scope — absent here since the page is invoked
// directly. An empty header set negotiates down to the shop's default
// locale, same as a real request that sends no Accept-Language.
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const { getDb } = await import("@/db/client");
const authModule = (await import("@/lib/auth")) as unknown as {
  auth: ReturnType<typeof vi.fn<() => Promise<Session | null>>>;
};
const auth = authModule.auth;
const EmbedSettingsPage = (await import("./page")).default;
const { SnippetField } = await import("./SnippetField");

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

const staffSession = (shopId: string, personId: string): Session => ({
  user: {
    personId,
    shopId,
    shopSlug: "blue-mantis",
    name: "Dana Reyes",
    roles: ["owner"],
  },
  expires: new Date(Date.now() + 60_000).toISOString(),
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

describe("EmbedSettingsPage attribution", () => {
  it("appends a crawlable Powered-by-DiveDay backlink after the iframe, carrying UTM params", async () => {
    const { db, shop, personId } = await seededContext();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(staffSession(shop.id, personId));
    const previousAppHost = process.env.APP_HOST;
    // Loopback http is only rejected in production (checkPublicHost) — a
    // vitest worker's NODE_ENV isn't "production", so this resolves.
    process.env.APP_HOST = "http://localhost:3000";
    try {
      const element = await EmbedSettingsPage();
      const snippetFields = findElements<{ label: string; snippet: string }>(element, SnippetField);
      const iframeField = snippetFields.find((field) => field.props.snippet.includes("<iframe"));
      expect(iframeField).toBeDefined();
      const snippet = iframeField?.props.snippet ?? "";

      // The anchor must come after the iframe's own closing tag — in the
      // shop's page HTML, not inside the framed document — or a crawler
      // won't attribute the backlink to the shop's page.
      const iframeEnd = snippet.indexOf("</iframe>");
      const anchorStart = snippet.indexOf("<a href=");
      expect(iframeEnd).toBeGreaterThan(-1);
      expect(anchorStart).toBeGreaterThan(iframeEnd);

      // The iframe's own src must carry no UTM params — those belong to the
      // outer backlink only.
      const iframeTag = snippet.slice(0, iframeEnd);
      expect(iframeTag).not.toContain("utm_source");

      expect(snippet).toContain("utm_source=embed");
      expect(snippet).toContain("utm_medium=widget");
      expect(snippet).toContain(`utm_campaign=${shop.slug}`);
    } finally {
      process.env.APP_HOST = previousAppHost;
    }
  });
});
