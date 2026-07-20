import { type APIRequestContext, request } from "@playwright/test";
import { DEMO_SHOP_SLUG, DEV_STAFF_LOGINS } from "../src/db/dev-credentials";
import { e2eBaseURL, e2eWorkerIndexes } from "./servers";

// Public routes whose first render does the heavy lifting (module graph load,
// DB query paths, React tree). GETting them warms those paths on every server.
const PUBLIC_WARM_ROUTES = ["/", "/sign-in", `/shop/${DEMO_SHOP_SLUG}/schedule`];

// Staff surfaces are the heaviest first renders and can't be reached without a
// session — an unwarmed one landing on the first test that opens it can exceed
// that test's timeout. Warm the top-level ones behind a signed-in context.
const STAFF_WARM_ROUTES = [
  `/shop/${DEMO_SHOP_SLUG}`,
  `/shop/${DEMO_SHOP_SLUG}/divers`,
  `/shop/${DEMO_SHOP_SLUG}/gear`,
  `/shop/${DEMO_SHOP_SLUG}/nitrox`,
  `/shop/${DEMO_SHOP_SLUG}/courses`,
  `/shop/${DEMO_SHOP_SLUG}/dive-sites`,
  `/shop/${DEMO_SHOP_SLUG}/waivers`,
  `/shop/${DEMO_SHOP_SLUG}/trips/new`,
];

/** Sign in with the owner's dev credentials so the context carries a session. */
async function signInOwner(context: APIRequestContext): Promise<void> {
  const csrf = await context.get("/api/auth/csrf", { timeout: 100_000 });
  const { csrfToken } = (await csrf.json()) as { csrfToken: string };
  await context.post("/api/auth/callback/credentials", {
    timeout: 100_000,
    form: {
      csrfToken,
      email: DEV_STAFF_LOGINS.owner.email,
      password: DEV_STAFF_LOGINS.owner.password,
      callbackUrl: `/shop/${DEMO_SHOP_SLUG}`,
    },
  });
}

/**
 * The first request that touches a worker's database pays getDb()'s one-time
 * migrate + seed; the first render of each route pays its one-time module and
 * query initialization. Every test's beforeEach also calls /api/test/reset
 * (e2e/fixtures.ts), which reseeds. Pay all of that on every worker server
 * here, in parallel, before any test's clock starts — otherwise the first
 * tests scheduled onto each server absorb it and can exceed their timeout.
 */
export default async function globalSetup() {
  await Promise.all(
    e2eWorkerIndexes.map(async (i) => {
      const context = await request.newContext({ baseURL: e2eBaseURL(i) });
      try {
        await context.post("/api/test/reset", { timeout: 100_000 });
        await signInOwner(context);
        for (const route of [...PUBLIC_WARM_ROUTES, ...STAFF_WARM_ROUTES]) {
          await context.get(route, { timeout: 100_000 }).catch(() => {});
        }
      } finally {
        await context.dispose();
      }
    }),
  );
}
