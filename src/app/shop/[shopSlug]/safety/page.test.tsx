import { eq } from "drizzle-orm";
import { isValidElement } from "react";
import { describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { personRoles } from "@/db/schema";
import { getShopBySlug } from "@/db/shops";
import type { DiveDaySession } from "@/lib/auth";
import type { Role } from "@/lib/authz";
import { seededTestDb } from "@/test/db";
import { nextHeadersStub } from "@/test/next-headers";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "@/test/staff-session";

// Invoked directly, outside Next's request scope: the db handle, better-auth
// and request headers are stubbed and nothing else. The gate re-reads the
// viewer's live `person_roles`, so each case rewrites them.
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn<() => Promise<DiveDaySession | null>>() }));
vi.mock("next/headers", () => nextHeadersStub());

const { getDb } = await import("@/db/client");
const { auth } = (await import("@/lib/auth")) as unknown as {
  auth: ReturnType<typeof vi.fn<() => Promise<DiveDaySession | null>>>;
};
const SafetyReportPage = (await import("./page")).default;

function textIn(node: unknown, found: string[] = []): string[] {
  if (typeof node === "string") found.push(node);
  else if (Array.isArray(node)) for (const child of node) textIn(child, found);
  else if (isValidElement<{ children?: unknown; title?: unknown }>(node)) {
    if (typeof node.props.title === "string") found.push(node.props.title);
    textIn(node.props.children, found);
  }
  return found;
}

async function renderAs(viewerRoles: Role[]) {
  const db: AppDb = await seededTestDb();
  const shop = await getShopBySlug(db, "blue-mantis");
  if (!shop) throw new Error("demo shop missing");
  const viewer = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  await db.delete(personRoles).where(eq(personRoles.personId, viewer));
  await db.insert(personRoles).values(viewerRoles.map((role) => ({ personId: viewer, role })));
  vi.mocked(getDb).mockResolvedValue(db);
  vi.mocked(auth).mockResolvedValue({
    user: {
      personId: viewer,
      shopId: shop.id,
      shopSlug: "blue-mantis",
      name: "Viewer",
      email: SEEDED_OWNER_EMAIL,
      roles: viewerRoles,
    },
  });
  const tree = await SafetyReportPage({
    params: Promise.resolve({ shopSlug: "blue-mantis" }),
    searchParams: Promise.resolve({}),
  });
  return textIn(tree).join("\n");
}

/**
 * **The Safety page is on the Reports gate** (ADR 20261012-incident-reports):
 * owners and managers, re-read from the database. The e2e signs in only as
 * the owner (the demo shop has no manager login), so the manager is pinned
 * here. It is a destination of its own (#2398), so its heading is "Safety", not Money's.
 */
describe("the Safety page", () => {
  it.each([["owner"], ["manager"]] as const)("opens for a %s", async (role) => {
    const text = await renderAs([role]);
    expect(text).toContain("Safety");
    expect(text).not.toContain("Money");
    expect(text).toContain("What the shop recorded on departures that left this month");
  });

  it.each([["captain"], ["instructor"], ["divemaster"], ["crew"]] as const)(
    "turns a %s back to Today",
    async (role) => {
      await expect(renderAs([role])).rejects.toThrow(/NEXT_REDIRECT/);
    },
  );
});
