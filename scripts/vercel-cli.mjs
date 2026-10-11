// How every script runs the Vercel CLI: `pnpm dlx` at one pinned version, never
// a devDependency. The CLI's own tree (undici 6.x, @fastify/busboy, braces)
// carried most of `pnpm audit`'s advisories into every `pnpm install`, for a
// tool a person runs a few times a year from the deploy wizards. Bump the pin
// here, deliberately; `pnpm dlx` caches it after the first run.
export const VERCEL_CLI_PACKAGE = "vercel@62.5.0";

/** The pnpm argv prefix: `pnpm ...VERCEL_CLI <vercel arguments>`. */
export const VERCEL_CLI = ["dlx", VERCEL_CLI_PACKAGE];
