import { eq } from "drizzle-orm";
import { isValidElement } from "react";
import { describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { personRoles } from "@/db/schema";
import { getShopBySlug } from "@/db/shops";
import type { DiveDaySession } from "@/lib/auth";
import type { Role } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import { seededTestDb } from "@/test/db";
import { nextHeadersStub } from "@/test/next-headers";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "@/test/staff-session";

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
const SafetyPrintPage = (await import("./page")).default;
const SafetyReportPage = (await import("../page")).default;

type Figure = { key: string; label: string; value: string; detail?: string; href?: string };

function walk(
  node: unknown,
  visit: (el: { type: unknown; props: Record<string, unknown> }) => void,
) {
  if (Array.isArray(node)) for (const child of node) walk(child, visit);
  else if (isValidElement<Record<string, unknown>>(node)) {
    visit(node as never);
    walk(node.props.children, visit);
  }
}

function textIn(node: unknown, found: string[] = []): string[] {
  if (typeof node === "string") found.push(node);
  else if (Array.isArray(node)) for (const child of node) textIn(child, found);
  else if (isValidElement<{ children?: unknown }>(node)) textIn(node.props.children, found);
  return found;
}

function figuresIn(node: unknown): Figure[] {
  const found: Figure[] = [];
  walk(node, (el) => {
    if (Array.isArray(el.props.figures)) found.push(...(el.props.figures as Figure[]));
  });
  return found;
}

async function signIn(roles: Role[]) {
  const db: AppDb = await seededTestDb();
  const shop = await getShopBySlug(db, "blue-mantis");
  if (!shop) throw new Error("demo shop missing");
  const viewer = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  await db.delete(personRoles).where(eq(personRoles.personId, viewer));
  await db.insert(personRoles).values(roles.map((role) => ({ personId: viewer, role })));
  vi.mocked(getDb).mockResolvedValue(db);
  vi.mocked(auth).mockResolvedValue({
    user: {
      personId: viewer,
      shopId: shop.id,
      shopSlug: "blue-mantis",
      name: "Viewer",
      email: SEEDED_OWNER_EMAIL,
      roles,
    },
  });
}

async function printTree(roles: Role[], searchParams: { month?: string; year?: string } = {}) {
  await signIn(roles);
  return SafetyPrintPage({
    params: Promise.resolve({ shopSlug: "blue-mantis" }),
    searchParams: Promise.resolve(searchParams),
  });
}

/**
 * **The Safety record as a sheet** (issue #2745). It is safety evidence a
 * broker or an inspector reads, so it must carry every figure the screen does.
 */
describe("the Safety sheet", () => {
  it("carries every figure the screen shows, in the same order, without a door", async () => {
    await signIn(["owner"]);
    const params = { params: Promise.resolve({ shopSlug: "blue-mantis" }) };
    const screen = figuresIn(
      await SafetyReportPage({ ...params, searchParams: Promise.resolve({}) }),
    );
    const sheet = figuresIn(await printTree(["owner"]));
    expect(sheet.length).toBeGreaterThan(0);
    expect(sheet.map(({ key, label, value, detail }) => [key, label, value, detail])).toEqual(
      screen.map(({ key, label, value, detail }) => [key, label, value, detail]),
    );
    for (const figure of sheet) {
      expect(figure.href, figure.key).toBeUndefined();
      expect(figure, figure.key).not.toHaveProperty("link");
    }
  });

  it("carries every figure of the year, saying whose record it is and when it was printed", async () => {
    const year = String(nowDate().getUTCFullYear());
    await signIn(["owner"]);
    const screen = figuresIn(
      await SafetyReportPage({
        params: Promise.resolve({ shopSlug: "blue-mantis" }),
        searchParams: Promise.resolve({ year }),
      }),
    );
    const tree = await printTree(["owner"], { year });
    expect(figuresIn(tree).map((figure) => figure.value)).toEqual(
      screen.map((figure) => figure.value),
    );
    const text = textIn(tree).join("\n").replace(/ /g, " ");
    expect(text).toMatch(/Blue Mantis[^\n]* · January 1 to [^\n]*, \d{4} · /);
    expect(text).toContain("Printed ");
    expect(text).toContain(year);
  });

  it("is the Reports gate: a diver-facing role goes back to Today", async () => {
    await expect(printTree(["crew"])).rejects.toThrow(/NEXT_REDIRECT/);
  });

  it("holds no link and no button", async () => {
    const tree = await printTree(["owner"]);
    const doors: string[] = [];
    walk(tree, (el) => {
      if (typeof el.type === "string" && ["a", "button"].includes(el.type)) doors.push(el.type);
    });
    expect(doors).toEqual([]);
  });
});
