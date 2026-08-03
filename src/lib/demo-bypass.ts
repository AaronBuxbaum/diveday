import { isDemoAccountEmail } from "@/lib/demo-identity";

/**
 * The demo sign-in bypass, and *only* the demo sign-in bypass.
 *
 * It used to be three lines inside `verifyCredentials`, guarded by a single
 * `shop.isDemo` boolean read out of the database. That put a "this password
 * authenticates any account" branch in the middle of the production
 * credentials verifier, one dropped condition away from being universal, and
 * with a database column as its only gate — so anything that could set
 * `shops.is_demo` (a bad migration, an import bug, a future admin toggle)
 * could also turn `password` into a master key for a real tenant.
 *
 * This module is the whole decision. `verifyCredentials` imports one
 * predicate from it and never spells the bypass out itself, so the branch is
 * reviewable, testable, and greppable in one place.
 *
 * ## Why it still exists in production
 *
 * Per-visitor demo shops are a *production* feature: "Try the live demo"
 * mints a throwaway `isDemo` shop and signs the visitor into its generated
 * owner without ever storing or transmitting a real password (ADR
 * 20260724-per-visitor-demo-shops). Deleting the bypass from production
 * builds would delete that funnel. So the hardening here is not "off in
 * production" — it is **three independent conditions, all required**, of
 * which no single misconfiguration is enough:
 *
 *  1. A recognized runtime, and no operator kill switch (`demoBypassEnabled`).
 *  2. The shop row carries `is_demo` (the original condition).
 *  3. The account's email sits in the reserved, non-routable demo namespace
 *     (`*.demo.invalid`, {@link isDemoAccountEmail}) — which no real shop's
 *     account can ever be in, because onboarding and staff invites both mail
 *     that address and `.invalid` never resolves.
 *
 * (3) is the one that matters: flipping `is_demo` on a real tenant no longer
 * does anything, because that tenant's staff addresses are routable.
 *
 * ## The password is not a secret
 *
 * It is printed in the demo banner for the visitor to note down, so the
 * comparison below is a plain `===` on purpose — there is nothing to leak by
 * timing, and a timing-safe compare here would be cargo cult.
 */
export const DEMO_BYPASS_PASSWORD = "password";

/**
 * The kill switch's variable name. Set it to `off` to disable demo sign-in in
 * a deployment that should never have a demo tenant at all (a self-hosted
 * install, a compliance-scoped environment); leave it unset for the default
 * in ADR 20260724.
 */
export const DEMO_BYPASS_ENV_VAR = "DIVEDAY_DEMO_BYPASS";

/** The runtimes this app is ever built and run in. Anything else is a mystery, and mysteries fail closed. */
const RECOGNIZED_RUNTIMES = new Set(["development", "test", "production"]);

/**
 * Deliberately *not* `NodeJS.ProcessEnv`. Next's ambient types narrow
 * `NODE_ENV` to the three literals and mark it required, which would make the
 * "unset or unrecognized" branch below look like dead code to the compiler —
 * but that narrowing is a build-time fiction. At runtime the environment is a
 * plain string map that anything can have emptied, and a fail-closed guard
 * that trusts a type it cannot enforce is not a guard.
 */
export type RuntimeEnv = Readonly<Record<string, string | undefined>>;

/**
 * The environment half of the gate. Fails **closed** on anything it does not
 * recognize:
 *
 * - `NODE_ENV` unset, empty, or not one of development/test/production → the
 *   process is running somewhere we have not reasoned about (a stray script, a
 *   hand-rolled container, a runtime that stripped the env), so no bypass.
 * - `DIVEDAY_DEMO_BYPASS` set to anything other than `on`/`off` → an operator
 *   who set this variable meant to control it, and a typo (`0`, `false`,
 *   `disabled`, `OFF `) must never read as consent. Only the literal `on`
 *   re-enables it once the variable is present.
 * - `DIVEDAY_DEMO_BYPASS` unset → the ADR default, enabled, subject to every
 *   other condition in {@link demoBypassAccepted}.
 *
 * `env` is a parameter so this is testable without touching the real process
 * environment, and so no caller can be tempted to re-read `process.env`
 * itself and get the precedence wrong.
 */
export function demoBypassEnabled(env: RuntimeEnv = process.env): boolean {
  const runtime = env.NODE_ENV;
  if (!runtime || !RECOGNIZED_RUNTIMES.has(runtime)) return false;

  const flag = env[DEMO_BYPASS_ENV_VAR];
  if (flag === undefined || flag === "") return true;
  return flag === "on";
}

export type DemoBypassCandidate = {
  /** `shops.is_demo` for the shop the account belongs to. */
  shopIsDemo: boolean;
  /** `user_accounts.email` for the account being verified — empty string when there is no account. */
  accountEmail: string;
  /** The password as submitted. */
  password: string;
};

/**
 * Whether this sign-in attempt may use the demo bypass. Every condition is
 * required; the order is cheapest-first and none of them is optional.
 *
 * Callers must treat `false` as "no opinion", not "wrong password" — the real
 * bcrypt compare is the primary check and this only ever *adds* an admission
 * for a demo tenant.
 */
export function demoBypassAccepted(
  candidate: DemoBypassCandidate,
  env: RuntimeEnv = process.env,
): boolean {
  if (!demoBypassEnabled(env)) return false;
  if (!candidate.shopIsDemo) return false;
  if (!isDemoAccountEmail(candidate.accountEmail)) return false;
  return candidate.password === DEMO_BYPASS_PASSWORD;
}
