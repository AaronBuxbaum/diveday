import { eq } from "drizzle-orm";
import { isValidElement } from "react";
import { describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { personRoles } from "@/db/schema";
import { getShopBySlug } from "@/db/shops";
import { staffTranslator } from "@/i18n/staff-messages";
import type { DiveDaySession } from "@/lib/auth";
import type { Role } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
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
  else if (
    isValidElement<{
      children?: unknown;
      actions?: unknown;
      label?: unknown;
      title?: unknown;
      "aria-label"?: unknown;
    }>(node)
  ) {
    if (typeof node.props.title === "string") found.push(node.props.title);
    if (typeof node.props["aria-label"] === "string") found.push(node.props["aria-label"]);
    if (typeof node.props.label === "string") found.push(node.props.label);
    textIn(node.props.actions, found);
    textIn(node.props.children, found);
  }
  return found;
}

/** The figures handed to `MonthFigures`, label and value, wherever they sit in the tree. */
function figuresIn(node: unknown): { label: string; value: string }[] {
  if (Array.isArray(node)) return node.flatMap((child) => figuresIn(child));
  if (!isValidElement<{ children?: unknown; figures?: unknown }>(node)) return [];
  if (Array.isArray(node.props.figures))
    return node.props.figures as { label: string; value: string }[];
  return figuresIn(node.props.children);
}

async function renderTree(viewerRoles: Role[], searchParams: { year?: string } = {}) {
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
  return SafetyReportPage({
    params: Promise.resolve({ shopSlug: "blue-mantis" }),
    searchParams: Promise.resolve(searchParams),
  });
}

async function renderAs(viewerRoles: Role[], searchParams: { year?: string } = {}) {
  return textIn(await renderTree(viewerRoles, searchParams)).join("\n");
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
    expect(text).toContain("Print month");
    expect(text).toContain("Year view");
  });

  /**
   * **Four doors, no prose** (visual review A05, A27): the month is four
   * counts, each a link to the list behind it, and no paragraph explains them.
   */
  it("reads the month as four counts, each a door to its list", async () => {
    const figures = figuresIn(await renderTree(["owner"])) as {
      key: string;
      label: string;
      href?: string;
    }[];
    expect(figures.map((figure) => figure.key)).toEqual([
      "rollCalls",
      "certOverrides",
      "crew",
      "incidents",
    ]);
    for (const figure of figures) expect(figure.href, figure.key).toBeTruthy();
    const text = await renderAs(["owner"]);
    expect(text).not.toContain("What the shop recorded on departures");
    expect(text).not.toContain("The dock roll call won’t record");
  });

  it.each([["captain"], ["instructor"], ["divemaster"], ["crew"]] as const)(
    "turns a %s back to Today",
    async (role) => {
      await expect(renderAs([role])).rejects.toThrow(/NEXT_REDIRECT/);
    },
  );
});

/** The year the insurer renews on (fifth loop, item 33). */
describe("the Safety year", () => {
  it("reads the whole year under its own heading, with a way to print it", async () => {
    const year = String(nowDate().getUTCFullYear());
    const text = await renderAs(["owner"], { year });
    expect(text).toContain(year);
    expect(text).toContain("Month view");
    // The year shows the figures alone, so no figure may point at a list below it.
    expect(text).not.toContain("listed below");
    expect(text).not.toContain("this month");
  });

  it("prints whose record it is, over which days and when (review F3)", async () => {
    const year = String(nowDate().getUTCFullYear());
    const text = await renderAs(["owner"], { year });
    expect(text.replace(/\u00a0/g, " ")).toMatch(
      /Blue Mantis[^\n]* · January 1 to [^\n]*, \d{4} · /,
    );
    expect(text).toContain("Printed ");
  });

  it("counts filed incident reports and names drafts beside them (review F4)", async () => {
    const year = String(nowDate().getUTCFullYear());
    const figures = figuresIn(await renderTree(["owner"], { year }));
    const incidents = figures.find((figure) => figure.label === "Incident reports");
    expect(incidents?.value).toMatch(/^\d+ filed( · \d+ drafts?)?$/);
    const t = staffTranslator("en-US");
    expect(t("incidents.safety.incidentsValue", { filed: 3, drafts: 1 })).toBe("3 filed · 1 draft");
    expect(t("incidents.safety.incidentsValue", { filed: 2, drafts: 0 })).toBe("2 filed");
  });

  it("says year, not month, on its arrows (review S1)", async () => {
    const year = String(nowDate().getUTCFullYear());
    const text = await renderAs(["owner"], { year });
    expect(text).toContain("Choose a year");
    expect(text).not.toContain("Previous month");
    expect(text).not.toContain("Choose month");
  });

  it("reads a year it cannot have as the month", async () => {
    const text = await renderAs(["owner"], { year: "1999" });
    expect(text).toContain("Year view");
    expect(text).not.toContain("Month view");
  });
});
