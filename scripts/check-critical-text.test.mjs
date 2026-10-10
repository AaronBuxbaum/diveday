import { describe, expect, it } from "vitest";

import { runGuard } from "./guard-fixture.mjs";

/** The five files the guard reads, each carrying exactly the needles it looks for. */
const surfaces = () => ({
  "docs/design/principles.md":
    "2. Critical text is any text a person reads to make a decision or to identify a record.\n",
  "src/components/search/CommandPalette.tsx":
    '<input className="w-full px-5 py-4 text-base outline-none focus-ring-inset" />\n',
  "src/components/PublicShopNav.tsx": 'const linkClass =\n  "rounded px-3 py-2 text-base";\n',
  "src/app/shop/[shopSlug]/orders/_components/OrdersLedger.tsx": [
    '<span className="truncate text-base font-medium sm:w-56 sm:shrink-0" />',
    '<span className="text-base text-muted text-pretty sm:truncate sm:text-sm" />',
    '<span className="min-w-20 text-end text-base font-semibold tabular-nums" />',
  ].join("\n"),
  "src/app/s/[shopSlug]/_components/WeekLedger.tsx": [
    '<b className="text-base font-bold tracking-[0.18em] uppercase" />',
    '<b className="text-base font-medium tracking-[0.18em] text-muted uppercase" />',
    '<i className="text-base text-muted tabular-nums" />',
    '<i className="text-base font-semibold tabular-nums" />',
  ].join("\n"),
});

const run = (overrides = {}) =>
  runGuard("check-critical-text.mjs", { ...surfaces(), ...overrides });

describe("check-critical-text", () => {
  it("passes when every named surface keeps its 16px floor", () => {
    const result = run();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("named phone surfaces keep critical text at 16px");
  });

  it("refuses when design principle 2 loses its definition", () => {
    const result = run({ "docs/design/principles.md": "2. Text matters.\n" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("critical-text: design principle 2: missing");
  });

  it("refuses a search field that dropped to 14px", () => {
    const result = run({
      "src/components/search/CommandPalette.tsx":
        '<input className="w-full px-5 py-4 text-sm outline-none focus-ring-inset" />\n',
    });
    expect(result.stderr).toContain("the search field must remain 16px");
  });

  it("refuses shopfront nav labels that drop to 14px on phones, and say so", () => {
    const { stderr } = run({
      "src/components/PublicShopNav.tsx": 'const linkClass = "px-3 text-sm sm:text-base";\n',
    });
    expect(stderr).toContain("shopfront nav labels must not drop to 14px on phones");
  });

  it("names the orders ledger cell that lost its size", () => {
    const { stderr } = run({
      "src/app/shop/[shopSlug]/orders/_components/OrdersLedger.tsx":
        '<span className="truncate text-base font-medium sm:w-56 sm:shrink-0" />\n',
    });
    expect(stderr).toContain("orders phone trip titles must be 16px on phones");
    expect(stderr).toContain("orders amounts must be 16px on phones");
    expect(stderr).not.toContain("orders person names");
  });

  it("refuses public schedule prices that shrank", () => {
    const { status, stderr } = run({
      "src/app/s/[shopSlug]/_components/WeekLedger.tsx": [
        '<b className="text-base font-bold tracking-[0.18em] uppercase" />',
        '<b className="text-base font-medium tracking-[0.18em] text-muted uppercase" />',
        '<i className="text-base text-muted tabular-nums" />',
        '<i className="text-sm font-semibold tabular-nums" />',
      ].join("\n"),
    });
    expect(status).toBe(1);
    expect(stderr).toContain("public schedule row prices must be 16px on phones");
  });
});
