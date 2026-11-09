import { expect, test as fixtures } from "./fixtures";

// Deliberately refuse browser setup: request-only specs must still get the
// automatic demo reset, but not a browser, context, page or hydration probe.
const test = fixtures.extend({
  browser: [
    async () => {
      throw new Error("request-only test created a browser");
    },
    { scope: "worker" },
  ],
  context: async () => {
    throw new Error("request-only test created a browser context");
  },
  page: async () => {
    throw new Error("request-only test created a page");
  },
});

test("request-only fixtures stay browser-free", async ({ request }) => {
  const response = await request.get("/");
  expect(response.ok()).toBe(true);
});
