import demoShop from "./demo-shop.json";

/**
 * The seeded demo shop's slug, on its own so a page or route that needs only
 * the slug never imports the demo logins in `dev-credentials.ts`. The value
 * lives in `demo-shop.json`, which the `.mjs` scripts read too.
 */
export const DEMO_SHOP_SLUG = demoShop.slug;
