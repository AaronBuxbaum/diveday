import { describe, expect, it } from "vitest";
import { capabilityRefusalProblems, routeProblems } from "./check-capability-refusals.mjs";

describe("routeProblems", () => {
  it("passes a route that answers in the page and catches its own errors", () => {
    expect(
      routeProblems("x/[token]", { "x/page.tsx": "return <Dead />" }, ["page.tsx", "error.tsx"]),
    ).toEqual([]);
  });

  it("refuses a notFound() anywhere under the route", () => {
    expect(
      routeProblems("x/[token]", { "x/_lib/load.ts": "if (!row) notFound();" }, [
        "page.tsx",
        "error.tsx",
      ]),
    ).toHaveLength(1);
  });

  it("refuses a route with no error.tsx", () => {
    expect(routeProblems("x/[token]", {}, ["page.tsx"])).toHaveLength(1);
  });
});

describe("the capability routes as they stand", () => {
  it("are the known nine, and every one refuses in place", async () => {
    const { problems, routes } = await capabilityRefusalProblems();
    expect(problems).toEqual([]);
    expect(routes).toBe(9);
  });
});
