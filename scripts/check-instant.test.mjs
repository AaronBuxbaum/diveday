import { describe, expect, it } from "vitest";
import { instantProblems, layoutProblems, pageProblems } from "./check-instant.mjs";

const INSTANT = "export const instant = true;\nexport default function Page() { return (<p />); }";

describe("pageProblems", () => {
  it("allows only sign-in to wait for complete native-form HTML", () => {
    expect(pageProblems("sign-in/page.tsx", "export const instant = false;", false)).toEqual([]);
    expect(
      pageProblems("other/page.tsx", "export const instant = false;", false).length,
    ).toBeGreaterThan(0);
    expect(pageProblems("sign-in/page.tsx", INSTANT, true).length).toBeGreaterThan(0);
    expect(
      pageProblems("sign-in/page.tsx", "export const instant = false; <Suspense>", false).length,
    ).toBeGreaterThan(0);
  });

  it("passes a page that claims instant under a loading.tsx", () => {
    expect(pageProblems("a/page.tsx", INSTANT, true)).toEqual([]);
  });

  it("passes a page that places its own Suspense instead", () => {
    expect(pageProblems("a/page.tsx", `${INSTANT}\n<Suspense>`, false)).toEqual([]);
  });

  it("refuses a page with no instant claim, and one with no boundary", () => {
    expect(
      pageProblems("a/page.tsx", "export default function Page() { return (<p />); }", true),
    ).toHaveLength(1);
    expect(pageProblems("a/page.tsx", INSTANT, false)).toHaveLength(1);
  });

  it("reads a claim in a comment as no claim", () => {
    const commented =
      "// export const instant = true\nexport default function P() { return (<p />); }";
    expect(pageProblems("a/page.tsx", commented, true)).toHaveLength(1);
  });

  it("lets a page that only redirects through", () => {
    expect(
      pageProblems("a/page.tsx", "export default function P() { redirect('/x'); }", false),
    ).toEqual([]);
  });
});

describe("layoutProblems", () => {
  const blocking = new Set(["slow/layout.tsx"]);

  it("refuses an async layout that is not a known blocking shell", () => {
    expect(
      layoutProblems("x/layout.tsx", "export default async function L() {}", blocking),
    ).toHaveLength(1);
  });

  it("holds a blocking shell to its instant = false, in both directions", () => {
    const shell = "export const instant = false;\nexport default async function L() {}";
    expect(layoutProblems("slow/layout.tsx", shell, blocking)).toEqual([]);
    expect(
      layoutProblems("slow/layout.tsx", "export default async function L() {}", blocking),
    ).toHaveLength(1);
    expect(layoutProblems("x/layout.tsx", shell, blocking).length).toBeGreaterThan(0);
  });
});

describe("the route tree as it stands", () => {
  it("has no route that can lose instant navigation", async () => {
    expect((await instantProblems()).problems).toEqual([]);
  });
});
