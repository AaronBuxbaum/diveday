/**
 * Next ships path-to-regexp pre-bundled and untyped. `src/lib/auth.config.test.ts`
 * compiles the legacy-redirect `source` patterns with the *same* build Next's
 * own `load-custom-routes` uses, so the test matches what production matches
 * rather than a hand-rolled approximation of path-to-regexp's syntax.
 *
 * Only the one function and the three options Next passes are declared — a
 * narrow surface on purpose, since this is an internal path.
 */
declare module "next/dist/compiled/path-to-regexp" {
  export function pathToRegexp(
    path: string,
    keys?: unknown[],
    options?: { strict?: boolean; sensitive?: boolean; delimiter?: string },
  ): RegExp;
}
