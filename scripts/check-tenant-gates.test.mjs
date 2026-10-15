import { describe, expect, it } from "vitest";
import {
  gateOf,
  reexportTarget,
  staffPageGates,
  tenantGateProblems,
} from "./check-tenant-gates.mjs";

describe("gateOf", () => {
  it("reads the helper, either inline comparison, or nothing", () => {
    expect(gateOf("const { shop } = await requireShopSurface(shopSlug);")).toBe("helper");
    expect(gateOf("if (shop.id !== session.user.shopId) notFound();")).toBe("by-hand");
    expect(gateOf("if (shop.slug !== shopSlug) notFound();")).toBe("by-hand");
    expect(gateOf("const shop = await getShopById(db, session.user.shopId);")).toBeNull();
  });

  it("does not take a comment naming the gate for the gate", () => {
    expect(
      gateOf("// requireShopSurface(shopSlug) is asked by the shell\nconst x = 1;"),
    ).toBeNull();
    expect(gateOf("/* requireShopSurface(shopSlug) */ const x = 1;")).toBeNull();
  });
});

describe("reexportTarget", () => {
  it("follows a bare re-export of default to its sibling", () => {
    expect(reexportTarget('export { default } from "./SettingsPage";')).toBe("SettingsPage");
    expect(reexportTarget("export default function Page() {}")).toBeNull();
  });
});

describe("tenantGateProblems", () => {
  const pages = (extra) =>
    Array.from({ length: 40 }, (_, index) => ({
      page: `p${index}/page.tsx`,
      where: `p${index}/page.tsx`,
      gate: "helper",
    })).concat(extra);

  it("refuses a page with no gate, naming the module it renders", () => {
    const problems = tenantGateProblems(
      pages([{ page: "x/page.tsx", where: "x/XPage.tsx", gate: null }]),
      [],
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("x/XPage.tsx");
  });

  it("refuses a by-hand comparison nobody listed, and a listed page that stopped", () => {
    expect(
      tenantGateProblems(pages([{ page: "y/page.tsx", where: "y/page.tsx", gate: "by-hand" }]), []),
    ).toHaveLength(1);
    expect(tenantGateProblems(pages([]), ["gone/page.tsx"])).toHaveLength(1);
  });

  it("refuses a walk that found almost nothing, so an empty tree is never green", () => {
    expect(tenantGateProblems([], [])).toHaveLength(1);
  });
});

describe("the staff tree as it stands", () => {
  it("gates every page, and compares by hand only where BY_HAND says why", async () => {
    expect(tenantGateProblems(await staffPageGates())).toEqual([]);
  });
});
