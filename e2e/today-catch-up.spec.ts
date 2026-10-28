import path from "node:path";
import { DEV_STAFF_LOGINS } from "../src/db/dev-credentials";
import { test as base, expect, makeActivitySafe } from "./fixtures";
import { todayCatchUpScenario } from "./today-catch-up-helper";

type CatchUpActorStates = { owner: string; captain: string };
type InterceptedShopRequest = {
  method: string;
  path: string;
  resourceType: string;
  isNavigationRequest: boolean;
  isPrefetch: boolean;
};

const test = base.extend<Record<never, never>, { catchUpActorStates: CatchUpActorStates }>({
  // Worker fixtures are ready before the test-scoped demoReset fixture. Sign in
  // both actors here, but abort the post-auth shop navigation so Today cannot
  // initialize its read mark before the reset or before this test's baseline.
  catchUpActorStates: [
    async ({ browser, workerBaseURL }, use, workerInfo) => {
      const states = {} as CatchUpActorStates;
      for (const role of ["owner", "captain"] as const) {
        const context = await browser.newContext({
          baseURL: workerBaseURL,
          storageState: { cookies: [], origins: [] },
          javaScriptEnabled: false,
          serviceWorkers: "block",
        });
        const page = makeActivitySafe(await context.newPage());
        const interceptedShopRequests: InterceptedShopRequest[] = [];
        const todayInitializationRequests: string[] = [];
        let pendingShopRouteHandlers = 0;
        let redirectPath: string | undefined;
        let resolveRedirectRequest!: (request: InterceptedShopRequest) => void;
        const redirectRequest = new Promise<InterceptedShopRequest>((resolve) => {
          resolveRedirectRequest = resolve;
        });
        let resolveRedirectFailure!: () => void;
        const redirectFailure = new Promise<void>((resolve) => {
          resolveRedirectFailure = resolve;
        });
        page.on("request", (request) => {
          const url = new URL(request.url());
          if (request.method() === "POST" && url.pathname === "/shop/blue-mantis") {
            todayInitializationRequests.push(`${request.method()} ${url.pathname}`);
          }
        });
        page.on("requestfailed", (request) => {
          if (
            redirectPath &&
            new URL(request.url()).pathname === redirectPath &&
            request.isNavigationRequest()
          ) {
            resolveRedirectFailure();
          }
        });
        await page.route("**/shop/**", async (route) => {
          pendingShopRouteHandlers += 1;
          const request = route.request();
          const headers = request.headers();
          const intercepted: InterceptedShopRequest = {
            method: request.method(),
            path: new URL(request.url()).pathname,
            resourceType: request.resourceType(),
            isNavigationRequest: request.isNavigationRequest(),
            isPrefetch:
              headers["next-router-prefetch"] === "1" ||
              headers.purpose === "prefetch" ||
              headers["sec-purpose"]?.includes("prefetch") === true,
          };
          try {
            await route.abort();
            interceptedShopRequests.push(intercepted);
            if (
              redirectPath === intercepted.path &&
              intercepted.isNavigationRequest &&
              !intercepted.isPrefetch
            ) {
              resolveRedirectRequest(intercepted);
            }
          } finally {
            pendingShopRouteHandlers -= 1;
          }
        });
        try {
          await page.goto("/sign-in");
          await page.getByLabel("Email").fill(DEV_STAFF_LOGINS[role].email);
          await page.getByLabel("Password").fill(DEV_STAFF_LOGINS[role].password);
          const signedIn = page.waitForResponse(
            (response) =>
              response.request().method() === "POST" &&
              new URL(response.url()).pathname === "/sign-in",
          );
          await page.getByRole("button", { name: "Sign in" }).click();
          const signInResponse = await signedIn;
          expect(signInResponse.status()).toBe(303);
          expect(signInResponse.headers()["x-action-redirect"]).toBeUndefined();
          const location = signInResponse.headers().location;
          expect(location).toBeTruthy();
          redirectPath = new URL(location, workerBaseURL).pathname;
          const alreadyIntercepted = interceptedShopRequests.find(
            (request) =>
              request.path === redirectPath && request.isNavigationRequest && !request.isPrefetch,
          );
          const blockedRedirect = alreadyIntercepted ?? (await redirectRequest);
          expect(blockedRedirect.path).toBe(redirectPath);
          expect(blockedRedirect.resourceType).toBe("document");
          expect(blockedRedirect.isNavigationRequest).toBe(true);
          expect(blockedRedirect.isPrefetch).toBe(false);
          await redirectFailure;
          expect(pendingShopRouteHandlers).toBe(0);
          expect(todayInitializationRequests).toEqual([]);
          const sessionCookies = (await context.cookies()).filter((cookie) =>
            cookie.name.includes("session_token"),
          );
          expect(sessionCookies.length).toBeGreaterThan(0);
          const statePath = path.join(
            workerInfo.project.outputDir,
            `.today-catch-up-${role}-${workerInfo.parallelIndex}.json`,
          );
          await context.storageState({ path: statePath });
          states[role] = statePath;
        } finally {
          await context.close();
        }
      }
      await use(states);
    },
    { scope: "worker" },
  ],
});

test.use({
  storageState: async ({ catchUpActorStates }, use) => {
    await use(catchUpActorStates.owner);
  },
});

test("Today catches the other staffer's walk-in and remembers Got it", async ({
  browser,
  page,
  workerBaseURL,
  catchUpActorStates,
}) => {
  const { reader, readerContext } = await todayCatchUpScenario(
    browser,
    page,
    workerBaseURL,
    catchUpActorStates.captain,
  );
  try {
    const strip = reader.getByRole("region", { name: /Since / });
    await expect(strip).toContainText("Today Catchup Diver took a seat.");
    await expect(strip).toContainText("Two-Tank Reef — Molasses & French");
    await strip.getByRole("button", { name: "Got it" }).click();
    await expect(strip).toHaveCount(0);
    await reader.reload();
    await expect(reader.getByRole("region", { name: /Since / })).toHaveCount(0);
  } finally {
    await readerContext.close();
  }
});
