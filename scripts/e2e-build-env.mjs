/** One production-equivalent environment for CI typegen and the browser build. */
export function e2eBuildEnv(env = process.env) {
  return {
    ...env,
    APP_HOST: "https://e2e.diveday.example",
    DATABASE_URL: "",
    DATABASE_URL_UNPOOLED: "",
    PGLITE_DATA_DIR: "memory",
    DIVEDAY_E2E: "1",
    // Stable legacy-offer fixture; default percentage copy is covered in marketing-pricing.test.tsx.
    PRICING_MONTHLY_CENTS: "9900",
    PRICING_BASIS_POINTS: "0",
    NEXT_PUBLIC_SENTRY_DSN: "",
  };
}
