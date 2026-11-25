/** One production-equivalent environment for CI typegen and the browser build. */
export function e2eBuildEnv(env = process.env) {
  return {
    ...env,
    APP_HOST: "https://e2e.diveday.example",
    DATABASE_URL: "",
    DATABASE_URL_UNPOOLED: "",
    PGLITE_DATA_DIR: "memory",
    DIVEDAY_E2E: "1",
    // The default offer: free, with 1% of money recorded as received (see pricing-flags.ts).
    PRICING_MONTHLY_CENTS: "0",
    PRICING_BASIS_POINTS: "100",
    NEXT_PUBLIC_SENTRY_DSN: "",
  };
}
