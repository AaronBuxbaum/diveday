/**
 * How a compiled-in default and an environment override combine.
 *
 * Some configuration is not configuration: DiveDay's own public origin, its
 * sender address, its Stripe Connect client id, its Sentry DSN. None is a
 * secret and none varies per deployment, yet each used to be carried out of
 * `.env.example` into Secrets Manager, written into three generated files, and
 * pushed to Vercel on every deploy -- so that the deployment could be told a
 * value this repository already knows. That round trip is not free: it is what
 * corrupted the SES sender in issue #517, where quote characters survived the
 * journey and every production email failed.
 *
 * So those values live beside the code that reads them now, and the
 * environment variable remains only as an override -- for a fork, a staging
 * deploy, or a self-hosted instance that needs its own. `alertRecipient` in
 * `platform-mail.ts` has always worked this way; this is that pattern, named.
 *
 * The three cases are deliberately distinct, and `||` cannot express them:
 *
 * | The variable is | Result | Why |
 * | --- | --- | --- |
 * | absent | the compiled default | nobody has an opinion, so use DiveDay's |
 * | set, non-empty | that value | somebody has an opinion |
 * | set, **empty** | `undefined` -- off | somebody has the opinion "none" |
 *
 * The empty case is load-bearing rather than pedantic. `pnpm e2e:build` runs
 * `DATABASE_URL= NEXT_PUBLIC_SENTRY_DSN= next build` precisely to switch those
 * off, and this repo uses that idiom elsewhere. A `||` fallback would read an
 * empty assignment as "no preference" and hand back the real Sentry DSN, so
 * the e2e suite would start reporting to production error monitoring -- the
 * exact thing the empty assignment was written to prevent.
 */

/**
 * Resolve one value from its override and its compiled default.
 *
 * Returns `undefined` only for an explicit empty override, which every caller
 * must treat the same way it treats a value that was never configured.
 */
export function configuredValue(
  override: string | undefined,
  fallback: string,
): string | undefined {
  if (override === undefined) return fallback;
  const trimmed = override.trim();
  return trimmed === "" ? undefined : trimmed;
}
