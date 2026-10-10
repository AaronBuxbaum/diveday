import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];

vi.mock("next/server", () => ({
  after: (task: () => void) => calls.push(`after:${typeof task}`),
  connection: async () => {
    calls.push("connection");
  },
}));

vi.mock("./query-timing", () => ({
  reportRenderQueries: (route: string, schedule: unknown, options?: { fallback?: boolean }) =>
    calls.push(`report:${route}:${typeof schedule}:${options?.fallback ?? "own"}`),
}));

const { connectionForRoute } = await import("./render-connection");

beforeEach(() => {
  calls.length = 0;
});

describe("connectionForRoute", () => {
  it("defers to the request first, then names the render with `after` as its scheduler", async () => {
    await connectionForRoute("/ready/[token]");

    expect(calls).toEqual(["connection", "report:/ready/[token]:function:own"]);
  });

  it("passes a layout's fallback label through", async () => {
    await connectionForRoute("/s/**", { fallback: true });

    expect(calls).toEqual(["connection", "report:/s/**:function:true"]);
  });
});
